"use client";

import { useEffect, useState } from "react";
import type { EvaluationMetrics, ScenarioOutcome } from "@/lib/engines/evaluation";
import {
  DecisionPill,
  EmptyState,
  EvidencePill,
  Loading,
  Metric,
  Notice,
  Panel,
  Pill,
  SectionTitle,
} from "@/components/ui";

interface EvaluationResponse {
  metrics: EvaluationMetrics | null;
  outcomes: ScenarioOutcome[];
}

export default function EvaluationPage() {
  const [data, setData] = useState<EvaluationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/evaluation")
      .then((r) => r.json())
      .then((d: EvaluationResponse) => {
        if (!cancelled) setData(d);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <Panel title="Evaluation">
        <p className="text-[0.8125rem] text-signal-bad">{error}</p>
      </Panel>
    );
  }
  if (!data) return <Loading label="Loading evaluation…" />;

  const m = data.metrics;

  // No run recorded yet: the API returns null metrics, which must render as an
  // explicit empty state rather than a client-side crash on `m.scenarios`.
  if (!m) {
    return (
      <div className="space-y-5">
        <SectionTitle
          title="Learning Evaluation"
          as="h1"
          hint="Did the activated safeguards actually change the outcome? These figures are measured over the controlled scenarios in the last run. They are scenario measurements, not claims about production reliability."
        />
        <EmptyState title="No scenario run recorded yet">
          Run the demonstrations from the Evaluation Lab. Every metric on this
          page is derived from that run and nothing else.
        </EmptyState>
      </div>
    );
  }

  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Learning Evaluation"
        hint="Did the activated safeguards actually change the outcome? These figures are measured over the controlled scenarios in the last run. They are scenario measurements, not claims about production reliability."
      />

      {m.scenarios === 0 ? (
        <EmptyState title="No scenario run recorded yet">
          Run the demonstrations from the Evaluation Lab. Every metric on this
          page is derived from that run and nothing else.
        </EmptyState>
      ) : (
        <>
          <Notice tone="info" title="How to read this">
            A first-occurrence scenario has no safeguard that could exist yet,
            so it establishes the unguarded baseline. A repeat scenario is one
            where a safeguard or recalled lesson already applied. Comparing the
            two is what the safeguards changed.
          </Notice>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric
              label="Unsupported claims caught"
              value={`${m.unsupportedClaimsCaught} / ${m.unsupportedClaims}`}
              tone={
                m.unsupportedClaimsAllowed > 0
                  ? "bad"
                  : m.unsupportedClaimsCaught === m.unsupportedClaims
                    ? "ok"
                    : "warn"
              }
              sub={
                m.unsupportedClaimsAllowed > 0
                  ? `${m.unsupportedClaimsAllowed} unsupported claim(s) were ALLOWED to stand. This must be zero.`
                  : m.unsupportedClaimsUnresolved > 0
                    ? `Refused by an explicit decision. A further ${m.unsupportedClaimsUnresolved} resolved to UNKNOWN — not accepted, but no safeguard governed them yet. None were allowed.`
                    : "Success claims made against failing or unverifiable actions that the engine refused to accept."
              }
            />
            <Metric
              label="Repeat prevention"
              value={pct(m.repeatPreventionRate)}
              tone={m.repeatFailuresSlippedThrough === 0 ? "ok" : "warn"}
              sub={`${m.repeatScenarios} repeat scenario(s); ${m.repeatFailuresSlippedThrough} slipped through.`}
            />
            <Metric
              label="Baseline failure rate"
              value={pct(m.baselineFailureRate)}
              tone="bad"
              sub={`${m.baselineScenarios} first-occurrence scenario(s), before any safeguard could apply.`}
            />
            <Metric
              label="False-block rate"
              value={pct(m.falseBlockRate)}
              tone={m.falseBlockRate > 0 ? "warn" : "ok"}
              sub="Valid actions that were blocked. Safe behaviour is not the same as denying everything."
            />
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric
              label="Evidence unavailable"
              value={pct(m.evidenceVerificationFailureRate)}
              tone="unknown"
              sub="Actions with no authoritative evidence. Never converted into success."
            />
            <Metric
              label="Memory retrieval relevance"
              value={pct(m.memoryRetrievalRelevance)}
              tone={m.memoryRetrievalRelevance >= 0.5 ? "ok" : "warn"}
              sub="Scenarios with an applicable safeguard where a lesson was recalled."
            />
            <Metric
              label="Scenarios"
              value={m.scenarios}
              sub="Controlled scenarios in the last run."
            />
            <Metric
              label="Repeat failures"
              value={m.repeatFailuresSlippedThrough}
              tone={m.repeatFailuresSlippedThrough > 0 ? "bad" : "ok"}
              sub="Repeats that were still allowed through."
            />
          </div>

          <Panel
            title="Decision distribution"
            hint="Every scenario resolves to exactly one decision."
          >
            <div className="flex flex-wrap gap-2">
              {Object.entries(m.decisions).map(([decision, count]) => (
                <div
                  key={decision}
                  className="flex items-center gap-2 rounded border hairline px-2.5 py-1.5"
                >
                  <DecisionPill
                    decision={decision as "ALLOW" | "BLOCK" | "REQUIRE_VERIFICATION" | "UNKNOWN"}
                  />
                  <span className="tabular text-[0.8125rem] font-semibold">
                    {count}
                  </span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            title="Per-scenario outcomes"
            hint="Each row is one controlled scenario. Ground truth is set when the scenario is defined, never inferred from the engine's decision."
          >
            <div
              className="scroll-x"
              role="region"
              aria-label="Per-scenario outcomes"
              tabIndex={0}
            >
              <table className="data">
                <thead>
                  <tr>
                    <th>Scenario</th>
                    <th>Kind</th>
                    <th>Ground truth</th>
                    <th>Agent claim</th>
                    <th>Evidence</th>
                    <th>Decision</th>
                    <th>Safeguard</th>
                    <th>Lesson recalled</th>
                  </tr>
                </thead>
                <tbody>
                  {data.outcomes.map((o) => (
                    <tr key={o.scenarioId}>
                      <td className="mono text-[0.6875rem]">{o.scenarioId}</td>
                      <td>
                        <Pill tone={o.isRepeat ? "info" : "neutral"}>
                          {o.isRepeat ? "repeat" : "first"}
                        </Pill>
                      </td>
                      <td>
                        <Pill tone={o.groundTruthFailure ? "bad" : "ok"}>
                          {o.groundTruthFailure ? "failing" : "valid"}
                        </Pill>
                      </td>
                      <td>
                        {o.agentClaimedSuccess ? (
                          <Pill tone="warn">claimed success</Pill>
                        ) : (
                          <span className="text-paper-500">none</span>
                        )}
                      </td>
                      <td>
                        <EvidencePill status={o.evidenceStatus} />
                      </td>
                      <td>
                        <DecisionPill decision={o.decision} />
                      </td>
                      <td>
                        {o.safeguardApplied ? (
                          <Pill tone="info">applied</Pill>
                        ) : (
                          <span className="text-paper-500">—</span>
                        )}
                      </td>
                      <td>
                        {o.lessonRecalled ? (
                          <Pill tone="ok">yes</Pill>
                        ) : (
                          <span className="text-paper-500">no</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
