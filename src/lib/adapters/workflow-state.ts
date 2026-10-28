/**
 * Minimal persistent workflow-state store used by the workflow demonstration.
 *
 * This is the authoritative state for the workflow domain: whether a required
 * prerequisite step actually completed. It is a real store, not a simulation
 * flag, so a "prerequisite satisfied" answer reflects persisted state rather
 * than an in-memory assertion.
 */

import type { Db } from "@/lib/db/sql";

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

/**
 * Durable workflow state backed by the shared database.
 *
 * The workflow demonstration depends on prerequisite state that must be visible
 * to whichever request next advances the job. An in-process store cannot do
 * that: on a serverless host the next batch may run in a different instance.
 * This store keeps the same authoritative meaning — it records what genuinely
 * completed — but persists it so the demonstration is resumable.
 */
export class DbWorkflowStateStore implements WorkflowStateStore {
  constructor(private readonly db: Db) {}

  async migrate(): Promise<void> {
    await this.db.lockMigration(async () => {
      await this.db.query(`
      CREATE TABLE IF NOT EXISTS workflow_state (
        workflow_id TEXT PRIMARY KEY,
        completed_prerequisites TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        failures INTEGER NOT NULL DEFAULT 0,
        last_failure_at TEXT,
        last_failure_reason TEXT,
        updated_at TEXT NOT NULL
      )`);
    });
  }

  async get(workflowId: string): Promise<WorkflowStateRecord | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM workflow_state WHERE workflow_id = $1`,
      [workflowId],
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      workflowId: r.workflow_id as string,
      completedPrerequisites: JSON.parse(r.completed_prerequisites as string),
      attempts: Number(r.attempts),
      failures: Number(r.failures),
      lastFailureAt: (r.last_failure_at as string) ?? undefined,
      lastFailureReason: (r.last_failure_reason as string) ?? undefined,
      updatedAt: r.updated_at as string,
    };
  }

  async save(record: WorkflowStateRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO workflow_state
         (workflow_id, completed_prerequisites, attempts, failures, last_failure_at, last_failure_reason, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (workflow_id) DO UPDATE SET
         completed_prerequisites = EXCLUDED.completed_prerequisites,
         attempts = EXCLUDED.attempts,
         failures = EXCLUDED.failures,
         last_failure_at = EXCLUDED.last_failure_at,
         last_failure_reason = EXCLUDED.last_failure_reason,
         updated_at = EXCLUDED.updated_at`,
      [
        record.workflowId,
        JSON.stringify(record.completedPrerequisites),
        record.attempts,
        record.failures,
        record.lastFailureAt ?? null,
        record.lastFailureReason ?? null,
        record.updatedAt,
      ],
    );
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
    await this.db.query(`DELETE FROM workflow_state WHERE workflow_id = $1`, [workflowId]);
  }

  async resetAll(): Promise<void> {
    await this.db.query(`DELETE FROM workflow_state`);
  }
}
