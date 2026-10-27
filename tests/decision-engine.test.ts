import { describe, expect, it } from "vitest";
import { decide, policyVersionFor } from "@/lib/engines/decision-engine";
import { EvidenceAssessmentSchema, SafeguardRuleSchema } from "@/lib/schemas";
import type { EvidenceStatus, SafeguardRule } from "@/lib/schemas";
import type { RecalledLesson } from "@/lib/adapters/memory";

function assessment(status: EvidenceStatus) {
  return EvidenceAssessmentSchema.parse({
    status,
    verified: status === "VERIFIED_SUCCESS" || status === "VERIFIED_FAILURE",
    evidenceType: "test_evidence",
    evidenceReference: "ref:1",
    observedAt: new Date().toISOString(),
    explanation: `evidence is ${status}`,
  });
}

function rule(overrides: Partial<SafeguardRule> = {}): SafeguardRule {
  return SafeguardRuleSchema.parse({
    ruleId: "rule-finance-unsupported_completion_claim",
    version: 2,
    domain: "finance",
    failurePattern: "unsupported_completion_claim",
    statement: "Require authoritative evidence before claiming success.",
    applicabilityConditions: ["domain=finance", "actionType=report_sui_transaction_success"],
    requiredEvidence: ["tatum_sui_json_rpc"],
    action: "BLOCK",
    severity: "high",
    validationStatus: "active",
    supportingIncidentIds: ["inc-1"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });
}

const base = {
  domain: "finance",
  actionType: "report_sui_transaction_success",
  mode: "claim" as const,
  assertedSuccess: true,
  preconditions: [],
  recalledLessons: [],
  policyVersion: "aftermath-policy-1.0",
};

describe("decision engine — evidence governs", () => {
  it("allows a success claim only when evidence is VERIFIED_SUCCESS", () => {
    const d = decide({ ...base, assessment: assessment("VERIFIED_SUCCESS"), applicableRules: [] });
    expect(d.decision).toBe("ALLOW");
  });

  it("blocks a success claim when evidence proves failure", () => {
    const d = decide({ ...base, assessment: assessment("VERIFIED_FAILURE"), applicableRules: [] });
    expect(d.decision).toBe("BLOCK");
  });

  it("never converts UNKNOWN evidence into success", () => {
    const d = decide({ ...base, assessment: assessment("UNKNOWN"), applicableRules: [rule()] });
    expect(d.decision).toBe("REQUIRE_VERIFICATION");
    expect(d.decision).not.toBe("ALLOW");
    expect(d.evidenceStatus).toBe("UNKNOWN");
  });

  it("never converts UNKNOWN evidence into failure", () => {
    const d = decide({ ...base, assessment: assessment("UNKNOWN"), applicableRules: [] });
    expect(d.decision).not.toBe("BLOCK");
    expect(d.decision).toBe("UNKNOWN");
  });

  it("treats PENDING as deferred, not decided", () => {
    const d = decide({ ...base, assessment: assessment("PENDING"), applicableRules: [rule()] });
    expect(d.decision).toBe("REQUIRE_VERIFICATION");
  });

  it("blocks on CONFLICTING evidence", () => {
    const d = decide({ ...base, assessment: assessment("CONFLICTING"), applicableRules: [rule()] });
    expect(d.decision).toBe("BLOCK");
  });
});

describe("decision engine — determinism", () => {
  it("produces identical decisions for identical inputs", () => {
    const input = {
      ...base,
      assessment: assessment("UNKNOWN"),
      applicableRules: [rule()],
    };
    const a = decide(input);
    const b = decide(input);
    expect({ ...a, decidedAt: "" }).toEqual({ ...b, decidedAt: "" });
  });

  it("is independent of rule input order", () => {
    const r1 = rule({ ruleId: "rule-a" });
    const r2 = rule({ ruleId: "rule-b", action: "REQUIRE_VERIFICATION" });
    const forward = decide({
      ...base,
      assessment: assessment("UNKNOWN"),
      applicableRules: [r1, r2],
    });
    const reverse = decide({
      ...base,
      assessment: assessment("UNKNOWN"),
      applicableRules: [r2, r1],
    });
    expect(forward.applicableRuleIds).toEqual(reverse.applicableRuleIds);
    expect(forward.decision).toBe(reverse.decision);
  });
});

describe("decision engine — preflight", () => {
  it("blocks when a blocking rule applies and a precondition is unmet", () => {
    const d = decide({
      ...base,
      mode: "preflight",
      assertedSuccess: false,
      assessment: assessment("VERIFIED_FAILURE"),
      applicableRules: [rule({ action: "BLOCK" })],
      preconditions: [{ id: "schema_validation", satisfied: false }],
    });
    expect(d.decision).toBe("BLOCK");
    expect(d.missingPreconditions).toEqual(["schema_validation"]);
  });

  it("requires verification (not a block) when no blocking rule exists", () => {
    const d = decide({
      ...base,
      mode: "preflight",
      assertedSuccess: false,
      assessment: assessment("VERIFIED_FAILURE"),
      applicableRules: [],
      preconditions: [{ id: "schema_validation", satisfied: false }],
    });
    expect(d.decision).toBe("REQUIRE_VERIFICATION");
  });

  it("allows a valid operation once preconditions are satisfied", () => {
    const d = decide({
      ...base,
      mode: "preflight",
      assertedSuccess: false,
      assessment: assessment("VERIFIED_SUCCESS"),
      applicableRules: [rule()],
      preconditions: [{ id: "schema_validation", satisfied: true }],
    });
    expect(d.decision).toBe("ALLOW");
  });
});

describe("decision engine — recalled lessons escalate, never override", () => {
  const lessonHit: RecalledLesson = {
    blobId: "blob-1",
    text: "corrective_lesson:finance:unsupported_completion_claim",
    distance: 0.1,
    provenance: "simulated",
    record: {
      type: "corrective_lesson",
      domain: "finance",
      failure_pattern: "unsupported_completion_claim",
      observation: "claimed success without evidence",
      verified_evidence: "lookup returned UNKNOWN",
      corrective_rule: "Require authoritative verification before reporting success.",
      scope: "finance:report_sui_transaction_success",
      validation_status: "validated",
      rule_version: 1,
      incident_id: "inc-1",
      evidence_reference: "sui:tx:abc",
      created_at: "2026-01-01T00:00:00.000Z",
      provenance: "simulated",
    },
  };

  it("escalates UNKNOWN to REQUIRE_VERIFICATION when a recalled lesson applies", () => {
    const withoutLesson = decide({
      ...base,
      assessment: assessment("UNKNOWN"),
      applicableRules: [],
      recalledLessons: [],
    });
    const withLesson = decide({
      ...base,
      assessment: assessment("UNKNOWN"),
      applicableRules: [],
      recalledLessons: [lessonHit],
    });
    expect(withoutLesson.decision).toBe("UNKNOWN");
    expect(withLesson.decision).toBe("REQUIRE_VERIFICATION");
    expect(withLesson.retrievedMemoryIds).toContain("blob-1");
  });

  it("still refuses to allow a claim on the strength of a recalled lesson", () => {
    const d = decide({
      ...base,
      assessment: assessment("UNKNOWN"),
      applicableRules: [],
      recalledLessons: [lessonHit],
    });
    expect(d.decision).not.toBe("ALLOW");
  });

  it("does not let a recalled lesson override VERIFIED_SUCCESS", () => {
    const d = decide({
      ...base,
      assessment: assessment("VERIFIED_SUCCESS"),
      applicableRules: [],
      recalledLessons: [lessonHit],
    });
    expect(d.decision).toBe("ALLOW");
  });

  it("does not let a recalled lesson override VERIFIED_FAILURE", () => {
    const d = decide({
      ...base,
      assessment: assessment("VERIFIED_FAILURE"),
      applicableRules: [],
      recalledLessons: [lessonHit],
    });
    expect(d.decision).toBe("BLOCK");
  });
});

describe("policy version", () => {
  it("changes when the active rule set changes", () => {
    const a = policyVersionFor([]);
    const b = policyVersionFor([rule()]);
    expect(a).not.toBe(b);
    expect(b).toContain("rule-finance-unsupported_completion_claim@2");
  });

  it("ignores inactive rules", () => {
    const inactive = policyVersionFor([rule({ validationStatus: "proposed" })]);
    expect(inactive).toBe(policyVersionFor([]));
  });
});
