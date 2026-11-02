import { NextResponse } from "next/server";
import { getRules } from "@/lib/service";
import { withStore } from "@/lib/api/errors";
import { guardPublicRead } from "@/lib/api/public-read-guard";
import { loadConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await guardPublicRead(request, loadConfig(), "public-read");
  if (!guard.ok) return guard.response;

  return withStore(async () => {
    const rules = await getRules();
    return NextResponse.json(
      { rules, returned: rules.length },
      { headers: guard.headers },
    );
  });
}
