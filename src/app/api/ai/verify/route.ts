import { NextResponse } from "next/server";
import { IncidentSubmissionSchema } from "@/lib/schemas";
import { loadConfig } from "@/lib/config";
import { runAiVerification } from "@/lib/engines/ai-verify";
import { guardVerifyRequest, verifyLimiter } from "@/lib/api/verify-guard";
import { classifyTransient } from "@/lib/util/transient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Read-only AI verification.
 *
 * Proves, against a live deployment, that the configured provider actually runs
 * and returns a *grounded* result — without submitting an incident, creating a
 * Walrus Memory, or touching the audit index. It reuses the production inference
 * path (same client, engine, grounding, timeout, redaction) and the same input
 * validation as a submission, but it holds no store, memory adapter, or runtime,
 * so it has nothing it *could* persist with.
 *
 * Protected by a bearer token that fails closed (see `verify-guard`): with no
 * `AFTERMATH_AI_VERIFY_TOKEN` configured, the route refuses to serve.
 *
 * The body is the same shape a submission accepts (`text` required). The
 * response reports `inference.ran` — the authoritative signal — plus the
 * validated `AiAnalysis`.
 */
export async function POST(request: Request) {
  const config = loadConfig();
  const guard = guardVerifyRequest(request, config, verifyLimiter(config));
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = IncidentSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_submission",
        detail: "The synthetic fixture did not pass validation.",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    const result = await runAiVerification({
      text: parsed.data.text,
      ...(parsed.data.service ? { service: parsed.data.service } : {}),
      ...(parsed.data.expectedBehavior
        ? { expectedBehavior: parsed.data.expectedBehavior }
        : {}),
      ...(parsed.data.actualBehavior ? { actualBehavior: parsed.data.actualBehavior } : {}),
    });
    return NextResponse.json(result);
  } catch (err) {
    // A throw here is unexpected (the engine never throws), but a transport
    // problem must still be reported as retryable, never as a result.
    const transient = classifyTransient(err);
    return NextResponse.json(
      {
        error: "verification_failed",
        retryable: transient.transient,
        retryAfterMs: transient.retryAfterMs ?? 30_000,
        detail: transient.reason,
      },
      { status: transient.transient ? 503 : 500 },
    );
  }
}
