import { NextResponse } from "next/server";
import { getOverview } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const overview = await getOverview();
  return NextResponse.json(overview);
}
