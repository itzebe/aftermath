import { NextResponse } from "next/server";
import { runScenarioBatch, getDemoProgress } from "@/lib/service";
import { storeUnavailable } from "@/lib/api/errors";
import { loadConfig } from "@/lib/config";
import { adminLimiter, guardAdminRequest } from "@/lib/api/verify-guard";
import { readJsonWithinLimit } from "@/lib/api/body-limit";

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
 *
 * Administrator-only, because a batch performs real Mainnet writes and
 * `restart:true` additionally clears simulated audit and workflow state. A
 * storage failure is reported as an explicit failure; a batch is never
 * presented as a completed run.
 */
export async function POST(request: Request) {
  const config = loadConfig();

  // Gate the token first, before touching the body: an unauthenticated caller
  // must not be able to make the server read a request body at all.
  const tokenGuard = guardAdminRequest(request, config, { rateLimit: false });
  if (!tokenGuard.ok) return tokenGuard.response;

  // The body must be read before the limiter can know whether `restart` was
  // requested. It is size-checked, then parsed leniently — an absent or non-JSON
  // body simply means "continue the current job".
  const read = await readJsonWithinLimit(request, config.bodyLimitBytes);
  if (!read.ok) return read.response;
  const raw = read.value as { restart?: unknown; budgetMs?: unknown } | null;

  const restart = raw?.restart === true;

  // A restart resets simulated state, so it is the more dangerous operation. It
  // still requires the admin token, but is exempt from the per-minute cap: an
  // operator holding the token may need to restart a wedged job immediately.
  // Every non-restart batch is rate-limited.
  const guard = guardAdminRequest(request, config, {
    limiter: adminLimiter("scenarios/run", config),
    rateLimit: !restart,
  });
  if (!guard.ok) return guard.response;

  let budgetMs: number | undefined;
  if (typeof raw?.budgetMs === "number" && Number.isFinite(raw.budgetMs)) {
    budgetMs = Math.min(Math.max(1_000, raw.budgetMs), 240_000);
  }

  try {
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
