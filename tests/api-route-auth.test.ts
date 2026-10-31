import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Route-level authorization.
 *
 * Every write or destructive endpoint must refuse an unauthenticated caller and
 * fail closed when no administrator token is configured. These tests exercise
 * the real route handlers with the memory backend forced to the simulated
 * adapter, so no Mainnet call is made.
 */

const TOKEN = "test-admin-token-1234567890";

let dir: string;
let submitPOST: (req: Request) => Promise<Response>;
let resetPOST: (req: Request) => Promise<Response>;
let scenariosPOST: (req: Request) => Promise<Response>;
let memoryVerifyPOST: (req: Request) => Promise<Response>;
let resetAdminLimiters: () => void;

function jsonReq(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function auth(): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}` };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "aftermath-authz-"));
  process.env.AFTERMATH_FORCE_MOCK_MEMORY = "1";
  process.env.AFTERMATH_DB_PATH = path.join(dir, "aftermath.db");
  process.env.DATABASE_URL = "";
  process.env.POSTGRES_URL = "";
  process.env.AFTERMATH_DATABASE_URL = "";
  process.env.AFTERMATH_ADMIN_TOKEN = TOKEN;
  ({ POST: submitPOST } = await import("@/app/api/incidents/submit/route"));
  ({ POST: resetPOST } = await import("@/app/api/reset/route"));
  ({ POST: scenariosPOST } = await import("@/app/api/scenarios/run/route"));
  ({ POST: memoryVerifyPOST } = await import("@/app/api/memory-verify/route"));
  ({ resetAdminLimiters } = await import("@/lib/api/verify-guard"));
});

afterEach(() => {
  resetAdminLimiters();
});

afterAll(async () => {
  const { resetRuntime } = await import("@/lib/runtime");
  await resetRuntime().catch(() => {});
  await rm(dir, { recursive: true, force: true });
  delete process.env.AFTERMATH_FORCE_MOCK_MEMORY;
  delete process.env.AFTERMATH_DB_PATH;
  delete process.env.AFTERMATH_ADMIN_TOKEN;
});

describe("POST /api/reset", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await resetPOST(new Request("http://test/api/reset", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("rejects a wrong token with 401", async () => {
    const res = await resetPOST(
      new Request("http://test/api/reset", {
        method: "POST",
        headers: { authorization: "Bearer nope" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("permits an authenticated request", async () => {
    const res = await resetPOST(
      new Request("http://test/api/reset", { method: "POST", headers: auth() }),
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /api/scenarios/run", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await scenariosPOST(jsonReq("http://test/api/scenarios/run", {}));
    expect(res.status).toBe(401);
  });

  it("rejects restart:true without a token — restart cannot bypass authorization", async () => {
    const res = await scenariosPOST(
      jsonReq("http://test/api/scenarios/run", { restart: true }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects restart:true with a wrong token", async () => {
    const res = await scenariosPOST(
      jsonReq("http://test/api/scenarios/run", { restart: true }, { authorization: "Bearer bad" }),
    );
    expect(res.status).toBe(401);
  });
});

describe("POST /api/incidents/submit", () => {
  it("rejects an unauthenticated request with 401 before doing any work", async () => {
    const res = await submitPOST(
      jsonReq("http://test/api/incidents/submit", { text: "2026-03-01 ERROR x returned 503" }),
    );
    expect(res.status).toBe(401);
  });

  it("accepts an authenticated submission", async () => {
    const res = await submitPOST(
      jsonReq(
        "http://test/api/incidents/submit",
        { text: "2026-03-01T10:00:00Z ERROR checkout-service returned 503", service: "checkout" },
        auth(),
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { record?: { provenance: string } };
    expect(body.record?.provenance).toBe("simulated");
  });
});

describe("POST /api/memory-verify", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await memoryVerifyPOST(
      jsonReq("http://test/api/memory-verify", { query: "anything" }),
    );
    expect(res.status).toBe(401);
  });

  it("accepts an authenticated recall query", async () => {
    const res = await memoryVerifyPOST(
      jsonReq("http://test/api/memory-verify", { query: "safeguard", limit: 5 }, auth()),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number; backend: string };
    expect(typeof body.count).toBe("number");
    expect(body.backend).toBe("simulated");
  });
});

describe("administrator token absent", () => {
  it("fails closed with 503 on every gated endpoint", async () => {
    delete process.env.AFTERMATH_ADMIN_TOKEN;
    try {
      const a = await resetPOST(new Request("http://test/api/reset", { method: "POST" }));
      const b = await scenariosPOST(jsonReq("http://test/api/scenarios/run", {}));
      const c = await submitPOST(
        jsonReq("http://test/api/incidents/submit", { text: "x" }),
      );
      const d = await memoryVerifyPOST(
        jsonReq("http://test/api/memory-verify", { query: "x" }),
      );
      for (const res of [a, b, c, d]) {
        expect(res.status).toBe(503);
        const body = (await res.json()) as { error: string };
        expect(body.error).toBe("admin_disabled");
      }
    } finally {
      process.env.AFTERMATH_ADMIN_TOKEN = TOKEN;
    }
  });
});

describe("rate limiting on /api/incidents/submit", () => {
  it("returns 429 after the per-client limit is exceeded", async () => {
    // The configured default is 5/minute; the 6th authenticated request is 429.
    const headers = { ...auth(), "x-real-ip": "198.51.100.42" };
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await submitPOST(
        jsonReq(
          "http://test/api/incidents/submit",
          { text: `2026-03-01T10:00:00Z ERROR svc returned 503 (attempt ${i})` },
          headers,
        ),
      );
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
  });

  it("treats a different client as a separate bucket", async () => {
    const res = await submitPOST(
      jsonReq(
        "http://test/api/incidents/submit",
        { text: "2026-03-01T10:00:00Z ERROR svc returned 503 from another client" },
        { ...auth(), "x-real-ip": "198.51.100.99" },
      ),
    );
    expect(res.status).toBe(200);
  });
});

describe("body size limit on /api/incidents/submit", () => {
  it("returns 413 for an oversized payload", async () => {
    const res = await submitPOST(
      jsonReq(
        "http://test/api/incidents/submit",
        { text: "x".repeat(100_000) },
        auth(),
      ),
    );
    expect(res.status).toBe(413);
  });
});
