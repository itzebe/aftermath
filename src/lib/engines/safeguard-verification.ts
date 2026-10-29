/**
 * Stage D: turn an investigation into a specific, testable safeguard
 * recommendation, and Stage E: verify it by actually executing the decision
 * engine.
 *
 * Both are deterministic and grounded in the investigation. The recommendation
 * is derived from the diagnosis (a hypothesis); it never asserts a root cause
 * the evidence does not support. The verification is a real execution of the
 * decision engine against the recommendation's rule — not a label applied
 * because the rule was saved.
 */

import {
  SafeguardRecommendationSchema,
  VerificationSchema,
  type Diagnosis,
  type EvidenceAssessment,
  type Investigation,
  type SafeguardRecommendation,
  type SafeguardRule,
  type Verification,
} from "@/lib/schemas";
import { decide } from "@/lib/engines/decision-engine";
import { PATTERN_ACTION, PATTERN_SEVERITY } from "@/lib/engines/rule-engine";

/**
 * Build the recommendation shown to the user.
 *
 * The statement is the diagnosis's rule sketch when one exists; the reasoning
 * quotes the observed evidence so the user can see exactly what supports it.
 */
export function buildRecommendation(input: {
  investigation: Investigation;
  assessment: EvidenceAssessment;
}): SafeguardRecommendation {
  const { investigation, assessment } = input;
  const { diagnosis, categories } = investigation;
  const pattern = diagnosis.pattern;

  const evidenceSummary = categories.observedEvidence
    .slice(0, 4)
    .map((f) => `${f.kind} ${f.value}`)
    .join("; ");

  const statement =
    diagnosis.ruleSketch?.statement ??
    "Require an authoritative record of the operation's outcome before the " +
      "reported result is accepted.";

  const failureMode = explainFailureMode(pattern);

  const whyEvidenceSupports = evidenceSummary
    ? `The material records ${evidenceSummary}. Combined with an evidence ` +
      `assessment of ${assessment.status}, this supports requiring ` +
      `${diagnosis.ruleSketch?.requiredEvidence ?? "authoritative evidence"} ` +
      `before the outcome is accepted.`
    : `The material does not contain a machine-checkable record, and the ` +
      `evidence assessment is ${assessment.status}. The recommendation is ` +
      `therefore to require that record rather than to conclude anything now.`;

  const assumptions: string[] = [];
  if (categories.hypotheses.length > 0) {
    assumptions.push(
      `The recommended mechanism assumes the leading hypothesis holds: ${categories.hypotheses[0]}`,
    );
  }
  if (investigation.domain === "incident") {
    assumptions.push(
      "No authoritative source was connected for this submission, so the " +
        "mechanism is validated against the decision engine's own behaviour " +
        "rather than against a live system.",
    );
  }
  assumptions.push(
    "The safeguard is scoped to this domain and action type; it does not " +
      "generalise to unrelated operations.",
  );

  const testPlan = [
    `Replay the reported action through the decision engine with the safeguard active and confirm the outcome.`,
    ...categories.nextChecks.slice(0, 3),
  ];

  const successCriteria =
    pattern === "unsupported_completion_claim" || pattern === "repeated_failed_operation"
      ? "The engine refuses to let the unsupported claim stand (BLOCK), while still allowing a genuinely evidenced success."
      : "The engine requires authoritative verification (REQUIRE_VERIFICATION) for this action, while still allowing a genuinely evidenced success.";

  return SafeguardRecommendationSchema.parse({
    statement,
    failureMode,
    whyEvidenceSupports,
    assumptions,
    testPlan,
    successCriteria,
    action: PATTERN_ACTION[pattern],
    severity: PATTERN_SEVERITY[pattern],
  });
}

function explainFailureMode(pattern: Diagnosis["pattern"]): string {
  switch (pattern) {
    case "unsupported_completion_claim":
      return "An outcome is reported as successful without an authoritative record that establishes success.";
    case "missing_prerequisite":
      return "A dependent operation runs before a required prerequisite has genuinely completed.";
    case "repeated_failed_operation":
      return "A failed operation is retried without first establishing whether a partial result already exists.";
    case "inadequate_verification":
      return "An operation's outcome is accepted without the verification step that would establish it.";
    case "stale_evidence":
      return "A decision relies on evidence that no longer reflects the current state.";
    case "incorrect_execution_state_assumption":
      return "The reported state does not match the state an authoritative source records.";
    case "evidence_unavailable":
      return "A dependency did not answer, so the outcome is unknown and must not be recorded as either success or failure.";
    case "conflicting_evidence":
      return "Two sources disagree about the outcome, so neither can be trusted until they are reconciled.";
  }
}

/**
 * Stage E: verify the safeguard.
 *
 * This executes the real decision engine twice for the reported action:
 *
 *   1. baseline    — with no applicable rule, i.e. the world before the safeguard
 *   2. safeguarded — with the (activated or proposed) rule applied
 *
 * and reports what actually happened. The state is `test_executed`, never
 * `verified`: a single incident cannot demonstrate that a *repeat* was
 * prevented, so claiming `verified` here would overstate the result. The test
 * is nonetheless genuine — the decisions it records are produced by the same
 * engine that governs the controlled scenarios.
 */
export function verifySafeguard(input: {
  investigation: Investigation;
  assessment: EvidenceAssessment;
  rule: SafeguardRule | null;
  mode: "claim" | "preflight";
  assertedSuccess: boolean;
}): Verification {
  const { investigation, assessment, rule, mode, assertedSuccess } = input;

  if (!rule) {
    return VerificationSchema.parse({
      state: "recommended",
      executed: "Nothing was executed: the investigation produced no rule to test.",
      steps: [
        {
          step: "recommendation",
          detail:
            "The diagnosis was not actionable, so no safeguard rule could be derived and there is nothing to verify.",
          outcome: "info",
        },
      ],
      established:
        "No runnable safeguard exists for this incident yet. The recommendation " +
        "above is a plan, not a tested control.",
      testExecuted: false,
    });
  }

  const base = {
    domain: investigation.domain,
    actionType: investigation.actionType,
    mode,
    assertedSuccess,
    assessment,
    recalledLessons: [],
    preconditions: [],
    policyVersion: "aftermath-policy-1.0",
  };

  // The decision engine only enforces *active* rules, by design. To test what
  // the recommendation would do, the rule's logic is evaluated through an
  // active copy; the original's real validation status is untouched and is
  // reported separately on the record.
  const testRule: SafeguardRule = { ...rule, validationStatus: "active" };

  const baseline = decide({ ...base, applicableRules: [] });
  const safeguarded = decide({ ...base, applicableRules: [testRule] });
  const ruleLabel = `${rule.ruleId}@v${rule.version} (${rule.validationStatus})`;

  const protective = (d: string) => d === "BLOCK" || d === "REQUIRE_VERIFICATION";
  const differs = baseline.decision !== safeguarded.decision;
  const nowProtective = protective(safeguarded.decision);

  const steps = [
    {
      step: "baseline replay",
      detail: `With no safeguard applied, the engine decided ${baseline.decision}: ${baseline.reason}`,
      outcome: "info" as const,
    },
    {
      step: "safeguarded replay",
      detail: `With ${ruleLabel} applied, the engine decided ${safeguarded.decision}: ${safeguarded.reason}`,
      outcome: differs && nowProtective ? ("pass" as const) : ("inconclusive" as const),
    },
  ];

  if (!differs) {
    return VerificationSchema.parse({
      state: "inconclusive",
      executed:
        `Executed the decision engine twice for ${investigation.actionType}: ` +
        `baseline ${baseline.decision}, safeguarded ${safeguarded.decision}.`,
      steps,
      established:
        `The safeguard did not change the decision (both ${baseline.decision}). ` +
        "Either the action is already handled correctly, or the rule's " +
        "applicability does not match this action — the rule needs revision " +
        "before it can be relied upon.",
      testExecuted: true,
    });
  }

  if (nowProtective) {
    return VerificationSchema.parse({
      state: "test_executed",
      executed:
        `Executed the decision engine twice for ${investigation.actionType}: ` +
        `baseline ${baseline.decision}, safeguarded ${safeguarded.decision}.`,
      steps,
      established:
        `The safeguard changes the outcome from ${baseline.decision} to ` +
        `${safeguarded.decision}, refusing to accept the outcome without ` +
        "authoritative evidence. This demonstrates the rule's effect on the " +
        "engine; it does not yet prove that a real recurrence was prevented, " +
        "which requires a second independent occurrence.",
      testExecuted: true,
    });
  }

  return VerificationSchema.parse({
    state: "failed",
    executed:
      `Executed the decision engine twice for ${investigation.actionType}: ` +
      `baseline ${baseline.decision}, safeguarded ${safeguarded.decision}.`,
    steps,
    established:
      `The safeguard changed the outcome to ${safeguarded.decision}, which is ` +
      "less protective than expected. The rule is not doing what it claims and " +
      "must not be relied upon as written.",
    testExecuted: true,
  });
}
