import { NextResponse } from "next/server";
import { getLearningLoop } from "@/lib/service";
import { withStore } from "@/lib/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The learning-loop view model.
 *
 * Read-only and anonymous, like the other public read endpoints: it exposes only
 * what the durable Safeguard Records already contain — the learning history, the
 * retrieval trail, the visible behaviour changes, the learning impact, and the
 * provenance of every claim. No credential, no write, no inference.
 */
export async function GET() {
  return withStore(async () => NextResponse.json(await getLearningLoop()));
}
