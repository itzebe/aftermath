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

/** Deterministic base identity of a safeguard: one base per domain + failure category. */
export function safeguardMemoryId(domain: string, failureCategory: string): string {
  return `safeguard-${domain}-${failureCategory}`;
}

/**
 * The versioned identity of a safeguard, `base@vN`.
 *
 * The base id is stable across versions so a recurrence is recognised, while the
 * versioned id is unique per version so provenance and supersession are
 * unambiguous and a version can never reference itself.
 */
export function versionedMemoryId(memory: {
  memory_id: string;
  version: number;
}): string {
  return `${memory.memory_id}@v${memory.version}`;
}

/**
 * Resolve which version of each safeguard is *effective* from the records that
 * were recalled.
 *
 * Walrus Memory is append-only from the application's point of view: a
 * correction is a new record that names its predecessor, and the predecessor's
 * blob is left untouched. Supersession is therefore derived here, at recall
 * time, rather than by mutating the old record:
 *
 *   - an explicit `supersedes` edge (from an *authoritative, active* record)
 *     retires the exact predecessor version it names;
 *   - within a base identity, only the highest active authoritative version is
 *     effective;
 *   - a non-authoritative correction cannot retire an authoritative safeguard.
 *
 * If an older version is recalled without its newer sibling, the recalled set is
 * *incomplete*: a higher version may exist that recall did not return. When the
 * caller supplies the highest version it knows from a separate source (the
 * durable record index), the uncertainty is resolved — the effective version is
 * the true highest. When it does not, the older version is still returned as
 * effective (so the safeguard keeps protecting) but the entry is flagged
 * `uncertain: true` and `latestKnownVersion` is recorded, and the callers and
 * the UI report that the effective version may not be the latest globally.
 *
 * `knownLatest` is the maximum version the caller can establish per base id from
 * a source other than recall (the durable index of what was actually learned).
 * It is always at least the highest version seen in `records`.
 */
export interface EffectiveSafeguard {
  record: SafeguardMemoryRecord;
  /** The highest version of this base identity present in the recalled set. */
  latestKnownVersion: number;
  /**
   * The highest version established from the caller's independent source, when
   * one was supplied; `undefined` when completeness could not be established.
   */
  latestGloballyVerifiedVersion?: number;
  /**
   * True when a higher version may exist that was not available to enforce. In
   * that case the recalled version is the latest *known*, not the latest
   * *verified*, and the safeguard's currency cannot be guaranteed.
   */
  uncertain: boolean;
}

export interface ResolveEffectiveOptions {
  /**
   * The highest version the caller can establish per base id from a source other
   * than recall (the durable record index). When present, a recalled version
   * below this bound is treated as definitively superseded — an obsolete version
   * is never enforced merely because its successor was omitted from recall.
   */
  knownLatest?: Map<string, number>;
}

export function resolveEffectiveSafeguards(
  records: SafeguardMemoryRecord[],
  options: ResolveEffectiveOptions = {},
): {
  /** base memory_id -> the effective record and its version-certainty metadata. */
  effective: Map<string, EffectiveSafeguard>;
  /** versioned ids retired by a valid superseder, whether or not recalled. */
  retired: Set<string>;
  /** versioned ids not enforced because the durable index shows a higher version. */
  obsolete: Set<string>;
} {
  const retired = new Set<string>();
  for (const r of records) {
    if (!r.supersedes) continue;
    // Only a record that is itself enforceable may retire another. A weak
    // correction is recorded but never retires an authoritative safeguard.
    if (!(r.authoritative && r.status === "active")) continue;
    retired.add(r.supersedes);
  }

  const byBase = new Map<string, SafeguardMemoryRecord[]>();
  for (const r of records) {
    const list = byBase.get(r.memory_id);
    if (list) list.push(r);
    else byBase.set(r.memory_id, [r]);
  }

  const effective = new Map<string, EffectiveSafeguard>();
  const obsolete = new Set<string>();
  for (const [base, group] of byBase) {
    const recalledHighest = group.reduce((a, b) => (b.version > a.version ? b : a));
    const known = options.knownLatest?.get(base);
    // The highest version that exists anywhere, as far as the caller can tell.
    const globalHighest =
      known === undefined ? undefined : Math.max(known, recalledHighest.version);

    const candidates = group.filter(
      (r) =>
        r.status === "active" &&
        r.authoritative &&
        !retired.has(versionedMemoryId(r)),
    );
    if (candidates.length === 0) continue;
    const highest = candidates.reduce((a, b) => (b.version > a.version ? b : a));

    // A recalled version strictly below the independently-known highest is
    // definitively obsolete: fail safe by not enforcing it, and record it so the
    // caller can explain why rather than silently dropping it.
    if (globalHighest !== undefined && highest.version < globalHighest) {
      for (const r of group) obsolete.add(versionedMemoryId(r));
      continue;
    }

    // Uncertainty remains only when the global highest could not be established.
    const uncertain = globalHighest === undefined;
    effective.set(base, {
      record: highest,
      latestKnownVersion: recalledHighest.version,
      ...(globalHighest !== undefined
        ? { latestGloballyVerifiedVersion: globalHighest }
        : {}),
      uncertain,
    });
  }

  return { effective, retired, obsolete };
}

export type SafeguardDisposition = "created" | "duplicate" | "superseded";

/**
 * The minimal prior-safeguard identity `learnSafeguard` needs to decide whether a
 * new finding is a duplicate or a correction. Kept narrow so callers can supply
 * priors from both recall and the durable record index without a full record.
 */
export interface PriorSafeguard {
  memory_id: string;
  version: number;
  corrective_rule: string;
}

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
  /**
   * Prior memories for the same category, as recalled or read from the durable
   * record index. Drives duplicate/supersede; the highest version wins.
   */
  existing?: PriorSafeguard[];
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

  // The prior is the highest-version memory for this category, whether it came
  // from recall or the durable index, so an out-of-order or partial recall can
  // never make a new version reuse an older one's number.
  const prior = input.existing
    ?.filter((m) => m.memory_id === memoryId)
    .reduce<PriorSafeguard | undefined>(
      (best, m) => (!best || m.version > best.version ? m : best),
      undefined,
    );
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
      // Name the exact predecessor identity, not the bare base id, so the
      // correction never appears to supersede itself.
      supersedes = versionedMemoryId(prior);
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
    baseMemoryId: memoryId,
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
  /**
   * The highest safeguard version the caller can establish per base id from the
   * durable record index (independent of what recall returned). When supplied,
   * a recalled version below this bound is treated as definitively superseded
   * and is never enforced. When absent, a recalled version is enforced but
   * flagged uncertain — it may not be the latest that exists.
   */
  knownLatest?: Map<string, number>;
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
  // Resolve which version is effective for each base identity from the recalled
  // records, so a superseded version is never enforced alongside its successor.
  // The caller's `knownLatest` (from the durable index) lets an obsolete recalled
  // version be detected even when its successor was not recalled.
  const recalledRecords = recalled
    .map((r) => r.safeguardMemory)
    .filter((m): m is SafeguardMemoryRecord => Boolean(m));
  const { effective, retired, obsolete } = resolveEffectiveSafeguards(
    recalledRecords,
    context.knownLatest ? { knownLatest: context.knownLatest } : {},
  );

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
      const version = record.version;
      const applies = safeguardApplies(record, context);
      const effectiveEntry = effective.get(record.memory_id);
      const effectiveRecord = effectiveEntry?.record;
      const isEffective = effectiveRecord === record;
      const isObsolete = obsolete.has(versionedMemoryId(record));
      const superseded =
        retired.has(versionedMemoryId(record)) ||
        (effectiveRecord !== undefined && effectiveRecord.version > record.version);
      const applicable = applies.applicable && isEffective;
      const applicabilityBasis = !applies.applicable
        ? applies.basis
        : isObsolete
          ? `Version ${version} is not the latest: the durable index shows a ` +
            "higher version of this safeguard exists, so this obsolete version " +
            "is not enforced."
          : superseded
            ? `Version ${version} has been superseded by ` +
              `${effectiveRecord ? versionedMemoryId(effectiveRecord) : "a later version"}; ` +
              "only the effective version is enforced."
            : applies.basis;
      // Version currency is reported only for a record that is actually
      // enforced: an uncertain version is still applied (it may be the latest),
      // but the reader is told the effective version may not be the latest that
      // exists. The uncertainty never weakens the safeguard below the current
      // evidence — it only adds a caution.
      const versionCertainty =
        applicable && effectiveEntry
          ? {
              latestKnownVersion: effectiveEntry.latestKnownVersion,
              ...(effectiveEntry.latestGloballyVerifiedVersion !== undefined
                ? { latestGloballyVerifiedVersion: effectiveEntry.latestGloballyVerifiedVersion }
                : {}),
              uncertain: effectiveEntry.uncertain,
            }
          : undefined;
      return {
        memoryId: record.memory_id,
        version,
        blobId: r.blobId,
        relation: verdict.relation,
        relevance,
        applicable,
        applicabilityBasis,
        originalIncidentId: record.origin_incident_id,
        ...(applicable
          ? {
              contributedRule: record.corrective_rule,
              addedVerification: record.required_checks[0],
            }
          : {}),
        changedBehaviour: false,
        authoritative: record.authoritative,
        ...(versionCertainty ? { versionCertainty } : {}),
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
      ...(lesson?.incident_id ? { originalIncidentId: lesson.incident_id } : {}),
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
  /** The engine's decision with the legacy lessons retained but no memory applied. */
  beforeDecision: BehaviourChange["beforeDecision"];
  /** The engine's decision with the applicable safeguard enforced. */
  afterDecision: BehaviourChange["afterDecision"];
  /** The verification checks the before arm required (always empty today). */
  beforeChecks?: string[];
  /** The verification checks the after arm required. */
  afterChecks: string[];
  /** The first applicable safeguard's rule, when one applied. */
  appliedRule?: string;
  appliedMemoryId?: string;
  /** The exact version of the applied memory. */
  appliedMemoryVersion?: number;
  /** Number of recalled records that were retrieved but did not apply. */
  retrievedNotApplicable: number;
}

/**
 * Compute the honest before/after of the applicable safeguards.
 *
 * Both arms are produced by the *same* deterministic engine over *identical*
 * inputs — the same evidence, the same legacy `recalledLessons`, the same rules
 * — and differ only in whether the applicable safeguard memory is enforced.
 * Because the legacy corrective-lesson path can also escalate an UNKNOWN
 * decision, the decision alone is not sufficient evidence of the memory's
 * effect. A change is therefore attributed to the memory only when the memory
 * moves the decision, or when it adds a required verification check the before
 * arm did not require.
 */
export function computeBehaviourChange(input: BehaviourChangeInput): BehaviourChange {
  const {
    beforeDecision,
    afterDecision,
    afterChecks,
    appliedRule,
    appliedMemoryId,
    appliedMemoryVersion,
    retrievedNotApplicable,
  } = input;
  const beforeChecks = input.beforeChecks ?? [];

  const decisionChanged = beforeDecision !== afterDecision;
  const addedRequiredChecks = afterChecks.filter((c) => !beforeChecks.includes(c));
  // Attribution: only the memory's own contribution counts. A decision the
  // before arm already reached — via a legacy lesson or an active rule — is not
  // a memory-caused change, even though the memory is enforced.
  const attributableToMemory = decisionChanged || addedRequiredChecks.length > 0;

  let explanation: string;
  if (decisionChanged) {
    const checksNote = addedRequiredChecks.length
      ? ` It also adds ${addedRequiredChecks.length} required verification check(s).`
      : "";
    explanation =
      `The legacy corrective lessons, evidence, and rules were held constant; ` +
      `only the safeguard-memory mechanism differed. Without it the engine ` +
      `concluded ${beforeDecision}; with the effective safeguard memory enforced ` +
      `it concludes ${afterDecision}.` +
      checksNote +
      (retrievedNotApplicable > 0
        ? ` ${retrievedNotApplicable} other retrieved record(s) did not apply and ` +
          "were not enforced."
        : "");
  } else if (addedRequiredChecks.length > 0) {
    explanation =
      `The decision is unchanged (${beforeDecision} either way, with the legacy ` +
      `lessons held constant), but the applicable safeguard adds ` +
      `${addedRequiredChecks.length} required verification check(s) the engine ` +
      "would not otherwise require. The check(s) strengthen the investigation " +
      "without altering its verdict." +
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
      `The applicable safeguard did not change the decision or add a required ` +
      `check: the engine reaches ${afterDecision} with the legacy lessons alone, ` +
      "so the safeguard is redundant here. This is recorded honestly rather than " +
      "counted as a memory-caused influence.";
  }

  return {
    changed: attributableToMemory,
    beforeDecision,
    afterDecision,
    beforeRequiredChecks: beforeChecks,
    afterRequiredChecks: afterChecks,
    addedRequiredChecks,
    attributableToMemory,
    comparisonBasis:
      "Both arms run the same decision engine over identical evidence, " +
      "identical recalled corrective lessons, and identical active rules; only " +
      "the applicable safeguard memory differs.",
    ...(attributableToMemory && appliedRule ? { changedByRule: appliedRule } : {}),
    ...(attributableToMemory && appliedMemoryId
      ? { changedByMemoryId: appliedMemoryId }
      : {}),
    ...(attributableToMemory && appliedMemoryVersion
      ? { changedByMemoryVersion: appliedMemoryVersion }
      : {}),
    explanation,
  };
}

/** A recalled memory's relation, for the UI's recall panel. */
export type { RecalledMemory };
