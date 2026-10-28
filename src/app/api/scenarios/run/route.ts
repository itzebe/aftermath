import { NextResponse } from "next/server";
import { runScenarios } from "@/lib/service";
import { storeUnavailable } from "@/lib/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Run all controlled demonstration scenarios against the current runtime.
 *
 * Scenarios labelled `simulated` never represent real financial transactions.
 * Finance scenarios marked `live` use digests discovered from the Sui ledger.
 *
 * A storage failure is reported as an explicit failure. The run is never
 * presented as having persisted when it did not.
 */
export async function POST() {
  try {
    const result = await runScenarios();
    return NextResponse.json(result);
  } catch (err) {
    return storeUnavailable(err);
  }
}
