import { describe, expect, it } from "vitest";
import type { AftermathConfig } from "@/lib/config";
import { guardPublicRead } from "@/lib/api/public-read-guard";
import {
  InMemoryRateLimitStore,
  SharedRateLimiter,
  unavailableRateLimitStore,
  type RateLimitPolicy,
} from "@/lib/api/rate-limit";
import { FixedWindowRateLimiter } from "@/lib/api/verify-guard";

/**
 * The anonymous read cap must actually bound a caller, must be enforced through
 * the shared store, and must fail safe (not fail open to unlimited) when that
 * store is down. The guard is exercised directly with an injected limiter so the
 * decision logic is proven without depending on process env or a live database.
 */

const POLICY: RateLimitPolicy = { maxRequests: 2, windowMs: 60_000 };

function config(): AftermathConfig {
  return {
    memory: {
      serverUrl: "https://relayer.memory.walrus.xyz",
      accountId: null,
      privateKey: null,
      namespace: "aftermath",
      forceSimulated: true,
    },
    tatum: { rpcUrl: "x", grpcUrl: "x", graphqlUrl: "x", apiKey: null, timeoutMs: 12000 },
    ai: {
      provider: "none",
      model: "openai/gpt-oss-120b",
      apiKey: null,
      timeoutMs: 20000,
      maxOutputTokens: 8192,
    },
    aiVerify: { token: null, maxRequests: 3, windowMs: 60_000 },
    adminToken: null,
    adminRateLimit: {
      "incidents/submit": { maxRequests: 5, windowMs: 60_000 },
      "scenarios/run": { maxRequests: 1, windowMs: 60_000 },
      "memory-verify": { maxRequests: 5, windowMs: 60_000 },
      reset: { maxRequests: 2, windowMs: 60_000 },
    },
    publicReadLimit: { read: POLICY, heavy: POLICY, status: POLICY },
    rateLimitSalt: "test-salt",
    bodyLimitBytes: 65_536,
    dbPath: ":memory:",
    harnessDir: "/tmp/h",
    databaseUrl: null,
  };
}

function limiter(store: ReturnType<typeof storeFor>) {
  return new SharedRateLimiter({
    policy: POLICY,
    store,
    fallback: new FixedWindowRateLimiter(POLICY),
    now: () => 1_000_000,
  });
}

function storeFor() {
  return new InMemoryRateLimitStore();
}

function req(ip: string): Request {
  return new Request("http://test/api/learning", { headers: { "x-real-ip": ip } });
}

describe("guardPublicRead", () => {
  it("allows up to the cap and refuses the next request with 429 + Retry-After", async () => {
    const l = limiter(storeFor());
    const cfg = config();

    const a = await guardPublicRead(req("198.51.100.1"), cfg, "public-read-heavy", l);
    const b = await guardPublicRead(req("198.51.100.1"), cfg, "public-read-heavy", l);
    const c = await guardPublicRead(req("198.51.100.1"), cfg, "public-read-heavy", l);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(c.ok).toBe(false);
    if (!a.ok) throw new Error("expected allow");
    expect(a.headers["x-ratelimit-limit"]).toBe("2");
    expect(a.headers["x-ratelimit-remaining"]).toBe("1");
    expect(a.headers["x-ratelimit-degraded"]).toBe("false");
    if (c.ok) throw new Error("expected refuse");
    expect(c.response.status).toBe(429);
    expect(Number(c.response.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("gives each client its own bucket", async () => {
    const l = limiter(storeFor());
    const cfg = config();
    await guardPublicRead(req("198.51.100.1"), cfg, "public-read", l);
    await guardPublicRead(req("198.51.100.1"), cfg, "public-read", l);
    const other = await guardPublicRead(req("198.51.100.2"), cfg, "public-read", l);
    expect(other.ok).toBe(true);
  });

  it("degrades to the in-process cap, and says so, when the shared store is down", async () => {
    const l = new SharedRateLimiter({
      policy: POLICY,
      store: unavailableRateLimitStore,
      fallback: new FixedWindowRateLimiter(POLICY),
      now: () => 1_000_000,
    });
    const cfg = config();
    const a = await guardPublicRead(req("198.51.100.9"), cfg, "public-read", l);
    const b = await guardPublicRead(req("198.51.100.9"), cfg, "public-read", l);
    const c = await guardPublicRead(req("198.51.100.9"), cfg, "public-read", l);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    // Not unlimited: the third is still refused while degraded.
    expect(c.ok).toBe(false);
    if (!a.ok) throw new Error("expected allow");
    expect(a.headers["x-ratelimit-degraded"]).toBe("true");
  });
});
