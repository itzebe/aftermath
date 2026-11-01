import { NextResponse } from "next/server";
import { getSafeguardRecords } from "@/lib/service";
import { withStore } from "@/lib/api/errors";
import { guardPublicRead } from "@/lib/api/public-read-guard";
import { loadConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Safeguard Records a user has produced, newest first.
 *
 * Bounded to a fixed maximum so the response cannot be grown by a caller; the
 * cap is enforced server-side and is not a query parameter.
 */
const RECORDS_LIMIT = 100;

export async function GET(request: Request) {
  const guard = await guardPublicRead(request, loadConfig(), "public-read");
  if (!guard.ok) return guard.response;

  return withStore(async () => {
    const records = await getSafeguardRecords(RECORDS_LIMIT);
    return NextResponse.json(
      { records, limit: RECORDS_LIMIT, returned: records.length },
      { headers: guard.headers },
    );
  });
}
