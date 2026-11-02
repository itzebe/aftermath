import { NextResponse } from "next/server";
import { getMemoryStatus, getMemoryWrites } from "@/lib/service";
import { runtime as appRuntime } from "@/lib/runtime";
import { withStore } from "@/lib/api/errors";
import { guardPublicRead } from "@/lib/api/public-read-guard";
import { loadConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Memory write ledger plus the live backend health and configuration.
 *
 * The health and status fields come from live upstream calls, so they are
 * cached for a short TTL and the route is behind the shared read cap. The write
 * ledger is bounded so the response cannot grow without limit.
 */
export async function GET(request: Request) {
  const guard = await guardPublicRead(request, loadConfig(), "public-read-status");
  if (!guard.ok) return guard.response;

  const rt = appRuntime();
  return withStore(async () => {
    const [{ health, status }, writes] = await Promise.all([
      getMemoryStatus(),
      getMemoryWrites(),
    ]);
    return NextResponse.json(
      {
        writes,
        health,
        status,
        backend: rt.memory.adapter.backend,
        isLive: rt.memory.adapter.isLive,
        reason: rt.memory.reason,
        degraded: rt.memory.degraded,
      },
      { headers: guard.headers },
    );
  });
}
