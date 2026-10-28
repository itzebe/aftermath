import type { Db } from "@/lib/db/sql";
import type { ScenarioRunReport } from "@/lib/demos/types";

/**
 * Durable tracking for a resumable demonstration.
 *
 * A single long-running request cannot finish every scenario inside a serverless
 * function's time limit, so the work is split into bounded batches. That only
 * works if progress survives between requests — which means the job, its
 * per-scenario state, and the lease that serialises workers all live in the
 * shared database, not in process memory.
 *
 * Two tables:
 *   demo_jobs           — one row per demonstration, with a worker lease.
 *   demo_job_scenarios  — one row per scenario, atomically claimed.
 */

export type DemoJobStatus = "running" | "completed" | "failed" | "stopped";
export type ScenarioState = "pending" | "executing" | "completed" | "failed";

export interface DemoJob {
  jobId: string;
  status: DemoJobStatus;
  total: number;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  /** Identity of the worker currently holding the job lease, or null. */
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  lastError: string | null;
  /** Durable cross-step state (e.g. discovered finance cases). */
  scratch: Record<string, unknown>;
}

export interface DemoScenarioRow {
  jobId: string;
  stepId: string;
  ordinal: number;
  domain: string;
  title: string;
  simulated: boolean;
  internal: boolean;
  state: ScenarioState;
  attempts: number;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  /** The completed report, once the scenario reaches its terminal state. */
  report: ScenarioRunReport | null;
  /** Durable write ids produced by this scenario, for reconciliation. */
  writeIds: string[];
  lastError: string | null;
  updatedAt: string;
}

/** A scenario as it is persisted when the job is created. */
export interface PlanStep {
  stepId: string;
  ordinal: number;
  domain: string;
  title: string;
  simulated: boolean;
  /** Setup steps are tracked durably but excluded from scenario reporting. */
  internal?: boolean;
}

export interface ClaimedScenario {
  job: DemoJob;
  scenario: DemoScenarioRow;
}

export interface DemoJobStore {
  readonly backend: "sqlite" | "postgres";
  migrate(): Promise<void>;

  createJob(jobId: string, steps: PlanStep[]): Promise<DemoJob>;
  /**
   * Add scenarios to an existing job. Used once, after the finance cases are
   * discovered, to append the live-case steps to the plan.
   */
  addScenarios(jobId: string, steps: PlanStep[]): Promise<void>;
  getJob(jobId: string): Promise<DemoJob | null>;
  latestJob(): Promise<DemoJob | null>;
  listScenarios(jobId: string): Promise<DemoScenarioRow[]>;
  setScratch(jobId: string, scratch: Record<string, unknown>): Promise<void>;

  /**
   * Acquire the job lease so only one worker advances this job at a time.
   * Returns the job when acquired (or already held by this owner); returns
   * null when another live worker holds it.
   */
  acquireJobLease(jobId: string, owner: string, leaseMs: number): Promise<DemoJob | null>;
  releaseJobLease(jobId: string, owner: string): Promise<void>;

  /** Extend a held lease; false if this worker no longer owns the job. */
  renewJobLease(jobId: string, owner: string, leaseMs: number): Promise<boolean>;

  /**
   * Atomically claim the next pending scenario (lowest ordinal). Reclaims
   * scenarios whose executing lease has expired, so a worker that died
   * mid-scenario does not strand the job. Returns null when nothing is
   * claimable.
   */
  claimNextScenario(jobId: string, owner: string, leaseMs: number): Promise<ClaimedScenario | null>;

  completeScenario(
    jobId: string,
    stepId: string,
    report: ScenarioRunReport,
    writeIds: string[],
  ): Promise<void>;
  failScenario(jobId: string, stepId: string, error: string): Promise<void>;
  addScenarioWriteId(jobId: string, stepId: string, writeId: string): Promise<void>;

  finishJob(jobId: string, status: DemoJobStatus, lastError?: string | null): Promise<void>;

  /** Per-state scenario counts for a job (all scenarios, incl. internal). */
  countScenarios(jobId: string): Promise<Record<ScenarioState, number>>;

  reset(): Promise<void>;
}

function parseJob(row: Record<string, unknown>): DemoJob {
  return {
    jobId: row.job_id as string,
    status: row.status as DemoJobStatus,
    total: Number(row.total),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    finishedAt: (row.finished_at as string) ?? null,
    leaseOwner: (row.lease_owner as string) ?? null,
    leaseExpiresAt: (row.lease_expires_at as string) ?? null,
    lastError: (row.last_error as string) ?? null,
    scratch: typeof row.scratch === "string" ? JSON.parse(row.scratch) : ((row.scratch as Record<string, unknown>) ?? {}),
  };
}

function parseScenario(row: Record<string, unknown>): DemoScenarioRow {
  const report = row.report;
  const writeIds = row.write_ids;
  return {
    jobId: row.job_id as string,
    stepId: row.step_id as string,
    ordinal: Number(row.ordinal),
    domain: row.domain as string,
    title: row.title as string,
    simulated: row.simulated === true || row.simulated === 1,
    internal: row.internal === true || row.internal === 1,
    state: row.state as ScenarioState,
    attempts: Number(row.attempts),
    leaseOwner: (row.lease_owner as string) ?? null,
    leaseExpiresAt: (row.lease_expires_at as string) ?? null,
    report:
      report == null
        ? null
        : typeof report === "string"
          ? (JSON.parse(report) as ScenarioRunReport)
          : (report as ScenarioRunReport),
    writeIds: writeIds == null ? [] : typeof writeIds === "string" ? JSON.parse(writeIds) : (writeIds as string[]),
    lastError: (row.last_error as string) ?? null,
    updatedAt: row.updated_at as string,
  };
}

/**
 * One implementation over the shared `Db` abstraction.
 *
 * Every concurrency-sensitive step is a single atomic UPDATE ... WHERE that
 * flips a row's state only if it is still in the expected state. That is what
 * makes two concurrent requests unable to claim the same scenario: the second
 * UPDATE matches zero rows.
 */
export class SqlDemoJobStore implements DemoJobStore {
  constructor(
    private readonly db: Db,
    readonly backend: "sqlite" | "postgres",
  ) {}

  async migrate(): Promise<void> {
    await this.db.lockMigration(async () => {
      await this.db.query(`
      CREATE TABLE IF NOT EXISTS demo_jobs (
        job_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        total INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finished_at TEXT,
        lease_owner TEXT,
        lease_expires_at TEXT,
        last_error TEXT,
        scratch TEXT NOT NULL DEFAULT '{}'
      )`);
      await this.db.query(`
      CREATE TABLE IF NOT EXISTS demo_job_scenarios (
        job_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        domain TEXT NOT NULL,
        title TEXT NOT NULL,
        simulated BOOLEAN NOT NULL DEFAULT FALSE,
        internal BOOLEAN NOT NULL DEFAULT FALSE,
        state TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        lease_owner TEXT,
        lease_expires_at TEXT,
        report TEXT,
        write_ids TEXT NOT NULL DEFAULT '[]',
        last_error TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (job_id, step_id)
      )`);
      await this.db.query(
        `CREATE INDEX IF NOT EXISTS idx_demo_scenarios_job_state ON demo_job_scenarios(job_id, state, ordinal)`,
      );
      // Defensive, idempotent column add for a table created by an earlier
      // version of this migration. Both SQLite and Postgres raise a "duplicate
      // column" error when it already exists, which is the expected steady state
      // and is ignored. Non-destructive: it only ever adds a column with a
      // default.
      try {
        await this.db.query(
          `ALTER TABLE demo_job_scenarios ADD COLUMN internal BOOLEAN NOT NULL DEFAULT FALSE`,
        );
      } catch {
        // column already present
      }
    });
  }

  async createJob(jobId: string, steps: PlanStep[]): Promise<DemoJob> {
    const now = new Date().toISOString();
    await this.db.query(
      `INSERT INTO demo_jobs (job_id, status, total, created_at, updated_at, scratch)
       VALUES ($1, 'running', $2, $3, $3, '{}')
       ON CONFLICT (job_id) DO NOTHING`,
      [jobId, steps.length, now],
    );
    for (const s of steps) {
      await this.db.query(
        `INSERT INTO demo_job_scenarios
           (job_id, step_id, ordinal, domain, title, simulated, internal, state, attempts, write_ids, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', 0, '[]', $8)
         ON CONFLICT (job_id, step_id) DO NOTHING`,
        [jobId, s.stepId, s.ordinal, s.domain, s.title, s.simulated, s.internal ?? false, now],
      );
    }
    return (await this.getJob(jobId))!;
  }

  async getJob(jobId: string): Promise<DemoJob | null> {
    const { rows } = await this.db.query(`SELECT * FROM demo_jobs WHERE job_id = $1`, [jobId]);
    return rows.length ? parseJob(rows[0]) : null;
  }

  async addScenarios(jobId: string, steps: PlanStep[]): Promise<void> {
    const now = new Date().toISOString();
    for (const s of steps) {
      await this.db.query(
        `INSERT INTO demo_job_scenarios
           (job_id, step_id, ordinal, domain, title, simulated, internal, state, attempts, write_ids, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', 0, '[]', $8)
         ON CONFLICT (job_id, step_id) DO NOTHING`,
        [jobId, s.stepId, s.ordinal, s.domain, s.title, s.simulated, s.internal ?? false, now],
      );
    }
    // Keep the total in step with the number of scenario rows, so the UI's
    // "remaining" figure is derived from reality rather than the initial plan.
    await this.db.query(
      `UPDATE demo_jobs
         SET total = (SELECT COUNT(*) FROM demo_job_scenarios WHERE job_id = $1), updated_at = $2
       WHERE job_id = $1`,
      [jobId, now],
    );
  }

  async latestJob(): Promise<DemoJob | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM demo_jobs ORDER BY created_at DESC LIMIT 1`,
    );
    return rows.length ? parseJob(rows[0]) : null;
  }

  async listScenarios(jobId: string): Promise<DemoScenarioRow[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM demo_job_scenarios WHERE job_id = $1 ORDER BY ordinal ASC`,
      [jobId],
    );
    return rows.map(parseScenario);
  }

  async setScratch(jobId: string, scratch: Record<string, unknown>): Promise<void> {
    await this.db.query(`UPDATE demo_jobs SET scratch = $1, updated_at = $2 WHERE job_id = $3`, [
      JSON.stringify(scratch),
      new Date().toISOString(),
      jobId,
    ]);
  }

  async acquireJobLease(jobId: string, owner: string, leaseMs: number): Promise<DemoJob | null> {
    const now = new Date();
    const nowIso = now.toISOString();
    const exp = new Date(now.getTime() + leaseMs).toISOString();
    // Claimable when the job is not finished, and the lease is free, expired,
    // or already ours. A finished ('completed') job is never re-opened here.
    const { rows } = await this.db.query(
      `UPDATE demo_jobs
         SET lease_owner = $1, lease_expires_at = $2, status = 'running', updated_at = $3
       WHERE job_id = $4
         AND status <> 'completed'
         AND (lease_owner IS NULL OR lease_owner = $1 OR lease_expires_at IS NULL OR lease_expires_at < $3)
       RETURNING *`,
      [owner, exp, nowIso, jobId],
    );
    return rows.length ? parseJob(rows[0]) : null;
  }

  async releaseJobLease(jobId: string, owner: string): Promise<void> {
    await this.db.query(
      `UPDATE demo_jobs SET lease_owner = NULL, lease_expires_at = NULL, updated_at = $1
       WHERE job_id = $2 AND lease_owner = $3`,
      [new Date().toISOString(), jobId, owner],
    );
  }

  /**
   * Extend a held lease. A scenario performs two Mainnet writes, each of which
   * can take ~30s and is not interruptible, so a batch can outrun a lease sized
   * for the request budget. Renewing between scenarios keeps a live worker's
   * claim from expiring mid-batch, which would let a second worker start the
   * same job and double-write.
   */
  async renewJobLease(
    jobId: string,
    owner: string,
    leaseMs: number,
  ): Promise<boolean> {
    const result = await this.db.query<{ job_id: string }>(
      `UPDATE demo_jobs SET lease_expires_at = $1, updated_at = $2
       WHERE job_id = $3 AND lease_owner = $4
       RETURNING job_id`,
      [new Date(Date.now() + leaseMs).toISOString(), new Date().toISOString(), jobId, owner],
    );
    return result.rows.length > 0;
  }

  async claimNextScenario(
    jobId: string,
    owner: string,
    leaseMs: number,
  ): Promise<ClaimedScenario | null> {
    const now = new Date();
    const nowIso = now.toISOString();
    const exp = new Date(now.getTime() + leaseMs).toISOString();

    // 1. Return any scenario whose executing lease has expired to `pending`, so
    //    a worker that died mid-scenario does not strand it. A scenario whose
    //    write landed but whose report was never persisted is safe to re-run:
    //    its writes carry deterministic ids and content keys, and the runner
    //    reconciles the recorded job ids first.
    await this.db.query(
      `UPDATE demo_job_scenarios
         SET state = 'pending', lease_owner = NULL, lease_expires_at = NULL, updated_at = $1
       WHERE job_id = $2 AND state = 'executing'
         AND lease_expires_at IS NOT NULL AND lease_expires_at < $1`,
      [nowIso, jobId],
    );

    // 2. Atomically claim the lowest-ordinal pending scenario. The sub-select is
    //    evaluated inside the same statement, and the outer UPDATE only flips a
    //    row that is still `pending`, so a concurrent claimer matches zero rows.
    const { rows } = await this.db.query(
      `UPDATE demo_job_scenarios
         SET state = 'executing', lease_owner = $1, lease_expires_at = $2,
             attempts = attempts + 1, updated_at = $3
       WHERE job_id = $4
         AND step_id = (
           SELECT step_id FROM demo_job_scenarios
           WHERE job_id = $4 AND state = 'pending'
           ORDER BY ordinal ASC LIMIT 1
         )
         AND state = 'pending'
       RETURNING *`,
      [owner, exp, nowIso, jobId],
    );
    if (!rows.length) return null;
    const job = await this.getJob(jobId);
    if (!job) return null;
    return { job, scenario: parseScenario(rows[0]) };
  }

  async completeScenario(
    jobId: string,
    stepId: string,
    report: ScenarioRunReport,
    writeIds: string[],
  ): Promise<void> {
    await this.db.query(
      `UPDATE demo_job_scenarios
         SET state = 'completed', report = $1, write_ids = $2,
             lease_owner = NULL, lease_expires_at = NULL, last_error = NULL, updated_at = $3
       WHERE job_id = $4 AND step_id = $5`,
      [JSON.stringify(report), JSON.stringify(writeIds), new Date().toISOString(), jobId, stepId],
    );
  }

  async failScenario(jobId: string, stepId: string, error: string): Promise<void> {
    await this.db.query(
      `UPDATE demo_job_scenarios
         SET state = 'failed', last_error = $1,
             lease_owner = NULL, lease_expires_at = NULL, updated_at = $2
       WHERE job_id = $3 AND step_id = $4`,
      [error, new Date().toISOString(), jobId, stepId],
    );
  }

  async addScenarioWriteId(jobId: string, stepId: string, writeId: string): Promise<void> {
    const { rows } = await this.db.query(
      `SELECT write_ids FROM demo_job_scenarios WHERE job_id = $1 AND step_id = $2`,
      [jobId, stepId],
    );
    const current: string[] = rows.length
      ? typeof rows[0].write_ids === "string"
        ? JSON.parse(rows[0].write_ids as string)
        : ((rows[0].write_ids as string[]) ?? [])
      : [];
    if (current.includes(writeId)) return;
    const next = [...current, writeId];
    await this.db.query(
      `UPDATE demo_job_scenarios SET write_ids = $1, updated_at = $2 WHERE job_id = $3 AND step_id = $4`,
      [JSON.stringify(next), new Date().toISOString(), jobId, stepId],
    );
  }

  async finishJob(jobId: string, status: DemoJobStatus, lastError?: string | null): Promise<void> {
    const now = new Date().toISOString();
    await this.db.query(
      `UPDATE demo_jobs
         SET status = $1, finished_at = $2, updated_at = $2, last_error = $3,
             lease_owner = NULL, lease_expires_at = NULL
       WHERE job_id = $4`,
      [status, now, lastError ?? null, jobId],
    );
  }

  async countScenarios(jobId: string): Promise<Record<ScenarioState, number>> {
    const { rows } = await this.db.query(
      `SELECT state, COUNT(*) AS n FROM demo_job_scenarios WHERE job_id = $1 GROUP BY state`,
      [jobId],
    );
    const counts: Record<ScenarioState, number> = {
      pending: 0,
      executing: 0,
      completed: 0,
      failed: 0,
    };
    for (const r of rows) {
      const s = r.state as ScenarioState;
      if (s in counts) counts[s] = Number(r.n);
    }
    return counts;
  }

  async reset(): Promise<void> {
    await this.db.query(`DELETE FROM demo_job_scenarios; DELETE FROM demo_jobs;`);
  }
}