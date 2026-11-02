import { NextResponse } from "next/server";
import { configurationStatus } from "@/lib/service";
import { guardPublicRead } from "@/lib/api/public-read-guard";
import { loadConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Redacted configuration summary. Never returns a raw credential. */
export async function GET(request: Request) {
  const guard = await guardPublicRead(request, loadConfig(), "public-read");
  if (!guard.ok) return guard.response;

  return NextResponse.json(configurationStatus(), { headers: guard.headers });
}
