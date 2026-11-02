import { NextResponse } from "next/server";
import type { AftermathConfig } from "@/lib/config";
import { runtime } from "@/lib/runtime";
import {
  clientIpKey,
  constantTimeEqual,
  extractAdminToken,
} from "@/lib/api/verify-guard";
import {
  DbRateLimitStore,
  limiterFor,
  rateLimitKey,
  unavailableRateLimitStore,
  type RateLimitStore,
  type SharedRateLimiter,
} from "@/lib/api/rate-limit";

/**
 * Durable administrator write-path protection.
 *
 * The write and destructive endpoints (incident submission, scenario runs,
 * reset, recall) are already gated by the shared admin token. That token gate
 * is the real control; the rate limit is a second gate that bounds a *holder*
 * of the token and blunts accidental client loops.
 *
 * The previous limiter was a module-level `Map`, so on a serverless host it was
 * per-instance, reset by a cold start, and racy under concurrency — it did not
 * reliably bound anything. This guard charges the same *shared* counter the
 * public reads use (a single atomic database statement), so the cap holds
 * across instances and cold starts.
 *
 * The token gate runs first, so an unauthenticated caller can never consume
 * another client's budget, and the credential is never logged or stored: only
 * the client address is hashed into the counter key.
 */

export type AdminWriteGuardResult =
  | { ok: true }
  | { ok: false; response: NextResponse };

function buildStore(): RateLimitStore {
  try {
    return new DbRateLimitStore(runtime().durable.db);
  } catch {
    return unavailableRateLimitStore;
  }
}

/**
 * The multiplier that turns an admin endpoint's per-client cap into its shared,
 * non-rotatable global cap.
 *
 * The admin endpoints are already gated by the shared token, so the rate limit
 * is a secondary bound. But the per-client key is a forwarding header, which a
 * token holder could rotate to mint a fresh bucket per request; the global cap
 * cannot be rotated, so it still bounds such a burst. The factor keeps the
 * global cap well clear of normal use (a batch loop makes a handful of calls a
 * minute) while remaining far below "unbounded".
 */
const ADMIN_GLOBAL_BACKSTOP_FACTOR = 20;

/** The shared limiter for an admin endpoint, created lazily from the config. */
export function adminWriteLimiter(
  endpoint: string,
  config: AftermathConfig,
): SharedRateLimiter {
  const policy = config.adminRateLimit[endpoint] ?? {
    maxRequests: 5,
    windowMs: 60_000,
  };
  return limiterFor(`admin:${endpoint}`, policy, {
    resolveStore: buildStore,
    globalMaxRequests: policy.maxRequests * ADMIN_GLOBAL_BACKSTOP_FACTOR,
    globalScope: endpoint,
    // Retention is derived from the configured windows so the sweep can never
    // drop a counter whose window is still active (F5).
    retentionMs: config.rateLimitRetentionMs,
  });
}

export interface AdminWriteGuardOptions {
  /** The limiter to charge, or `null`/omitted to skip rate limiting. */
  limiter?: SharedRateLimiter | null;
  /** Charge the limiter on this request (default true). */
  rateLimit?: boolean;
}

/**
 * Enforce the administrator token (and, optionally, a shared rate limit).
 *
 * Fails closed when no token is configured — an unset `AFTERMATH_ADMIN_TOKEN`
 * disables the endpoint entirely rather than exposing it. The token comparison
 * is constant-time and the credential is never echoed.
 */
export async function guardAdminWrite(
  request: Request,
  config: AftermathConfig,
  options: AdminWriteGuardOptions = {},
): Promise<AdminWriteGuardResult> {
  const expected = config.adminToken;
  if (!expected) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "admin_disabled",
          detail:
            "This endpoint is disabled because no administrator token is " +
            "configured (AFTERMATH_ADMIN_TOKEN). It never runs without one.",
        },
        { status: 503 },
      ),
    };
  }

  const provided = extractAdminToken(request);
  if (!provided || !constantTimeEqual(provided, expected)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "unauthorized", detail: "A valid administrator token is required." },
        { status: 401, headers: { "www-authenticate": "Bearer" } },
      ),
    };
  }

  if (options.limiter && options.rateLimit !== false) {
    // Hash the client address before it reaches the counter table, exactly as
    // the public-read guard does. The counter key is persisted, so a raw `ip:`
    // key would put every caller's address at rest in the shared database; the
    // salt keeps the mapping from being reversible by anyone who reads it.
    const bucket = options.limiter.bucketId ?? "admin";
    const key = rateLimitKey(bucket, clientIpKey(request), config.rateLimitSalt);
    const verdict = await options.limiter.check(key);
    if (!verdict.allowed) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            error: "rate_limited",
            detail: "Too many requests; try again shortly.",
            retryAfterSeconds: verdict.retryAfterSeconds,
          },
          {
            status: 429,
            headers: {
              "retry-after": String(verdict.retryAfterSeconds),
              "x-ratelimit-degraded": verdict.degraded ? "true" : "false",
            },
          },
        ),
      };
    }
  }

  return { ok: true };
}
