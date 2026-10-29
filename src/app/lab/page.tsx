import { getOverview, getLastRun } from "@/lib/service";
import { EvidencePill, DecisionPill, Metric, Notice, PageHeader, Pill, ProvenancePill, Section } from "@/components/ui";
import { RunScenariosButton } from "@/components/run-scenarios";

export const dynamic = "force-dynamic";

export default async function LabPage() {
  const [overview, lastRun] = await Promise.all([
    getOverview().catch((err) => ({ error: (err as Error).message })),
    // The last-run table is a convenience view over the audit index. If the
    // store cannot be read, the page must still render the overview and the
    // reason, not throw a server exception.
    Promise.resolve()
      .then(() => getLastRun())
      .catch(() => null),
  ]);

  if ("error" in overview) {
    return (
      <div>
        <PageHeader eyebrow="System" title="Evaluation Lab" />
        <Notice tone="bad" title="Lab unavailable">
          {overview.error}
        </Notice>
      </div>
    );
  }

  const { counts, configuration, tatumHealth, memoryHealth, memoryStatus, mainnetRequirement, evaluation, lastRunAt } =
    overview;

  return (
    <div className="space-y-16">
      <div>
        <PageHeader
          eyebrow="System"
          title="Evaluation Lab"
          lead="The reliability console: live system state and the controlled scenarios that test the mechanism. Every figure is read from the running system; nothing is illustrative."
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

        <Section eyebrow="Overview" title="System state">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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
        </Section>
      </div>

      <Section
        eyebrow="Integrity"
        title="Walrus Memory"
        lead="A write only counts once the relayer job completes and returns a blob id, and recall confirms the record is retrievable."
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          <Metric
            label="Completed Mainnet writes"
            value={mainnetRequirement.completedLive}
            tone={mainnetRequirement.satisfied ? "ok" : "warn"}
            sub={`This instance's ledger. Requirement: ${mainnetRequirement.required}. ${
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
            label="Memories in namespace"
            value={
              typeof memoryStatus.namespaceMemoryCount === "number"
                ? memoryStatus.namespaceMemoryCount
                : "—"
            }
            tone={
              typeof memoryStatus.namespaceMemoryCount === "number" &&
              memoryStatus.namespaceMemoryCount >= 10
                ? "ok"
                : "neutral"
            }
            sub="Authoritative count the relayer reports for the namespace, independent of this instance's ledger."
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
              <div className="label">
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
              <div className="mt-2 break-words text-[0.75rem] leading-relaxed text-paper-300">
                {configuration.memory.reason}
              </div>
            </div>
            <div>
              <div className="label">
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
              <div className="mt-2 break-words text-[0.75rem] leading-relaxed text-paper-300">
                {memoryStatus.detail}
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section
        eyebrow="Integrity"
        title="Tatum verification health"
        lead="Read-only Sui Mainnet verification. No transaction is ever broadcast."
      >
        <div className="panel p-5">
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
          <div className="mt-2 break-words text-[0.75rem] leading-relaxed text-paper-300">
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
      </Section>

      <Section
        eyebrow="Persistence"
        title="Audit index"
        lead="Where the incident index is stored. The index is an audit record, not an authority; Tatum and Walrus Memory remain the sources of truth."
      >
        <div className="panel p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={configuration.persistence.durable ? "ok" : "warn"}>
              {configuration.persistence.backend}
            </Pill>
            <span className="mono text-[0.6875rem] text-paper-500">
              {configuration.persistence.durable
                ? "durable · shared across instances"
                : "per-instance · not shared"}
            </span>
          </div>
          <div className="mt-2 break-words text-[0.75rem] leading-relaxed text-paper-300">
            {configuration.persistence.detail}
          </div>
          {!configuration.persistence.durable ? (
            <div className="mt-3">
              <Notice tone="warn" title="Audit index is not durable on this host">
                Records written by one request are not guaranteed to be visible
                to another. Set DATABASE_URL to a PostgreSQL connection string
                (for example a Neon database) to make the audit index durable.
              </Notice>
            </div>
          ) : null}
        </div>
      </Section>

      <Section
        eyebrow="Measurement"
        title="Evaluation"
        lead="Measured over the controlled scenarios in the last run. These are scenario measurements, not claims about production reliability."
      >
        {evaluation ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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
      </Section>

      <Section
        eyebrow="Evidence"
        title="Last scenario run"
        lead={
          lastRunAt
            ? `Each scenario shows the agent claim, the evidence, and the resulting decision. This is the most recent run recorded, executed ${lastRunAt.slice(0, 19).replace("T", " ")} UTC.`
            : "Each scenario shows the agent claim, the evidence, and the resulting decision."
        }
      >
        {lastRun ? (
          <div
            className="panel scroll-x"
            role="region"
            aria-label="Last scenario run"
            tabIndex={0}
          >
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
            Use “Run from scratch” to execute the controlled scenarios.
          </Notice>
        )}
      </Section>
    </div>
  );
}
