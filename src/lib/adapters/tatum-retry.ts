import { TatumSuiTransportError } from "@/lib/adapters/tatum-sui";

/**
 * Retry a Tatum call when the gateway answers "too many requests".
 *
 * Tatum's Sui gateway enforces a low per-key request rate on both the gRPC and
 * the GraphQL interface (observed: three rapid calls succeed, the fourth is
 * rejected). A burst — discovering digests and then verifying each one — trips
 * it easily. Retrying a rate-limit response is correct and safe: the gateway
 * answered, so no transaction outcome is implied, and the request is read-only.
 *
 * Only a 429 / RESOURCE_EXHAUSTED is retried. Every other failure is returned
 * to the caller unchanged so its evidence semantics are preserved.
 */
export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injectable for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function isRateLimit(err: unknown): boolean {
  if (err instanceof TatumSuiTransportError) {
    return err.httpStatus === 429;
  }
  // @protobuf-ts surfaces gRPC's RESOURCE_EXHAUSTED as a string code.
  const e = err as { code?: unknown; message?: string };
  if (e?.code === "RESOURCE_EXHAUSTED") return true;
  return (
    typeof e?.message === "string" && /429|too many requests|rate limit/i.test(e.message)
  );
}

export async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const base = opts.baseDelayMs ?? 250;
  const max = opts.maxDelayMs ?? 4000;
  const sleep = opts.sleep ?? defaultSleep;

  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRateLimit(err) || attempt === attempts - 1) throw err;
      const advised =
        err instanceof TatumSuiTransportError ? err.retryAfterMs : undefined;
      const backoff = Math.min(max, base * 2 ** attempt);
      await sleep(advised && advised > 0 ? Math.max(advised, backoff) : backoff);
    }
  }
  throw lastErr;
}
