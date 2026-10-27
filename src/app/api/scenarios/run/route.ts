import { NextResponse } from "next/server";
import { runScenarios } from "@/lib/service";
import { redact } from "@/lib/util/redact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Run all controlled demonstration scenarios against the current runtime.
 *
 * Scenarios labelled `simulated` never represent real financial transactions.
 * Finance scenarios marked `live` use digests discovered from the Sui ledger.
 */
export async function POST() {
  try {
    const result = await runScenarios();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: redact((err as Error).message) },
      { status: 500 },
    );
  }
}
