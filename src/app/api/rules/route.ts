import { NextResponse } from "next/server";
import { getRules } from "@/lib/service";
import { withStore } from "@/lib/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return withStore(async () => NextResponse.json({ rules: await getRules() }));
}
