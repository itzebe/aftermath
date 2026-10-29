import Link from "next/link";
import { getSafeguardRecords } from "@/lib/service";
import { EmptyState, PageHeader, Pill } from "@/components/ui";

export const dynamic = "force-dynamic";

const VERIFICATION_TONE = {
  recommended: "info",
  test_planned: "info",
  test_executed: "warn",
  verified: "ok",
  inconclusive: "warn",
  failed: "bad",
} as const;

/**
 * The archive of Safeguard Records — each one a failure that left a safeguard
 * behind. Presented as a spine, because the value compounds: the point of
 * preserving a lesson is the next occurrence.
 */
export default async function RecordsPage() {
  let records;
  try {
    records = await getSafeguardRecords();
  } catch (err) {
    return (
      <div>
        <PageHeader eyebrow="Archive" title="Safeguard Records" />
        <EmptyState title="The record store could not be read">
          {(err as Error).message}
        </EmptyState>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Archive"
        title="Safeguard Records"
        lead="Every incident investigated through the submission path, newest first. Each record connects an incident to a specific safeguard and states honestly how far that safeguard has been verified."
        right={
          <Pill tone="neutral">
            {records.length} {records.length === 1 ? "record" : "records"}
          </Pill>
        }
      />

      {records.length === 0 ? (
        <EmptyState title="No records yet">
          <Link href="/" className="link-quiet">
            Submit an incident
          </Link>{" "}
          to produce the first Safeguard Record.
        </EmptyState>
      ) : (
        <ol className="spine">
          {records.map((r) => (
            <li key={r.recordId} className="spine-node">
              <span className="spine-dot" aria-hidden />
              <Link
                href={`/records/${r.recordId}`}
                className="panel block p-5 transition-colors hover:border-ink-500"
              >
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0">
                    <div className="mono text-[0.6875rem] text-paper-500">
                      {r.createdAt.slice(0, 19).replace("T", " ")} ·{" "}
                      {r.investigation.domain}
                    </div>
                    <div className="heading mt-1.5 text-[1rem]">
                      {r.investigation.summary}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Pill tone={VERIFICATION_TONE[r.verification.state]}>
                      {r.verification.state.replace(/_/g, " ")}
                    </Pill>
                    <Pill tone={r.provenance === "live" ? "ok" : "warn"}>
                      {r.provenance === "live" ? "live" : "simulated"}
                    </Pill>
                  </div>
                </div>
                <div className="mt-3 text-[0.875rem] leading-relaxed text-paper-300">
                  {r.recommendation.statement}
                </div>
                <div className="mono mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[0.6875rem] text-paper-600">
                  <span>pattern {r.investigation.diagnosis.pattern}</span>
                  <span>
                    {r.investigation.categories.observedEvidence.length} observed
                  </span>
                  <span>
                    {r.investigation.categories.hypotheses.length} hypotheses
                  </span>
                  <span>{r.recalledMemories.length} recalled</span>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
