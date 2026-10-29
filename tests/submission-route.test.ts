import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Route-level tests for the submission API.
 *
 * The route is exercised through the real service and a real (file-backed
 * SQLite) store, with the memory backend forced to the SDK's simulated
 * adapter — no Mainnet call is made. The point under test is the honesty of
 * the response contract: a valid submission yields a labelled Safeguard Record;
 * a malformed one is rejected before any work happens.
 */
let dir: string;
let POST: (req: Request) => Promise<Response>;
let GET: () => Promise<Response>;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "aftermath-route-"));
  process.env.AFTERMATH_FORCE_MOCK_MEMORY = "1";
  process.env.AFTERMATH_DB_PATH = path.join(dir, "aftermath.db");
  process.env.DATABASE_URL = "";
  process.env.POSTGRES_URL = "";
  process.env.AFTERMATH_DATABASE_URL = "";
  // Import after the environment is set so config/runtime pick it up.
  ({ POST } = await import("@/app/api/incidents/submit/route"));
  ({ GET } = await import("@/app/api/records/route"));
});

afterAll(async () => {
  const { resetRuntime } = await import("@/lib/runtime");
  await resetRuntime().catch(() => {});
  await rm(dir, { recursive: true, force: true });
  delete process.env.AFTERMATH_FORCE_MOCK_MEMORY;
  delete process.env.AFTERMATH_DB_PATH;
});

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://test/api/incidents/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/incidents/submit", () => {
  it("returns a labelled Safeguard Record for a valid submission", async () => {
    const res = await post({
      text: "2026-03-01T10:00:00Z ERROR checkout-service returned 503 Service Unavailable",
      service: "checkout-service",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { record: { provenance: string; memory: { isLive: boolean } } };
    expect(body.record.provenance).toBe("simulated");
    expect(body.record.memory.isLive).toBe(false);
  });

  it("rejects a malformed body before doing any work", async () => {
    const res = await post({ text: "" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: unknown[] };
    expect(body.error).toBe("invalid_submission");
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it("rejects a non-JSON body with a 400, not a 500", async () => {
    const res = await POST(
      new Request("http://test/api/incidents/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/records", () => {
  it("lists the records the submission produced", async () => {
    await post({ text: "a distinct incident for listing: E1234" });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { records: { recordId: string }[] };
    expect(body.records.length).toBeGreaterThan(0);
    expect(body.records[0].recordId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
