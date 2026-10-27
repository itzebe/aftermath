import {
  SafeguardDecisionSchema,
  type Decision,
  type EvidenceAssessment,
  type SafeguardDecision,
  type SafeguardRule,
} from "@/lib/schemas";
import type { RecalledLesson } from "@/lib/adapters/memory";

export type DecisionMode = "claim" | "preflight";

export interface Precondition {
  id: string;
  satisfied: boolean;
  description?: string;
}

export interface DecisionInput {
  domain: string;
  actionType: string;
  /**
   * "claim": may the asserted outcome stand?
   * "preflight": may the attempted action run at all?
   */
  mode: DecisionMode;
  assertedSuccess: boolean;
  assessment: EvidenceAssessment;
  applicableRules: SafeguardRule[];
  recalledLessons: RecalledLesson[];
  preconditions: Precondition[];
  policyVersion: string;
}

/**
 * Deterministic safeguard decision engine.
 *
 * Rules of the road:
 *  - Current authoritative evidence governs. A recalled memory never overrides
 *    it and never converts UNKNOWN into success or failure.
 *  - A missing or failed lookup yields UNKNOWN / REQUIRE_VERIFICATION, never a
 *    fabricated success and never a fabricated failure.
 *  - The same inputs and policy version always produce the same decision.
 *  - Only active rules are enforced (callers pass already-filtered rules, and
 *    this function re-checks the status).
 */
export function decide(input: DecisionInput): SafeguardDecision {
  const trace: SafeguardDecision["trace"] = [];
  const activeRules = input.applicableRules
    .filter((r) => r.validationStatus === "active")
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId));

  const missingPreconditions = input.preconditions
    .filter((p) => !p.satisfied)
    .map((p) => p.id)
    .sort();

  const retrievedMemoryIds = input.recalledLessons
    .map((l) => l.blobId)
    .sort();

  trace.push({
    step: "evidence",
    detail: `Evidence status is ${input.assessment.status} (verified=${input.assessment.verified}) from ${input.assessment.evidenceType}.`,
  });
  trace.push({
    step: "applicable_rules",
    detail: activeRules.length
      ? `Active rules: ${activeRules.map((r) => `${r.ruleId}@v${r.version}`).join(", ")}`
      : "No active rule applies to this action.",
  });
  trace.push({
    step: "memory",
    detail: retrievedMemoryIds.length
      ? `Recalled ${retrievedMemoryIds.length} memory record(s); memory informs but does not govern this decision.`
      : "No relevant memory was recalled.",
  });
  if (missingPreconditions.length) {
    trace.push({
      step: "preconditions",
      detail: `Unsatisfied preconditions: ${missingPreconditions.join(", ")}`,
    });
  }

  const strongestRuleAction = activeRules.some((r) => r.action === "BLOCK")
    ? "BLOCK"
    : activeRules.length > 0
      ? "REQUIRE_VERIFICATION"
      : null;

  const finish = (
    decision: Decision,
    reason: string,
    extraTrace: Array<{ step: string; detail: string }> = [],
  ): SafeguardDecision =>
    SafeguardDecisionSchema.parse({
      decision,
      reason,
      applicableRuleIds: activeRules.map((r) => r.ruleId),
      evidenceReferences: [input.assessment.evidenceReference],
      retrievedMemoryIds,
      missingPreconditions,
      evidenceStatus: input.assessment.status,
      policyVersion: input.policyVersion,
      decidedAt: new Date().toISOString(),
      trace: [...trace, ...extraTrace],
    });

  const status = input.assessment.status;

  if (input.mode === "claim") {
    if (input.assertedSuccess) {
      if (status === "VERIFIED_SUCCESS") {
        return finish(
          "ALLOW",
          "Authoritative evidence establishes success, so the completion claim may stand.",
          [{ step: "gate", detail: "claim permitted: evidence is VERIFIED_SUCCESS" }],
        );
      }
      if (status === "VERIFIED_FAILURE") {
        return finish(
          "BLOCK",
          "Authoritative evidence proves the operation failed, so a success claim must not be made.",
          [{ step: "gate", detail: "claim blocked: evidence is VERIFIED_FAILURE" }],
        );
      }
      if (status === "CONFLICTING") {
        return finish(
          "BLOCK",
          "Evidence conflicts, so no success claim may be made until it is reconciled.",
          [{ step: "gate", detail: "claim blocked: evidence is CONFLICTING" }],
        );
      }
      if (status === "PENDING") {
        return finish(
          "REQUIRE_VERIFICATION",
          "Execution is still pending; success cannot be asserted yet.",
          [{ step: "gate", detail: "claim deferred: evidence is PENDING" }],
        );
      }
      // UNKNOWN: never convert missing evidence into success.
      const recalledSafeguard = input.recalledLessons.some(
        (l) => l.record?.type === "corrective_lesson",
      );
      if (activeRules.length > 0 || recalledSafeguard) {
        const why = activeRules.length
          ? `rule(s) ${activeRules.map((r) => r.ruleId).join(", ")} require authoritative verification`
          : `${input.recalledLessons.filter((l) => l.record?.type === "corrective_lesson").length} recalled lesson(s) require authoritative verification`;
        return finish(
          "REQUIRE_VERIFICATION",
          "Evidence is unavailable, so the success claim is deferred rather than accepted or rejected.",
          [{ step: "gate", detail: `claim deferred: evidence is UNKNOWN and ${why}` }],
        );
      }
      return finish(
        "UNKNOWN",
        "Evidence is unavailable and no rule governs this action, so the outcome cannot be decided.",
        [{ step: "gate", detail: "decision unknown: no evidence and no applicable rule" }],
      );
    }

    // No success asserted.
    if (status === "VERIFIED_SUCCESS" || status === "VERIFIED_FAILURE") {
      return finish(
        "ALLOW",
        "No unsupported completion claim was made and the recorded outcome matches the evidence.",
        [{ step: "gate", detail: `allowed: no false claim (evidence ${status})` }],
      );
    }
    return finish(
      strongestRuleAction === "BLOCK" ? "REQUIRE_VERIFICATION" : strongestRuleAction ?? "UNKNOWN",
      "No completion claim was made, but the outcome is not yet established.",
      [{ step: "gate", detail: "no claim; outcome unestablished" }],
    );
  }

  // mode === "preflight": may the action run?
  if (missingPreconditions.length > 0) {
    if (strongestRuleAction === "BLOCK") {
      return finish(
        "BLOCK",
        `Required precondition(s) not satisfied: ${missingPreconditions.join(", ")}. An active rule blocks this action.`,
        [{ step: "gate", detail: "blocked: unsatisfied precondition with a blocking rule" }],
      );
    }
    return finish(
      "REQUIRE_VERIFICATION",
      `Required precondition(s) not satisfied: ${missingPreconditions.join(", ")}. Satisfy them before proceeding.`,
      [{ step: "gate", detail: "deferred: unsatisfied precondition" }],
    );
  }

  if (status === "VERIFIED_FAILURE") {
    return finish(
      strongestRuleAction === "BLOCK" ? "BLOCK" : "REQUIRE_VERIFICATION",
      "Prerequisite state indicates a prior failure, so the action is not cleared to run.",
      [{ step: "gate", detail: "not cleared: prerequisite state records failure" }],
    );
  }

  if (status === "VERIFIED_SUCCESS") {
    return finish(
      "ALLOW",
      "All required preconditions are satisfied and the prerequisite evidence is authoritative.",
      [{ step: "gate", detail: "allowed: preconditions satisfied" }],
    );
  }

  if (status === "PENDING") {
    return finish(
      "REQUIRE_VERIFICATION",
      "Prerequisite state is still pending.",
      [{ step: "gate", detail: "deferred: prerequisite state pending" }],
    );
  }

  return finish(
    strongestRuleAction ?? "UNKNOWN",
    "Prerequisite state could not be established from authoritative evidence.",
    [{ step: "gate", detail: "prerequisite state unknown" }],
  );
}

/** Stable policy version derived from the active rule set. */
export function policyVersionFor(rules: SafeguardRule[]): string {
  const parts = rules
    .filter((r) => r.validationStatus === "active")
    .map((r) => `${r.ruleId}@${r.version}`)
    .sort();
  return parts.length ? `aftermath-policy-1.0+${parts.join("+")}` : "aftermath-policy-1.0";
}
