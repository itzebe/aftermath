import { NextResponse } from "next/server";
import { configurationStatus } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Redacted configuration summary. Never returns a raw credential. */
export async function GET() {
  return NextResponse.json(configurationStatus());
}
