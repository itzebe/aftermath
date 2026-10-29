import { NextResponse } from "next/server";
import { getSafeguardRecord } from "@/lib/service";
import { withStore } from "@/lib/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One Safeguard Record by id. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ recordId: string }> },
) {
  const { recordId } = await params;
  return withStore(async () => {
    const record = await getSafeguardRecord(recordId);
    if (!record) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ record });
  });
}
