"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  Diagnosis,
  EvidenceAssessment,
  Incident,
  SafeguardDecision,
  SafeguardRule,
} from "@/lib/schemas";
import {
  DecisionPill,
  EmptyState,
  EvidencePill,
  Field,
  Loading,
  PageHeader,
  Panel,
  Pill,
  ProvenancePill,
} from "@/components/ui";

interface IncidentRecord {
  incident: Incident;
  assessment: EvidenceAssessment;
  diagnosis: Diagnosis;
  decision: SafeguardDecision;
}

interface IncidentsResponse {
  incidents: IncidentRecord[];
  rules: SafeguardRule[];
}

const DOMAIN_LABEL: Record<string, string> = {
  finance: "Finance",
  coding: "Coding",
  workflow: "Workflow",
};

export default function IncidentsPage() {
  const [data, setData] = useState<IncidentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [domainFilter, setDomainFilter] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/incidents")
      .then((r) => r.json())
      .then((d: IncidentsResponse) => {
        if (cancelled) return;
        setData(d);
        setSelectedId(d.incidents[0]?.incident.incidentId ?? null);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    return domainFilter === "all"
      ? data.incidents
      : data.incidents.filter((r) => r.incident.domain === domainFilter);
  }, [data, domainFilter]);

  const selected =
    filtered.find((r) => r.incident.incidentId === selectedId) ??
    filtered[0] ??
    null;

  if (error) {
    return (
      <div>
        <PageHeader eyebrow="System" title="Incident Explorer" />
        <Panel>
          <p className="text-[0.875rem] text-signal-bad">{error}</p>
        </Panel>
      </div>
    );
  }
  if (!data) return <Loading label="Loading incidents…" />;

  return (
    <div>
      <PageHeader
        eyebrow="System"
        title="Incident Explorer"
        lead="Every attempted action the engine has evaluated, with the evidence it read, the diagnosis it formed, and the decision it reached. Evidence is recorded before any conclusion."
      />

      {data.incidents.length === 0 ? (
        <EmptyState title="No incidents recorded yet">
          Run the demonstrations from the Evaluation Lab to populate the
          incident timeline.
        </EmptyState>
      ) : (
        <div className="space-y-8">
          <div className="flex flex-wrap items-center gap-2">
            <FilterButton
              active={domainFilter === "all"}
              onClick={() => setDomainFilter("all")}
              label={`All (${data.incidents.length})`}
            />
            {["finance", "coding", "workflow"].map((d) => {
              const n = data.incidents.filter(
                (r) => r.incident.domain === d,
              ).length;
              return (
                <FilterButton
                  key={d}
                  active={domainFilter === d}
                  onClick={() => setDomainFilter(d)}
                  label={`${DOMAIN_LABEL[d]} (${n})`}
                />
              );
            })}
          </div>

          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
            <Panel
              title="Timeline"
              hint={`${filtered.length} incident(s), newest last.`}
              className="min-w-0 self-start"
            >
              <ol className="space-y-1">
                {filtered.map((r) => {
                  const isSelected =
                    selected?.incident.incidentId === r.incident.incidentId;
                  return (
                    <li key={r.incident.incidentId}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(r.incident.incidentId)}
                        className={`w-full rounded-md border px-3 py-2.5 text-left transition-colors ${
                          isSelected
                            ? "border-signal-info/50 bg-signal-info/[0.07]"
                            : "border-transparent hover:bg-white/[0.025]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="mono text-[0.6875rem] text-paper-500">
                            {DOMAIN_LABEL[r.incident.domain] ?? r.incident.domain}
                          </span>
                          <DecisionPill decision={r.decision.decision} />
                        </div>
                        <div className="mt-1.5 text-[0.875rem] leading-snug">
                          {r.incident.actionType.replace(/_/g, " ")}
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <EvidencePill status={r.assessment.status} />
                          <ProvenancePill provenance={r.incident.provenance} />
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </Panel>

            {selected ? <IncidentDetail record={selected} rules={data.rules} /> : null}
          </div>
        </div>
      )}
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-1.5 text-[0.8125rem] transition-colors ${
        active
          ? "border-signal-info/50 bg-signal-info/[0.09] text-paper-100"
          : "hairline border text-paper-500 hover:text-paper-300"
      }`}
    >
      {label}
    </button>
  );
}

function IncidentDetail({
  record,
  rules,
}: {
  record: IncidentRecord;
  rules: SafeguardRule[];
}) {
  const { incident, assessment, diagnosis, decision } = record;
  const applicableRules = rules.filter((r) =>
    decision.applicableRuleIds.includes(r.ruleId),
  );

  return (
    <div className="min-w-0 space-y-6">
      <Panel
        title="Attempted action"
        right={<ProvenancePill provenance={incident.provenance} />}
      >
        <Field label="Domain">
          {DOMAIN_LABEL[incident.domain] ?? incident.domain}
        </Field>
        <Field label="Action type" mono>
          {incident.actionType}
        </Field>
        <Field label="Intended outcome">{incident.intendedOutcome}</Field>
        <Field label="Agent claim">
          {incident.claimedOutcome ? (
            <span className="flex flex-wrap items-center gap-2">
              <span>{incident.claimedOutcome.claim}</span>
              <Pill
                tone={
                  incident.claimedOutcome.assertedStatus === "success"
                    ? "info"
                    : "neutral"
                }
              >
                asserts {incident.claimedOutcome.assertedStatus}
              </Pill>
            </span>
          ) : (
            <span className="text-paper-500">No completion claim was made.</span>
          )}
        </Field>
        <Field label="Evidence refs" mono>
          {incident.evidenceReferences.length
            ? incident.evidenceReferences
                .map((e) => `${e.kind}:${e.ref}`)
                .join(", ")
            : "(none supplied)"}
        </Field>
        <Field label="Incident ID" mono>
          {incident.incidentId}
        </Field>
        <Field label="Recorded" mono>
          {incident.createdAt}
        </Field>
      </Panel>

      <Panel
        title="Evidence verification"
        hint="Produced by the domain adapter that queried the authoritative source — never by a language model."
        right={<EvidencePill status={assessment.status} />}
      >
        <Field label="Source" mono>
          {assessment.evidenceType}
        </Field>
        <Field label="Reference" mono>
          {assessment.evidenceReference}
        </Field>
        <Field label="Verified">
          {assessment.verified ? (
            <Pill tone="ok">verified</Pill>
          ) : (
            <Pill tone="unknown">not established</Pill>
          )}
        </Field>
        <Field label="Observed at" mono>
          {assessment.observedAt}
        </Field>
        <Field label="Explanation">{assessment.explanation}</Field>
        {assessment.failureReason ? (
          <Field label="Failure reason">{assessment.failureReason}</Field>
        ) : null}
        {assessment.raw ? (
          <details className="mt-3">
            <summary className="mono cursor-pointer text-[0.6875rem] uppercase tracking-[0.12em] text-paper-500">
              Raw evidence payload
            </summary>
            <pre className="code mt-3">
              {JSON.stringify(assessment.raw, null, 2)}
            </pre>
          </details>
        ) : null}
      </Panel>

      <Panel
        title="Diagnosis"
        hint="A hypothesis derived deterministically from the observed facts. It is not evidence."
      >
        <Field label="Pattern" mono>
          {diagnosis.pattern}
        </Field>
        <Field label="Confidence">
          <span className="tabular">{diagnosis.confidence.toFixed(2)}</span>
        </Field>
        <Field label="Actionable">
          {diagnosis.actionable ? (
            <Pill tone="info">yes</Pill>
          ) : (
            <Pill tone="neutral">no</Pill>
          )}
        </Field>
        <Field label="Observed facts">
          <ul className="mono space-y-0.5 text-[0.75rem]">
            {diagnosis.observedFacts.map((f) => (
              <li key={f} className="text-paper-300">
                {f}
              </li>
            ))}
          </ul>
        </Field>
        <Field label="Hypothesis">{diagnosis.hypothesis}</Field>
        {diagnosis.ruleSketch ? (
          <Field label="Rule sketch">
            <div className="space-y-1">
              <div>{diagnosis.ruleSketch.statement}</div>
              <div className="mono text-[0.6875rem] text-paper-500">
                scope: {diagnosis.ruleSketch.applicability}
              </div>
            </div>
          </Field>
        ) : null}
      </Panel>

      <Panel
        title="Safeguard decision"
        right={<DecisionPill decision={decision.decision} />}
      >
        <Field label="Reason">{decision.reason}</Field>
        <Field label="Evidence status">
          <EvidencePill status={decision.evidenceStatus} />
        </Field>
        <Field label="Policy version" mono>
          {decision.policyVersion}
        </Field>
        <Field label="Applicable rules">
          {applicableRules.length ? (
            <ul className="space-y-1">
              {applicableRules.map((r) => (
                <li key={r.ruleId} className="mono text-[0.75rem]">
                  {r.ruleId}@v{r.version} → {r.action}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-paper-500">
              No active rule governed this action.
            </span>
          )}
        </Field>
        <Field label="Memories retrieved">
          {decision.retrievedMemoryIds.length ? (
            <ul className="mono space-y-0.5 text-[0.75rem]">
              {decision.retrievedMemoryIds.map((id) => (
                <li key={id} className="text-paper-300">
                  {id}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-paper-500">None recalled.</span>
          )}
        </Field>
        {decision.missingPreconditions.length ? (
          <Field label="Missing preconditions" mono>
            {decision.missingPreconditions.join(", ")}
          </Field>
        ) : null}
        <Field label="Decided at" mono>
          {decision.decidedAt}
        </Field>

        <details className="mt-3" open>
          <summary className="mono cursor-pointer text-[0.6875rem] uppercase tracking-[0.12em] text-paper-500">
            Decision trace
          </summary>
          <ol className="mt-3 space-y-2">
            {decision.trace.map((t, i) => (
              <li key={`${t.step}-${i}`} className="flex gap-3">
                <span className="mono shrink-0 text-[0.6875rem] uppercase tracking-[0.08em] text-paper-500">
                  {t.step.replace(/_/g, " ")}
                </span>
                <span className="text-[0.8125rem] leading-relaxed text-paper-300">
                  {t.detail}
                </span>
              </li>
            ))}
          </ol>
        </details>
      </Panel>
    </div>
  );
}
