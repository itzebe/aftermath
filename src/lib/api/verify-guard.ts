import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { AftermathConfig } from "@/lib/config";

/**
 * Access control for the read-only AI verification endpoint.
 *
 * The endpoint runs a real, metered model call, so it must never be public. It
 * is protected by two independent gates:
 *
 *   1. a shared bearer token, compared in constant time. With no token
 *      configured the route *fails closed* — it refuses to serve at all, rather
 *      than becoming an unauthenticated inference endpoint by omission.
 *   2. a fixed-window request cap per caller, so a holder of the token cannot
 *      drain the free-tier quota or use the route as a free LLM proxy.
 *
 * Both gates are pure and take the clock/counter as inputs, so they are
 * testable without a server or a network.
 */

export interface RateLimiterOptions {
  maxRequests: number;
  windowMs: number;
}

interface Window {
  count: number;
  resetAt: number;
}

/**
 * A fixed-window counter keyed by an opaque caller id.
 *
 * Deliberately simple and in-process: the endpoint is a diagnostic, not a
 * product surface, and a per-instance cap still bounds abuse on a serverless
 * host. Correctness never depends on it — a miss only lets a request through to
 * the token gate, which is the real control.
 */
export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, Window>();
  constructor(private readonly options: RateLimiterOptions) {}

  /** Record a hit for `key`; return whether it is allowed and the wait time. */
  check(key: string, now: number = Date.now()): { allowed: boolean; retryAfterMs: number } {
    const existing = this.windows.get(key);
    if (!existing || now >= existing.resetAt) {
      this.windows.set(key, { count: 1, resetAt: now + this.options.windowMs });
      return { allowed: true, retryAfterMs: 0 };
    }
    if (existing.count >= this.options.maxRequests) {
      return { allowed: false, retryAfterMs: Math.max(0, existing.resetAt - now) };
    }
    existing.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  reset(): void {
    this.windows.clear();
  }
}

/** Compare two strings without leaking length or content through timing. */
export function constantTimeEqual(a: string, b: string): boolean {
  // Hash both sides to a fixed 32-byte width first, so the comparison is
  // constant-time regardless of the inputs' differing lengths.
  const ah = createHash("sha256").update(a, "utf8").digest();
  const bh = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ah, bh);
}

/** Pull the caller's token from an Authorization bearer or a dedicated header. */
export function extractToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth) {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match) return match[1].trim();
  }
  const header = request.headers.get("x-aftermath-verify-token");
  return header ? header.trim() : null;
}

/** A stable, non-secret caller id for rate limiting. */
export function callerId(request: Request): string {
  // Key the window on the presented credential, not on a client-supplied IP:
  // `x-forwarded-for` can be spoofed, so an IP key would let a token holder
  // rotate the header to evade the cap. The token is the thing being metered.
  const token = extractToken(request);
  if (token) return createHash("sha256").update(token, "utf8").digest("hex");
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return `ip:${fwd.split(",")[0]!.trim()}`;
  return `ip:${request.headers.get("x-real-ip") ?? "unknown"}`;
}

export type VerifyGuardResult =
  | { ok: true }
  | { ok: false; response: NextResponse };

/**
 * The process-wide limiter for the verify endpoint. Kept here (not in the route
 * module) so it can be reset in tests without the route exporting anything
 * beyond its HTTP handlers.
 */
let sharedLimiter: FixedWindowRateLimiter | null = null;

export function verifyLimiter(config: AftermathConfig): FixedWindowRateLimiter {
  if (!sharedLimiter) {
    sharedLimiter = new FixedWindowRateLimiter({
      maxRequests: config.aiVerify.maxRequests,
      windowMs: config.aiVerify.windowMs,
    });
  }
  return sharedLimiter;
}

/** Reset the in-process rate-limit window. Exported for tests. */
export function resetVerifyLimiter(): void {
  sharedLimiter = null;
}

/**
 * Enforce the token and rate-limit gates. Returns a ready-to-return error
 * response when the request must be refused.
 */
export function guardVerifyRequest(
  request: Request,
  config: AftermathConfig,
  limiter: FixedWindowRateLimiter,
  now: number = Date.now(),
): VerifyGuardResult {
  const expected = config.aiVerify.token;
  if (!expected) {
    // Fail closed. An unset token disables the endpoint entirely.
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "ai_verify_disabled",
          detail:
            "This endpoint is disabled because no verification token is " +
            "configured. It never serves inference without one.",
        },
        { status: 503 },
      ),
    };
  }

  const provided = extractToken(request);
  if (!provided || !constantTimeEqual(provided, expected)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "unauthorized", detail: "A valid verification token is required." },
        { status: 401, headers: { "www-authenticate": "Bearer" } },
      ),
    };
  }

  const verdict = limiter.check(callerId(request), now);
  if (!verdict.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "rate_limited",
          detail: "Too many verification requests; try again shortly.",
          retryAfterMs: verdict.retryAfterMs,
        },
        {
          status: 429,
          headers: { "retry-after": String(Math.ceil(verdict.retryAfterMs / 1000)) },
        },
      ),
    };
  }

  return { ok: true };
}
