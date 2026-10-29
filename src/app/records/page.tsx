import Link from "next/link";
import { getSafeguardRecords } from "@/lib/service";
import { EmptyState, Pill, SectionTitle } from "@/components/ui";

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
 * behind. Presented as a timeline, because the value compounds: the point of
 * preserving a lesson is the next occurrence.
 */
export default async function RecordsPage() {
  let records;
  try {
    records = await getSafeguardRecords();
  } catch (err) {
    return (
      <div className="space-y-5">
        <SectionTitle title="Safeguard Records" />
        <EmptyState title="The record store could not be read">
          {(err as Error).message}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Safeguard Records"
        as="h1"
        hint="Every incident investigated through the submission path, newest first. Each record connects an incident to a specific safeguard and states honestly how far that safeguard has been verified."
        right={<Pill tone="neutral">{records.length} record(s)</Pill>}
      />

      {records.length === 0 ? (
        <EmptyState title="No records yet">
          <Link href="/" className="text-signal-info underline-offset-2 hover:underline">
            Submit an incident
          </Link>{" "}
          to produce the first Safeguard Record.
        </EmptyState>
      ) : (
        <ol className="chain">
          {records.map((r) => (
            <li key={r.recordId} className="chain-node">
              <span className="chain-dot" aria-hidden />
              <Link
                href={`/records/${r.recordId}`}
                className="panel block rounded p-3.5 transition-colors hover:border-[#3d4859]"
              >
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0">
                    <div className="mono text-[0.6875rem] text-paper-500">
                      {r.createdAt.slice(0, 19).replace("T", " ")} ·{" "}
                      {r.investigation.domain}
                    </div>
                    <div className="mt-0.5 text-[0.8125rem] font-medium">
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
                <div className="mt-2 text-[0.75rem] leading-relaxed text-paper-300">
                  {r.recommendation.statement}
                </div>
                <div className="mono mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.625rem] text-paper-500">
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
