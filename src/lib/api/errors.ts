import { NextResponse } from "next/server";
import { redact } from "@/lib/util/redact";

/**
 * The durable store is unreachable or a query failed.
 *
 * A storage failure must never be reported as success. This turns it into an
 * explicit `503` with a non-secret reason, so the UI shows an error instead of
 * an empty (but apparently healthy) result. The reason is redacted because a
 * driver error can embed the connection string.
 */
export function storeUnavailable(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json(
    {
      error: "store_unavailable",
      detail:
        "The durable audit store could not be reached, so this result cannot " +
        "be trusted. No success is being reported.",
      reason: redact(message),
    },
    { status: 503 },
  );
}

/** Run a route body, converting an unexpected throw into an explicit 503. */
export async function withStore<T>(
  fn: () => Promise<T>,
): Promise<T | NextResponse> {
  try {
    return await fn();
  } catch (err) {
    return storeUnavailable(err);
  }
}
