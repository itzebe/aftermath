import { NextResponse } from "next/server";
import { getOverview } from "@/lib/service";
import { withStore } from "@/lib/api/errors";
import { guardPublicRead } from "@/lib/api/public-read-guard";
import { loadConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The homepage aggregate. It makes live Walrus and Tatum health calls, so it is
 * behind the shared read cap; the aggregate itself is memoised for a short TTL
 * in `getOverview`, bounding the upstream calls an anonymous caller can trigger.
 */
export async function GET(request: Request) {
  const guard = await guardPublicRead(request, loadConfig(), "public-read-status");
  if (!guard.ok) return guard.response;

  return withStore(async () =>
    NextResponse.json(await getOverview(), { headers: guard.headers }),
  );
}
