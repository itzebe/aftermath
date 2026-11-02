import { NextResponse } from "next/server";
import type { AftermathConfig } from "@/lib/config";
import { runtime } from "@/lib/runtime";
import { clientIpKey } from "@/lib/api/verify-guard";
import {
  DbRateLimitStore,
  limiterFor,
  rateLimitKey,
  unavailableRateLimitStore,
  type RateLimitStore,
  type SharedRateLimiter,
} from "@/lib/api/rate-limit";
import { adminWriteLimiter, guardAdminWrite } from "@/lib/api/admin-write-guard";

/**
 * The boundary for anonymous public incident submission.
 *
 * Public submission is the one operation that both spends a shared resource
 * (the free-tier model quota and a signed Walrus Mainnet write) and produces a
 * durable record, so it is enabled only when *every* control below is present
 * and verified at request time. This module never decides whether a submission
 * is *valid* — the route and the pipeline do that. It decides whether an
 * anonymous caller may reach the pipeline at all, and it fails closed.
 *
 * The controls are deliberately not individually configurable. A partial set of
 * controls is the dangerous state: the operator could believe submission is
 * safe because they enabled it, while a missing shared counter or a simulated
 * backend silently makes it unbounded or non-durable. So the route treats the
 * feature as available only when the whole set holds.
 */

export interface PublicSubmitAvailability {
  /** True only when every control is present; the route may serve anonymous callers. */
  available: boolean;
  /** Why submission is (or is not) available, stated for the operator and the caller. */
  reason: string;
}

/**
 * Evaluate whether the safety controls for public submission are in place.
 *
 * The checks are read from the live runtime and config rather than asserted:
 *
 *  1. The operator has opted in (`AFTERMATH_PUBLIC_SUBMISSION_ENABLED=1`).
 *  2. The memory backend is live (Walrus Memory Mainnet), not the simulated
 *     adapter — so a public submission that earns authority is durably
 *     persisted, and nothing fabricates a Mainnet record.
 *  3. The audit index is shared (PostgreSQL), not a per-instance SQLite file —
 *     so rate-limit counters and records hold across serverless instances
 *     instead of resetting on every cold start.
 *  4. A per-client submission cap is configured and positive.
 */
export function evaluatePublicSubmitAvailability(
  config: AftermathConfig,
): PublicSubmitAvailability {
  if (!config.publicSubmission.enabled) {
    return {
      available: false,
      reason:
        "Public submission is disabled. It is enabled only by the operator " +
        "setting AFTERMATH_PUBLIC_SUBMISSION_ENABLED=1.",
    };
  }

  let backend: string;
  let memoryLive: boolean;
  let indexShared: boolean;
  try {
    const rt = runtime();
    memoryLive = rt.memory.adapter.isLive;
    backend = rt.memory.adapter.backend;
    indexShared = rt.durable.backend === "postgres";
  } catch {
    return {
      available: false,
      reason:
        "The runtime could not be constructed, so the safety controls cannot " +
        "be verified. Submission stays admin-gated.",
    };
  }

  if (!memoryLive) {
    return {
      available: false,
      reason:
        `The memory backend is "${backend}", not the live Walrus Memory ` +
        "Mainnet adapter. Public submission stays admin-gated so nothing " +
        "records a durable memory that does not exist.",
    };
  }

  if (!indexShared) {
    return {
      available: false,
      reason:
        "The audit index is not shared (no DATABASE_URL). Rate-limit counters " +
        "and records would reset per serverless instance, so public submission " +
        "stays admin-gated.",
    };
  }

  if ((config.adminRateLimit["incidents/submit"]?.maxRequests ?? 0) <= 0) {
    return {
      available: false,
      reason: "No positive per-client submission cap is configured.",
    };
  }

  return {
    available: true,
    reason:
      "All safety controls are present: public submission is enabled, the " +
      "memory backend is live Walrus Memory Mainnet, the audit index is " +
      "shared, and a per-client cap is configured.",
  };
}

function buildStore(): RateLimitStore {
  try {
    return new DbRateLimitStore(runtime().durable.db);
  } catch {
    return unavailableRateLimitStore;
  }
}

/**
 * The limiter for anonymous submissions.
 *
 * It reuses the same shared, non-rotatable backstop the admin write path uses,
 * so a caller who rotates a forwarding header cannot mint unlimited buckets.
 * The per-client cap is the configured `incidents/submit` policy.
 */
export function publicSubmitLimiter(config: AftermathConfig): SharedRateLimiter {
  const policy = config.adminRateLimit["incidents/submit"] ?? {
    maxRequests: 5,
    windowMs: 60_000,
  };
  return limiterFor("public:incidents/submit", policy, {
    resolveStore: buildStore,
    globalMaxRequests: policy.maxRequests * 20,
    globalScope: "incidents/submit",
    retentionMs: config.rateLimitRetentionMs,
  });
}

export type PublicSubmitGuardResult =
  | { ok: true; anonymous: boolean }
  | { ok: false; response: NextResponse };

/**
 * Decide whether a submission request may proceed, and as whom.
 *
 * A valid administrator token always proceeds (the operator's own submissions
 * are unchanged). Otherwise the anonymous path is permitted only when every
 * safety control holds, and it is charged the shared submission cap. When the
 * controls are absent the caller receives the same fail-closed admin gate the
 * route used before, so a disabled deployment behaves exactly as it did.
 */
export async function guardIncidentSubmission(
  request: Request,
  config: AftermathConfig,
): Promise<PublicSubmitGuardResult> {
  const availability = evaluatePublicSubmitAvailability(config);

  if (!availability.available) {
    // Fall back to the exact admin gate the route used before this module
    // existed: token plus the shared per-client limiter. A valid token still
    // works; an anonymous caller gets the existing 401/429/503 with no hint
    // about internal state.
    const admin = await guardAdminWrite(request, config, {
      limiter: adminWriteLimiter("incidents/submit", config),
    });
    return admin.ok ? { ok: true, anonymous: false } : admin;
  }

  // A configured admin token still takes precedence, so the operator's own
  // tooling keeps working and is never subject to the anonymous cap.
  if (config.adminToken) {
    const admin = await guardAdminWrite(request, config, { limiter: null });
    if (admin.ok) return { ok: true, anonymous: false };
  }

  const limiter = publicSubmitLimiter(config);
  // Hash the client address before it reaches the persisted counter table, so
  // no raw caller address is written to the shared database.
  const key = rateLimitKey(
    limiter.bucketId ?? "public:incidents/submit",
    clientIpKey(request),
    config.rateLimitSalt,
  );
  const verdict = await limiter.check(key);
  if (!verdict.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "rate_limited",
          detail: "Too many submissions from this client; try again shortly.",
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

  return { ok: true, anonymous: true };
}
