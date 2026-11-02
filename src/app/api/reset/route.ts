import { NextResponse } from "next/server";
import { resetAll } from "@/lib/service";
import { withStore } from "@/lib/api/errors";
import { loadConfig } from "@/lib/config";
import { adminWriteLimiter, guardAdminWrite } from "@/lib/api/admin-write-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Clear the audit index. Does not touch Walrus Memory.
 *
 * This is destructive — it deletes the incident, decision, rule, and memory-write
 * ledger rows — so it requires the administrator token and fails closed when no
 * token is configured. Its rate limit is enforced through a shared, atomic
 * counter so it holds across serverless instances. It never touches on-chain
 * state; Walrus blobs are immutable and are not removed here.
 */
export async function POST(request: Request) {
  const config = loadConfig();
  const guard = await guardAdminWrite(request, config, {
    limiter: adminWriteLimiter("reset", config),
  });
  if (!guard.ok) return guard.response;

  return withStore(async () => {
    await resetAll();
    return NextResponse.json({ ok: true });
  });
}
