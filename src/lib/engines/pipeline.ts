import { randomUUID } from "node:crypto";
import {
  CorrectiveLessonRecordSchema,
  IncidentSchema,
  IncidentInputSchema,
  type Diagnosis,
  type EvidenceAssessment,
  type Incident,
  type IncidentInputDraft,
  type SafeguardDecision,
  type SafeguardRule,
} from "@/lib/schemas";
import type { EvidenceAdapter } from "@/lib/adapters/evidence";
import type { MemoryAdapter, MemoryWriteReceipt } from "@/lib/adapters/memory";
import { diagnose } from "@/lib/engines/diagnosis";
import {
  proposeRule,
  selectApplicableRules,
  validateRule,
} from "@/lib/engines/rule-engine";
import { decide, policyVersionFor, type Precondition } from "@/lib/engines/decision-engine";
import type { AuditStore } from "@/lib/db/audit-store";

export interface PipelineDeps {
  evidence: EvidenceAdapter;
  memory: MemoryAdapter;
  store: AuditStore;
}

export interface ProcessResult {
  incident: Incident;
  assessment: EvidenceAssessment;
  diagnosis: Diagnosis;
  decision: SafeguardDecision;
  proposedRule: SafeguardRule | null;
  activatedRule: SafeguardRule | null;
  validationReasons: string[];
  incidentWrite: MemoryWriteReceipt | null;
  lessonWrite: MemoryWriteReceipt | null;
  recalledLessons: number;
  /** Memories recalled for this action, for the UI's recall panel. */
  recalledIds: string[];
}

/**
 * End-to-end incident pipeline:
 *   intake -> evidence -> diagnosis -> rule proposal/validation -> memory -> decision.
 *
 * The decision is computed from *current* evidence and the *active* rule set.
 * Recalled memories inform the decision record but never override evidence.
 */
export class IncidentPipeline {
  constructor(private readonly deps: PipelineDeps) {}

  async process(
    input: IncidentInputDraft,
    options: {
      preconditions?: Precondition[];
      mode?: "claim" | "preflight";
      persistIncidentMemory?: boolean;
      /**
       * Set false to evaluate a decision without writing a lesson. Used by the
       * read-only recall demonstration, which must not add new Mainnet records
       * on every run.
       */
      persistLessonMemory?: boolean;
    } = {},
  ): Promise<ProcessResult> {
    const validated = IncidentInputSchema.parse(input);
    const incident = IncidentSchema.parse({
      ...validated,
      incidentId: randomUUID(),
      createdAt: new Date().toISOString(),
      currentStatus: "open",
    });

    // 1. Authoritative evidence.
    const assessment = await this.deps.evidence.verifyEvidence(incident);

    // 2. Deterministic diagnosis (a hypothesis).
    const diagnosis = diagnose(incident, assessment);

    // 3. Recall relevant prior lessons. Memory informs, evidence governs.
    const recallQuery = `${incident.domain} ${incident.actionType} ${diagnosis.pattern}`;
    const recalled = await this.deps.memory.recallRelevantLessons(recallQuery, {
      limit: 5,
    });

    // 3b. Snapshot the rule set as it stands *before* this incident can
    //     activate a new rule. A lesson learned from an incident governs
    //     subsequent actions, never retroactively the incident that produced it.
    const priorActiveRules = await this.deps.store.listActiveRules();

    // 4. Rule proposal + validation against the current evidence.
    const proposedRule = proposeRule(incident, diagnosis, assessment);
    let activatedRule: SafeguardRule | null = null;
    let validationReasons: string[] = [];
    if (proposedRule) {
      const outcome = validateRule(proposedRule, diagnosis, {
        supportingIncidents: [incident],
        assessments: { [incident.incidentId]: assessment },
        policyVersion: "aftermath-policy-1.0",
      });
      validationReasons = outcome.reasons;
      activatedRule = outcome.rule ?? null;
      if (activatedRule) await this.deps.store.saveRule(activatedRule);
      else await this.deps.store.saveRule(proposedRule);
    }

    // 5. Decision from current evidence + the pre-existing active rule set.
    const applicable = selectApplicableRules(priorActiveRules, {
      domain: incident.domain,
      actionType: incident.actionType,
    });
    const decision = decide({
      domain: incident.domain,
      actionType: incident.actionType,
      mode: options.mode ?? "claim",
      assertedSuccess: incident.claimedOutcome?.assertedStatus === "success",
      assessment,
      applicableRules: applicable,
      recalledLessons: recalled,
      preconditions: options.preconditions ?? [],
      policyVersion: policyVersionFor(priorActiveRules),
    });

    const finalStatus = statusFromDecision(decision, diagnosis);
    const storedIncident: Incident = { ...incident, currentStatus: finalStatus };

    await this.deps.store.saveIncident({
      incident: storedIncident,
      assessment,
      diagnosis,
      decision,
    });

    // 6. Persist to the memory backend.
    let incidentWrite: MemoryWriteReceipt | null = null;
    let lessonWrite: MemoryWriteReceipt | null = null;

    if (options.persistIncidentMemory !== false) {
      incidentWrite = await this.deps.memory.rememberIncident(storedIncident);
      await this.deps.store.saveMemoryWrite(incidentWrite, {
        incidentId: storedIncident.incidentId,
      });
    }

    if (diagnosis.actionable && options.persistLessonMemory !== false) {
      // A lesson is persisted even when the rule could not be activated. The
      // brief requires lessons to be storable before they become enforceable
      // rules, so `validation_status` records which of the two this is.
      const lesson = CorrectiveLessonRecordSchema.parse({
        type: "corrective_lesson",
        domain: incident.domain,
        failure_pattern: diagnosis.pattern,
        observation: diagnosis.observedFacts.join("; "),
        verified_evidence: assessment.explanation,
        corrective_rule:
          activatedRule?.statement ??
          proposedRule?.statement ??
          diagnosis.ruleSketch?.statement ??
          "Require authoritative evidence before reporting the outcome.",
        scope: `${incident.domain}:${incident.actionType}`,
        validation_status: activatedRule ? "validated" : "proposed",
        rule_version: activatedRule?.version ?? proposedRule?.version ?? 1,
        incident_id: storedIncident.incidentId,
        evidence_reference: assessment.evidenceReference,
        created_at: new Date().toISOString(),
        provenance: incident.provenance,
      });
      lessonWrite = await this.deps.memory.rememberLesson(lesson);
      await this.deps.store.saveMemoryWrite(lessonWrite, {
        incidentId: storedIncident.incidentId,
        ruleId: activatedRule?.ruleId ?? proposedRule?.ruleId,
      });
    }

    return {
      incident: storedIncident,
      assessment,
      diagnosis,
      decision,
      proposedRule,
      activatedRule,
      validationReasons,
      incidentWrite,
      lessonWrite,
      recalledLessons: recalled.length,
      recalledIds: recalled.map((r) => r.blobId),
    };
  }

  /**
   * Preflight: may an attempted action run at all? Used by the workflow
   * demonstration to decide *before* an operation is attempted.
   */
  async preflight(
    input: IncidentInputDraft,
    preconditions: Precondition[],
  ): Promise<ProcessResult> {
    return this.process(input, {
      preconditions,
      mode: "preflight",
      persistIncidentMemory: true,
    });
  }
}

function statusFromDecision(
  decision: SafeguardDecision,
  diagnosis: Diagnosis,
): Incident["currentStatus"] {
  if (decision.decision === "BLOCK") return "unresolved";
  if (decision.decision === "UNKNOWN") return "unresolved";
  if (decision.decision === "REQUIRE_VERIFICATION") return "diagnosed";
  if (diagnosis.actionable) return "safeguarded";
  return "resolved";
}
