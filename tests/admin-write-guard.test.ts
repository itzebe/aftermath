import { describe, expect, it } from "vitest";
import type { AftermathConfig } from "@/lib/config";
import { guardAdminWrite } from "@/lib/api/admin-write-guard";
import {
  InMemoryRateLimitStore,
  SharedRateLimiter,
  type RateLimitPolicy,
} from "@/lib/api/rate-limit";
import { FixedWindowRateLimiter } from "@/lib/api/verify-guard";

const TOKEN = "correct-horse-battery-staple";
const POLICY: RateLimitPolicy = { maxRequests: 2, windowMs: 60_000 };

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
    adminRateLimit: { reset: POLICY },
    publicReadLimit: { read: POLICY, heavy: POLICY, status: POLICY },
    publicReadGlobalLimit: { read: 1200, heavy: 600, status: 600 },
    rateLimitSalt: "test-salt",
    rateLimitRetentionMs: 120_000,
    bodyLimitBytes: 65_536,
    dbPath: ":memory:",
    harnessDir: "/tmp/h",
    databaseUrl: null,
  };
}

function limiter() {
  return new SharedRateLimiter({
    policy: POLICY,
    store: new InMemoryRateLimitStore(),
    fallback: new FixedWindowRateLimiter(POLICY),
    now: () => 1_000_000,
  });
}

function post(ip: string, token?: string): Request {
  const headers: Record<string, string> = { "x-real-ip": ip };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request("http://test/api/reset", { method: "POST", headers });
}

describe("guardAdminWrite", () => {
  it("fails closed with 503 when no admin token is configured", async () => {
    const res = await guardAdminWrite(post("203.0.113.1", TOKEN), config(null));
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected refuse");
    expect(res.response.status).toBe(503);
  });

  it("rejects a missing or wrong credential with 401", async () => {
    const missing = await guardAdminWrite(post("203.0.113.1"), config(TOKEN));
    const wrong = await guardAdminWrite(post("203.0.113.1", "nope"), config(TOKEN));
    expect(missing.ok).toBe(false);
    expect(wrong.ok).toBe(false);
    if (missing.ok || wrong.ok) throw new Error("expected refuse");
    expect(missing.response.status).toBe(401);
    expect(wrong.response.status).toBe(401);
  });

  it("accepts the correct token", async () => {
    const res = await guardAdminWrite(post("203.0.113.1", TOKEN), config(TOKEN));
    expect(res.ok).toBe(true);
  });

  it("returns 429 past the shared cap", async () => {
    const l = limiter();
    const cfg = config(TOKEN);
    const a = await guardAdminWrite(post("203.0.113.1", TOKEN), cfg, { limiter: l });
    const b = await guardAdminWrite(post("203.0.113.1", TOKEN), cfg, { limiter: l });
    const c = await guardAdminWrite(post("203.0.113.1", TOKEN), cfg, { limiter: l });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(c.ok).toBe(false);
    if (c.ok) throw new Error("expected refuse");
    expect(c.response.status).toBe(429);
    expect(Number(c.response.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("does not let an unauthenticated caller consume the budget", async () => {
    const l = limiter();
    const cfg = config(TOKEN);
    // Two unauthenticated attempts are rejected before the limiter is charged.
    await guardAdminWrite(post("203.0.113.5"), cfg, { limiter: l });
    await guardAdminWrite(post("203.0.113.5"), cfg, { limiter: l });
    const ok = await guardAdminWrite(post("203.0.113.5", TOKEN), cfg, { limiter: l });
    expect(ok.ok).toBe(true);
  });

  it("never echoes the expected token in a rejection body", async () => {
    const res = await guardAdminWrite(post("203.0.113.1", "wrong"), config(TOKEN));
    if (res.ok) throw new Error("expected refuse");
    const body = await res.response.text();
    expect(body).not.toContain(TOKEN);
  });
});
