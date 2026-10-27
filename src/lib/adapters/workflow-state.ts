/**
 * Minimal persistent workflow-state store used by the workflow demonstration.
 *
 * This is the authoritative state for the workflow domain: whether a required
 * prerequisite step actually completed. It is a real store, not a simulation
 * flag, so a "prerequisite satisfied" answer reflects persisted state rather
 * than an in-memory assertion.
 */

export interface WorkflowStateRecord {
  workflowId: string;
  /** Prerequisite step identifiers that have genuinely completed. */
  completedPrerequisites: string[];
  /** Number of times the dependent operation has been attempted. */
  attempts: number;
  /** Number of recorded failures for the dependent operation. */
  failures: number;
  lastFailureAt?: string;
  lastFailureReason?: string;
  updatedAt: string;
}

export interface WorkflowStateStore {
  get(workflowId: string): Promise<WorkflowStateRecord | null>;
  save(record: WorkflowStateRecord): Promise<void>;
  /** Record that a prerequisite step completed for real. */
  markPrerequisiteComplete(workflowId: string, stepId: string): Promise<WorkflowStateRecord>;
  /** Record an attempt and, when it failed, the reason. */
  recordAttempt(
    workflowId: string,
    outcome: "success" | "failure",
    failureReason?: string,
  ): Promise<WorkflowStateRecord>;
  reset(workflowId: string): Promise<void>;
  /** Clear every workflow record, so a scenario run starts from a known state. */
  resetAll(): Promise<void>;
}

export function emptyWorkflowState(workflowId: string): WorkflowStateRecord {
  return {
    workflowId,
    completedPrerequisites: [],
    attempts: 0,
    failures: 0,
    updatedAt: new Date().toISOString(),
  };
}

export class InMemoryWorkflowStateStore implements WorkflowStateStore {
  private readonly records = new Map<string, WorkflowStateRecord>();

  async get(workflowId: string): Promise<WorkflowStateRecord | null> {
    return this.records.get(workflowId) ?? null;
  }

  async save(record: WorkflowStateRecord): Promise<void> {
    this.records.set(record.workflowId, record);
  }

  async markPrerequisiteComplete(
    workflowId: string,
    stepId: string,
  ): Promise<WorkflowStateRecord> {
    const current = (await this.get(workflowId)) ?? emptyWorkflowState(workflowId);
    if (!current.completedPrerequisites.includes(stepId)) {
      current.completedPrerequisites = [...current.completedPrerequisites, stepId];
    }
    current.updatedAt = new Date().toISOString();
    await this.save(current);
    return current;
  }

  async recordAttempt(
    workflowId: string,
    outcome: "success" | "failure",
    failureReason?: string,
  ): Promise<WorkflowStateRecord> {
    const current = (await this.get(workflowId)) ?? emptyWorkflowState(workflowId);
    current.attempts += 1;
    if (outcome === "failure") {
      current.failures += 1;
      current.lastFailureAt = new Date().toISOString();
      current.lastFailureReason = failureReason;
    }
    current.updatedAt = new Date().toISOString();
    await this.save(current);
    return current;
  }

  async reset(workflowId: string): Promise<void> {
    this.records.delete(workflowId);
  }

  async resetAll(): Promise<void> {
    this.records.clear();
  }
}
