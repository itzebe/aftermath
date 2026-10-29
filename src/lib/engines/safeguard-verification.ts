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
 * The safeguard is *pattern-specific*: a connection-pool incident yields a
 * control that instruments and measures the pool, not the generic
 * "require verification" fallback, which is reserved for incidents whose
 * central issue genuinely is an unknown operation outcome.
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
  const specific = patternSpecificControl(pattern);

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
  for (const extra of specific.assumptions) assumptions.push(extra);
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

  const testPlan = [...specific.testPlan, ...categories.nextChecks.slice(0, 3)];

  const successCriteria = specific.successCriteria;

  return SafeguardRecommendationSchema.parse({
    statement: specific.controlStatement
      ? `${statement} ${specific.controlStatement}`
      : statement,
    failureMode,
    whyEvidenceSupports,
    assumptions,
    testPlan,
    successCriteria,
    action: PATTERN_ACTION[pattern],
    severity: PATTERN_SEVERITY[pattern],
  });
}

interface PatternControl {
  /** An additional, concrete control sentence appended to the rule statement. */
  controlStatement: string;
  assumptions: string[];
  testPlan: string[];
  successCriteria: string;
}

/**
 * The pattern-specific control, test, and measurable criteria.
 *
 * Every branch states a *measurable* pass/fail condition, so a later run can
 * actually be judged. The generic branch is honest about having no mechanism
 * to measure: it can only require that the missing evidence be obtained.
 */
function patternSpecificControl(pattern: Diagnosis["pattern"]): PatternControl {
  switch (pattern) {
    case "connection_pool_exhaustion":
      return {
        controlStatement:
          "Instrument connection acquisition, usage, and release; alert on sustained pool saturation and rising acquisition latency; and treat the pool's capacity as unproven until a controlled concurrency test demonstrates it.",
        assumptions: [
          "It is assumed the pool's configured maximum is the intended capacity; the material does not state the configuration or how it was chosen.",
          "It is assumed the reported measurements (active/idle/max) came from the pool under test; their source is not named in the material.",
        ],
        testPlan: [
          "Exercise a controlled workload with a documented concurrency level and duration, against the same pool configuration.",
          "Measure connection-acquisition latency, pool utilisation, request latency, and the HTTP 5xx rate throughout the run.",
        ],
        successCriteria:
          "Under the documented workload, pool utilisation stays below the test's declared safety threshold (for example 90%) for the whole run, connection-acquisition latency stays within the declared budget, and the request error rate stays within the declared error budget. Record the exact workload, the measurements, and the pass/fail result.",
      };
    case "upstream_dependency_failure":
      return {
        controlStatement:
          "Establish the operation's own outcome from an authoritative record before accepting or rejecting the result, and record which upstream dependency returned the error.",
        assumptions: [
          "It is assumed the 5xx originated from the named dependency; the material does not always name which component produced it.",
        ],
        testPlan: [
          "Replay the request against a stubbed dependency that returns the same status, and confirm the operation's own outcome is recorded from an authoritative source rather than inferred from the status.",
        ],
        successCriteria:
          "For a replayed request whose dependency returns the recorded status, the operation's outcome is recorded from an authoritative source (not inferred from the status), and the upstream component responsible is named. The outcome and the source are both written to the record.",
      };
    case "evidence_unavailable":
      return {
        controlStatement:
          "Obtain an authoritative record of the operation's outcome before accepting or rejecting the result; a missing answer must not be recorded as either success or failure.",
        assumptions: [
          "It is assumed no authoritative record of this operation is currently available; if one exists, the control reduces to consulting it.",
        ],
        testPlan: [
          "Re-run the action and capture its own authoritative record (exit code, HTTP response, transaction status) rather than relying on narration.",
        ],
        successCriteria:
          "A subsequent run of the action yields an authoritative record of its outcome, and the engine's decision is derived from that record rather than from the absence of an answer. Until such a record exists, the outcome stays UNKNOWN.",
      };
    default:
      return {
        controlStatement: "",
        assumptions: [],
        testPlan: [
          "Replay the reported action through the decision engine with the safeguard active and confirm the outcome.",
        ],
        successCriteria:
          pattern === "unsupported_completion_claim" || pattern === "repeated_failed_operation"
            ? "The engine refuses to let the unsupported claim stand (BLOCK), while still allowing a genuinely evidenced success."
            : "The engine requires authoritative verification (REQUIRE_VERIFICATION) for this action, while still allowing a genuinely evidenced success.",
      };
  }
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
    case "connection_pool_exhaustion":
      return "The database connection pool is exhausted, so connection acquisitions time out and requests fail, because connections are not released, concurrency exceeds capacity, or slow operations hold connections too long.";
    case "upstream_dependency_failure":
      return "An upstream dependency returned a server error, so the operation's own outcome is not established by the error alone.";
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
