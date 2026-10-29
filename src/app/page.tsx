import Link from "next/link";
import { getOverview } from "@/lib/service";
import { SubmitIncidentForm } from "@/components/submit-incident-form";
import { Metric, Pill } from "@/components/ui";

export const dynamic = "force-dynamic";

const SAMPLE = `2026-03-01T10:00:00Z ERROR checkout-service
POST /v1/charge returned 503 Service Unavailable
retrying (attempt 2/3)...
2026-03-01T10:00:07Z WARN checkout-service charge status: unknown
2026-03-01T10:00:08Z INFO agent "the charge completed successfully"`;

/**
 * The incident-first landing page.
 *
 * AFTERMATH's promise is that every failure should leave a safeguard, so the
 * front door is the act that produces one: submitting a real incident. The
 * reliability console (the controlled-scenario Evaluation Lab) is deliberately
 * one link away, because it is evidence *for* the mechanism, not the product's
 * purpose.
 */
export default async function HomePage() {
  const overview = await getOverview().catch(() => null);
  const configured = overview && !("error" in overview) ? overview : null;

  return (
    <div className="space-y-10">
      <section className="hero-grid -mx-5 -mt-6 border-b hairline px-5 pb-8 pt-10 md:-mx-8 md:px-8">
        <div className="max-w-3xl">
          <div className="label">Evidence-first failure prevention</div>
          <h1 className="mt-2 text-[1.75rem] font-semibold leading-tight tracking-tight md:text-[2.35rem]">
            Every failure should leave a safeguard.
          </h1>
          <p className="mt-3 max-w-2xl text-[0.9375rem] leading-relaxed text-paper-300">
            Submit real incident evidence. AFTERMATH returns a structured,
            evidence-grounded investigation: what the material shows, what is
            confirmed, what is merely hypothesised, what is still unknown — and a
            specific safeguard with a concrete path to verify it.
          </p>
          <p className="mt-2 max-w-2xl text-[0.8125rem] leading-relaxed text-paper-500">
            The investigation is rule-based and deterministic. There is no
            language model in the path, and nothing is asserted without an
            evidence span behind it. A rate limit or timeout is never recorded as
            a failure — missing evidence is stated as missing.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Pill tone="ok">rule-based extraction</Pill>
            <Pill tone="info">evidence spans on every fact</Pill>
            <Pill tone="neutral">simulated state labelled simulated</Pill>
            <Link
              href="/lab"
              className="mono text-[0.6875rem] text-signal-info underline-offset-2 hover:underline"
            >
              See the mechanism tested in the Evaluation Lab →
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0">
          <SubmitIncidentForm sample={SAMPLE} />
        </div>

        <aside className="space-y-3">
          <div className="panel rounded p-3.5">
            <div className="label">How a record is built</div>
            <ol className="mt-2 space-y-2 text-[0.75rem] leading-relaxed text-paper-300">
              {[
                ["Incident", "the material, treated as data"],
                ["Evidence", "observed vs. confirmed, with spans"],
                ["Hypothesis", "candidate mechanisms, with confidence"],
                ["Safeguard", "a specific, testable rule"],
                ["Verification", "executed, not merely asserted"],
                ["Memory", "preserved for the next occurrence"],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-2.5">
                  <span className="mono mt-0.5 text-[0.625rem] text-paper-500">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>
                    <span className="font-medium text-paper-100">{t}.</span> {d}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <div className="panel rounded p-3.5">
            <div className="label">Honest by construction</div>
            <ul className="mt-2 space-y-2 text-[0.75rem] leading-relaxed text-paper-300">
              <li>
                A success claim without an authoritative record is refused, not
                accepted.
              </li>
              <li>
                A safeguard is only <span className="mono">test_executed</span>{" "}
                once a real test ran; a single incident never claims{" "}
                <span className="mono">verified</span>.
              </li>
              <li>
                A recalled lesson is labelled a possible similarity until its
                pattern matches exactly.
              </li>
            </ul>
          </div>

          {configured ? (
            <div className="panel rounded p-3.5">
              <div className="label">Live system state</div>
              <div className="mt-2 space-y-2">
                <Metric
                  label="Safeguard records"
                  value={configured.counts.records}
                  sub="Investigations preserved from submissions."
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={configured.configuration.memory.isLive ? "ok" : "warn"}>
                    {configured.configuration.memory.isLive
                      ? "memory live"
                      : "memory simulated"}
                  </Pill>
                  <span className="mono text-[0.625rem] text-paper-500">
                    {configured.configuration.memory.backend}
                  </span>
                </div>
              </div>
              <Link
                href="/lab"
                className="mono mt-3 inline-block text-[0.6875rem] text-signal-info underline-offset-2 hover:underline"
              >
                Full system state in the Lab →
              </Link>
            </div>
          ) : null}
        </aside>
      </section>
    </div>
  );
}
