import { NextResponse } from "next/server";
import { getEvaluation, getScenarioOutcomes } from "@/lib/service";
import { withStore } from "@/lib/api/errors";
import { guardPublicRead } from "@/lib/api/public-read-guard";
import { loadConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await guardPublicRead(request, loadConfig(), "public-read");
  if (!guard.ok) return guard.response;

  return withStore(async () => {
    const [metrics, outcomes] = await Promise.all([
      getEvaluation(),
      getScenarioOutcomes(),
    ]);
    return NextResponse.json({ metrics, outcomes }, { headers: guard.headers });
  });
}
