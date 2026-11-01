/**
 * The learning loop's core: turn a verified failure into a structured Safeguard
 * Memory, evaluate whether a recalled memory applies to a new investigation, and
 * compute the real before/after the applied memory produced.
 *
 * Three stages live here, kept deliberately separate so a reader can trace the
 * chain the brief requires — retrieved memory, applicable safeguard, enforced
 * verification requirement, resulting decision:
 *
 *   1. `learnSafeguard`      — the "learn" stage. Produces a memory from an
 *                              actionable, evidence-grounded diagnosis. Only a
 *                              sufficiently-supported finding is authoritative.
 *   2. `evaluateSafeguardApplications` — the "recall" stage. Decides, per
 *                              recalled record, why it is relevant, whether it
 *                              applies, and what it contributes.
 *   3. `computeBehaviourChange` — the "change behaviour" stage. Compares the
 *                              decision engine's output with and without the
 *                              applicable safeguards enforced.
 *
 * Nothing here fabricates a finding: a memory is built only from the incident,
 * the evidence assessment, and the diagnosis, and a behaviour change is only
 * reported when the decision engine genuinely differs.
 */

import {
  SafeguardMemoryRecordSchema,
  type BehaviourChange,
  type Diagnosis,
  type EvidenceAssessment,
  type Incident,
  type Investigation,
  type RecalledMemory,
  type SafeguardApplication,
  type SafeguardMemory,
  type SafeguardMemoryRecord,
  type SafeguardRecommendation,
  type SafeguardRule,
} from "@/lib/schemas";
import { PATTERN_ACTION, PATTERN_SEVERITY } from "@/lib/engines/rule-engine";
import { classifyRecurrence } from "@/lib/engines/recurrence";
import type { RecalledLesson } from "@/lib/adapters/memory";

/** Deterministic identity of a safeguard: one memory per domain + failure category. */
export function safeguardMemoryId(domain: string, failureCategory: string): string {
  return `safeguard-${domain}-${failureCategory}`;
}

export type SafeguardDisposition = "created" | "duplicate" | "superseded";

export interface LearnedSafeguard {
  record: SafeguardMemoryRecord;
  memory: SafeguardMemory;
  /**
   * `created` — a new safeguard for this category.
   * `duplicate` — an identical safeguard already exists; nothing new to persist.
   * `superseded` — a corrected rule for the same category; this version replaces it.
   */
  disposition: SafeguardDisposition;
}

export interface LearnInput {
  incident: Incident;
  diagnosis: Diagnosis;
  assessment: EvidenceAssessment;
  investigation: Investigation;
  recommendation: SafeguardRecommendation;
  activatedRule?: SafeguardRule | null;
  proposedRule?: SafeguardRule | null;
  /** Prior memories for the same category, as recalled. Drives duplicate/supersede. */
  existing?: SafeguardMemoryRecord[];
  /** The memory backend the write will go to. */
  backend: string;
  now?: string;
}

/**
 * The conditions under which a finding is authoritative enough to be enforced.
 *
 * A finding is authoritative only when the material itself supplies a
 * machine-checkable observed fact, or a connected authoritative source was
 * consulted, or an authoritative source established the outcome. An actionable
 * diagnosis that rests on none of these is recorded (so it is not lost) but is
 * never enforced and is not persisted to Mainnet.
 */
export function assessAuthority(input: {
  diagnosis: Diagnosis;
  assessment: EvidenceAssessment;
  investigation: Investigation;
}): { authoritative: boolean; basis: string } {
  const { diagnosis, assessment, investigation } = input;
  if (!diagnosis.actionable) {
    return {
      authoritative: false,
      basis:
        "The diagnosis is not actionable, so there is no failure pattern to " +
        "safeguard.",
    };
  }
  const observed = investigation.categories.observedEvidence.length;
  const lookupAttempted = investigation.authoritativeLookup.attempted;
  if (assessment.verified) {
    return {
      authoritative: true,
      basis:
        `An authoritative source established the outcome as ` +
        `${assessment.status} (${assessment.evidenceReference}), so the finding ` +
        "is grounded in verified evidence.",
    };
  }
  if (lookupAttempted) {
    return {
      authoritative: true,
      basis:
        `An authoritative source was consulted ` +
        `(${investigation.authoritativeLookup.source}) and returned ` +
        `${assessment.status}. The absence of confirmation is itself the ` +
        "verified finding, so the safeguard is grounded.",
    };
  }
  if (observed > 0) {
    return {
      authoritative: true,
      basis:
        `The material supplies ${observed} machine-checkable observed fact(s) ` +
        "behind the finding, so the safeguard is grounded in the submitted " +
        "evidence.",
    };
  }
  return {
    authoritative: false,
    basis:
      "The diagnosis is actionable but rests on no observed fact, no " +
      "authoritative lookup, and no verified outcome. It is recorded as an " +
      "unverified observation and is not enforced.",
  };
}

/**
 * Build the safeguard a diagnosis yields. Returns null when the diagnosis is
 * not actionable (there is no failure pattern to safeguard).
 */
export function learnSafeguard(input: LearnInput): LearnedSafeguard | null {
  const { incident, diagnosis, assessment, investigation, recommendation } = input;
  if (!diagnosis.actionable) return null;

  const now = input.now ?? new Date().toISOString();
  const memoryId = safeguardMemoryId(incident.domain, diagnosis.pattern);
  const { authoritative, basis } = assessAuthority({
    diagnosis,
    assessment,
    investigation,
  });

  const correctiveRule =
    input.activatedRule?.statement ??
    input.proposedRule?.statement ??
    recommendation.statement;

  const requiredChecks =
    recommendation.testPlan.length > 0
      ? recommendation.testPlan
      : [
          diagnosis.ruleSketch?.requiredEvidence ??
            "an authoritative record of the operation's outcome",
        ];

  const appliesWhen = [
    `domain=${incident.domain}`,
    `actionType=${incident.actionType}`,
    `failureCategory=${diagnosis.pattern}`,
  ];

  const limitations = [
    `Scoped to domain ${incident.domain} and action type ${incident.actionType}; ` +
      "it does not generalise to unrelated operations.",
    ...recommendation.assumptions,
  ];

  // A root cause is recorded only where the evidence actually establishes one.
  // The claim-mismatch patterns do: the cause is the missing verification, not a
  // guess about the underlying system.
  const rootCause =
    diagnosis.pattern === "unsupported_completion_claim" ||
    diagnosis.pattern === "repeated_failed_operation"
      ? "A completion claim was made without an authoritative record of the " +
        "operation's outcome."
      : undefined;

  const prior = input.existing?.find((m) => m.memory_id === memoryId);
  let version = 1;
  let disposition: SafeguardDisposition = "created";
  let supersedes: string | undefined;
  if (prior) {
    if (prior.corrective_rule === correctiveRule) {
      disposition = "duplicate";
      version = prior.version;
    } else {
      disposition = "superseded";
      version = prior.version + 1;
      supersedes = prior.memory_id;
    }
  }

  const record: SafeguardMemoryRecord = SafeguardMemoryRecordSchema.parse({
    type: "safeguard_memory",
    memory_id: memoryId,
    version,
    origin_incident_id: incident.incidentId,
    domain: incident.domain,
    action_type: incident.actionType,
    failure_category: diagnosis.pattern,
    verified_failure: diagnosis.hypothesis,
    evidence: [`incident:${incident.incidentId}`, assessment.evidenceReference],
    ...(rootCause ? { root_cause: rootCause } : {}),
    corrective_rule: correctiveRule,
    applies_when: appliesWhen,
    required_checks: requiredChecks,
    action: PATTERN_ACTION[diagnosis.pattern],
    severity: PATTERN_SEVERITY[diagnosis.pattern],
    confidence: diagnosis.confidence,
    limitations,
    authoritative,
    support_basis: basis,
    status: "active",
    ...(supersedes ? { supersedes } : {}),
    created_at: now,
    provenance: incident.provenance,
  });

  const memory: SafeguardMemory = {
    type: "safeguard_memory",
    memoryId,
    version,
    originIncidentId: incident.incidentId,
    domain: incident.domain,
    actionType: incident.actionType,
    failureCategory: diagnosis.pattern,
    verifiedFailureDescription: record.verified_failure,
    evidence: record.evidence,
    ...(record.root_cause ? { rootCause: record.root_cause } : {}),
    correctiveRule: record.corrective_rule,
    appliesWhen: record.applies_when,
    requiredChecks: record.required_checks,
    action: record.action,
    severity: record.severity,
    confidence: record.confidence,
    limitations: record.limitations,
    authoritative: record.authoritative,
    supportBasis: record.support_basis,
    status: record.status,
    ...(record.supersedes ? { supersedes: record.supersedes } : {}),
    createdAt: record.created_at ?? now,
    walrus: {
      backend: input.backend,
      persisted: false,
      recallVerified: false,
    },
    provenance: record.provenance,
  };

  return { record, memory, disposition };
}

/* ------------------------------------------------------------------ *
 * Recall: applicability
 * ------------------------------------------------------------------ */

export interface ApplicabilityContext {
  domain: string;
  actionType: string;
  /** The current investigation's diagnosed failure category. */
  pattern: string;
  /** Whether the current incident carries a machine-checkable evidence reference. */
  hasAuthoritativeReference: boolean;
}

/** Whether a safeguard's conditions match the current investigation. */
export function safeguardApplies(
  record: SafeguardMemoryRecord,
  context: ApplicabilityContext,
): { applicable: boolean; basis: string } {
  if (record.status !== "active") {
    return {
      applicable: false,
      basis: `The memory is "${record.status}", so it is not enforced.`,
    };
  }
  if (!record.authoritative) {
    return {
      applicable: false,
      basis:
        "The memory is recorded but not authoritative, so it is never enforced.",
    };
  }
  if (record.domain !== context.domain) {
    return {
      applicable: false,
      basis: `The memory is scoped to domain ${record.domain}, not ${context.domain}.`,
    };
  }
  if (record.failure_category !== context.pattern) {
    return {
      applicable: false,
      basis:
        `The memory addresses ${record.failure_category}, but this investigation ` +
        `diagnosed ${context.pattern}. A shared domain is not enough to apply it.`,
    };
  }
  const actionCondition = record.applies_when.find((c) => c.startsWith("actionType="));
  if (actionCondition && actionCondition.slice("actionType=".length) !== context.actionType) {
    return {
      applicable: false,
      basis:
        `The memory applies to action type ` +
        `${actionCondition.slice("actionType=".length)}, not ${context.actionType}.`,
    };
  }
  return {
    applicable: true,
    basis:
      `Domain (${context.domain}), failure category (${context.pattern}), and ` +
      `action type (${context.actionType}) all match, and the memory is ` +
      "authoritative and active.",
  };
}

/**
 * Evaluate every recalled record against the current investigation.
 *
 * Each recalled record yields exactly one application entry, so a reader can see
 * which memories were retrieved, which applied, and — for the ones that applied
 * — what they contributed. A record that was retrieved but did not apply is
 * recorded with `applicable: false` and never influences the decision.
 */
export function evaluateSafeguardApplications(
  recalled: RecalledLesson[],
  context: ApplicabilityContext,
): SafeguardApplication[] {
  return recalled.map((r) => {
    const record = r.safeguardMemory;
    const lesson = r.record;

    // Relation: reuse the documented recurrence criteria, mapped onto the
    // safeguard record when one was recalled.
    const verdict = classifyRecurrence({
      ...(record
        ? {
            record: {
              domain: record.domain,
              failure_pattern: record.failure_category,
              incident_id: record.origin_incident_id,
              evidence_reference: record.evidence[0] ?? "none",
            },
          }
        : lesson
          ? { record: lesson }
          : {}),
      domain: context.domain,
      pattern: context.pattern,
      hasAuthoritativeReference: context.hasAuthoritativeReference,
    });

    const relevance = record
      ? `A safeguard learned from a verified ${record.failure_category} failure ` +
        `in domain ${record.domain} was retrieved.`
      : lesson
        ? `A corrective lesson from a prior ${lesson.failure_pattern} incident ` +
          "was retrieved."
        : "A prior memory was retrieved by similarity; its text did not parse as " +
          "a structured record.";

    if (record) {
      const applies = safeguardApplies(record, context);
      return {
        memoryId: record.memory_id,
        blobId: r.blobId,
        relation: verdict.relation,
        relevance,
        applicable: applies.applicable,
        applicabilityBasis: applies.basis,
        ...(applies.applicable
          ? {
              contributedRule: record.corrective_rule,
              addedVerification: record.required_checks[0],
            }
          : {}),
        changedBehaviour: false,
        authoritative: record.authoritative,
        provenance: r.provenance,
      };
    }

    // A legacy corrective lesson: applicability is domain + pattern equality.
    const applicable = Boolean(
      lesson && lesson.domain === context.domain && lesson.failure_pattern === context.pattern,
    );
    return {
      memoryId: lesson?.incident_id ?? `blob-${r.blobId}`,
      blobId: r.blobId,
      relation: verdict.relation,
      relevance,
      applicable,
      applicabilityBasis: applicable
        ? `Domain (${context.domain}) and failure pattern (${context.pattern}) ` +
          "match the recalled lesson."
        : "The recalled lesson does not share both the domain and the failure " +
          "pattern of this investigation, so it does not apply.",
      ...(applicable && lesson ? { contributedRule: lesson.corrective_rule } : {}),
      changedBehaviour: false,
      authoritative: false,
      provenance: r.provenance,
    };
  });
}

/**
 * Convert an applicable safeguard into an enforceable rule for the decision
 * engine. Only the domain and action-type conditions are carried, because those
 * are the conditions the rule engine evaluates; the failure-category condition
 * is already guaranteed by the applicability check.
 */
export function safeguardToRule(memory: SafeguardMemoryRecord): SafeguardRule {
  return {
    ruleId: `memory-${memory.memory_id}`,
    version: memory.version,
    domain: memory.domain,
    failurePattern: memory.failure_category,
    statement: memory.corrective_rule,
    applicabilityConditions: memory.applies_when.filter(
      (c) => c.startsWith("domain=") || c.startsWith("actionType="),
    ),
    requiredEvidence:
      memory.required_checks.length > 0 ? memory.required_checks : [memory.corrective_rule],
    action: memory.action,
    severity: memory.severity,
    validationStatus: "active",
    supportingIncidentIds: [memory.origin_incident_id],
    createdAt: memory.created_at ?? new Date().toISOString(),
    updatedAt: memory.created_at ?? new Date().toISOString(),
    provenance: memory.provenance,
  };
}

/* ------------------------------------------------------------------ *
 * Change behaviour
 * ------------------------------------------------------------------ */

export interface BehaviourChangeInput {
  beforeDecision: BehaviourChange["beforeDecision"];
  afterDecision: BehaviourChange["afterDecision"];
  /** The checks the applicable memories require. */
  appliedChecks: string[];
  /** The first applicable safeguard's rule, when one applied. */
  appliedRule?: string;
  appliedMemoryId?: string;
  /** Number of recalled records that were retrieved but did not apply. */
  retrievedNotApplicable: number;
}

/**
 * Compute the honest before/after of the applicable safeguards.
 *
 * A change is reported when the decision differs, or when the decision is
 * REQUIRE_VERIFICATION (the safeguard is what forces the extra checks). When the
 * evidence already established the outcome — VERIFIED_SUCCESS allows, or
 * VERIFIED_FAILURE blocks — the safeguard adds nothing and no change is claimed.
 */
export function computeBehaviourChange(input: BehaviourChangeInput): BehaviourChange {
  const {
    beforeDecision,
    afterDecision,
    appliedChecks,
    appliedRule,
    appliedMemoryId,
    retrievedNotApplicable,
  } = input;

  const decisionChanged = beforeDecision !== afterDecision;
  // Checks are only "added" when the safeguard is what forces verification.
  const addedRequiredChecks =
    afterDecision === "REQUIRE_VERIFICATION" ? appliedChecks : [];
  const changed = decisionChanged || addedRequiredChecks.length > 0;

  let explanation: string;
  if (decisionChanged) {
    const checksNote = addedRequiredChecks.length
      ? ` It also adds ${addedRequiredChecks.length} required verification check(s).`
      : "";
    explanation =
      `With no memory applied the decision engine concluded ${beforeDecision}; ` +
      `with the applicable safeguard enforced it concludes ${afterDecision}.` +
      checksNote +
      (retrievedNotApplicable > 0
        ? ` ${retrievedNotApplicable} other retrieved record(s) did not apply and ` +
          "were not enforced."
        : "");
  } else if (addedRequiredChecks.length > 0) {
    explanation =
      `The decision is unchanged (${beforeDecision} either way), but the ` +
      `applicable safeguard adds ${addedRequiredChecks.length} required ` +
      "verification check(s) that would not otherwise be required. The check(s) " +
      "strengthen the investigation without altering its verdict." +
      (retrievedNotApplicable > 0
        ? ` ${retrievedNotApplicable} other retrieved record(s) did not apply.`
        : "");
  } else if (retrievedNotApplicable > 0 && !appliedRule) {
    explanation =
      `No recalled safeguard applied to this investigation, so the decision ` +
      `(${afterDecision}) is the same with and without memory. ${retrievedNotApplicable} ` +
      "record(s) were retrieved but did not meet the applicability conditions.";
  } else {
    explanation =
      `The applicable safeguard did not change the outcome: the evidence alone ` +
      `already establishes ${afterDecision}, so the safeguard is redundant here. ` +
      "This is recorded honestly rather than counted as an influence.";
  }

  return {
    changed,
    beforeDecision,
    afterDecision,
    beforeRequiredChecks: [],
    afterRequiredChecks: addedRequiredChecks,
    addedRequiredChecks,
    ...(changed && appliedRule ? { changedByRule: appliedRule } : {}),
    ...(changed && appliedMemoryId ? { changedByMemoryId: appliedMemoryId } : {}),
    explanation,
  };
}

/** A recalled memory's relation, for the UI's recall panel. */
export type { RecalledMemory };
