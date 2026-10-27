import { describe, expect, it } from "vitest";
import { proposeRule, ruleApplies, selectApplicableRules, supersedeRule, validateRule } from "@/lib/engines/rule-engine";
import { diagnose } from "@/lib/engines/diagnosis";
import {
  EvidenceAssessmentSchema,
  IncidentSchema,
  type EvidenceStatus,
  type Incident,
} from "@/lib/schemas";

function makeIncident(overrides: Partial<Incident> = {}): Incident {
  return IncidentSchema.parse({
    domain: "coding",
    actionType: "report_bug_fixed",
    executionId: "exec-1",
    intendedOutcome: "the bug is fixed",
    claimedOutcome: { claim: "fixed it", assertedStatus: "success" },
    evidenceReferences: [],
    relevantContext: {},
    provenance: "simulated",
    incidentId: "inc-1",
    createdAt: new Date().toISOString(),
    currentStatus: "open",
    ...overrides,
  });
}

function assessment(status: EvidenceStatus) {
  return EvidenceAssessmentSchema.parse({
    status,
    verified: status === "VERIFIED_SUCCESS" || status === "VERIFIED_FAILURE",
    evidenceType: "test_run",
    evidenceReference: "ref",
    observedAt: new Date().toISOString(),
    explanation: status,
  });
}

describe("diagnosis", () => {
  it("flags an unsupported completion claim", () => {
    const d = diagnose(makeIncident(), assessment("UNKNOWN"));
    expect(d.pattern).toBe("evidence_unavailable");
    expect(d.actionable).toBe(true);
  });

  it("flags a false success claim against proven failure", () => {
    const d = diagnose(makeIncident(), assessment("VERIFIED_FAILURE"));
    expect(d.pattern).toBe("unsupported_completion_claim");
    expect(d.confidence).toBeGreaterThan(0.9);
  });

  it("does not flag a supported success claim", () => {
    const d = diagnose(makeIncident(), assessment("VERIFIED_SUCCESS"));
    expect(d.actionable).toBe(false);
  });

  it("is deterministic", () => {
    const a = diagnose(makeIncident(), assessment("VERIFIED_FAILURE"));
    const b = diagnose(makeIncident(), assessment("VERIFIED_FAILURE"));
    expect(a).toEqual(b);
  });
});

describe("rule proposal and validation", () => {
  it("proposes a rule but does not activate it", () => {
    const incident = makeIncident();
    const a = assessment("VERIFIED_FAILURE");
    const diagnosis = diagnose(incident, a);
    const proposed = proposeRule(incident, diagnosis, a);
    expect(proposed).not.toBeNull();
    expect(proposed!.validationStatus).toBe("proposed");
  });

  it("activates a narrow rule backed by verified evidence", () => {
    const incident = makeIncident();
    const a = assessment("VERIFIED_FAILURE");
    const diagnosis = diagnose(incident, a);
    const proposed = proposeRule(incident, diagnosis, a)!;
    const outcome = validateRule(proposed, diagnosis, {
      supportingIncidents: [incident],
      assessments: { [incident.incidentId]: a },
      policyVersion: "v1",
    });
    expect(outcome.accepted).toBe(true);
    expect(outcome.rule!.validationStatus).toBe("active");
  });

  it("refuses to activate a rule on unverified evidence", () => {
    const incident = makeIncident();
    const a = assessment("UNKNOWN");
    const diagnosis = diagnose(incident, a);
    const proposed = proposeRule(incident, diagnosis, a)!;
    const outcome = validateRule(proposed, diagnosis, {
      supportingIncidents: [incident],
      assessments: { [incident.incidentId]: a },
      policyVersion: "v1",
    });
    expect(outcome.accepted).toBe(false);
    expect(outcome.reasons.join(" ")).toContain("verified evidence");
  });

  it("refuses to activate a rule with no supporting incident", () => {
    const incident = makeIncident();
    const a = assessment("VERIFIED_FAILURE");
    const diagnosis = diagnose(incident, a);
    const proposed = proposeRule(incident, diagnosis, a)!;
    const outcome = validateRule(proposed, diagnosis, {
      supportingIncidents: [],
      assessments: {},
      policyVersion: "v1",
    });
    expect(outcome.accepted).toBe(false);
  });

  it("refuses to generalise broadly from a single execution", () => {
    const incident = makeIncident();
    const a = assessment("VERIFIED_FAILURE");
    const diagnosis = diagnose(incident, a);
    const proposed = proposeRule(incident, diagnosis, a)!;
    const broad = { ...proposed, applicabilityConditions: ["domain=coding"] };
    const outcome = validateRule(broad, diagnosis, {
      supportingIncidents: [incident],
      assessments: { [incident.incidentId]: a },
      policyVersion: "v1",
    });
    expect(outcome.accepted).toBe(false);
    expect(outcome.reasons.join(" ")).toContain("two independent executions");
  });
});

describe("applicability", () => {
  const incident = makeIncident();
  const a = assessment("VERIFIED_FAILURE");
  const rule = proposeRule(incident, diagnose(incident, a), a)!;
  const active = { ...rule, validationStatus: "active" as const };

  it("applies only to its exact scope", () => {
    expect(ruleApplies(active, { domain: "coding", actionType: "report_bug_fixed" })).toBe(true);
    expect(ruleApplies(active, { domain: "coding", actionType: "other" })).toBe(false);
    expect(ruleApplies(active, { domain: "finance", actionType: "report_bug_fixed" })).toBe(false);
  });

  it("never applies while it is only proposed", () => {
    expect(ruleApplies(rule, { domain: "coding", actionType: "report_bug_fixed" })).toBe(false);
  });

  it("fails closed on an unknown condition key", () => {
    const weird = { ...active, applicabilityConditions: ["env=prod"] };
    expect(ruleApplies(weird, { domain: "coding", actionType: "report_bug_fixed" })).toBe(false);
  });

  it("selects applicable rules ordered by severity", () => {
    const low = { ...active, ruleId: "rule-low", severity: "low" as const };
    const critical = { ...active, ruleId: "rule-critical", severity: "critical" as const };
    const selected = selectApplicableRules([low, critical], {
      domain: "coding",
      actionType: "report_bug_fixed",
    });
    expect(selected.map((r) => r.ruleId)).toEqual(["rule-critical", "rule-low"]);
  });
});

describe("supersession", () => {
  it("retires the previous version and links the successor", () => {
    const incident = makeIncident();
    const a = assessment("VERIFIED_FAILURE");
    const rule = proposeRule(incident, diagnose(incident, a), a)!;
    const next = { ...rule, statement: "narrower statement" };
    const { retired, successor } = supersedeRule(rule, next);
    expect(retired.validationStatus).toBe("superseded");
    expect(successor.supersedes).toBe(rule.ruleId);
    expect(successor.version).toBe(rule.version + 1);
  });
});
