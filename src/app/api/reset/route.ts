import { NextResponse } from "next/server";
import { resetAll } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Clear the local audit index. Does not touch Walrus Memory. */
export async function POST() {
  resetAll();
  return NextResponse.json({ ok: true });
}
