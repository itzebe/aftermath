import { NextResponse } from "next/server";
import { z } from "zod";
import { runtime as appRuntime } from "@/lib/runtime";
import { redact } from "@/lib/util/redact";
import { loadConfig } from "@/lib/config";
import { adminLimiter, guardAdminRequest } from "@/lib/api/verify-guard";
import { readJsonWithinLimit } from "@/lib/api/body-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BodySchema = z.object({
  query: z.string().min(1).max(2000),
  limit: z.number().int().min(1).max(50).optional(),
  sort: z.enum(["relevance", "recent"]).optional(),
});

/**
 * Run a recall query against the memory backend and report what came back.
 * Used by the Memory screen to demonstrate that stored lessons are retrievable.
 *
 * Administrator-only: each call reaches the Walrus Memory relayer, so it is
 * gated by the admin token and a per-client rate limit.
 */
export async function POST(request: Request) {
  const config = loadConfig();
  const guard = guardAdminRequest(request, config, {
    limiter: adminLimiter("memory-verify", config),
  });
  if (!guard.ok) return guard.response;

  const read = await readJsonWithinLimit(request, config.bodyLimitBytes);
  if (!read.ok) return read.response;
  const parsed = BodySchema.safeParse(read.value);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const rt = appRuntime();
  try {
    const lessons = await rt.memory.adapter.recallRelevantLessons(
      parsed.data.query,
      { limit: parsed.data.limit ?? 10, sort: parsed.data.sort ?? "relevance" },
    );
    return NextResponse.json({
      backend: rt.memory.adapter.backend,
      isLive: rt.memory.adapter.isLive,
      query: parsed.data.query,
      count: lessons.length,
      lessons,
    });
  } catch (err) {
    return NextResponse.json(
      { error: redact((err as Error).message) },
      { status: 502 },
    );
  }
}
