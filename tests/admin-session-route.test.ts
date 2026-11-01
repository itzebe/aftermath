import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AftermathConfig } from "@/lib/config";

/**
 * Regression tests for the admin session endpoint.
 *
 * The console validates a pasted credential against this route before it
 * reveals any gated operation, so the route must:
 *   - fail closed when the server has no admin token configured,
 *   - reject a missing or wrong credential with 401,
 *   - accept the configured credential with 200,
 *   - never echo the credential, and
 *   - perform no work (no rate-limit charge, no store, no external call).
 */

const TOKEN = "correct-horse-battery-staple";

function config(adminToken: string | null): AftermathConfig {
  return {
    memory: {
      serverUrl: "https://relayer.memory.walrus.xyz",
      accountId: null,
      privateKey: null,
      namespace: "aftermath",
      forceSimulated: true,
    },
    tatum: { rpcUrl: "x", grpcUrl: "x", graphqlUrl: "x", apiKey: null, timeoutMs: 12000 },
    ai: { provider: "none", model: "openai/gpt-oss-120b", apiKey: null, timeoutMs: 20000, maxOutputTokens: 8192 },
    aiVerify: { token: null, maxRequests: 3, windowMs: 60_000 },
    adminToken,
    adminRateLimit: {
      "incidents/submit": { maxRequests: 5, windowMs: 60_000 },
      "scenarios/run": { maxRequests: 1, windowMs: 60_000 },
      "memory-verify": { maxRequests: 5, windowMs: 60_000 },
      reset: { maxRequests: 2, windowMs: 60_000 },
    },
    publicReadLimit: {
      read: { maxRequests: 120, windowMs: 60_000 },
      heavy: { maxRequests: 60, windowMs: 60_000 },
      status: { maxRequests: 60, windowMs: 60_000 },
    },
    rateLimitSalt: "test-salt",
    bodyLimitBytes: 65_536,
    dbPath: ":memory:",
    harnessDir: "/tmp/h",
    databaseUrl: null,
  };
}

let activeConfig: AftermathConfig = config(TOKEN);
vi.mock("@/lib/config", () => ({
  loadConfig: () => activeConfig,
}));

// The session route must not import or touch any write path. A guard that fails
// the test if the store is reached pins that property.
vi.mock("@/lib/service", () => ({
  submitIncident: () => {
    throw new Error("session validation must not reach the incident service");
  },
}));

async function session(headers: Record<string, string> = {}) {
  const { GET } = await import("@/app/api/admin/session/route");
  return GET(new Request("http://test/api/admin/session", { headers }));
}

beforeEach(() => {
  activeConfig = config(TOKEN);
});

describe("GET /api/admin/session", () => {
  it("fails closed with 503 when no admin token is configured", async () => {
    activeConfig = config(null);
    const res = await session({ authorization: `Bearer ${TOKEN}` });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("admin_disabled");
  });

  it("rejects a missing credential with 401", async () => {
    const res = await session();
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("rejects an incorrect credential with 401", async () => {
    const res = await session({ authorization: "Bearer not-the-token" });
    expect(res.status).toBe(401);
  });

  it("authenticates the correct credential with 200", async () => {
    const res = await session({ authorization: `Bearer ${TOKEN}` });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("accepts the credential from the x-aftermath-admin-token header too", async () => {
    const res = await session({ "x-aftermath-admin-token": TOKEN });
    expect(res.status).toBe(200);
  });

  it("never echoes the credential in any response", async () => {
    const cases: Array<Record<string, string>> = [
      {},
      { authorization: `Bearer ${TOKEN}` },
      { authorization: "Bearer wrong" },
    ];
    for (const headers of cases) {
      const res = await session(headers);
      const text = await res.text();
      expect(text).not.toContain(TOKEN);
    }
  });

  it("does not charge a rate-limit window, so repeated checks stay 200", async () => {
    for (let i = 0; i < 25; i += 1) {
      const res = await session({ authorization: `Bearer ${TOKEN}` });
      expect(res.status).toBe(200);
    }
  });
});
