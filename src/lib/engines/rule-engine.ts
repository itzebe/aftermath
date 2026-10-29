import {
  SafeguardRuleSchema,
  type Diagnosis,
  type EvidenceAssessment,
  type FailurePattern,
  type Incident,
  type SafeguardRule,
  type Severity,
} from "@/lib/schemas";

export const PATTERN_SEVERITY: Record<FailurePattern, Severity> = {
  unsupported_completion_claim: "high",
  missing_prerequisite: "medium",
  repeated_failed_operation: "high",
  inadequate_verification: "medium",
  stale_evidence: "medium",
  incorrect_execution_state_assumption: "medium",
  evidence_unavailable: "low",
  conflicting_evidence: "high",
};

export const PATTERN_ACTION: Record<FailurePattern, "BLOCK" | "REQUIRE_VERIFICATION"> = {
  unsupported_completion_claim: "BLOCK",
  missing_prerequisite: "REQUIRE_VERIFICATION",
  repeated_failed_operation: "BLOCK",
  inadequate_verification: "REQUIRE_VERIFICATION",
  stale_evidence: "REQUIRE_VERIFICATION",
  incorrect_execution_state_assumption: "REQUIRE_VERIFICATION",
  evidence_unavailable: "REQUIRE_VERIFICATION",
  conflicting_evidence: "BLOCK",
};

export interface ValidationContext {
  /** Incidents offered as supporting evidence for the proposed rule. */
  supportingIncidents: Incident[];
  /** Assessments already computed for those incidents, keyed by incidentId. */
  assessments: Record<string, EvidenceAssessment>;
  /** Policy version string recorded on the activated rule. */
  policyVersion: string;
}

export interface RuleValidationOutcome {
  accepted: boolean;
  reasons: string[];
  rule?: SafeguardRule;
}

/**
 * Turn an actionable diagnosis into a *proposed* rule. Proposed rules are not
 * enforced. This function never activates anything.
 */
export function proposeRule(
  incident: Incident,
  diagnosis: Diagnosis,
  assessment: EvidenceAssessment,
  now = new Date().toISOString(),
): SafeguardRule | null {
  if (!diagnosis.actionable || !diagnosis.ruleSketch) return null;

  const ruleId = `rule-${incident.domain}-${diagnosis.pattern}`;
  return SafeguardRuleSchema.parse({
    ruleId,
    version: 1,
    domain: incident.domain,
    failurePattern: diagnosis.pattern,
    statement: diagnosis.ruleSketch.statement,
    applicabilityConditions: [
      `domain=${incident.domain}`,
      `actionType=${incident.actionType}`,
    ],
    requiredEvidence: [assessment.evidenceType],
    action: PATTERN_ACTION[diagnosis.pattern],
    severity: PATTERN_SEVERITY[diagnosis.pattern],
    validationStatus: "proposed",
    supportingIncidentIds: [incident.incidentId],
    createdAt: now,
    updatedAt: now,
    provenance: incident.provenance,
  });
}

/**
 * Validate a proposed rule before it may be enforced.
 *
 * Rules are only activated when they are narrow (scoped to a domain and action
 * type), backed by at least one incident whose evidence actually supports the
 * pattern, and — for anything that would generalise beyond the incident that
 * produced it — backed by at least two independent executions. A single
 * unrelated incident can never justify a broad rule.
 */
export function validateRule(
  rule: SafeguardRule,
  diagnosis: Diagnosis,
  context: ValidationContext,
  now = new Date().toISOString(),
): RuleValidationOutcome {
  const reasons: string[] = [];

  if (!diagnosis.actionable) {
    reasons.push("diagnosis is not actionable, so no rule may be derived from it");
  }

  if (rule.validationStatus !== "proposed") {
    reasons.push(
      `rule ${rule.ruleId} is in state "${rule.validationStatus}", expected "proposed"`,
    );
  }

  if (rule.applicabilityConditions.length === 0) {
    reasons.push("rule has no applicability conditions and would be unbounded");
  }

  if (rule.requiredEvidence.length === 0) {
    reasons.push("rule does not name the evidence it requires");
  }

  const supporting = rule.supportingIncidentIds
    .map((id) => context.supportingIncidents.find((i) => i.incidentId === id))
    .filter((i): i is Incident => Boolean(i));

  if (supporting.length === 0) {
    reasons.push("no supporting incident is available to validate against");
  }

  const evidenceBacked = supporting.filter((incident) => {
    const assessment = context.assessments[incident.incidentId];
    if (!assessment) return false;
    // The incident must be tied to a *verified* outcome, not to a guess.
    return assessment.verified === true;
  });

  if (evidenceBacked.length === 0) {
    reasons.push(
      "no supporting incident has a verified evidence assessment; a rule " +
        "cannot be activated on unverified evidence",
    );
  }

  const distinctExecutions = new Set(
    supporting.map((i) => i.executionId),
  ).size;

  const generalisesBeyondOrigin =
    rule.applicabilityConditions.some((c) => !c.includes("=")) ||
    rule.applicabilityConditions.length < 2;

  if (generalisesBeyondOrigin && distinctExecutions < 2) {
    reasons.push(
      "rule would generalise beyond its originating incident but is backed " +
        "by fewer than two independent executions",
    );
  }

  if (reasons.length > 0) {
    return { accepted: false, reasons };
  }

  const validated: SafeguardRule = SafeguardRuleSchema.parse({
    ...rule,
    validationStatus: "active",
    version: rule.version + 1,
    updatedAt: now,
    reviewAfter: reviewDate(now),
  });

  return {
    accepted: true,
    reasons: [
      `validated against ${supporting.length} supporting incident(s), ` +
        `${evidenceBacked.length} with verified evidence, ` +
        `${distinctExecutions} independent execution(s)`,
    ],
    rule: validated,
  };
}

function reviewDate(fromIso: string): string {
  const d = new Date(fromIso);
  d.setUTCDate(d.getUTCDate() + 90);
  return d.toISOString();
}

/**
 * Whether a rule applies to an attempted action. A rule applies only when every
 * one of its applicability conditions matches the incoming context. Conditions
 * are `key=value` pairs compared against the action descriptor.
 */
export function ruleApplies(
  rule: SafeguardRule,
  context: {
    domain: string;
    actionType: string;
    requiredEvidenceKinds?: string[];
  },
): boolean {
  if (rule.validationStatus !== "active") return false;
  if (rule.domain !== context.domain) return false;

  const facts: Record<string, string> = {
    domain: context.domain,
    actionType: context.actionType,
  };

  return rule.applicabilityConditions.every((condition) => {
    const eq = condition.indexOf("=");
    if (eq === -1) return false;
    const key = condition.slice(0, eq).trim();
    const expected = condition.slice(eq + 1).trim();
    if (key === "domain") return facts.domain === expected;
    if (key === "actionType") return facts.actionType === expected;
    // Unknown condition keys do not match: fail closed on applicability so a
    // rule can never silently apply to something it was not written for.
    return false;
  });
}

export function selectApplicableRules(
  rules: SafeguardRule[],
  context: { domain: string; actionType: string },
): SafeguardRule[] {
  return rules
    .filter((r) => ruleApplies(r, context))
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

function severityRank(s: Severity): number {
  return ["info", "low", "medium", "high", "critical"].indexOf(s);
}

/** Build a successor rule, retiring the previous version. */
export function supersedeRule(
  previous: SafeguardRule,
  next: SafeguardRule,
  now = new Date().toISOString(),
): { retired: SafeguardRule; successor: SafeguardRule } {
  return {
    retired: SafeguardRuleSchema.parse({
      ...previous,
      validationStatus: "superseded",
      updatedAt: now,
    }),
    successor: SafeguardRuleSchema.parse({
      ...next,
      version: previous.version + 1,
      supersedes: previous.ruleId,
      updatedAt: now,
    }),
  };
}
