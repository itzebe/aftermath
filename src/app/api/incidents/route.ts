import { NextResponse } from "next/server";
import { getIncidents, getLastRun, getRules } from "@/lib/service";
import { withStore } from "@/lib/api/errors";
import { guardPublicRead } from "@/lib/api/public-read-guard";
import { loadConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Incidents, rules, and the last run. Bounded server-side, not by a parameter. */
const INCIDENTS_LIMIT = 200;

export async function GET(request: Request) {
  const guard = await guardPublicRead(request, loadConfig(), "public-read");
  if (!guard.ok) return guard.response;

  return withStore(async () => {
    const [incidents, rules, lastRun] = await Promise.all([
      getIncidents(INCIDENTS_LIMIT),
      getRules(),
      getLastRun(),
    ]);
    return NextResponse.json(
      { incidents, rules, lastRun, limit: INCIDENTS_LIMIT },
      { headers: guard.headers },
    );
  });
}
