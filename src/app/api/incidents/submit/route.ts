import { NextResponse } from "next/server";
import { submitIncident } from "@/lib/service";
import { IncidentSubmissionSchema } from "@/lib/schemas";
import { storeUnavailable } from "@/lib/api/errors";
import { classifyTransient } from "@/lib/util/transient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Submit an incident for investigation.
 *
 * The body is validated before anything else happens. The submitted material is
 * treated strictly as data: it is parsed with regular expressions, never
 * executed, and never interpolated into a command, a query, or a shell. A
 * transient failure of a dependency (the memory relayer, Tatum) is reported as
 * a retryable condition, never as a verdict about the incident.
 */
export async function POST(request: Request) {
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
        detail: "The submission did not pass validation.",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    const record = await submitIncident(parsed.data);
    return NextResponse.json({ record });
  } catch (err) {
    const transient = classifyTransient(err);
    if (transient.transient) {
      // The dependency refused to answer. This is not a failed investigation;
      // the caller may retry, and the deterministic record id keeps the retry
      // idempotent.
      return NextResponse.json(
        {
          error: "transient_dependency_error",
          retryable: true,
          retryAfterMs: transient.retryAfterMs ?? 30_000,
          detail:
            "A dependency was transiently unavailable, so the investigation " +
            "did not complete. No verdict has been recorded for this incident. " +
            transient.reason,
        },
        { status: 503 },
      );
    }
    return storeUnavailable(err);
  }
}
