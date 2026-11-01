import { createHash } from "node:crypto";
import type { Db } from "@/lib/db/sql";
import { FixedWindowRateLimiter } from "@/lib/api/verify-guard";

/**
 * Shared, durable rate limiting for the public read endpoints.
 *
 * The process-local {@link FixedWindowRateLimiter} in `verify-guard.ts` is
 * correct only as a *supplement*: a module-level `Map` is per-instance, reset by
 * a cold start, and racy under concurrency, so on a serverless host it cannot
 * bound a caller who spreads requests across instances. The public read routes
 * make live upstream calls (Walrus availability, Tatum health) and can return
 * large bodies, so they need a counter that every instance shares.
 *
 * This module keeps that counter in the same durable database the audit index
 * already uses. The increment is a single atomic statement, so concurrent
 * requests — across instances or within one — cannot both read the old count
 * and write the new one. There is no read-then-write in application code.
 *
 * The counters hold no personal data: the key is a salted hash of the client
 * address, scoped to a route bucket, and the address itself is never stored.
 */

/** The route categories, so expensive and cheap endpoints get different caps. */
export type RateLimitBucket =
  | "public-read"
  | "public-read-heavy"
  | "public-read-status";

export interface RateLimitPolicy {
  /** Requests permitted per window, per client. */
  maxRequests: number;
  /** Window length. */
  windowMs: number;
}

export type RateLimitPolicies = Record<RateLimitBucket, RateLimitPolicy>;

/** The outcome of one attempt against a bucket. */
export interface RateLimitVerdict {
  allowed: boolean;
  /** Whole seconds the caller should wait before retrying. */
  retryAfterSeconds: number;
  /** Remaining allowance in the current window (best-effort, for headers). */
  remaining: number;
}

/**
 * The store the limiter charges. Implemented over `Db` for the durable
 * (Postgres/SQLite) path, and by an in-memory object for unit tests. Keeping it
 * an interface lets the atomic statement be tested against real SQLite without
 * a live Postgres.
 */
export interface RateLimitStore {
  /**
   * Atomically record one hit for `key` and return the running count for the
   * current window, which begins at `windowStart`.
   */
  hit(key: string, windowStart: number): Promise<number>;
}

/** Postgres/SQLite implementation over the shared `Db` façade. */
export class DbRateLimitStore implements RateLimitStore {
  private ready: Promise<void> | null = null;
  constructor(private readonly db: Db) {}

  /**
   * Create the counter table on first use.
   *
   * The limiter may run before any other durable store has migrated, so it owns
   * its table rather than depending on call order. The migration is held under
   * the same cross-instance advisory lock as the other migrators, so two
   * instances starting together cannot collide on the catalog.
   */
  private ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = this.db
        .lockMigration(async () => {
          await this.db.query(
            `CREATE TABLE IF NOT EXISTS rate_limit_counters (
               bucket_key TEXT PRIMARY KEY,
               window_start BIGINT NOT NULL,
               count INTEGER NOT NULL
             )`,
          );
        })
        .catch((err) => {
          // Do not cache a failed migration: a later request retries once the
          // database is reachable again.
          this.ready = null;
          throw err;
        });
    }
    return this.ready;
  }

  /**
   * One statement does everything: insert the first hit, or increment within the
   * same window, or reset when the window has advanced. `RETURNING count` hands
   * back the post-update value, so two concurrent callers see two distinct
   * counts and the cap cannot be stepped over by a race. The same SQL text runs
   * on Postgres and SQLite (`Db` rewrites `$n` to `?` for SQLite).
   */
  async hit(key: string, windowStart: number): Promise<number> {
    await this.ensureReady();
    const res = await this.db.query<{ count: number }>(
      `INSERT INTO rate_limit_counters (bucket_key, window_start, count)
       VALUES ($1, $2, 1)
       ON CONFLICT (bucket_key) DO UPDATE
         SET count = CASE
               WHEN rate_limit_counters.window_start = $2
                 THEN rate_limit_counters.count + 1
               ELSE 1
             END,
             window_start = $2
       RETURNING count`,
      [key, windowStart],
    );
    const row = res.rows[0];
    return row ? Number(row.count) : 1;
  }
}

/**
 * In-memory store for tests. It models the same contract as the SQL store
 * (atomic per-key increment within a window) so the limiter's behaviour can be
 * exercised without a database. It is NOT used in production.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly counters = new Map<string, { windowStart: number; count: number }>();

  async hit(key: string, windowStart: number): Promise<number> {
    const existing = this.counters.get(key);
    const next =
      existing && existing.windowStart === windowStart
        ? { windowStart, count: existing.count + 1 }
        : { windowStart, count: 1 };
    this.counters.set(key, next);
    return next.count;
  }
}

/**
 * What happens when the backing store is unavailable.
 *
 * A read endpoint is not a write endpoint, so a database outage should not take
 * the public site down. But an unbounded fail-open would hand an attacker a way
 * to disable the limiter by inducing store errors, so the fallback is a
 * conservative in-process cap: requests still pass, but the process itself caps
 * how many per window it will serve while degraded. The caller reports the
 * degraded state in a response header.
 */
export type DegradedBehavior = "allow-in-process-cap";

export interface SharedRateLimiterOptions {
  policy: RateLimitPolicy;
  store: RateLimitStore;
  /**
   * The in-process limiter used only while `store` is unavailable. Bounds abuse
   * during a database outage without failing the public site closed.
   */
  fallback: FixedWindowRateLimiter;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

export interface RateLimitResult extends RateLimitVerdict {
  /**
   * True when the shared store could not be reached and the in-process cap was
   * used instead. The route surfaces this so a client (and the operator) can
   * tell a shared decision from a degraded one.
   */
  degraded: boolean;
}

/**
 * Enforce a bucket's limit through the shared store.
 *
 * The window is aligned to `windowMs` boundaries from the epoch, so every
 * instance agrees on which window a request belongs to without sharing a
 * "start" value. The window key the caller passes already scopes the counter to
 * the route and client.
 */
export class SharedRateLimiter {
  private readonly now: () => number;
  constructor(private readonly options: SharedRateLimiterOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  async check(windowKey: string): Promise<RateLimitResult> {
    const now = this.now();
    const { maxRequests, windowMs } = this.options.policy;
    const windowStart = Math.floor(now / windowMs) * windowMs;
    try {
      const count = await this.options.store.hit(windowKey, windowStart);
      const allowed = count <= maxRequests;
      const retryAfterSeconds = allowed
        ? 0
        : Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
      return {
        allowed,
        retryAfterSeconds,
        remaining: Math.max(0, maxRequests - count),
        degraded: false,
      };
    } catch {
      // The store failed. Do not fail open to *unlimited*: apply the in-process
      // cap so a store outage cannot be used to defeat the limit entirely.
      const verdict = this.options.fallback.check(windowKey, now);
      return {
        allowed: verdict.allowed,
        retryAfterSeconds: verdict.allowed
          ? 0
          : Math.max(1, Math.ceil(verdict.retryAfterMs / 1000)),
        remaining: 0,
        degraded: true,
      };
    }
  }
}

/* -------------------------------------------------------------------------- *
 * Limiter registry
 *
 * One limiter per logical bucket, reused across requests in a process. The
 * durable store is resolved lazily so this module stays importable from a pure
 * unit test that supplies its own store.
 * -------------------------------------------------------------------------- */

const limiters = new Map<string, SharedRateLimiter>();

/**
 * A store that always fails. Used when the durable store cannot be built at all
 * (a misconfiguration), so the caller degrades to the in-process cap rather
 * than failing the request open to unlimited.
 */
export const unavailableRateLimitStore: RateLimitStore = {
  hit: () => Promise.reject(new Error("rate-limit store unavailable")),
};

export interface LimiterRegistryOptions {
  /** Build the shared store, or throw if it cannot be built. */
  resolveStore: () => RateLimitStore;
}

/**
 * Return the shared limiter for `key`, creating it from `policy` on first use.
 *
 * The fallback is a process-local fixed-window cap that only applies while the
 * shared store is unreachable — it bounds a store outage, and is never the
 * primary control.
 */
export function limiterFor(
  key: string,
  policy: RateLimitPolicy,
  options: LimiterRegistryOptions,
  now?: () => number,
): SharedRateLimiter {
  let limiter = limiters.get(key);
  if (!limiter) {
    let store: RateLimitStore;
    try {
      store = options.resolveStore();
    } catch {
      store = unavailableRateLimitStore;
    }
    limiter = new SharedRateLimiter({
      policy,
      store,
      fallback: new FixedWindowRateLimiter(policy),
      ...(now ? { now } : {}),
    });
    limiters.set(key, limiter);
  }
  return limiter;
}

/** Drop every registered limiter. Exported for tests and after a reset. */
export function resetSharedLimiters(): void {
  limiters.clear();
}

/**
 * Derive the counter key for a request.
 *
 * The key is `bucket:sha256(salt|clientId)`. The hash keeps the client address
 * out of the database (no personal data at rest) while still giving each client
 * a stable, distinct bucket. The salt is a per-deployment secret so the mapping
 * cannot be brute-forced from a leaked table; without it the key still works,
 * just with a fixed salt.
 */
export function rateLimitKey(
  bucket: RateLimitBucket,
  clientId: string,
  salt: string,
): string {
  return `${bucket}:${createHash("sha256").update(`${salt}|${clientId}`, "utf8").digest("hex")}`;
}
