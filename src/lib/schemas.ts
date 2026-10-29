import { z } from "zod";

/**
 * Domains AFTERMATH covers. The safeguard mechanism is shared; only the
 * evidence adapter differs per domain.
 *
 * `incident` is the user-submission domain. A submission is only assigned a
 * different domain when the material itself names an authoritative source that
 * can actually be consulted (for example a Sui transaction digest, which the
 * finance adapter can look up through Tatum). Otherwise it stays `incident`,
 * whose adapter honestly reports that no authoritative source is connected
 * rather than inventing one.
 */
export const DomainSchema = z.enum([
  "finance",
  "coding",
  "workflow",
  "incident",
]);
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

/**
 * Candidate failure patterns. A diagnosis is a hypothesis, not a verdict.
 *
 * `connection_pool_exhaustion` and `upstream_dependency_failure` exist so a
 * submission whose material names a concrete mechanism is classified by that
 * mechanism, rather than being forced into the generic `evidence_unavailable`
 * bucket merely because the material also contains a timeout keyword. The
 * generic pattern is reserved for material that genuinely establishes nothing.
 */
export const FailurePatternSchema = z.enum([
  "unsupported_completion_claim",
  "missing_prerequisite",
  "repeated_failed_operation",
  "inadequate_verification",
  "stale_evidence",
  "incorrect_execution_state_assumption",
  "connection_pool_exhaustion",
  "upstream_dependency_failure",
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

/* ------------------------------------------------------------------ *
 * User-submitted incident investigation
 *
 * Everything below is the product's primary surface: a person pastes real
 * incident material, AFTERMATH investigates it, and the result is a structured,
 * inspectable Safeguard Record. The pipeline reuses the same evidence,
 * diagnosis, rule, decision, and memory primitives the controlled scenarios use,
 * so the mechanisms a judge can see working in the Evaluation Lab are the same
 * ones that run on a submission.
 * ------------------------------------------------------------------ */

/** Maximum sizes, so a hostile or accidental huge paste cannot exhaust the host. */
export const SUBMISSION_LIMITS = {
  text: 20_000,
  short: 2_000,
} as const;

/**
 * A person's incident report. This is the only untrusted input in the product.
 * It is treated as data throughout: it is never executed, never evaluated as
 * code or SQL, and never echoed into a shell.
 */
export const IncidentSubmissionSchema = z.object({
  /** The raw material: error text, stack trace, logs, a failed request, prose. */
  text: z.string().min(1).max(SUBMISSION_LIMITS.text),
  /** Optional structured context. */
  expectedBehavior: z.string().max(SUBMISSION_LIMITS.short).optional(),
  actualBehavior: z.string().max(SUBMISSION_LIMITS.short).optional(),
  service: z.string().max(200).optional(),
  /** Optional caller-supplied idempotency key. Falls back to a content hash. */
  idempotencyKey: z.string().min(1).max(200).optional(),
});
export type IncidentSubmission = z.infer<typeof IncidentSubmissionSchema>;
export type IncidentSubmissionDraft = z.input<typeof IncidentSubmissionSchema>;

/**
 * A single extracted fact, with the exact evidence span it came from.
 *
 * `source` records where the value was found so the UI can show provenance and
 * a reader can check the claim against the original text. Nothing is asserted
 * without a span behind it.
 */
export const ExtractedFactSchema = z.object({
  kind: z.string().min(1),
  value: z.string().min(1).max(SUBMISSION_LIMITS.short),
  /** The verbatim substring of the submission that supports this fact. */
  source: z.string().min(1).max(SUBMISSION_LIMITS.text),
});
export type ExtractedFact = z.infer<typeof ExtractedFactSchema>;

/**
 * The four evidence categories the brief requires, kept strictly separate so
 * the UI can never blur what is known into what is merely suspected.
 */
export const EvidenceAssessmentCategoriesSchema = z.object({
  /** Directly supported by the submitted material. */
  observedEvidence: z.array(ExtractedFactSchema),
  /** Established by the input or an authoritative connected-system response. */
  confirmedFacts: z.array(ExtractedFactSchema),
  /** Plausible explanations that still need verification. */
  hypotheses: z.array(z.string().min(1).max(SUBMISSION_LIMITS.short)),
  /** Important questions the evidence does not answer. */
  unknowns: z.array(z.string().min(1).max(SUBMISSION_LIMITS.short)),
  /** Additional information or tests that could distinguish the hypotheses. */
  nextChecks: z.array(z.string().min(1).max(SUBMISSION_LIMITS.short)),
});
export type EvidenceAssessmentCategories = z.infer<
  typeof EvidenceAssessmentCategoriesSchema
>;

/** How the submission was parsed. Stated honestly; there is no LLM in the path. */
export const ExtractionMethodSchema = z.enum(["rule-based", "model"]);
export type ExtractionMethod = z.infer<typeof ExtractionMethodSchema>;

/** Whether a connected authoritative source was actually consulted. */
export const AuthoritativeLookupSchema = z.object({
  attempted: z.boolean(),
  source: z.string().min(1),
  /** True only when the lookup returned a definitive, verified result. */
  verified: z.boolean(),
  status: EvidenceStatusSchema,
  detail: z.string().min(1).max(4000),
  evidenceReference: z.string().min(1),
});
export type AuthoritativeLookup = z.infer<typeof AuthoritativeLookupSchema>;

/** The investigation of one submission: parse + evidence assessment. */
export const InvestigationSchema = z.object({
  extractionMethod: ExtractionMethodSchema,
  /** The inferred domain, and why. */
  domain: DomainSchema,
  domainReason: z.string().min(1).max(2000),
  actionType: z.string().min(1).max(120),
  /** Concise restatement of what was reported. */
  summary: z.string().min(1).max(4000),
  categories: EvidenceAssessmentCategoriesSchema,
  authoritativeLookup: AuthoritativeLookupSchema,
  /** The deterministic diagnosis hypothesis derived from the above. */
  diagnosis: DiagnosisSchema,
});
export type Investigation = z.infer<typeof InvestigationSchema>;

/**
 * A safeguard recommendation. Distinct from a `SafeguardRule`: this is the
 * proposal shown to the user, with the reasoning that supports it. It becomes a
 * rule only when the rule engine activates it.
 */
export const SafeguardRecommendationSchema = z.object({
  statement: z.string().min(1).max(4000),
  failureMode: z.string().min(1).max(4000),
  whyEvidenceSupports: z.string().min(1).max(4000),
  assumptions: z.array(z.string().min(1).max(SUBMISSION_LIMITS.short)),
  testPlan: z.array(z.string().min(1).max(SUBMISSION_LIMITS.short)),
  successCriteria: z.string().min(1).max(2000),
  action: z.enum(["BLOCK", "REQUIRE_VERIFICATION"]),
  severity: SeveritySchema,
});
export type SafeguardRecommendation = z.infer<
  typeof SafeguardRecommendationSchema
>;

/**
 * The outcome of verifying a safeguard.
 *
 * The state vocabulary is deliberately ordinal and pessimistic. A safeguard is
 * `recommended` the moment it is proposed; it is only `test_executed` once a
 * real test actually ran; and it is only `verified` when that test's outcome
 * genuinely demonstrates the safeguard works. A submission can never reach
 * `verified` on its own, because a single incident cannot demonstrate that a
 * repeat was prevented — that requires a second, independent occurrence.
 */
export const VerificationStateSchema = z.enum([
  "recommended",
  "test_planned",
  "test_executed",
  "verified",
  "inconclusive",
  "failed",
]);
export type VerificationState = z.infer<typeof VerificationStateSchema>;

export const VerificationStepSchema = z.object({
  step: z.string().min(1).max(SUBMISSION_LIMITS.short),
  detail: z.string().min(1).max(4000),
  outcome: z.enum(["pass", "fail", "inconclusive", "info"]),
});

export const VerificationSchema = z.object({
  state: VerificationStateSchema,
  /** What was actually executed, stated plainly. Empty when nothing ran. */
  executed: z.string().min(1).max(2000),
  steps: z.array(VerificationStepSchema),
  /** What the test established — or why it could not establish anything. */
  established: z.string().min(1).max(4000),
  /**
   * True only when a real, runnable test was produced and executed. The UI uses
   * this — never the state label alone — to decide whether to claim testing.
   */
  testExecuted: z.boolean(),
});
export type Verification = z.infer<typeof VerificationSchema>;

/**
 * How a recalled prior record relates to the current submission.
 *
 * The labels are deliberately ordinal and conservative:
 *  - `retrieved`            — returned by the search; nothing further claimed.
 *  - `possible_similarity`  — semantically similar, but not a compatible pattern.
 *  - `candidate_pattern_match` — a compatible structured failure classification,
 *                               but not enough traceable evidence to call it a
 *                               recurrence. This is the honest default when only
 *                               vector similarity and a shared pattern exist.
 *  - `confirmed_recurrence` — the documented recurrence criteria are satisfied
 *                             by sufficiently strong, traceable evidence.
 */
export const MemoryRelationSchema = z.enum([
  "retrieved",
  "possible_similarity",
  "candidate_pattern_match",
  "confirmed_recurrence",
]);
export type MemoryRelation = z.infer<typeof MemoryRelationSchema>;

/**
 * Memory-write lifecycle, defined here so the audit record schema below can
 * validate a receipt without importing the adapter module (which would be a
 * cycle). The adapter re-exports these types, so there is still one definition.
 */
export const MemoryBackendIdSchema = z.enum([
  "memwal-mainnet",
  "memwal-staging",
  "memwal-unknown",
  "simulated",
]);
export type MemoryBackendId = z.infer<typeof MemoryBackendIdSchema>;

export const MemoryWriteStateSchema = z.enum([
  "requested",
  "processing",
  "completed",
  "failed",
]);
export type MemoryWriteState = z.infer<typeof MemoryWriteStateSchema>;

export const MemoryWriteReceiptSchema = z.object({
  writeId: z.string().min(1),
  kind: z.enum(["incident", "lesson"]),
  jobId: z.string().nullable(),
  state: MemoryWriteStateSchema,
  blobId: z.string().optional(),
  owner: z.string().optional(),
  namespace: z.string().optional(),
  error: z.string().optional(),
  recallVerified: z.boolean(),
  recallMatches: z.number().optional(),
  backend: MemoryBackendIdSchema,
  provenance: ProvenanceSchema,
  requestedAt: z.string(),
  completedAt: z.string().optional(),
  text: z.string(),
});
export type MemoryWriteReceipt = z.infer<typeof MemoryWriteReceiptSchema>;

export const RecalledMemorySchema = z.object({
  blobId: z.string().min(1),
  relation: MemoryRelationSchema,
  /** Human explanation of why it is relevant, grounded in the recalled record. */
  why: z.string().min(1).max(2000),
  distance: z.number(),
  /** The recalled lesson's rule statement, when the text parsed as a lesson. */
  ruleStatement: z.string().max(4000).optional(),
  domain: z.string().max(120).optional(),
  failurePattern: z.string().max(120).optional(),
  /**
   * Stable identifiers used to compare and deduplicate this recalled record.
   * `incidentId` is the originating incident; `patternKey` is the structured
   * failure classification it was filed under. Both are read from the recalled
   * lesson, never inferred from the vector distance.
   */
  incidentId: z.string().max(200).optional(),
  patternKey: z.string().max(120).optional(),
  /**
   * How the record meets (or fails) the documented recurrence criteria, stated
   * for the reader. This is the traceability the brief requires: what was
   * compared, and why recurrence was or was not established. Optional only so
   * that records written before this field existed still load and render; every
   * new record populates it.
   */
  matchBasis: z.string().min(1).max(2000).optional(),
  /** Whether the documented recurrence criteria were satisfied by evidence. */
  recurrenceEstablished: z.boolean().optional(),
  provenance: ProvenanceSchema,
});
export type RecalledMemory = z.infer<typeof RecalledMemorySchema>;

/**
 * The signature artifact. Connects
 *   Incident -> Evidence -> Hypothesis -> Safeguard -> Verification -> Memory
 * with truthful state labels at every join.
 */
export const SafeguardRecordSchema = z.object({
  recordId: z.string().min(1),
  incidentId: z.string().min(1),
  createdAt: z.string(),
  submission: IncidentSubmissionSchema,
  investigation: InvestigationSchema,
  recommendation: SafeguardRecommendationSchema,
  /** The rule the engine proposed from this investigation, if any. */
  proposedRule: SafeguardRuleSchema.nullable(),
  /** The rule that was activated, if validation accepted it. */
  activatedRule: SafeguardRuleSchema.nullable(),
  /** Reasons the rule was or was not activated. */
  validationReasons: z.array(z.string()),
  decision: SafeguardDecisionSchema,
  verification: VerificationSchema,
  recalledMemories: z.array(RecalledMemorySchema),
  memory: z.object({
    /** Persistence of the incident record. */
    incident: MemoryWriteReceiptSchema,
    /** Persistence of the corrective lesson. Null when no lesson applied. */
    lesson: MemoryWriteReceiptSchema.nullable(),
    /** Whether a later recall returned the stored lesson. */
    recallVerified: z.boolean(),
    /** Backend the writes went to. */
    backend: z.string().min(1),
    isLive: z.boolean(),
  }),
  provenance: ProvenanceSchema,
});
export type SafeguardRecord = z.infer<typeof SafeguardRecordSchema>;

/**
 * A user-submitted incident is always `live` in the sense that it is real user
 * material, but it is NOT a Mainnet write. The record carries `simulated`
 * provenance when the memory backend is not live, so nothing claims a durable
 * Mainnet memory that does not exist.
 */
