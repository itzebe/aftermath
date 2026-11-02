import { NextResponse } from "next/server";
import { getSafeguardRecord } from "@/lib/service";
import { withStore } from "@/lib/api/errors";
import { guardPublicRead } from "@/lib/api/public-read-guard";
import { loadConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One Safeguard Record by id.
 *
 * Public and read-only, like the record list, so it sits behind the same shared
 * read cap: a caller cannot escape the limit by walking record ids, and the cap
 * is charged before the record is read. The record's submission is redacted on
 * the way out by `getSafeguardRecord`, so a credential-shaped value is never
 * served even from a record written before the redaction rule existed.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ recordId: string }> },
) {
  const guard = await guardPublicRead(request, loadConfig(), "public-read");
  if (!guard.ok) return guard.response;

  const { recordId } = await params;
  return withStore(async () => {
    const record = await getSafeguardRecord(recordId);
    if (!record) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ record }, { headers: guard.headers });
  });
}
