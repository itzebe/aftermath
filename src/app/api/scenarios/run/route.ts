import { NextResponse } from "next/server";
import { runScenarioBatch, getDemoProgress } from "@/lib/service";
import { storeUnavailable } from "@/lib/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Advance the resumable demonstration by one bounded batch.
 *
 * The full plan runs ~16 scenarios, several of which perform real Walrus
 * Memory Mainnet writes. Completing them all takes longer than this function's
 * time limit, so a single request executes a bounded slice and persists
 * progress after each scenario. The client repeats until `continuationRequired`
 * is false.
 *
 * Body (optional): { "restart": boolean, "budgetMs": number }
 * A storage failure is reported as an explicit failure. A batch is never
 * presented as a completed run.
 */
export async function POST(request: Request) {
  try {
    let restart = false;
    let budgetMs: number | undefined;
    try {
      const body = (await request.json()) as {
        restart?: unknown;
        budgetMs?: unknown;
      };
      restart = body?.restart === true;
      if (typeof body?.budgetMs === "number" && Number.isFinite(body.budgetMs)) {
        budgetMs = Math.min(Math.max(1_000, body.budgetMs), 240_000);
      }
    } catch {
      // No body or non-JSON body: use defaults (continue the current job).
    }
    const result = await runScenarioBatch({ restart, budgetMs });
    return NextResponse.json(result);
  } catch (err) {
    return storeUnavailable(err);
  }
}

/** Current progress of the demonstration, for the UI to resume/continue. */
export async function GET() {
  try {
    const progress = await getDemoProgress();
    return NextResponse.json(progress ?? { jobId: null, total: 0, completed: 0, remaining: 0 });
  } catch (err) {
    return storeUnavailable(err);
  }
}
