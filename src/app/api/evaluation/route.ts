import { NextResponse } from "next/server";
import { getEvaluation, getScenarioOutcomes } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    metrics: getEvaluation(),
    outcomes: getScenarioOutcomes(),
  });
}
