import {
  DiagnosisSchema,
  type Diagnosis,
  type EvidenceAssessment,
  type Incident,
} from "@/lib/schemas";

/**
 * Deterministic failure diagnosis.
 *
 * The diagnosis is derived from (a) the untrusted claim the agent made and
 * (b) the evidence assessment produced by the domain adapter. It is a
 * hypothesis with a confidence, not a verdict. No language model is consulted
 * here: the pattern is a function of the two inputs, so the same incident
 * always yields the same diagnosis.
 */
export function diagnose(
  incident: Incident,
  assessment: EvidenceAssessment,
): Diagnosis {
  const claimed = incident.claimedOutcome;
  const assertedSuccess = claimed?.assertedStatus === "success";
  const hasClaim = Boolean(claimed);

  const observedFacts: string[] = [
    `domain=${incident.domain}`,
    `actionType=${incident.actionType}`,
    `evidenceStatus=${assessment.status}`,
    `evidenceType=${assessment.evidenceType}`,
  ];
  if (hasClaim) observedFacts.push(`claimedStatus=${claimed?.assertedStatus}`);
  if (assessment.failureReason)
    observedFacts.push(`failureReason=${assessment.failureReason}`);

  // 1. The agent asserted success but no evidence establishes it.
  if (
    assertedSuccess &&
    assessment.status !== "VERIFIED_SUCCESS" &&
    assessment.status !== "VERIFIED_FAILURE"
  ) {
    const pattern =
      assessment.status === "CONFLICTING"
        ? "conflicting_evidence"
        : assessment.status === "UNKNOWN"
          ? "evidence_unavailable"
          : "unsupported_completion_claim";
    return DiagnosisSchema.parse({
      pattern,
      observedFacts,
      hypothesis:
        "The agent asserted a successful outcome while the authoritative " +
        `evidence was ${assessment.status}. The completion claim is not ` +
        "supported by evidence.",
      confidence: 0.95,
      actionable: true,
      ruleSketch: {
        statement:
          "Do not report this action as successful unless authoritative " +
          "evidence establishes success.",
        applicability: `${incident.domain}:${incident.actionType}`,
        requiredEvidence: assessment.evidenceType,
        action:
          "Allow a success claim only when the evidence is VERIFIED_SUCCESS. " +
          "Otherwise return UNKNOWN / REQUIRE_VERIFICATION.",
      },
    });
  }

  // 2. The agent asserted success and the evidence confirms it: no failure.
  if (assertedSuccess && assessment.status === "VERIFIED_SUCCESS") {
    return DiagnosisSchema.parse({
      pattern: "incorrect_execution_state_assumption",
      observedFacts,
      hypothesis:
        "The completion claim is supported by authoritative evidence. No " +
        "failure pattern is present in this incident.",
      confidence: 0.1,
      actionable: false,
    });
  }

  // 3. The agent claimed success but the evidence proves failure.
  if (assertedSuccess && assessment.status === "VERIFIED_FAILURE") {
    return DiagnosisSchema.parse({
      pattern: "unsupported_completion_claim",
      observedFacts,
      hypothesis:
        "The agent reported success while authoritative evidence proves the " +
        "operation failed.",
      confidence: 0.99,
      actionable: true,
      ruleSketch: {
        statement:
          "Do not report success when authoritative evidence records failure.",
        applicability: `${incident.domain}:${incident.actionType}`,
        requiredEvidence: assessment.evidenceType,
        action: "Block the success claim.",
      },
    });
  }

  // 4. No claim, but evidence proves failure: a prerequisite or verification
  //    gap is the likely cause.
  if (!hasClaim && assessment.status === "VERIFIED_FAILURE") {
    return DiagnosisSchema.parse({
      pattern: "missing_prerequisite",
      observedFacts,
      hypothesis:
        "The operation failed without a recorded prerequisite check. The " +
        "required precondition was likely not satisfied.",
      confidence: 0.7,
      actionable: true,
      ruleSketch: {
        statement: "Verify the required prerequisite before re-running.",
        applicability: `${incident.domain}:${incident.actionType}`,
        requiredEvidence: assessment.evidenceType,
        action: "Require the prerequisite to be satisfied before allowing the action.",
      },
    });
  }

  // 5. The action is still in flight.
  if (assessment.status === "PENDING") {
    return DiagnosisSchema.parse({
      pattern: "inadequate_verification",
      observedFacts,
      hypothesis:
        "The action is still pending. Concluding success or failure now would " +
        "be premature.",
      confidence: 0.8,
      actionable: false,
    });
  }

  // 6. Evidence could not be obtained, and nothing was claimed.
  return DiagnosisSchema.parse({
    pattern: "evidence_unavailable",
    observedFacts,
    hypothesis:
      "No authoritative evidence was available. This establishes neither " +
      "success nor failure.",
    confidence: 0.5,
    actionable: false,
  });
}
