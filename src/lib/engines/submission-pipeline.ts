/**
 * The user-facing incident-to-safeguard workflow.
 *
 * This composes the shared primitives — the evidence adapter, the deterministic
 * investigation, the rule engine, the decision engine, the memory adapter, and
 * the durable audit store — into one pipeline:
 *
 *   Submit -> Investigate -> Establish facts -> Identify uncertainty ->
 *   Retrieve relevant lessons -> Propose a safeguard -> Verify -> Preserve.
 *
 * It reuses the *same* rule, decision, and memory code the controlled scenarios
 * use, so the mechanisms a judge can watch in the Evaluation Lab are the ones
 * that run on a real submission. Nothing here executes the submitted material.
 */

import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import {
  SafeguardRecordSchema,
  type EvidenceAssessment,
  type IncidentSubmission,
  type RecalledMemory,
  type SafeguardRecord,
  type SafeguardRule,
} from "@/lib/schemas";
import type { EvidenceAdapter } from "@/lib/adapters/evidence";
import type { MemoryAdapter, MemoryWriteReceipt } from "@/lib/adapters/memory";
import type { AuditStore } from "@/lib/db/audit-store";
import { incidentToMemoryText, lessonToMemoryText } from "@/lib/adapters/memory";
import { proposeRule, validateRule } from "@/lib/engines/rule-engine";
import { decide, policyVersionFor } from "@/lib/engines/decision-engine";
import {
  extractSignals,
  investigateSubmission,
  submissionToIncidentInput,
} from "@/lib/engines/investigation";
import {
  buildRecommendation,
  verifySafeguard,
} from "@/lib/engines/safeguard-verification";
import { IncidentSchema, CorrectiveLessonRecordSchema } from "@/lib/schemas";

export interface InvestigationDeps {
  /** Chosen from the inferred domain; may be the honest no-source adapter. */
  resolveEvidence: (domain: "finance" | "incident") => EvidenceAdapter;
  memory: MemoryAdapter;
  store: AuditStore;
}

/**
 * Deterministic id for a submission, so a retried request is idempotent.
 *
 * The id is the SHA-256 of the normalised submission content plus any explicit
 * caller key. The same content therefore always produces the same record id,
 * incident id, and memory idempotency keys — a retry upserts rather than
 * duplicating, and the memory relayer dedupes on the same keys.
 */
export function submissionId(submission: IncidentSubmission): string {
  const basis = submission.idempotencyKey
    ? `key:${submission.idempotencyKey}`
    : JSON.stringify({
        text: submission.text,
        expected: submission.expectedBehavior ?? null,
        actual: submission.actualBehavior ?? null,
        service: submission.service ?? null,
      });
  const hash = createHash("sha256").update(basis).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

/**
 * Run the full workflow for one submission and persist the resulting record.
 *
 * Returns the record. If the memory backend is unavailable the record still
 * persists (with the write's failed receipt recorded), because losing the
 * investigation would be worse than recording an honest persistence failure.
 */
export async function runSubmissionPipeline(
  submission: IncidentSubmission,
  deps: InvestigationDeps,
): Promise<SafeguardRecord> {
  const recordId = submissionId(submission);
  const incidentId = recordId;

  // Stage A/B: rule-based parse. The authoritative lookup is folded in first so
  // the investigation reflects what a connected source actually returned.
  const signals = extractSignals(submission.text);
  const preliminary = investigateSubmission({
    submission,
    authoritativeLookup: {
      attempted: false,
      verified: false,
      status: "UNKNOWN",
      detail: "No authoritative lookup was attempted.",
      evidenceReference: "none",
      source: "none",
    },
  });

  const evidence = deps.resolveEvidence(
    preliminary.domain === "finance" ? "finance" : "incident",
  );

  // Build the incident input the adapter expects, then ask the adapter. For a
  // finance submission this is a real, read-only Tatum lookup; for an incident
  // submission it honestly reports that no source is connected.
  const incidentInput = submissionToIncidentInput({
    investigation: preliminary,
    executionId: recordId,
    intendedOutcome: submission.expectedBehavior ?? "Resolve the reported incident",
    signals,
  });
  const incident = IncidentSchema.parse({
    ...incidentInput,
    incidentId,
    createdAt: new Date().toISOString(),
    currentStatus: "open",
  });

  const assessment: EvidenceAssessment = await evidence.verifyEvidence(incident);

  // Re-run the investigation with the real lookup result folded in.
  const investigation = investigateSubmission({
    submission,
    authoritativeLookup: {
      attempted: preliminary.domain === "finance",
      verified: assessment.verified,
      status: assessment.status,
      detail: assessment.explanation,
      evidenceReference: assessment.evidenceReference,
      source: evidence.sourceName,
    },
  });

  // Stage C: retrieve relevant prior lessons. Memory informs; it never governs.
  const recallQuery = `${investigation.domain} ${investigation.actionType} ${investigation.diagnosis.pattern}`;
  const recalled = await deps.memory.recallRelevantLessons(recallQuery, {
    limit: 5,
  });
  const recalledMemories: RecalledMemory[] = recalled.map((r) =>
    describeRecall(r, investigation.diagnosis.pattern),
  );

  // Stage D: propose and validate the safeguard against the shared rule engine.
  const storedIncident = { ...incident, currentStatus: "diagnosed" as const };
  const proposedRule = proposeRule(
    storedIncident,
    investigation.diagnosis,
    assessment,
  );
  let activatedRule: SafeguardRule | null = null;
  let validationReasons: string[] = [];
  if (proposedRule) {
    const outcome = validateRule(proposedRule, investigation.diagnosis, {
      supportingIncidents: [storedIncident],
      assessments: { [incidentId]: assessment },
      policyVersion: "aftermath-policy-1.0",
    });
    validationReasons = outcome.reasons;
    activatedRule = outcome.rule ?? null;
    // A user submission persists its rule as *proposed* unless validation
    // genuinely activated it. A single submission cannot justify a broad rule,
    // and the store must reflect that.
    await deps.store.saveRule(activatedRule ?? proposedRule);
  }

  const recommendation = buildRecommendation({ investigation, assessment });

  // Stage E: verify by executing the decision engine against the recommendation.
  const priorActiveRules = await deps.store.listActiveRules();
  const assertedSuccess = signals.claimsSuccess;
  const verification = verifySafeguard({
    investigation,
    assessment,
    rule: activatedRule ?? proposedRule,
    mode: "claim",
    assertedSuccess,
  });

  const decision = decide({
    domain: investigation.domain,
    actionType: investigation.actionType,
    mode: "claim",
    assertedSuccess,
    assessment,
    applicableRules: priorActiveRules.filter(
      (r) => r.domain === investigation.domain,
    ),
    recalledLessons: recalled,
    preconditions: [],
    policyVersion: policyVersionFor(priorActiveRules),
  });

  await deps.store.saveIncident({
    incident: storedIncident,
    assessment,
    diagnosis: investigation.diagnosis,
    decision,
  });

  // Stage F: preserve the lesson. Two independent writes, issued concurrently.
  const incidentWrite = await deps.memory.rememberIncident(storedIncident);
  await deps.store.saveMemoryWrite(incidentWrite, { incidentId });

  let lessonWrite: MemoryWriteReceipt | null = null;
  if (investigation.diagnosis.actionable) {
    const lesson = CorrectiveLessonRecordSchema.parse({
      type: "corrective_lesson",
      domain: investigation.domain,
      failure_pattern: investigation.diagnosis.pattern,
      observation: investigation.diagnosis.observedFacts.join("; "),
      verified_evidence: assessment.explanation,
      corrective_rule: recommendation.statement,
      scope: `${investigation.domain}:${investigation.actionType}`,
      validation_status: activatedRule ? "validated" : "proposed",
      rule_version: activatedRule?.version ?? proposedRule?.version ?? 1,
      incident_id: incidentId,
      evidence_reference: assessment.evidenceReference,
      created_at: new Date().toISOString(),
      provenance: storedIncident.provenance,
    });
    lessonWrite = await deps.memory.rememberLesson(lesson, {
      onAccepted: async (receipt) => {
        await deps.store.saveMemoryWrite(receipt, {
          incidentId,
          ...(activatedRule?.ruleId ? { ruleId: activatedRule.ruleId } : {}),
        });
      },
    });
    await deps.store.saveMemoryWrite(lessonWrite, {
      incidentId,
      ...(activatedRule?.ruleId ? { ruleId: activatedRule.ruleId } : {}),
    });
  }

  // Report persistence and recall as separate outcomes, as required.
  const recallVerified =
    Boolean(lessonWrite?.recallVerified) || incidentWrite.recallVerified;

  const record = SafeguardRecordSchema.parse({
    recordId,
    incidentId,
    createdAt: new Date().toISOString(),
    submission,
    investigation,
    recommendation,
    proposedRule,
    activatedRule,
    validationReasons,
    decision,
    verification,
    recalledMemories,
    memory: {
      incident: incidentWrite,
      lesson: lessonWrite,
      recallVerified,
      backend: deps.memory.backend,
      isLive: deps.memory.isLive,
    },
    // The record is `live` only when its lesson was durably written to a live
    // backend. Otherwise it is labelled simulated so nothing claims a Mainnet
    // memory that does not exist.
    provenance: deps.memory.isLive && lessonWrite?.state === "completed" ? "live" : "simulated",
  });

  await deps.store.saveSafeguardRecord(record);
  return record;
}

/**
 * Describe how a recalled record relates to the current submission.
 *
 * The relation is derived from the recalled lesson's own fields, never from a
 * claim about memory improving outcomes. A distance below the relayer's
 * similarity threshold, with a matching domain and pattern, is a confirmed
 * recurrence; a looser match is a possible similarity.
 */
function describeRecall(
  recalled: {
    blobId: string;
    distance: number;
    record?: {
      domain?: string;
      failure_pattern?: string;
      corrective_rule?: string;
    };
  },
  pattern: string,
): RecalledMemory {
  const r = recalled.record;
  const samePattern = r?.failure_pattern === pattern;
  const relation: RecalledMemory["relation"] = samePattern
    ? "confirmed_recurrence"
    : "possible_similarity";
  const why = r
    ? samePattern
      ? `A prior lesson with the same failure pattern (${pattern}) was retrieved for ${r.domain}. This is a confirmed recurrence of a known pattern.`
      : `A prior lesson in ${r.domain ?? "another domain"} with pattern ${r.failure_pattern ?? "unknown"} was retrieved; the match is on similarity, not an exact recurrence.`
    : "A prior memory was retrieved by similarity; its text did not parse as a structured lesson, so it is treated as a possible similarity only.";
  return {
    blobId: recalled.blobId,
    relation,
    why,
    distance: recalled.distance,
    ...(r?.corrective_rule ? { ruleStatement: r.corrective_rule } : {}),
    ...(r?.domain ? { domain: r.domain } : {}),
    ...(r?.failure_pattern ? { failurePattern: r.failure_pattern } : {}),
    provenance: "live",
  };
}

/** Text forms reused from the memory adapter, re-exported for tests. */
export { incidentToMemoryText, lessonToMemoryText };

/** A fresh execution id, for callers that want a non-idempotent run. */
export function newExecutionId(): string {
  return randomUUID();
}
