import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Submission redaction and public-read protection (F1 / F2).
 *
 * Two properties the adversarial review found were missing:
 *
 *   1. A credential pasted into an incident must not be persisted, and must not
 *      be served from a record written before the rule existed. New records are
 *      redacted before storage; historical records are redacted on read.
 *   2. `/api/records` and `/api/records/[recordId]` must be behind the shared
 *      read cap, so a caller cannot walk record ids to escape the limit.
 *
 * These exercise the real route handlers against a temp SQLite store, with the
 * memory backend forced to the simulated adapter so no Mainnet call is made.
 */

const TOKEN = "test-admin-token-redaction";
const READ_MAX = 2;

// Distinct client addresses keep each test's rate-limit bucket isolated.
const IP = {
  submit: "198.51.100.10",
  list: "198.51.100.11",
  detail: "198.51.100.12",
  legacy: "198.51.100.13",
};

let dir: string;
let submitPOST: (req: Request) => Promise<Response>;
let recordsGET: (req: Request) => Promise<Response>;
let recordByIdGET: (
  req: Request,
  ctx: { params: Promise<{ recordId: string }> },
) => Promise<Response>;
let incidentsGET: (req: Request) => Promise<Response>;
let learningGET: (req: Request) => Promise<Response>;
let resetPublicReadLimiters: () => void;

function jsonReq(url: string, body: unknown, ip: string): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
      "x-real-ip": ip,
    },
    body: JSON.stringify(body),
  });
}

function get(url: string, ip: string): Request {
  return new Request(url, { headers: { "x-real-ip": ip } });
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "aftermath-redact-"));
  process.env.AFTERMATH_FORCE_MOCK_MEMORY = "1";
  process.env.AFTERMATH_DB_PATH = path.join(dir, "aftermath.db");
  process.env.DATABASE_URL = "";
  process.env.POSTGRES_URL = "";
  process.env.AFTERMATH_DATABASE_URL = "";
  process.env.AFTERMATH_ADMIN_TOKEN = TOKEN;
  process.env.AFTERMATH_RL_PUBLIC_READ_MAX = String(READ_MAX);
  ({ POST: submitPOST } = await import("@/app/api/incidents/submit/route"));
  ({ GET: recordsGET } = await import("@/app/api/records/route"));
  ({ GET: recordByIdGET } = await import("@/app/api/records/[recordId]/route"));
  ({ GET: incidentsGET } = await import("@/app/api/incidents/route"));
  ({ GET: learningGET } = await import("@/app/api/learning/route"));
  ({ resetPublicReadLimiters } = await import("@/lib/api/public-read-guard"));
});

afterEach(() => {
  resetPublicReadLimiters();
});

afterAll(async () => {
  const { resetRuntime } = await import("@/lib/runtime");
  await resetRuntime().catch(() => {});
  await rm(dir, { recursive: true, force: true });
  delete process.env.AFTERMATH_FORCE_MOCK_MEMORY;
  delete process.env.AFTERMATH_DB_PATH;
  delete process.env.AFTERMATH_ADMIN_TOKEN;
  delete process.env.AFTERMATH_RL_PUBLIC_READ_MAX;
});

/** The credential-shaped values used across the cases. Synthetic only. */
const SECRETS = {
  github: `ghp_${"C".repeat(36)}`,
  password: "hunter2secret",
  dsnPassword: "s3cr3tpw",
};

const INCIDENT_WITH_SECRETS = [
  "2026-03-01T10:00:00Z ERROR checkout-service",
  "POST /v1/charge returned 503 after retry (attempt 2/3)",
  `the agent reported success; token=${SECRETS.github} password=${SECRETS.password}`,
  `db postgres://admin:${SECRETS.dsnPassword}@db.internal:5432/aftermath`,
].join("\n");

describe("F1 — a submitted credential is never persisted", () => {
  it("stores the submission redacted and returns it redacted", async () => {
    const res = await submitPOST(
      jsonReq(
        "http://test/api/incidents/submit",
        { text: INCIDENT_WITH_SECRETS, service: "checkout-service" },
        IP.submit,
      ),
    );
    expect(res.status).toBe(200);
    const { record } = (await res.json()) as {
      record: { recordId: string; submission: { text: string; service?: string } };
    };

    expect(record.submission.text).not.toContain(SECRETS.github);
    expect(record.submission.text).not.toContain(SECRETS.password);
    expect(record.submission.text).not.toContain(SECRETS.dsnPassword);
    // Non-sensitive context survives the redaction.
    expect(record.submission.text).toContain("checkout-service");
    expect(record.submission.text).toContain("503");
    expect(record.submission.service).toBe("checkout-service");

    // The persisted payload itself is redacted — read the store directly, not
    // through the redacting service boundary.
    const { runtime } = await import("@/lib/runtime");
    const stored = await runtime().store.getSafeguardRecord(record.recordId);
    expect(stored?.submission.text).not.toContain(SECRETS.github);
    expect(stored?.submission.text).not.toContain(SECRETS.password);
    expect(stored?.submission.text).not.toContain(SECRETS.dsnPassword);
  });
});

describe("F1 — an idempotency key is redacted without breaking dedup", () => {
  it("redacts a secret-bearing idempotency key but keeps the record identity", async () => {
    const { submissionId } = await import("@/lib/engines/submission-pipeline");
    const rawKey = "idem-A1b2A1b2A1b2A1b2A1b2A1b2A1b2A1b2";
    const text = "2026-03-05T00:00:00Z ERROR svc returned 500";

    const res = await submitPOST(
      jsonReq(
        "http://test/api/incidents/submit",
        { text, idempotencyKey: rawKey },
        IP.submit,
      ),
    );
    expect(res.status).toBe(200);
    const { record } = (await res.json()) as {
      record: { recordId: string; submission: { idempotencyKey?: string } };
    };

    // The served idempotency key is redacted; the raw value is gone.
    expect(record.submission.idempotencyKey).toBeDefined();
    expect(record.submission.idempotencyKey).not.toContain(rawKey);
    expect(record.submission.idempotencyKey).toContain("[possible-secret]");

    // The stored payload is redacted too.
    const { runtime } = await import("@/lib/runtime");
    const stored = await runtime().store.getSafeguardRecord(record.recordId);
    expect(stored?.submission.idempotencyKey).not.toContain(rawKey);

    // Identity is derived from the *raw* submission, so it is unchanged: the
    // redaction never alters which record this is.
    expect(record.recordId).toBe(submissionId({ text, idempotencyKey: rawKey }));
  });
});

describe("F1 — a historical record cannot expose a credential", () => {
  it("redacts on read even when the stored payload still holds the raw value", async () => {
    const { runtime } = await import("@/lib/runtime");
    const store = runtime().store;

    // Simulate a record written *before* the redaction rule existed: its stored
    // payload still contains the raw credential.
    const legacyId = "00000000-legacy-0000-0000-000000000001";
    const base = await store.getSafeguardRecord(legacyId);
    expect(base).toBeNull();

    // Build a minimal valid record by submitting once, then overwrite its
    // submission text in the store to the raw (unredacted) form.
    const seeded = await submitPOST(
      jsonReq(
        "http://test/api/incidents/submit",
        { text: "2026-03-02T00:00:00Z ERROR svc returned 503" },
        IP.legacy,
      ),
    );
    const { record } = (await seeded.json()) as {
      record: Record<string, unknown> & { recordId: string; submission: { text: string } };
    };
    const raw = { ...record, submission: { ...record.submission, text: INCIDENT_WITH_SECRETS } };
    await store.saveSafeguardRecord(raw as never);

    // The list endpoint must not serve the raw value.
    const listRes = await recordsGET(get("http://test/api/records", IP.list));
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      records: Array<{ recordId: string; submission: { text: string } }>;
    };
    const listed = listBody.records.find((r) => r.recordId === record.recordId);
    expect(listed).toBeDefined();
    expect(listed?.submission.text).not.toContain(SECRETS.github);
    expect(listed?.submission.text).not.toContain(SECRETS.password);

    // The detail endpoint must not serve it either.
    const detailRes = await recordByIdGET(
      get(`http://test/api/records/${record.recordId}`, IP.detail),
      { params: Promise.resolve({ recordId: record.recordId }) },
    );
    expect(detailRes.status).toBe(200);
    const detailBody = (await detailRes.json()) as {
      record: { submission: { text: string } };
    };
    expect(detailBody.record.submission.text).not.toContain(SECRETS.github);
    expect(detailBody.record.submission.text).not.toContain(SECRETS.password);
    expect(detailBody.record.submission.text).not.toContain(SECRETS.dsnPassword);

    // The record's own identity is intact — redaction did not rewrite it.
    expect(detailBody.record.submission.text).toContain("checkout-service");
  });
});

describe("F2 — the public record routes are rate-limited", () => {
  it("caps /api/records and returns 429 past the limit", async () => {
    const ip = "198.51.100.20";
    const statuses: number[] = [];
    for (let i = 0; i < READ_MAX + 1; i += 1) {
      const res = await recordsGET(get("http://test/api/records", ip));
      statuses.push(res.status);
    }
    expect(statuses.slice(0, READ_MAX)).toEqual(Array(READ_MAX).fill(200));
    expect(statuses[READ_MAX]).toBe(429);
  });

  it("caps /api/records/[recordId], so walking ids cannot escape the limit", async () => {
    const ip = "198.51.100.21";
    const statuses: number[] = [];
    for (let i = 0; i < READ_MAX + 1; i += 1) {
      const res = await recordByIdGET(get("http://test/api/records", ip), {
        params: Promise.resolve({ recordId: `id-${i}` }),
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, READ_MAX)).toEqual(Array(READ_MAX).fill(404));
    expect(statuses[READ_MAX]).toBe(429);
  });

  it("reports a 429 with a Retry-After header and no record body", async () => {
    const ip = "198.51.100.22";
    for (let i = 0; i < READ_MAX; i += 1) {
      await recordsGET(get("http://test/api/records", ip));
    }
    const res = await recordsGET(get("http://test/api/records", ip));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    const body = (await res.json()) as { error: string; records?: unknown };
    expect(body.error).toBe("rate_limited");
    expect(body.records).toBeUndefined();
  });

  it("returns a plain 404 for an unknown record id and never leaks a body", async () => {
    const res = await recordByIdGET(
      get("http://test/api/records", "198.51.100.23"),
      { params: Promise.resolve({ recordId: "does-not-exist" }) },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; record?: unknown };
    expect(body.error).toBe("not_found");
    expect(body.record).toBeUndefined();
  });
});

/**
 * The derived-copy leak: a credential placed in a *structured* free-text field
 * (`expectedBehavior` / `actualBehavior` / `service`) was copied verbatim into
 * derived investigation fields — `confirmedFacts` (value and source), the
 * `summarise` summary, and the Incident's `intendedOutcome` — which reached
 * durable storage, the public record endpoints, the public incident endpoint,
 * the incidents page, and the Walrus incident-to-memory payload.
 */
const STRUCTURED_SECRETS = {
  password: "hunter2secret",
  bearer: "Bearer abcdefghijklmnopqrstuvwxyz012345",
};

/** A submission whose secrets sit only in the structured context fields. */
function structuredSecretBody() {
  return {
    text: "2026-03-03T00:00:00Z ERROR checkout-service returned 503",
    expectedBehavior: `password ${STRUCTURED_SECRETS.password}`,
    actualBehavior: `${STRUCTURED_SECRETS.bearer} rejected`,
    service: "checkout-service",
  };
}

describe("F1 — a credential in a structured field is never persisted", () => {
  it("keeps it out of the stored record, the investigation, and the memory payload", async () => {
    const res = await submitPOST(
      jsonReq("http://test/api/incidents/submit", structuredSecretBody(), "198.51.100.30"),
    );
    expect(res.status).toBe(200);
    const { record } = (await res.json()) as {
      record: { recordId: string };
    };

    // Read the store directly, bypassing the service read boundary: the
    // persisted payload itself must be clean.
    const { runtime } = await import("@/lib/runtime");
    const stored = await runtime().store.getSafeguardRecord(record.recordId);
    expect(stored).not.toBeNull();
    const blob = JSON.stringify(stored);
    expect(blob).not.toContain(STRUCTURED_SECRETS.password);
    expect(blob).not.toContain("abcdefghijklmnopqrstuvwxyz012345");

    // The derived copies specifically.
    const facts = stored!.investigation.categories.confirmedFacts;
    expect(JSON.stringify(facts)).not.toContain(STRUCTURED_SECRETS.password);
    expect(JSON.stringify(facts)).not.toContain("abcdefghijklmnopqrstuvwxyz012345");
    expect(stored!.investigation.summary).not.toContain(STRUCTURED_SECRETS.password);

    // The incident row the public endpoint serves, and the Walrus payload.
    const incidentRow = await runtime().store.listIncidents(50);
    const mine = incidentRow.find((r) => r.incident.incidentId === record.recordId);
    expect(mine).toBeDefined();
    expect(mine!.incident.intendedOutcome).not.toContain(STRUCTURED_SECRETS.password);
    expect(JSON.stringify(mine)).not.toContain(STRUCTURED_SECRETS.password);

    const writes = await runtime().store.listMemoryWrites(50);
    const incidentWrite = writes.find(
      (w) => w.kind === "incident" && w.writeId.length > 0,
    );
    // The write receipt's text is the exact payload sent to the backend.
    const receipts = writes.map((w) => w.text ?? "").join("\n");
    expect(receipts).not.toContain(STRUCTURED_SECRETS.password);
    expect(incidentWrite).toBeDefined();
  });
});

describe("F1 — every public read path redacts the derived copies", () => {
  it("does not leak through /api/records, /api/records/[id], /api/incidents, or /api/learning", async () => {
    const res = await submitPOST(
      jsonReq("http://test/api/incidents/submit", structuredSecretBody(), "198.51.100.31"),
    );
    expect(res.status).toBe(200);
    const { record } = (await res.json()) as { record: { recordId: string } };

    const listRes = await recordsGET(get("http://test/api/records", "198.51.100.32"));
    expect(listRes.status).toBe(200);
    const listBlob = JSON.stringify(await listRes.json());
    expect(listBlob).not.toContain(STRUCTURED_SECRETS.password);
    expect(listBlob).not.toContain("abcdefghijklmnopqrstuvwxyz012345");

    const detailRes = await recordByIdGET(
      get(`http://test/api/records/${record.recordId}`, "198.51.100.33"),
      { params: Promise.resolve({ recordId: record.recordId }) },
    );
    expect(detailRes.status).toBe(200);
    const detailBlob = JSON.stringify(await detailRes.json());
    expect(detailBlob).not.toContain(STRUCTURED_SECRETS.password);
    expect(detailBlob).not.toContain("abcdefghijklmnopqrstuvwxyz012345");

    const incidentsRes = await incidentsGET(get("http://test/api/incidents", "198.51.100.34"));
    expect(incidentsRes.status).toBe(200);
    const incidentsBlob = JSON.stringify(await incidentsRes.json());
    expect(incidentsBlob).not.toContain(STRUCTURED_SECRETS.password);
    expect(incidentsBlob).not.toContain("abcdefghijklmnopqrstuvwxyz012345");

    const learningRes = await learningGET(get("http://test/api/learning", "198.51.100.35"));
    expect(learningRes.status).toBe(200);
    const learningBlob = JSON.stringify(await learningRes.json());
    expect(learningBlob).not.toContain(STRUCTURED_SECRETS.password);
    expect(learningBlob).not.toContain("abcdefghijklmnopqrstuvwxyz012345");
  });
});

describe("F1 — a historical record's derived fields are redacted on read", () => {
  it("sanitizes an already-persisted unredacted derived copy at the boundary", async () => {
    const { runtime } = await import("@/lib/runtime");
    const store = runtime().store;

    // Seed a record, then rewrite its *derived* fields to the raw (unredacted)
    // form, simulating a record written before this boundary existed.
    const seeded = await submitPOST(
      jsonReq(
        "http://test/api/incidents/submit",
        { text: "2026-03-04T00:00:00Z ERROR svc returned 503" },
        "198.51.100.36",
      ),
    );
    const { record } = (await seeded.json()) as {
      record: Record<string, unknown> & {
        recordId: string;
        investigation: Record<string, unknown>;
      };
    };
    const rawDerived = {
      ...record,
      investigation: {
        ...record.investigation,
        summary: `[svc] password ${STRUCTURED_SECRETS.password}`,
      },
    };
    await store.saveSafeguardRecord(rawDerived as never);

    // The list endpoint must not serve the raw derived value.
    const listRes = await recordsGET(get("http://test/api/records", "198.51.100.37"));
    const listBody = (await listRes.json()) as {
      records: Array<{ recordId: string; investigation: { summary: string } }>;
    };
    const listed = listBody.records.find((r) => r.recordId === record.recordId);
    expect(listed).toBeDefined();
    expect(listed!.investigation.summary).not.toContain(STRUCTURED_SECRETS.password);

    // The detail endpoint must not serve it either, and identity is intact.
    const detailRes = await recordByIdGET(
      get(`http://test/api/records/${record.recordId}`, "198.51.100.38"),
      { params: Promise.resolve({ recordId: record.recordId }) },
    );
    const detailBody = (await detailRes.json()) as {
      record: { recordId: string; investigation: { summary: string } };
    };
    expect(detailBody.record.investigation.summary).not.toContain(
      STRUCTURED_SECRETS.password,
    );
    expect(detailBody.record.recordId).toBe(record.recordId);
  });
});

describe("F1 — legitimate evidence survives the read boundary", () => {
  it("keeps a labelled transaction digest and the record identity intact", async () => {
    const digest =
      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    const res = await submitPOST(
      jsonReq(
        "http://test/api/incidents/submit",
        {
          text: `2026-03-06T00:00:00Z settlement\n tx hash ${digest}\n the agent reported success`,
          expectedBehavior: "settlement completes",
        },
        "198.51.100.39",
      ),
    );
    expect(res.status).toBe(200);
    const { record } = (await res.json()) as { record: { recordId: string } };

    const detailRes = await recordByIdGET(
      get(`http://test/api/records/${record.recordId}`, "198.51.100.40"),
      { params: Promise.resolve({ recordId: record.recordId }) },
    );
    expect(detailRes.status).toBe(200);
    const detailBlob = JSON.stringify(await detailRes.json());
    // The labelled transaction digest is evidence, not a secret: it must survive
    // the read boundary so the finance verification stays traceable.
    expect(detailBlob).toContain(digest);
    // And the record's own identity is untouched.
    expect(detailBlob).toContain(record.recordId);
  });
});
