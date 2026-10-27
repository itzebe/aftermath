"use client";

import { useEffect, useState } from "react";
import type { SafeguardRule } from "@/lib/schemas";
import {
  EmptyState,
  Field,
  Loading,
  Panel,
  Pill,
  ProvenancePill,
  RuleStatusPill,
  SectionTitle,
} from "@/components/ui";

interface RulesResponse {
  rules: SafeguardRule[];
}

const ACTION_TONE: Record<string, "bad" | "warn"> = {
  BLOCK: "bad",
  REQUIRE_VERIFICATION: "warn",
};

const SEVERITY_TONE: Record<string, "bad" | "warn" | "info"> = {
  critical: "bad",
  high: "bad",
  medium: "warn",
  low: "info",
  info: "info",
};

export default function SafeguardsPage() {
  const [rules, setRules] = useState<SafeguardRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/rules")
      .then((r) => r.json())
      .then((d: RulesResponse) => {
        if (!cancelled) setRules(d.rules);
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
      <Panel title="Safeguards">
        <p className="text-[0.8125rem] text-signal-bad">{error}</p>
      </Panel>
    );
  }
  if (!rules) return <Loading label="Loading safeguards…" />;

  const active = rules.filter((r) => r.validationStatus === "active");
  const proposed = rules.filter((r) => r.validationStatus === "proposed");

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Safeguards"
        hint="Corrective rules derived from verified incidents. A rule is proposed first and only enforced once validation passes; proposed rules never block anything."
        right={
          <div className="flex gap-2">
            <Pill tone="ok">{active.length} active</Pill>
            <Pill tone="info">{proposed.length} proposed</Pill>
          </div>
        }
      />

      {rules.length === 0 ? (
        <EmptyState title="No safeguards exist yet">
          Run the demonstrations to generate incidents. A rule is proposed from
          each actionable diagnosis and activated only when its evidence
          supports it.
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {[...active, ...proposed].map((rule) => (
            <RuleCard key={`${rule.ruleId}-${rule.version}`} rule={rule} />
          ))}
        </div>
      )}
    </div>
  );
}

function RuleCard({ rule }: { rule: SafeguardRule }) {
  const isActive = rule.validationStatus === "active";
  return (
    <Panel
      title={`${rule.ruleId}@v${rule.version}`}
      right={
        <div className="flex items-center gap-1.5">
          <RuleStatusPill status={rule.validationStatus} />
          <ProvenancePill provenance={rule.provenance} />
        </div>
      }
      className={isActive ? "border-signal-ok/25" : ""}
    >
      <p className="text-[0.8125rem] leading-relaxed">{rule.statement}</p>

      <div className="mt-3">
        <Field label="Action">
          <Pill tone={ACTION_TONE[rule.action] ?? "neutral"}>{rule.action}</Pill>
        </Field>
        <Field label="Severity">
          <Pill tone={SEVERITY_TONE[rule.severity] ?? "neutral"}>
            {rule.severity}
          </Pill>
        </Field>
        <Field label="Domain" mono>
          {rule.domain}
        </Field>
        <Field label="Failure pattern" mono>
          {rule.failurePattern}
        </Field>
        <Field label="Applies when">
          <ul className="mono space-y-0.5 text-[0.75rem]">
            {rule.applicabilityConditions.map((c) => (
              <li key={c} className="text-paper-300">
                {c}
              </li>
            ))}
          </ul>
        </Field>
        <Field label="Requires evidence" mono>
          {rule.requiredEvidence.join(", ")}
        </Field>
        <Field label="Supporting incidents">
          <ul className="mono space-y-0.5 text-[0.6875rem]">
            {rule.supportingIncidentIds.map((id) => (
              <li key={id} className="text-paper-300">
                {id}
              </li>
            ))}
          </ul>
        </Field>
        <Field label="Created" mono>
          {rule.createdAt}
        </Field>
        {rule.reviewAfter ? (
          <Field label="Review after" mono>
            {rule.reviewAfter}
          </Field>
        ) : null}
        {rule.supersedes ? (
          <Field label="Supersedes" mono>
            {rule.supersedes}
          </Field>
        ) : null}
      </div>

      {!isActive ? (
        <p className="mt-3 rounded border border-signal-info/30 bg-signal-info/[0.05] px-2.5 py-2 text-[0.75rem] leading-relaxed text-paper-300">
          This rule is proposed, not enforced. It did not influence any decision
          until validation promoted it to active.
        </p>
      ) : null}
    </Panel>
  );
}
