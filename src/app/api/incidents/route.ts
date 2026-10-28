import { NextResponse } from "next/server";
import { getIncidents, getLastRun, getRules } from "@/lib/service";
import { withStore } from "@/lib/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return withStore(async () => {
    const [incidents, rules, lastRun] = await Promise.all([
      getIncidents(),
      getRules(),
      getLastRun(),
    ]);
    return NextResponse.json({ incidents, rules, lastRun });
  });
}
