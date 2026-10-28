/**
 * Classify an error as a transient transport condition rather than a genuine
 * failure of the attempted action.
 *
 * This distinction is the whole point of the product: a rate limit, a timeout,
 * or a 5xx from a dependency means the evidence is *unavailable*, not that the
 * operation failed. Recording such a condition as a permanent scenario failure
 * would be the same mistake AFTERMATH exists to prevent — converting missing
 * evidence into a verdict. Callers use this to defer and retry instead.
 */

export interface TransientAssessment {
  transient: boolean;
  /** How long the source asked us to wait, when it said so. */
  retryAfterMs?: number;
  reason: string;
}

/** The relayer's own hint, e.g. `"retry_after_seconds":300`. */
const RETRY_AFTER_JSON = /"retry_after_seconds"\s*:\s*(\d+)/i;
/** A `Retry-After` header surfaced in an error string. */
const RETRY_AFTER_TEXT = /retry[-_ ]?after["'\s:=]*(\d+)/i;

const RATE_LIMIT = /rate limit|429|too many requests|quota|throttl/i;
const SERVER_ERROR =
  /\b5\d\d\b|server error|bad gateway|service unavailable|gateway timeout|upstream|unavailable/i;
const NETWORK =
  /timeout|timed out|econnreset|econnrefused|etimedout|econnaborted|enotfound|network|socket hang up|fetch failed|aborted/i;

/** Never wait longer than this for one deferral, however large the hint. */
const MAX_RETRY_AFTER_MS = 300_000;
const DEFAULT_RETRY_AFTER_MS = 30_000;

function parseRetryAfterMs(message: string): number | undefined {
  const json = RETRY_AFTER_JSON.exec(message) ?? RETRY_AFTER_TEXT.exec(message);
  if (!json) return undefined;
  const seconds = Number(json[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

/**
 * Decide whether an error is worth retrying.
 *
 * A transient condition is one where the request never produced a verdict:
 * the dependency refused to answer (429), failed to answer (5xx), or the
 * connection never completed (timeout, reset). Anything else — a 4xx that is
 * not a rate limit, a malformed response, a domain error — is treated as a
 * real failure and is not retried.
 */
export function classifyTransient(err: unknown): TransientAssessment {
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : String(err);

  // A server that explicitly refused due to load is transient even if the text
  // also mentions something else.
  if (RATE_LIMIT.test(message)) {
    return {
      transient: true,
      retryAfterMs: parseRetryAfterMs(message) ?? DEFAULT_RETRY_AFTER_MS,
      reason: "the dependency rate-limited the request",
    };
  }
  if (SERVER_ERROR.test(message)) {
    return {
      transient: true,
      retryAfterMs: parseRetryAfterMs(message),
      reason: "the dependency returned a server error",
    };
  }
  if (NETWORK.test(message)) {
    return {
      transient: true,
      retryAfterMs: parseRetryAfterMs(message),
      reason: "the request never completed (network or timeout)",
    };
  }
  return { transient: false, reason: "not a transient transport condition" };
}
