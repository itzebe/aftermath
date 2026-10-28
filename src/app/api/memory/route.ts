import { NextResponse } from "next/server";
import { getMemoryWrites } from "@/lib/service";
import { runtime as appRuntime } from "@/lib/runtime";
import { withStore } from "@/lib/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Memory write ledger plus the live backend health and configuration. */
export async function GET() {
  const rt = appRuntime();
  return withStore(async () => {
    const [health, status, writes] = await Promise.all([
      rt.memory.adapter.validateMemoryAvailability(),
      rt.memory.adapter.status(),
      getMemoryWrites(),
    ]);
    return NextResponse.json({
      writes,
      health,
      status,
      backend: rt.memory.adapter.backend,
      isLive: rt.memory.adapter.isLive,
      reason: rt.memory.reason,
      degraded: rt.memory.degraded,
    });
  });
}
