import { EvidenceAssessmentSchema, type EvidenceAssessment } from "@/lib/schemas";
import type { EvidenceAdapter } from "@/lib/adapters/evidence";
import type { WorkflowStateStore } from "@/lib/adapters/workflow-state";

export interface WorkflowDefinition {
  workflowId: string;
  /** Prerequisite steps that must have completed before the operation may run. */
  requiredPrerequisites: Array<{ id: string; description: string }>;
  /** The dependent operation this workflow guards. */
  operation: string;
}

export interface WorkflowAdapterConfig {
  definition: WorkflowDefinition;
  store: WorkflowStateStore;
}

/**
 * Workflow-domain evidence adapter.
 *
 * The authoritative evidence is persisted application state: which prerequisite
 * steps genuinely completed and whether the dependent operation has previously
 * failed. A prior failure with an unmet prerequisite is the classic "repeated
 * failed operation" pattern this domain exists to prevent.
 */
export class WorkflowEvidenceAdapter implements EvidenceAdapter {
  readonly domain = "workflow" as const;
  readonly sourceName = "persisted workflow state store";

  constructor(private readonly config: WorkflowAdapterConfig) {}

  async verifyEvidence(): Promise<EvidenceAssessment> {
    const observedAt = new Date().toISOString();
    const { definition, store } = this.config;
    const reference = `workflow:${definition.workflowId}`;

    const state = await store.get(definition.workflowId);

    if (!state) {
      return EvidenceAssessmentSchema.parse({
        status: "UNKNOWN",
        verified: false,
        evidenceType: "workflow_state",
        evidenceReference: reference,
        observedAt,
        explanation:
          "No persisted state exists for this workflow, so prerequisite " +
          "satisfaction cannot be established.",
        failureReason: "workflow state missing",
        raw: { requiredPrerequisites: definition.requiredPrerequisites.map((p) => p.id) },
      });
    }

    const missing = definition.requiredPrerequisites
      .map((p) => p.id)
      .filter((id) => !state.completedPrerequisites.includes(id));

    const raw = {
      completedPrerequisites: state.completedPrerequisites,
      requiredPrerequisites: definition.requiredPrerequisites.map((p) => p.id),
      missingPrerequisites: missing,
      attempts: state.attempts,
      failures: state.failures,
      lastFailureAt: state.lastFailureAt ?? null,
      lastFailureReason: state.lastFailureReason ?? null,
    };

    // A prior failure with an unmet prerequisite is a verified failure of the
    // prerequisite condition. It is not a guess: the state store records it.
    if (missing.length > 0 && state.failures > 0) {
      return EvidenceAssessmentSchema.parse({
        status: "VERIFIED_FAILURE",
        verified: true,
        evidenceType: "workflow_state",
        evidenceReference: reference,
        observedAt,
        explanation:
          `The operation previously failed ${state.failures} time(s) and the ` +
          `prerequisite step(s) ${missing.join(", ")} have never completed.`,
        failureReason: `missing prerequisite(s): ${missing.join(", ")}`,
        raw,
      });
    }

    if (missing.length > 0) {
      return EvidenceAssessmentSchema.parse({
        status: "VERIFIED_FAILURE",
        verified: true,
        evidenceType: "workflow_state",
        evidenceReference: reference,
        observedAt,
        explanation:
          `Required prerequisite step(s) ${missing.join(", ")} have not completed.`,
        failureReason: `missing prerequisite(s): ${missing.join(", ")}`,
        raw,
      });
    }

    return EvidenceAssessmentSchema.parse({
      status: "VERIFIED_SUCCESS",
      verified: true,
      evidenceType: "workflow_state",
      evidenceReference: reference,
      observedAt,
      explanation:
        "All required prerequisite steps are recorded as completed in the " +
        "persisted state store.",
      raw,
    });
  }
}
