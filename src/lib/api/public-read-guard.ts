import { NextResponse } from "next/server";
import type { AftermathConfig } from "@/lib/config";
import { runtime } from "@/lib/runtime";
import { clientIpKey } from "@/lib/api/verify-guard";
import {
  DbRateLimitStore,
  limiterFor,
  rateLimitKey,
  resetSharedLimiters,
  unavailableRateLimitStore,
  type RateLimitBucket,
  type RateLimitStore,
} from "@/lib/api/rate-limit";

/**
 * Abuse protection for the anonymous read endpoints.
 *
 * These endpoints are public by design — the learning loop is meant to be
 * readable without an account — but several of them do real work: they rebuild
 * a large view model or call Walrus and Tatum. Left unbounded, an anonymous
 * caller can turn a refresh loop into a denial-of-wallet attack against the
 * operator's upstream quotas.
 *
 * The cap is enforced through a *shared* counter (the durable database), so it
 * holds across serverless instances and cold starts. It is deliberately coarse:
 * a shared NAT egress address should not have one visitor's traffic exhaust
 * everyone's allowance, so the read buckets are generous and only the
 * expensive endpoints are tighter.
 */

const BUCKET_POLICY: Record<RateLimitBucket, keyof AftermathConfig["publicReadLimit"]> = {
  "public-read": "read",
  "public-read-heavy": "heavy",
  "public-read-status": "status",
};

function buildStore(): RateLimitStore {
  try {
    return new DbRateLimitStore(runtime().durable.db);
  } catch {
    // The runtime could not be built (misconfiguration). Degrade to the
    // in-process cap rather than failing the public site open.
    return unavailableRateLimitStore;
  }
}

/** The shared limiter for a bucket, created lazily from the configuration. */
export function publicReadLimiter(
  bucket: RateLimitBucket,
  config: AftermathConfig,
) {
  return limiterFor(`public:${bucket}`, config.publicReadLimit[BUCKET_POLICY[bucket]], {
    resolveStore: buildStore,
  });
}

/** Reset every public-read limiter. Exported for tests. */
export function resetPublicReadLimiters(): void {
  resetSharedLimiters();
}

export type PublicReadGuardResult =
  | { ok: true; headers: Record<string, string> }
  | { ok: false; response: NextResponse };

/**
 * Enforce the shared read cap for a bucket.
 *
 * On success returns headers (limit, remaining, policy, and a `degraded` flag
 * when the shared store was unavailable) for the route to attach to its own
 * response. On refusal returns a ready-to-return `429` with `Retry-After`.
 */
export async function guardPublicRead(
  request: Request,
  config: AftermathConfig,
  bucket: RateLimitBucket,
  limiter = publicReadLimiter(bucket, config),
): Promise<PublicReadGuardResult> {
  const key = rateLimitKey(bucket, clientIpKey(request), config.rateLimitSalt);
  const verdict = await limiter.check(key);

  if (!verdict.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "rate_limited",
          detail:
            "Too many read requests from this client; try again shortly. " +
            "Public data remains available at the normal rate.",
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

  const policy = config.publicReadLimit[BUCKET_POLICY[bucket]];
  return {
    ok: true,
    headers: {
      "x-ratelimit-limit": String(policy.maxRequests),
      "x-ratelimit-remaining": String(verdict.remaining),
      "x-ratelimit-policy": bucket,
      "x-ratelimit-degraded": verdict.degraded ? "true" : "false",
    },
  };
}
