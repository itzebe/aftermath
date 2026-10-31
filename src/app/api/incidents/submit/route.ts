import { NextResponse } from "next/server";
import { submitIncident } from "@/lib/service";
import { IncidentSubmissionSchema } from "@/lib/schemas";
import { storeUnavailable } from "@/lib/api/errors";
import { classifyTransient } from "@/lib/util/transient";
import { loadConfig } from "@/lib/config";
import { adminLimiter, guardAdminRequest } from "@/lib/api/verify-guard";
import { readJsonWithinLimit } from "@/lib/api/body-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Submit an incident for investigation.
 *
 * This is an administrator-only operation: it spends free-tier model quota on
 * every request, so it is gated by the shared admin token and a per-client rate
 * limit (both fail closed — see `verify-guard`). The body is size-checked before
 * it is parsed, then validated before anything else happens. The submitted
 * material is treated strictly as data: it is parsed with regular expressions,
 * never executed, and never interpolated into a command, a query, or a shell. A
 * transient failure of a dependency (the memory relayer, Tatum) is reported as
 * a retryable condition, never as a verdict about the incident.
 */
export async function POST(request: Request) {
  const config = loadConfig();
  const guard = guardAdminRequest(request, config, {
    limiter: adminLimiter("incidents/submit", config),
  });
  if (!guard.ok) return guard.response;

  const read = await readJsonWithinLimit(request, config.bodyLimitBytes);
  if (!read.ok) return read.response;
  const body = read.value;

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
