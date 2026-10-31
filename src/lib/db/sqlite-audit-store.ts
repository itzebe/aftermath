import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type {
  AuditCounts,
  AuditStore,
  IncidentRecord,
  ScenarioRunRow,
} from "@/lib/db/audit-store";
import { countsFromRow } from "@/lib/db/audit-store";
import type { MemoryWriteReceipt } from "@/lib/adapters/memory";
import type { SafeguardDecision, SafeguardRecord, SafeguardRule } from "@/lib/schemas";

/**
 * SQLite-backed audit index.
 *
 * This is the local-development and test engine. It is a genuine persistent
 * store when given a writable file path, but on a serverless host the only
 * writable location is the OS temp directory, which is *not shared* between
 * instances — so `durable` is reported as false there and the UI says so.
 */
export class SqliteAuditStore implements AuditStore {
  readonly backend = "sqlite" as const;
  private readonly db: DatabaseSync;
  readonly durable: boolean;
  readonly detail: string;

  constructor(dbPath: string, options: { durable?: boolean; detail?: string } = {}) {
    if (dbPath !== ":memory:") {
      mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
    this.durable = options.durable ?? dbPath !== ":memory:";
    this.detail =
      options.detail ??
      (this.durable
        ? `SQLite file at ${dbPath}`
        : "SQLite in a non-shared location (in-memory or OS temp directory)");
  }

  /** The underlying handle, so the durable job/workflow stores can share it. */
  getHandle(): DatabaseSync {
    return this.db;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS incidents (
        incident_id TEXT PRIMARY KEY,
        domain TEXT NOT NULL,
        action_type TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        status TEXT NOT NULL,
        provenance TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rules (
        rule_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        domain TEXT NOT NULL,
        failure_pattern TEXT NOT NULL,
        validation_status TEXT NOT NULL,
        provenance TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (rule_id, version)
      );
      CREATE TABLE IF NOT EXISTS decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        incident_id TEXT NOT NULL,
        decision TEXT NOT NULL,
        policy_version TEXT NOT NULL,
        decided_at TEXT NOT NULL,
        payload TEXT NOT NULL
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
        recall_verified INTEGER NOT NULL DEFAULT 0,
        requested_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS scenario_runs (
        run_id TEXT PRIMARY KEY,
        ran_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS safeguard_records (
        record_id TEXT PRIMARY KEY,
        incident_id TEXT NOT NULL,
        domain TEXT NOT NULL,
        verification_state TEXT NOT NULL,
        provenance TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_incidents_domain ON incidents(domain);
      CREATE INDEX IF NOT EXISTS idx_writes_backend ON memory_writes(backend, state);
      CREATE INDEX IF NOT EXISTS idx_records_created ON safeguard_records(created_at);
    `);
  }

  async saveScenarioRun(runId: string, ranAt: string, payload: unknown): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO scenario_runs (run_id, ran_at, payload) VALUES (?, ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET payload = excluded.payload`,
      )
      .run(runId, ranAt, JSON.stringify(payload));
  }

  async listScenarioRuns(limit = 20): Promise<ScenarioRunRow[]> {
    const rows = this.db
      .prepare(`SELECT run_id, ran_at, payload FROM scenario_runs ORDER BY ran_at DESC LIMIT ?`)
      .all(limit) as Array<{ run_id: string; ran_at: string; payload: string }>;
    return rows.map((r) => ({
      runId: r.run_id,
      ranAt: r.ran_at,
      payload: JSON.parse(r.payload),
    }));
  }

  async saveIncident(record: IncidentRecord): Promise<void> {
    const { incident, decision } = record;
    this.db
      .prepare(
        `INSERT INTO incidents
          (incident_id, domain, action_type, execution_id, status, provenance, created_at, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(incident_id) DO UPDATE SET status = excluded.status, payload = excluded.payload`,
      )
      .run(
        incident.incidentId,
        incident.domain,
        incident.actionType,
        incident.executionId,
        incident.currentStatus,
        incident.provenance,
        incident.createdAt,
        JSON.stringify(record),
      );

    this.db
      .prepare(
        `INSERT INTO decisions (incident_id, decision, policy_version, decided_at, payload)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        incident.incidentId,
        decision.decision,
        decision.policyVersion,
        decision.decidedAt,
        JSON.stringify(decision),
      );
  }

  async updateIncidentStatus(incidentId: string, status: string): Promise<void> {
    this.db
      .prepare(`UPDATE incidents SET status = ? WHERE incident_id = ?`)
      .run(status, incidentId);
  }

  async saveRule(rule: SafeguardRule): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO rules
          (rule_id, version, domain, failure_pattern, validation_status, provenance, updated_at, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(rule_id, version) DO UPDATE SET validation_status = excluded.validation_status, payload = excluded.payload`,
      )
      .run(
        rule.ruleId,
        rule.version,
        rule.domain,
        rule.failurePattern,
        rule.validationStatus,
        rule.provenance,
        rule.updatedAt,
        JSON.stringify(rule),
      );
  }

  async saveMemoryWrite(
    receipt: MemoryWriteReceipt,
    refs: { incidentId?: string; ruleId?: string } = {},
  ): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO memory_writes
          (write_id, incident_id, rule_id, kind, state, backend, provenance, blob_id, recall_verified, requested_at, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(write_id) DO UPDATE SET
           state = excluded.state,
           blob_id = excluded.blob_id,
           recall_verified = excluded.recall_verified,
           payload = excluded.payload`,
      )
      .run(
        receipt.writeId,
        refs.incidentId ?? null,
        refs.ruleId ?? null,
        receipt.kind,
        receipt.state,
        receipt.backend,
        receipt.provenance,
        receipt.blobId ?? null,
        receipt.recallVerified ? 1 : 0,
        receipt.requestedAt,
        JSON.stringify(receipt),
      );
  }

  async listIncidents(limit = 100): Promise<IncidentRecord[]> {
    const rows = this.db
      .prepare(`SELECT payload FROM incidents ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as Array<{ payload: string }>;
    return rows.map((r) => JSON.parse(r.payload) as IncidentRecord);
  }

  async getIncident(incidentId: string): Promise<IncidentRecord | null> {
    const row = this.db
      .prepare(`SELECT payload FROM incidents WHERE incident_id = ?`)
      .get(incidentId) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as IncidentRecord) : null;
  }

  async listRules(): Promise<SafeguardRule[]> {
    const rows = this.db
      .prepare(`SELECT payload FROM rules ORDER BY updated_at DESC`)
      .all() as Array<{ payload: string }>;
    return rows.map((r) => JSON.parse(r.payload) as SafeguardRule);
  }

  async listActiveRules(): Promise<SafeguardRule[]> {
    return (await this.listRules()).filter((r) => r.validationStatus === "active");
  }

  async listMemoryWrites(limit = 500): Promise<MemoryWriteReceipt[]> {
    const rows = this.db
      .prepare(`SELECT payload FROM memory_writes ORDER BY requested_at DESC LIMIT ?`)
      .all(limit) as Array<{ payload: string }>;
    return rows.map((r) => JSON.parse(r.payload) as MemoryWriteReceipt);
  }

  async saveSafeguardRecord(record: SafeguardRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO safeguard_records
          (record_id, incident_id, domain, verification_state, provenance, created_at, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(record_id) DO UPDATE SET payload = excluded.payload`,
      )
      .run(
        record.recordId,
        record.incidentId,
        record.investigation.domain,
        record.verification.state,
        record.provenance,
        record.createdAt,
        JSON.stringify(record),
      );
  }

  async listSafeguardRecords(limit = 100): Promise<SafeguardRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT payload FROM safeguard_records ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit) as Array<{ payload: string }>;
    return rows.map((r) => JSON.parse(r.payload) as SafeguardRecord);
  }

  async getSafeguardRecord(recordId: string): Promise<SafeguardRecord | null> {
    const row = this.db
      .prepare(`SELECT payload FROM safeguard_records WHERE record_id = ?`)
      .get(recordId) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as SafeguardRecord) : null;
  }

  async countSafeguardRecords(): Promise<number> {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM safeguard_records`)
      .get() as { n: number };
    return Number(row.n);
  }

  async listDecisions(limit = 200): Promise<SafeguardDecision[]> {
    const rows = this.db
      .prepare(`SELECT payload FROM decisions ORDER BY decided_at DESC LIMIT ?`)
      .all(limit) as Array<{ payload: string }>;
    return rows.map((r) => JSON.parse(r.payload) as SafeguardDecision);
  }

  async listMemoryWritesForIncident(incidentId: string): Promise<MemoryWriteReceipt[]> {
    const rows = this.db
      .prepare(
        `SELECT payload FROM memory_writes WHERE incident_id = ? ORDER BY requested_at ASC`,
      )
      .all(incidentId) as Array<{ payload: string }>;
    return rows.map((r) => JSON.parse(r.payload) as MemoryWriteReceipt);
  }

  async counts(): Promise<AuditCounts> {
    // Aggregate in SQL. The classification predicates mirror `computeCounts`
    // exactly. `json_extract` reads only the two payload fields that matter, so
    // no full payload is loaded into Node merely to count rows.
    const row = this.db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM incidents) AS incidents,
           (SELECT COUNT(*) FROM incidents
              WHERE json_extract(payload, '$.assessment.status') = 'VERIFIED_FAILURE') AS verified_failures,
           (SELECT COUNT(*) FROM rules WHERE validation_status = 'active') AS active_rules,
           (SELECT COUNT(*) FROM incidents
              WHERE json_extract(payload, '$.decision.decision') IN ('UNKNOWN', 'REQUIRE_VERIFICATION')) AS unresolved,
           (SELECT COUNT(*) FROM memory_writes
              WHERE state = 'completed' AND backend != 'simulated') AS completed_live,
           (SELECT COUNT(*) FROM memory_writes
              WHERE recall_verified = 1 AND backend != 'simulated') AS recall_verified,
           (SELECT COUNT(*) FROM memory_writes WHERE backend = 'simulated') AS simulated,
           (SELECT COUNT(*) FROM memory_writes) AS total_writes,
           (SELECT COUNT(*) FROM safeguard_records) AS records`,
      )
      .get() as Record<string, unknown>;
    return countsFromRow(row);
  }

  async reset(): Promise<void> {
    this.db.exec(
      `DELETE FROM incidents; DELETE FROM rules; DELETE FROM decisions; DELETE FROM memory_writes; DELETE FROM scenario_runs; DELETE FROM safeguard_records;`,
    );
  }

  /**
   * Reset only the state a controlled scenario run produces, leaving any real
   * Mainnet memory-write records in place.
   *
   * A live write is an irreversible on-chain artefact. Clearing its ledger
   * entry would not un-write it, but it would hide it from the count the
   * submission is judged on. So simulated writes are cleared (a re-run must be
   * reproducible) and live writes are kept (the ledger must stay truthful).
   *
   * User-submitted Safeguard Records are deliberately NOT cleared here: they
   * are a person's own work, not scenario output, and a demonstration run must
   * never delete them.
   */
  async resetSimulated(): Promise<void> {
    this.db.exec(
      `DELETE FROM incidents; DELETE FROM rules; DELETE FROM decisions; DELETE FROM scenario_runs;
       DELETE FROM memory_writes WHERE provenance != 'live';`,
    );
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
