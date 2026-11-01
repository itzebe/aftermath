import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SqliteDb } from "@/lib/db/sql";
import {
  DbRateLimitStore,
  InMemoryRateLimitStore,
  SharedRateLimiter,
  limiterFor,
  rateLimitKey,
  resetSharedLimiters,
  unavailableRateLimitStore,
  type RateLimitPolicy,
} from "@/lib/api/rate-limit";
import { FixedWindowRateLimiter } from "@/lib/api/verify-guard";

/**
 * The shared limiter must be *shared*: one counter every instance reads, an
 * atomic increment so a race cannot step over the cap, and a per-client key that
 * never stores the client address. These tests exercise the real SQLite path
 * (the same SQL the Postgres path runs) rather than a mock, so the statement and
 * the window logic are proven, not assumed.
 */

const POLICY: RateLimitPolicy = { maxRequests: 3, windowMs: 60_000 };

function at(fixed: number) {
  return () => fixed;
}

async function sqliteStore() {
  const dir = await mkdtemp(path.join(tmpdir(), "aftermath-rl-"));
  const db = new SqliteDb(path.join(dir, "rl.db"));
  return {
    store: new DbRateLimitStore(db),
    cleanup: async () => {
      db.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

describe("SharedRateLimiter over the durable SQLite store", () => {
  it("counts hits per window and refuses past the cap", async () => {
    const { store, cleanup } = await sqliteStore();
    try {
      const limiter = new SharedRateLimiter({
        policy: POLICY,
        store,
        fallback: new FixedWindowRateLimiter(POLICY),
        now: at(1_000_000),
      });
      const results = [];
      for (let i = 0; i < 4; i += 1) results.push(await limiter.check("k1"));
      expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
      expect(results[3].retryAfterSeconds).toBeGreaterThan(0);
      expect(results[0].remaining).toBe(2);
      expect(results[0].degraded).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it("keeps a separate counter per client key", async () => {
    const { store, cleanup } = await sqliteStore();
    try {
      const limiter = new SharedRateLimiter({
        policy: POLICY,
        store,
        fallback: new FixedWindowRateLimiter(POLICY),
        now: at(1_000_000),
      });
      for (let i = 0; i < 3; i += 1) await limiter.check("a");
      expect((await limiter.check("a")).allowed).toBe(false);
      // A different client is unaffected by the first client's exhaustion.
      expect((await limiter.check("b")).allowed).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("resets the counter when the window advances", async () => {
    const { store, cleanup } = await sqliteStore();
    try {
      let now = 1_000_000;
      const limiter = new SharedRateLimiter({
        policy: POLICY,
        store,
        fallback: new FixedWindowRateLimiter(POLICY),
        now: () => now,
      });
      for (let i = 0; i < 3; i += 1) await limiter.check("k");
      expect((await limiter.check("k")).allowed).toBe(false);
      // One full window later the counter starts fresh.
      now += POLICY.windowMs;
      expect((await limiter.check("k")).allowed).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("increments atomically: concurrent hits never both see the last slot", async () => {
    const { store, cleanup } = await sqliteStore();
    try {
      const limiter = new SharedRateLimiter({
        policy: POLICY,
        store,
        fallback: new FixedWindowRateLimiter(POLICY),
        now: at(1_000_000),
      });
      // Ten simultaneous hits against a cap of three: exactly three may pass.
      const results = await Promise.all(
        Array.from({ length: 10 }, () => limiter.check("race")),
      );
      expect(results.filter((r) => r.allowed).length).toBe(3);
    } finally {
      await cleanup();
    }
  });

  it("degrades to the in-process cap when the store fails, and reports it", async () => {
    const limiter = new SharedRateLimiter({
      policy: POLICY,
      store: unavailableRateLimitStore,
      fallback: new FixedWindowRateLimiter(POLICY),
      now: at(1_000_000),
    });
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await limiter.check("d"));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.every((r) => r.degraded)).toBe(true);
  });

  it("shares one limiter per registry key", () => {
    resetSharedLimiters();
    const opts = { resolveStore: () => new InMemoryRateLimitStore() };
    const a = limiterFor("public:read", POLICY, opts);
    const b = limiterFor("public:read", POLICY, opts);
    expect(a).toBe(b);
    resetSharedLimiters();
  });
});

describe("rateLimitKey", () => {
  it("never contains the raw client id", () => {
    const key = rateLimitKey("public-read", "203.0.113.7", "salt");
    expect(key).not.toContain("203.0.113.7");
    expect(key.startsWith("public-read:")).toBe(true);
  });

  it("is stable for the same client and salt, and distinct across salts", () => {
    const a = rateLimitKey("public-read", "203.0.113.7", "s1");
    const b = rateLimitKey("public-read", "203.0.113.7", "s1");
    const c = rateLimitKey("public-read", "203.0.113.7", "s2");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
