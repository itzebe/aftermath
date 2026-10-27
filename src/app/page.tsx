import { getOverview, getLastRun } from "@/lib/service";
import { EvidencePill, DecisionPill, Metric, Notice, Pill, ProvenancePill, SectionTitle } from "@/components/ui";
import { RunScenariosButton } from "@/components/run-scenarios";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const [overview, lastRun] = await Promise.all([
    getOverview().catch((err) => ({ error: (err as Error).message })),
    Promise.resolve(getLastRun()),
  ]);

  if ("error" in overview) {
    return (
      <Notice tone="bad" title="Overview unavailable">
        {overview.error}
      </Notice>
    );
  }

  const { counts, configuration, tatumHealth, memoryHealth, memoryStatus, mainnetRequirement, evaluation } =
    overview;

  return (
    <div className="space-y-8">
      <section>
        <SectionTitle
          title="Overview"
          hint="Live application state. Every figure below is read from the running system; nothing is illustrative."
          right={<RunScenariosButton />}
        />

        {memoryStatus.state === "MAINNET_AUTH_FAILED" ? (
          <div className="mb-4">
            <Notice tone="bad" title="Walrus Memory credentials rejected">
              The relayer is reachable but refused the delegate credentials, so
              no Mainnet write can be claimed. {memoryStatus.detail}
            </Notice>
          </div>
        ) : configuration.memory.isLive && !memoryStatus.authenticated ? (
          <div className="mb-4">
            <Notice tone="warn" title="Walrus Memory authentication unverified">
              The relayer is reachable but the credential check did not confirm
              the delegate key. {memoryStatus.detail}
            </Notice>
          </div>
        ) : !configuration.memory.isLive ? (
          <div className="mb-4">
            <Notice tone="warn" title="Simulated memory backend in use">
              {configuration.memory.reason}
            </Notice>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Total incidents" value={counts.incidents} />
          <Metric
            label="Verified failures"
            value={counts.verifiedFailures}
            tone={counts.verifiedFailures > 0 ? "bad" : "neutral"}
            sub="Authoritative evidence proves the action failed."
          />
          <Metric
            label="Active safeguards"
            value={counts.activeRules}
            tone={counts.activeRules > 0 ? "ok" : "neutral"}
            sub="Validated rules currently enforced."
          />
          <Metric
            label="Unresolved incidents"
            value={counts.unresolved}
            tone={counts.unresolved > 0 ? "warn" : "neutral"}
            sub="Unknown or awaiting verification."
          />
        </div>
      </section>

      <section>
        <SectionTitle
          title="Walrus Memory"
          hint="A write only counts once the relayer job completes and returns a blob id, and recall confirms the record is retrievable."
        />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Metric
            label="Completed Mainnet writes"
            value={mainnetRequirement.completedLive}
            tone={mainnetRequirement.satisfied ? "ok" : "warn"}
            sub={`Requirement: ${mainnetRequirement.required}. ${
              mainnetRequirement.satisfied
                ? "Satisfied."
                : `${mainnetRequirement.remaining} still required.`
            }`}
          />
          <Metric
            label="Recall-verified"
            value={mainnetRequirement.recallVerified}
            tone={mainnetRequirement.recallVerified > 0 ? "ok" : "neutral"}
            sub="Writes confirmed retrievable by a recall query."
          />
          <Metric
            label="Simulated writes"
            value={counts.simulatedWrites}
            tone={counts.simulatedWrites > 0 ? "warn" : "neutral"}
            sub="Excluded from the Mainnet requirement."
          />
        </div>

        <div className="panel mt-3 rounded p-3.5">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="mono text-[0.625rem] uppercase tracking-[0.1em] text-paper-500">
                Backend
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <Pill tone={configuration.memory.isLive ? "ok" : "warn"}>
                  {configuration.memory.backend}
                </Pill>
                <span className="mono text-[0.6875rem] text-paper-500">
                  {configuration.memory.network} · {configuration.memory.relayerUrl}
                </span>
              </div>
              <div className="mt-2 text-[0.75rem] leading-relaxed text-paper-300">
                {configuration.memory.reason}
              </div>
            </div>
            <div>
              <div className="mono text-[0.625rem] uppercase tracking-[0.1em] text-paper-500">
                Relayer health
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <Pill
                  tone={
                    memoryStatus.state === "MAINNET_AUTH_FAILED"
                      ? "bad"
                      : memoryStatus.authenticated
                        ? "ok"
                        : "warn"
                  }
                >
                  {memoryStatus.authenticated
                    ? "credentials accepted"
                    : memoryStatus.state === "MAINNET_AUTH_FAILED"
                      ? "credentials rejected"
                      : memoryStatus.reachable
                        ? "reachable · auth unverified"
                        : "unreachable"}
                </Pill>
                {memoryHealth.relayerVersion ? (
                  <span className="mono text-[0.6875rem] text-paper-500">
                    relayer {memoryHealth.relayerVersion}
                  </span>
                ) : null}
              </div>
              <div className="mt-2 text-[0.75rem] leading-relaxed text-paper-300">
                {memoryStatus.detail}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <SectionTitle
          title="Tatum verification health"
          hint="Read-only Sui Mainnet verification. No transaction is ever broadcast."
        />
        <div className="panel rounded p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={tatumHealth.ok ? "ok" : "bad"}>
              {tatumHealth.ok ? "healthy" : "unavailable"}
            </Pill>
            {tatumHealth.chainIdentifier ? (
              <span className="mono text-[0.6875rem] text-paper-500">
                chain identifier {tatumHealth.chainIdentifier}
              </span>
            ) : null}
            <span className="mono text-[0.6875rem] text-paper-500">
              {configuration.tatum.interface}
            </span>
          </div>
          <div className="mt-2 text-[0.75rem] leading-relaxed text-paper-300">
            {tatumHealth.detail}
          </div>
          {!configuration.tatum.configured ? (
            <div className="mt-3">
              <Notice tone="warn" title="Tatum API key not configured">
                Live on-chain verification is unavailable. Finance incidents will
                resolve to UNKNOWN, which is the correct behaviour: a lookup that
                cannot run establishes neither success nor failure.
              </Notice>
            </div>
          ) : null}
        </div>
      </section>

      <section>
        <SectionTitle
          title="Evaluation"
          hint="Measured over the controlled scenarios in the last run. These are scenario measurements, not claims about production reliability."
        />
        {evaluation ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric
              label="Unsupported claims caught"
              value={`${evaluation.unsupportedClaimsCaught}/${evaluation.unsupportedClaims}`}
              tone={
                evaluation.unsupportedClaimsCaught === evaluation.unsupportedClaims
                  ? "ok"
                  : "warn"
              }
              sub="Claims of success made against failing or unverifiable actions."
            />
            <Metric
              label="Repeat prevention"
              value={`${(evaluation.repeatPreventionRate * 100).toFixed(0)}%`}
              tone={
                evaluation.repeatFailuresSlippedThrough === 0 ? "ok" : "warn"
              }
              sub={`${evaluation.repeatScenarios} repeat scenario(s); ${evaluation.repeatFailuresSlippedThrough} slipped through.`}
            />
            <Metric
              label="Baseline failure rate"
              value={`${(evaluation.baselineFailureRate * 100).toFixed(0)}%`}
              tone="bad"
              sub={`${evaluation.baselineScenarios} first-occurrence scenario(s), unguarded.`}
            />
            <Metric
              label="False-block rate"
              value={`${(evaluation.falseBlockRate * 100).toFixed(0)}%`}
              tone={evaluation.falseBlockRate > 0 ? "warn" : "ok"}
              sub="Valid actions blocked. Lower is better; zero means nothing valid was stopped."
            />
          </div>
        ) : (
          <Notice tone="info" title="No scenario run recorded yet">
            Run the demonstrations to populate the evaluation metrics.
          </Notice>
        )}
        {evaluation ? (
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric
              label="Evidence unavailable"
              value={`${(evaluation.evidenceVerificationFailureRate * 100).toFixed(0)}%`}
              tone="unknown"
              sub="Actions with no authoritative evidence. Never counted as success."
            />
            <Metric
              label="Memory retrieval relevance"
              value={`${(evaluation.memoryRetrievalRelevance * 100).toFixed(0)}%`}
              tone={evaluation.memoryRetrievalRelevance >= 0.5 ? "ok" : "warn"}
              sub="Scenarios with an applicable safeguard where a lesson was recalled."
            />
            <Metric
              label="Total scenarios"
              value={evaluation.scenarios}
              sub="Controlled scenarios in the last run."
            />
            <Metric
              label="Repeat failures"
              value={evaluation.repeatFailuresSlippedThrough}
              tone={evaluation.repeatFailuresSlippedThrough > 0 ? "bad" : "ok"}
              sub="Repeats that were still allowed through."
            />
          </div>
        ) : null}
      </section>

      <section>
        <SectionTitle
          title="Last scenario run"
          hint="Each scenario shows the agent claim, the evidence, and the resulting decision."
        />
        {lastRun ? (
          <div className="panel scroll-x rounded">
            <table className="data">
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th>Domain</th>
                  <th>Evidence</th>
                  <th>Decision</th>
                  <th>Provenance</th>
                </tr>
              </thead>
              <tbody>
                {lastRun.scenarios.map((s) => (
                  <tr key={s.scenarioId}>
                    <td>
                      <div className="font-medium">{s.title}</div>
                      <div className="mono text-[0.6875rem] text-paper-500">
                        {s.scenarioId}
                      </div>
                    </td>
                    <td className="mono text-[0.75rem]">{s.domain}</td>
                    <td>
                      <EvidencePill status={s.evidenceStatus as never} />
                    </td>
                    <td>
                      <DecisionPill decision={s.decision as never} />
                    </td>
                    <td>
                      <ProvenancePill provenance={s.simulated ? "simulated" : "live"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Notice tone="info" title="No run yet">
            Use “Run demonstrations” to execute the controlled scenarios.
          </Notice>
        )}
      </section>
    </div>
  );
}
