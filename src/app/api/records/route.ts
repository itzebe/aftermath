import { NextResponse } from "next/server";
import { getSafeguardRecords } from "@/lib/service";
import { withStore } from "@/lib/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The Safeguard Records a user has produced, newest first. */
export async function GET() {
  return withStore(async () => {
    const records = await getSafeguardRecords();
    return NextResponse.json({ records });
  });
}
