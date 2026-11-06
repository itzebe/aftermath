import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  type RateLimitStore,
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

  it("does not hang the request when the store never settles", async () => {
    // A store that never resolves models a stalled database dependency. Without
    // a bound the caller would wait as long as the dependency, and the platform
    // would turn the request into a 504. The limiter must instead give up after
    // its timeout and degrade to the in-process cap.
    const neverSettles: RateLimitStore = {
      hit: () => new Promise<number>(() => {}),
    };
    const limiter = new SharedRateLimiter({
      policy: POLICY,
      store: neverSettles,
      fallback: new FixedWindowRateLimiter(POLICY),
      storeTimeoutMs: 50,
      now: at(1_000_000),
    });
    const verdict = await limiter.check("stalled");
    expect(verdict.allowed).toBe(true);
    expect(verdict.degraded).toBe(true);
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

describe("global backstop (anti-spoofing)", () => {
  it("bounds a caller who rotates the per-client key", async () => {
    // Cap 3 per client, global ceiling 6. A caller that mints a fresh key per
    // request must still be stopped once the shared ceiling is reached.
    const limiter = new SharedRateLimiter({
      policy: POLICY,
      store: new InMemoryRateLimitStore(),
      fallback: new FixedWindowRateLimiter(POLICY),
      globalScope: "test-bucket",
      globalMaxRequests: 6,
      now: at(1_000_000),
    });
    const results = [];
    for (let i = 0; i < 10; i += 1) results.push(await limiter.check(`rotated-${i}`));
    expect(results.filter((r) => r.allowed).length).toBe(6);
    // The refused requests are refused by the global scope, not their own bucket.
    expect(results[6].globalLimited).toBe(true);
    expect(results[6].allowed).toBe(false);
  });

  it("does not charge the global ceiling for distinct buckets", async () => {
    const limiter = new SharedRateLimiter({
      policy: POLICY,
      store: new InMemoryRateLimitStore(),
      fallback: new FixedWindowRateLimiter(POLICY),
      globalScope: "test-bucket",
      globalMaxRequests: 100,
      now: at(1_000_000),
    });
    for (let i = 0; i < 3; i += 1) expect((await limiter.check("a")).allowed).toBe(true);
    expect((await limiter.check("b")).allowed).toBe(true);
  });

  it("leaves behaviour unchanged when no global cap is configured", async () => {
    const limiter = new SharedRateLimiter({
      policy: POLICY,
      store: new InMemoryRateLimitStore(),
      fallback: new FixedWindowRateLimiter(POLICY),
      now: at(1_000_000),
    });
    const results = [];
    for (let i = 0; i < 5; i += 1) results.push(await limiter.check(`k-${i}`));
    // No global cap: every distinct client is allowed its own bucket.
    expect(results.every((r) => r.allowed)).toBe(true);
    expect(results.some((r) => r.globalLimited)).toBe(false);
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

describe("bounded state (cleanup)", () => {
  it("prunes expired windows from the in-process fallback limiter", () => {
    // A caller that rotates its key would otherwise grow the map without bound.
    const limiter = new FixedWindowRateLimiter({ maxRequests: 1, windowMs: 1_000 });
    // Fill well past the prune threshold, all in one window.
    for (let i = 0; i < 11_000; i += 1) limiter.check(`k-${i}`, 0);
    // A later check, in a new window, prunes the expired entries and admits the
    // caller instead of refusing it against a stale counter.
    const v = limiter.check("fresh", 5_000);
    expect(v.allowed).toBe(true);
  });

  it("sweeps stale counters from the durable store, throttled and non-fatal", async () => {
    const sweeps: number[] = [];
    const store: RateLimitStore = {
      hit: () => Promise.resolve(1),
      sweep: (cutoff) => {
        sweeps.push(cutoff);
        return Promise.resolve();
      },
    };
    const limiter = new SharedRateLimiter({
      policy: POLICY,
      store,
      fallback: new FixedWindowRateLimiter(POLICY),
      now: at(10_000_000),
    });
    for (let i = 0; i < 5; i += 1) await limiter.check(`k-${i}`);
    // Throttled: at most one sweep within the interval.
    expect(sweeps.length).toBe(1);
    // Only rows older than the retention window are removed.
    expect(sweeps[0]).toBe(10_000_000 - 10 * 60_000);
  });

  it("never fails a request when the sweep throws", async () => {
    const store: RateLimitStore = {
      hit: () => Promise.resolve(1),
      sweep: () => Promise.reject(new Error("sweep boom")),
    };
    const limiter = new SharedRateLimiter({
      policy: POLICY,
      store,
      fallback: new FixedWindowRateLimiter(POLICY),
      now: at(10_000_000),
    });
    const v = await limiter.check("k");
    expect(v.allowed).toBe(true);
    // Let the rejected sweep settle; the unhandled-rejection guard must hold.
    await new Promise((r) => setTimeout(r, 5));
  });
});

/**
 * Counter retention (F5).
 *
 * A fixed retention shorter than a configurable window let the sweep delete a
 * counter whose window was still active, resetting it mid-flight and handing a
 * caller a fresh allowance. Retention is now derived from the longest
 * configured window, and these pin that property against both stores.
 */
describe("counter retention (F5)", () => {
  it("derives retention strictly greater than the longest configured window", async () => {
    const { loadConfig } = await import("@/lib/config");
    const original = process.env.AFTERMATH_RL_PUBLIC_READ_WINDOW_MS;
    try {
      // A window far longer than the old fixed 10-minute retention.
      process.env.AFTERMATH_RL_PUBLIC_READ_WINDOW_MS = String(45 * 60_000);
      const config = loadConfig();
      expect(config.publicReadLimit.read.windowMs).toBe(45 * 60_000);
      expect(config.rateLimitRetentionMs).toBeGreaterThan(45 * 60_000);
    } finally {
      if (original === undefined) delete process.env.AFTERMATH_RL_PUBLIC_READ_WINDOW_MS;
      else process.env.AFTERMATH_RL_PUBLIC_READ_WINDOW_MS = original;
    }
  });

  it("does not delete an active long window when swept with the derived retention", async () => {
    const { store, cleanup } = await sqliteStore();
    try {
      const windowMs = 30 * 60_000; // 30 minutes, three times the old retention
      const now = 1_700_000_000_000;
      // The window began 20 minutes ago — still active for a 30-minute window.
      const windowStart = now - 20 * 60_000;
      const key = "long-window-client";
      await store.hit(key, windowStart);
      await store.hit(key, windowStart);

      // A sweep using the derived retention (2 * windowMs = 60 min) must leave
      // the row: its window began well inside the retention horizon.
      await store.sweep(now - 2 * windowMs);
      expect(await store.hit(key, windowStart)).toBe(3);
    } finally {
      await cleanup();
    }
  });

  it("demonstrates the defect it fixes: a 10-minute cutoff resets a 30-minute window", async () => {
    const { store, cleanup } = await sqliteStore();
    try {
      const now = 1_700_000_000_000;
      // Same active 30-minute window, begun 20 minutes ago.
      const windowStart = now - 20 * 60_000;
      const key = "victim";
      await store.hit(key, windowStart);
      await store.hit(key, windowStart);
      // The old fixed retention: the row's window began >10 min ago, so the
      // sweep drops it and the next hit starts the window over.
      await store.sweep(now - 10 * 60_000);
      expect(await store.hit(key, windowStart)).toBe(1);
    } finally {
      await cleanup();
    }
  });

  it("uses the limiter's configured retention for the sweep cutoff", async () => {
    const sweeps: number[] = [];
    const store: RateLimitStore = {
      hit: () => Promise.resolve(1),
      sweep: (cutoff) => {
        sweeps.push(cutoff);
        return Promise.resolve();
      },
    };
    const limiter = new SharedRateLimiter({
      policy: POLICY,
      store,
      fallback: new FixedWindowRateLimiter(POLICY),
      retentionMs: 30 * 60_000,
      now: at(10_000_000),
    });
    await limiter.check("k");
    expect(sweeps[0]).toBe(10_000_000 - 30 * 60_000);
  });
});

/**
 * The same limiter over real PostgreSQL.
 *
 * The SQLite suite proves the statement's logic; this proves the *Postgres*
 * dialect of it — the `ON CONFLICT ... DO UPDATE ... RETURNING` atomic
 * increment and the `DELETE ... WHERE window_start < $1` sweep — against the
 * engine production actually runs. Gated on `AFTERMATH_TEST_DATABASE_URL` and
 * skipped without it, like the other durable suites.
 */
const pgUrl = process.env.AFTERMATH_TEST_DATABASE_URL;
const maybePg = pgUrl ? describe : describe.skip;

maybePg("DbRateLimitStore over PostgreSQL", () => {
  let pool: import("pg").Pool;
  let db: import("@/lib/db/sql").PgDb;
  const uniqueKey = () => `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  beforeAll(async () => {
    const { Pool } = await import("pg");
    const { PgDb } = await import("@/lib/db/sql");
    pool = new Pool({ connectionString: pgUrl });
    db = new PgDb(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("increments atomically under concurrent hits (no lost update)", async () => {
    const store = new DbRateLimitStore(db);
    const key = uniqueKey();
    const windowStart = Math.floor(Date.now() / 60_000) * 60_000;
    // Fire many hits at once; an atomic statement yields distinct counts.
    const counts = await Promise.all(
      Array.from({ length: 20 }, () => store.hit(key, windowStart)),
    );
    expect(new Set(counts).size).toBe(20);
    expect(Math.max(...counts)).toBe(20);
  });

  it("resets the count when the window advances", async () => {
    const store = new DbRateLimitStore(db);
    const key = uniqueKey();
    await store.hit(key, 60_000);
    await store.hit(key, 60_000);
    expect(await store.hit(key, 120_000)).toBe(1);
  });

  it("sweeps stale windows and keeps live ones", async () => {
    const store = new DbRateLimitStore(db);
    const live = uniqueKey();
    const stale = uniqueKey();
    const now = Date.now();
    const windowStart = Math.floor(now / 60_000) * 60_000;
    await store.hit(live, windowStart);
    await store.hit(stale, now - 60 * 60_000);
    await store.sweep(now - 10 * 60_000);
    // The stale row is gone (its window is re-created fresh), the live one stays.
    expect(await store.hit(stale, now - 60 * 60_000)).toBe(1);
    expect(await store.hit(live, windowStart)).toBe(2);
  });

  it("keeps an active long window when swept with the derived retention (F5)", async () => {
    const store = new DbRateLimitStore(db);
    const key = uniqueKey();
    const windowMs = 30 * 60_000;
    const now = Date.now();
    // The window began 20 minutes ago — still active for a 30-minute window.
    const windowStart = now - 20 * 60_000;
    await store.hit(key, windowStart);
    await store.hit(key, windowStart);
    // The derived retention for a 30-minute window is 60 minutes; the row is
    // newer than that cutoff, so the sweep must not touch it.
    await store.sweep(now - 2 * windowMs);
    expect(await store.hit(key, windowStart)).toBe(3);
  });

  it("resets an active long window under the old fixed 10-minute cutoff (F5)", async () => {
    const store = new DbRateLimitStore(db);
    const key = uniqueKey();
    const now = Date.now();
    // Same active 30-minute window, begun 20 minutes ago.
    const windowStart = now - 20 * 60_000;
    await store.hit(key, windowStart);
    await store.hit(key, windowStart);
    // A cutoff of now - 10min is *after* the window start, so the still-active
    // row is deleted and the next hit starts the window over — the defect.
    await store.sweep(now - 10 * 60_000);
    expect(await store.hit(key, windowStart)).toBe(1);
  });

  it("does not take the migration lock once the table exists (no cold-start degradation)", async () => {
    // Reproduces the cross-instance flake: a cold instance used to acquire the
    // cross-instance advisory lock on *every* first hit, even though the table
    // already existed. When another session held that lock, the hit blocked
    // until `storeTimeoutMs` and degraded to the in-process cap, so it never
    // reached the shared counter — defeating the cross-instance limit exactly
    // when instances start together (a burst).
    let lockCalls = 0;
    const counting: import("@/lib/db/sql").Db = {
      query: (sql, params) => db.query(sql, params),
      lockMigration: (fn) => {
        lockCalls += 1;
        return db.lockMigration(fn);
      },
    };
    // The table exists by now (earlier tests created it), so the first hit must
    // not need the lock at all.
    const store = new DbRateLimitStore(counting);
    const key = uniqueKey();
    const windowStart = Math.floor(Date.now() / 60_000) * 60_000;
    expect(await store.hit(key, windowStart)).toBe(1);
    expect(await store.hit(key, windowStart)).toBe(2);
    expect(lockCalls).toBe(0);
  });

  it("a cold store charges the shared counter while another session holds the migration lock", async () => {
    // The end-to-end form of the flake, with the real advisory lock: while a
    // separate session holds it, a cold store's first hit must still record in
    // the shared counter and must not degrade. Under the old always-lock
    // behaviour this hit blocked until `storeTimeoutMs` and reported
    // `degraded: true`, so it never reached the shared counter.
    const { Pool } = await import("pg");
    const { MIGRATION_LOCK_KEY } = await import("@/lib/db/sql");
    const holder = new Pool({ connectionString: pgUrl });
    const session = await holder.connect();
    try {
      await session.query(`SELECT pg_advisory_lock($1)`, [MIGRATION_LOCK_KEY]);
      const store = new DbRateLimitStore(db);
      const key = uniqueKey();
      const policy = { maxRequests: 3, windowMs: 10 * 60_000 };
      const limiter = new SharedRateLimiter({
        policy,
        store,
        fallback: new FixedWindowRateLimiter(policy),
      });
      const verdict = await limiter.check(key);
      expect(verdict.degraded).toBe(false);
      expect(verdict.allowed).toBe(true);
    } finally {
      await session.query(`SELECT pg_advisory_unlock($1)`, [MIGRATION_LOCK_KEY]).catch(() => {});
      session.release();
      await holder.end();
    }
  });
});
