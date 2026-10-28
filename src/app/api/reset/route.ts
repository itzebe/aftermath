import { NextResponse } from "next/server";
import { resetAll } from "@/lib/service";
import { withStore } from "@/lib/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Clear the audit index. Does not touch Walrus Memory. */
export async function POST() {
  return withStore(async () => {
    await resetAll();
    return NextResponse.json({ ok: true });
  });
}
