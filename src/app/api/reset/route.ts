import { NextResponse } from "next/server";
import { resetAll } from "@/lib/service";
import { withStore } from "@/lib/api/errors";
import { loadConfig } from "@/lib/config";
import { adminLimiter, guardAdminRequest } from "@/lib/api/verify-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Clear the audit index. Does not touch Walrus Memory.
 *
 * This is destructive — it deletes the incident, decision, rule, and memory-write
 * ledger rows — so it requires the administrator token and fails closed when no
 * token is configured. It never touches on-chain state; Walrus blobs are
 * immutable and are not removed here.
 */
export async function POST(request: Request) {
  const config = loadConfig();
  const guard = guardAdminRequest(request, config, {
    limiter: adminLimiter("reset", config),
  });
  if (!guard.ok) return guard.response;

  return withStore(async () => {
    await resetAll();
    return NextResponse.json({ ok: true });
  });
}
