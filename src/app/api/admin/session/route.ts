import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { guardAdminRequest } from "@/lib/api/verify-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Validate the administrator credential without performing any work.
 *
 * The admin console uses this to confirm a pasted token before it reveals the
 * gated operations, so a wrong token is reported as an authentication failure
 * instead of surfacing later as an unexplained error from a write.
 *
 * It is deliberately read-only: it charges no rate-limit window, touches no
 * store, and reaches no external service. It therefore cannot be used to make a
 * write happen. The token gate itself — fail-closed when unset, constant-time
 * compare, never echoed — is the shared one, so this route cannot drift from the
 * write endpoints.
 */
export async function GET(request: Request) {
  const guard = guardAdminRequest(request, loadConfig(), { rateLimit: false });
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true });
}
