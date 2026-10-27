import { NextResponse } from "next/server";
import { z } from "zod";
import { runtime as appRuntime } from "@/lib/runtime";
import { redact } from "@/lib/util/redact";

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
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
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
