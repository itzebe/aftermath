import { NextResponse } from "next/server";
import { getIncidents, getLastRun, getRules } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    incidents: getIncidents(),
    rules: getRules(),
    lastRun: getLastRun(),
  });
}
