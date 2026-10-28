import { Pool, type PoolConfig } from "pg";
import { MIGRATION_LOCK_KEY } from "@/lib/db/sql";
import type {
  AuditCounts,
  AuditStore,
  IncidentRecord,
  ScenarioRunRow,
} from "@/lib/db/audit-store";
import { computeCounts } from "@/lib/db/audit-store";
import type { MemoryWriteReceipt } from "@/lib/adapters/memory";
import type { SafeguardDecision, SafeguardRule } from "@/lib/schemas";

/**
 * PostgreSQL-backed audit index — the durable, cross-instance store.
 *
 * On a serverless host each request may run in a different instance with its
 * own filesystem, so a file-backed index cannot be shared between requests.
 * A network database can: a record committed here is visible to every instance.
 *
 * Connection and query failures propagate as thrown errors on purpose. The
 * caller must never treat an unreachable database as a successful write, and
 * this store never silently degrades to memory or a temp file.
 */
export class PostgresAuditStore implements AuditStore {
  readonly backend = "postgres" as const;
  readonly durable = true;
  readonly detail: string;
  private readonly pool: Pool;
  private readonly ownsPool: boolean;
  private ready: Promise<void> | null = null;

  constructor(
    connectionString: string,
    options: { ssl?: PoolConfig["ssl"]; pool?: Pool } = {},
  ) {
    // Strip credentials from the host we report, so the detail string is safe
    // to surface in an API response.
    this.detail = `PostgreSQL at ${safeHost(connectionString)}`;
    this.ownsPool = !options.pool;
    this.pool =
      options.pool ??
      new Pool({
        connectionString,
        ssl: options.ssl,
        max: 3,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 10_000,
      });
    // A pool-level error (e.g. the backend dropping an idle connection) must
    // not crash the process as an unhandled 'error' event.
    this.pool.on("error", () => {});
  }

  /** The shared connection pool, so other durable stores can reuse it. */
  getPool(): Pool {
    return this.pool;
  }

  /** Run the idempotent migration once per process. */
  private ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = this.migrate().catch((err) => {
        // Do not cache a failed migration: a later request must be able to
        // retry once the database is reachable again.
        this.ready = null;
        throw err;
      });
    }
    return this.ready;
  }

  private async migrate(): Promise<void> {
    // Hold a cross-instance advisory lock while creating the tables. Without
    // it, two instances starting together both pass the `IF NOT EXISTS` check
    // and collide on the catalog's unique index. A dedicated client is checked
    // out so the lock and the DDL share one session.
    const client = await this.pool.connect();
    try {
      await client.query(`SELECT pg_advisory_lock($1)`, [MIGRATION_LOCK_KEY]);
      await client.query(`
      CREATE TABLE IF NOT EXISTS incidents (
        incident_id TEXT PRIMARY KEY,
        domain TEXT NOT NULL,
        action_type TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        status TEXT NOT NULL,
        provenance TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload JSONB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rules (
        rule_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        domain TEXT NOT NULL,
        failure_pattern TEXT NOT NULL,
        validation_status TEXT NOT NULL,
        provenance TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload JSONB NOT NULL,
        PRIMARY KEY (rule_id, version)
      );
      CREATE TABLE IF NOT EXISTS decisions (
        id BIGSERIAL PRIMARY KEY,
        incident_id TEXT NOT NULL,
        decision TEXT NOT NULL,
        policy_version TEXT NOT NULL,
        decided_at TEXT NOT NULL,
        payload JSONB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_writes (
        write_id TEXT PRIMARY KEY,
        incident_id TEXT,
        rule_id TEXT,
        kind TEXT NOT NULL,
        state TEXT NOT NULL,
        backend TEXT NOT NULL,
        provenance TEXT NOT NULL,
        blob_id TEXT,
        recall_verified BOOLEAN NOT NULL DEFAULT FALSE,
        requested_at TEXT NOT NULL,
        payload JSONB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS scenario_runs (
        run_id TEXT PRIMARY KEY,
        ran_at TEXT NOT NULL,
        payload JSONB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_incidents_domain ON incidents(domain);
      CREATE INDEX IF NOT EXISTS idx_writes_backend ON memory_writes(backend, state);
    `);
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1)`, [MIGRATION_LOCK_KEY]);
      client.release();
    }
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      await this.pool.query("SELECT 1");
      return { ok: true, detail: this.detail };
    } catch (err) {
      return { ok: false, detail: `${this.detail} — ${(err as Error).message}` };
    }
  }

  async saveScenarioRun(runId: string, ranAt: string, payload: unknown): Promise<void> {
    await this.ensureReady();
    await this.pool.query(
      `INSERT INTO scenario_runs (run_id, ran_at, payload) VALUES ($1, $2, $3)
       ON CONFLICT (run_id) DO UPDATE SET payload = EXCLUDED.payload`,
      [runId, ranAt, JSON.stringify(payload)],
    );
  }

  async listScenarioRuns(limit = 20): Promise<ScenarioRunRow[]> {
    await this.ensureReady();
    const { rows } = await this.pool.query(
      `SELECT run_id, ran_at, payload FROM scenario_runs ORDER BY ran_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({ runId: r.run_id, ranAt: r.ran_at, payload: r.payload }));
  }

  async saveIncident(record: IncidentRecord): Promise<void> {
    await this.ensureReady();
    const { incident, decision } = record;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO incidents
          (incident_id, domain, action_type, execution_id, status, provenance, created_at, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (incident_id) DO UPDATE SET status = EXCLUDED.status, payload = EXCLUDED.payload`,
        [
          incident.incidentId,
          incident.domain,
          incident.actionType,
          incident.executionId,
          incident.currentStatus,
          incident.provenance,
          incident.createdAt,
          JSON.stringify(record),
        ],
      );
      await client.query(
        `INSERT INTO decisions (incident_id, decision, policy_version, decided_at, payload)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          incident.incidentId,
          decision.decision,
          decision.policyVersion,
          decision.decidedAt,
          JSON.stringify(decision),
        ],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async updateIncidentStatus(incidentId: string, status: string): Promise<void> {
    await this.ensureReady();
    await this.pool.query(
      `UPDATE incidents SET status = $1 WHERE incident_id = $2`,
      [status, incidentId],
    );
  }

  async saveRule(rule: SafeguardRule): Promise<void> {
    await this.ensureReady();
    await this.pool.query(
      `INSERT INTO rules
        (rule_id, version, domain, failure_pattern, validation_status, provenance, updated_at, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (rule_id, version) DO UPDATE SET
         validation_status = EXCLUDED.validation_status, payload = EXCLUDED.payload`,
      [
        rule.ruleId,
        rule.version,
        rule.domain,
        rule.failurePattern,
        rule.validationStatus,
        rule.provenance,
        rule.updatedAt,
        JSON.stringify(rule),
      ],
    );
  }

  async saveMemoryWrite(
    receipt: MemoryWriteReceipt,
    refs: { incidentId?: string; ruleId?: string } = {},
  ): Promise<void> {
    await this.ensureReady();
    await this.pool.query(
      `INSERT INTO memory_writes
        (write_id, incident_id, rule_id, kind, state, backend, provenance, blob_id, recall_verified, requested_at, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (write_id) DO UPDATE SET
         state = EXCLUDED.state,
         blob_id = EXCLUDED.blob_id,
         recall_verified = EXCLUDED.recall_verified,
         payload = EXCLUDED.payload`,
      [
        receipt.writeId,
        refs.incidentId ?? null,
        refs.ruleId ?? null,
        receipt.kind,
        receipt.state,
        receipt.backend,
        receipt.provenance,
        receipt.blobId ?? null,
        receipt.recallVerified,
        receipt.requestedAt,
        JSON.stringify(receipt),
      ],
    );
  }

  async listIncidents(limit = 100): Promise<IncidentRecord[]> {
    await this.ensureReady();
    const { rows } = await this.pool.query(
      `SELECT payload FROM incidents ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map((r) => r.payload as IncidentRecord);
  }

  async getIncident(incidentId: string): Promise<IncidentRecord | null> {
    await this.ensureReady();
    const { rows } = await this.pool.query(
      `SELECT payload FROM incidents WHERE incident_id = $1`,
      [incidentId],
    );
    return rows.length ? (rows[0].payload as IncidentRecord) : null;
  }

  async listRules(): Promise<SafeguardRule[]> {
    await this.ensureReady();
    const { rows } = await this.pool.query(
      `SELECT payload FROM rules ORDER BY updated_at DESC`,
    );
    return rows.map((r) => r.payload as SafeguardRule);
  }

  async listActiveRules(): Promise<SafeguardRule[]> {
    return (await this.listRules()).filter((r) => r.validationStatus === "active");
  }

  async listMemoryWrites(limit = 500): Promise<MemoryWriteReceipt[]> {
    await this.ensureReady();
    const { rows } = await this.pool.query(
      `SELECT payload FROM memory_writes ORDER BY requested_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map((r) => r.payload as MemoryWriteReceipt);
  }

  async listDecisions(limit = 200): Promise<SafeguardDecision[]> {
    await this.ensureReady();
    const { rows } = await this.pool.query(
      `SELECT payload FROM decisions ORDER BY decided_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map((r) => r.payload as SafeguardDecision);
  }

  async listMemoryWritesForIncident(incidentId: string): Promise<MemoryWriteReceipt[]> {
    await this.ensureReady();
    const { rows } = await this.pool.query(
      `SELECT payload FROM memory_writes WHERE incident_id = $1 ORDER BY requested_at ASC`,
      [incidentId],
    );
    return rows.map((r) => r.payload as MemoryWriteReceipt);
  }

  async counts(): Promise<AuditCounts> {
    const incidents = await this.listIncidents(100_000);
    const writes = await this.listMemoryWrites(100_000);
    const activeRules = await this.listActiveRules();
    return computeCounts({ incidents, writes, activeRules });
  }

  async reset(): Promise<void> {
    await this.ensureReady();
    await this.pool.query(
      `DELETE FROM incidents; DELETE FROM rules; DELETE FROM decisions; DELETE FROM memory_writes; DELETE FROM scenario_runs;`,
    );
  }

  async resetSimulated(): Promise<void> {
    await this.ensureReady();
    await this.pool.query(
      `DELETE FROM incidents; DELETE FROM rules; DELETE FROM decisions; DELETE FROM scenario_runs;
       DELETE FROM memory_writes WHERE provenance <> 'live';`,
    );
  }

  async close(): Promise<void> {
    if (this.ownsPool) await this.pool.end();
  }
}

/** Host and database name only — never the user, password, or query string. */
function safeHost(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const db = url.pathname.replace(/^\//, "") || "default";
    return `${url.hostname}/${db}`;
  } catch {
    return "configured database";
  }
}
