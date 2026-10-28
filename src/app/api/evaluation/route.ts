import { NextResponse } from "next/server";
import { getEvaluation, getScenarioOutcomes } from "@/lib/service";
import { withStore } from "@/lib/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return withStore(async () => {
    const [metrics, outcomes] = await Promise.all([
      getEvaluation(),
      getScenarioOutcomes(),
    ]);
    return NextResponse.json({ metrics, outcomes });
  });
}
