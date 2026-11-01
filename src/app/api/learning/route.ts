import { NextResponse } from "next/server";
import { getLearningLoop } from "@/lib/service";
import { withStore } from "@/lib/api/errors";
import { guardPublicRead } from "@/lib/api/public-read-guard";
import { loadConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The learning-loop view model.
 *
 * Read-only and anonymous, like the other public read endpoints: it exposes only
 * what the durable Safeguard Records already contain — the learning history, the
 * retrieval trail, the visible behaviour changes, the learning impact, and the
 * provenance of every claim. No credential, no write, no inference.
 *
 * It rebuilds a large view model, so it is protected by a *shared* (database-
 * backed) read cap and the view model itself is cached for a short TTL. Public
 * data stays available at the normal rate; only a burst is refused.
 */
export async function GET(request: Request) {
  const guard = await guardPublicRead(request, loadConfig(), "public-read-heavy");
  if (!guard.ok) return guard.response;

  return withStore(async () => {
    const loop = await getLearningLoop();
    return NextResponse.json(loop, { headers: guard.headers });
  });
}
