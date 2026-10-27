import { z } from "zod";

/**
 * Domains AFTERMATH covers. The safeguard mechanism is shared; only the
 * evidence adapter differs per domain.
 */
export const DomainSchema = z.enum(["finance", "coding", "workflow"]);
export type Domain = z.infer<typeof DomainSchema>;

/**
 * Outcome of evaluating evidence for an attempted action.
 *
 * These are deliberately not a boolean. "We could not look" must never collapse
 * into "it failed", and "the transport worked" must never collapse into
 * "the operation succeeded".
 */
export const EvidenceStatusSchema = z.enum([
  "VERIFIED_SUCCESS",
  "VERIFIED_FAILURE",
  "PENDING",
  "UNKNOWN",
  "CONFLICTING",
]);
export type EvidenceStatus = z.infer<typeof EvidenceStatusSchema>;

/** Final decision returned by the safeguard engine. */
export const DecisionSchema = z.enum([
  "ALLOW",
  "BLOCK",
  "REQUIRE_VERIFICATION",
  "UNKNOWN",
]);
export type Decision = z.infer<typeof DecisionSchema>;

/** Lifecycle of an incident. */
export const IncidentStatusSchema = z.enum([
  "open",
  "diagnosed",
  "lesson_proposed",
  "lesson_validated",
  "safeguarded",
  "resolved",
  "unresolved",
]);
export type IncidentStatus = z.infer<typeof IncidentStatusSchema>;

/** Whether a record was produced by a real integration or a simulation. */
export const ProvenanceSchema = z.enum(["live", "simulated"]);
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const EvidenceReferenceSchema = z.object({
  /** Adapter-specific kind, e.g. "sui_tx_digest", "vitest_run", "workflow_state". */
  kind: z.string().min(1),
  /** Stable pointer to the evidence, e.g. a tx digest or a run artifact path. */
  ref: z.string().min(1),
  /** Optional human note. Never treated as authoritative. */
  note: z.string().max(2000).optional(),
});
export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;

/**
 * Structured record of an attempted action.
 *
 * `claimedOutcome.claim` is the agent's *claim*. It is explicitly untrusted:
 * the evidence layer decides whether anything actually happened.
 */
export const IncidentInputSchema = z.object({
  domain: DomainSchema,
  actionType: z.string().min(1).max(120),
  executionId: z.string().min(1).max(200),
  intendedOutcome: z.string().min(1).max(4000),
  /** The untrusted claim made by the acting agent. */
  claimedOutcome: z
    .object({
      claim: z.string().min(1).max(4000),
      assertedStatus: z.enum(["success", "failure", "unknown"]).default("success"),
    })
    .optional(),
  evidenceReferences: z.array(EvidenceReferenceSchema).max(50).default([]),
  relevantContext: z.record(z.unknown()).default({}),
  idempotencyKey: z.string().min(1).max(200).optional(),
  provenance: ProvenanceSchema.default("live"),
});
export type IncidentInput = z.infer<typeof IncidentInputSchema>;
/** The pre-parse shape, where schema defaults may still be absent. */
export type IncidentInputDraft = z.input<typeof IncidentInputSchema>;

export const IncidentSchema = IncidentInputSchema.extend({
  incidentId: z.string().min(1),
  createdAt: z.string(),
  currentStatus: IncidentStatusSchema,
});
export type Incident = z.infer<typeof IncidentSchema>;

/**
 * Result produced by a domain evidence adapter.
 *
 * `verified` is only true for VERIFIED_SUCCESS and VERIFIED_FAILURE. It is the
 * single field the decision engine trusts when deciding whether a claim of
 * success may stand.
 */
export const EvidenceAssessmentSchema = z.object({
  status: EvidenceStatusSchema,
  verified: z.boolean(),
  evidenceType: z.string().min(1),
  evidenceReference: z.string().min(1),
  observedAt: z.string(),
  explanation: z.string().min(1).max(4000),
  failureReason: z.string().max(4000).optional(),
  /** Raw, redacted adapter payload for the audit trail. */
  raw: z.record(z.unknown()).optional(),
});
export type EvidenceAssessment = z.infer<typeof EvidenceAssessmentSchema>;

/** Candidate failure patterns. A diagnosis is a hypothesis, not a verdict. */
export const FailurePatternSchema = z.enum([
  "unsupported_completion_claim",
  "missing_prerequisite",
  "repeated_failed_operation",
  "inadequate_verification",
  "stale_evidence",
  "incorrect_execution_state_assumption",
  "evidence_unavailable",
  "conflicting_evidence",
]);
export type FailurePattern = z.infer<typeof FailurePatternSchema>;

export const DiagnosisSchema = z.object({
  pattern: FailurePatternSchema,
  /** Observed facts only. No interpretation. */
  observedFacts: z.array(z.string().min(1)).min(1),
  /** The hypothesis. Explicitly a hypothesis until validated. */
  hypothesis: z.string().min(1).max(4000),
  confidence: z.number().min(0).max(1),
  /** True when a rule can be proposed from this diagnosis. */
  actionable: z.boolean(),
  ruleSketch: z
    .object({
      statement: z.string().min(1),
      applicability: z.string().min(1),
      requiredEvidence: z.string().min(1),
      action: z.string().min(1),
    })
    .optional(),
});
export type Diagnosis = z.infer<typeof DiagnosisSchema>;

export const RuleValidationStatusSchema = z.enum([
  "proposed",
  "validated",
  "active",
  "retired",
  "superseded",
]);
export type RuleValidationStatus = z.infer<typeof RuleValidationStatusSchema>;

export const SeveritySchema = z.enum(["info", "low", "medium", "high", "critical"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const SafeguardRuleSchema = z.object({
  ruleId: z.string().min(1),
  version: z.number().int().positive(),
  domain: DomainSchema,
  failurePattern: FailurePatternSchema,
  statement: z.string().min(1).max(4000),
  applicabilityConditions: z.array(z.string().min(1)).min(1),
  requiredEvidence: z.array(z.string().min(1)).min(1),
  /** What the engine does when the rule applies and evidence is insufficient. */
  action: z.enum(["BLOCK", "REQUIRE_VERIFICATION"]),
  severity: SeveritySchema,
  validationStatus: RuleValidationStatusSchema,
  supportingIncidentIds: z.array(z.string().min(1)).min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Optional ISO date after which the rule should be re-reviewed. */
  reviewAfter: z.string().optional(),
  supersedes: z.string().optional(),
  provenance: ProvenanceSchema.default("live"),
});
export type SafeguardRule = z.infer<typeof SafeguardRuleSchema>;

export const DecisionTraceStepSchema = z.object({
  step: z.string().min(1),
  detail: z.string().min(1),
});

export const SafeguardDecisionSchema = z.object({
  decision: DecisionSchema,
  reason: z.string().min(1),
  applicableRuleIds: z.array(z.string()),
  evidenceReferences: z.array(z.string()),
  retrievedMemoryIds: z.array(z.string()),
  missingPreconditions: z.array(z.string()),
  evidenceStatus: EvidenceStatusSchema,
  policyVersion: z.string().min(1),
  decidedAt: z.string(),
  trace: z.array(DecisionTraceStepSchema),
});
export type SafeguardDecision = z.infer<typeof SafeguardDecisionSchema>;

/**
 * Structured corrective-lesson record written to Walrus Memory.
 *
 * This is a content format for memory. It is not proof that the underlying
 * event occurred — the incident record and evidence reference are.
 */
export const CorrectiveLessonRecordSchema = z.object({
  type: z.literal("corrective_lesson"),
  domain: DomainSchema,
  failure_pattern: FailurePatternSchema,
  observation: z.string().min(1),
  verified_evidence: z.string().min(1),
  corrective_rule: z.string().min(1),
  scope: z.string().min(1),
  validation_status: z.enum(["proposed", "validated", "retired"]),
  rule_version: z.number().int().positive(),
  incident_id: z.string().min(1),
  evidence_reference: z.string().min(1),
  created_at: z.string(),
  provenance: ProvenanceSchema,
});
export type CorrectiveLessonRecord = z.infer<typeof CorrectiveLessonRecordSchema>;
