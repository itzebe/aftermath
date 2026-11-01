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
