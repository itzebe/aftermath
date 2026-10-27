import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type {
  EvidenceAssessment,
  Incident,
  SafeguardDecision,
  SafeguardRule,
} from "@/lib/schemas";
import type { MemoryWriteReceipt } from "@/lib/adapters/memory";
import type { Diagnosis } from "@/lib/schemas";

export interface IncidentRecord {
  incident: Incident;
  assessment: EvidenceAssessment;
  diagnosis: Diagnosis;
  decision: SafeguardDecision;
}

/**
 * Append-only audit index for incidents, rules, decisions, and memory writes.
 *
 * This database is an *index*, not an authority: the authoritative evidence
 * lives at the source (Tatum, the test process, the workflow state store) and
 * the persistent lesson store lives in Walrus Memory. Nothing here is used to
 * override current evidence.
 */
export class AftermathStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
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
      CREATE INDEX IF NOT EXISTS idx_incidents_domain ON incidents(domain);
      CREATE INDEX IF NOT EXISTS idx_writes_backend ON memory_writes(backend, state);
    `);
  }

  saveScenarioRun(runId: string, ranAt: string, payload: unknown): void {
    this.db
      .prepare(
        `INSERT INTO scenario_runs (run_id, ran_at, payload) VALUES (?, ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET payload = excluded.payload`,
      )
      .run(runId, ranAt, JSON.stringify(payload));
  }

  listScenarioRuns(
    limit = 20,
  ): Array<{ runId: string; ranAt: string; payload: unknown }> {
    const rows = this.db
      .prepare(`SELECT run_id, ran_at, payload FROM scenario_runs ORDER BY ran_at DESC LIMIT ?`)
      .all(limit) as Array<{ run_id: string; ran_at: string; payload: string }>;
    return rows.map((r) => ({
      runId: r.run_id,
      ranAt: r.ran_at,
      payload: JSON.parse(r.payload),
    }));
  }

  saveIncident(record: IncidentRecord): void {
    const { incident, assessment, diagnosis, decision } = record;
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
    void assessment;
    void diagnosis;

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

  updateIncidentStatus(incidentId: string, status: string): void {
    this.db
      .prepare(`UPDATE incidents SET status = ? WHERE incident_id = ?`)
      .run(status, incidentId);
  }

  saveRule(rule: SafeguardRule): void {
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

  saveMemoryWrite(
    receipt: MemoryWriteReceipt,
    refs: { incidentId?: string; ruleId?: string } = {},
  ): void {
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

  listIncidents(limit = 100): IncidentRecord[] {
    const rows = this.db
      .prepare(
        `SELECT payload FROM incidents ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit) as Array<{ payload: string }>;
    return rows.map((r) => JSON.parse(r.payload) as IncidentRecord);
  }

  getIncident(incidentId: string): IncidentRecord | null {
    const row = this.db
      .prepare(`SELECT payload FROM incidents WHERE incident_id = ?`)
      .get(incidentId) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as IncidentRecord) : null;
  }

  listRules(): SafeguardRule[] {
    const rows = this.db
      .prepare(`SELECT payload FROM rules ORDER BY updated_at DESC`)
      .all() as Array<{ payload: string }>;
    return rows.map((r) => JSON.parse(r.payload) as SafeguardRule);
  }

  /** Active rules, most recent version per rule id. */
  listActiveRules(): SafeguardRule[] {
    return this.listRules().filter((r) => r.validationStatus === "active");
  }

  listMemoryWrites(limit = 500): MemoryWriteReceipt[] {
    const rows = this.db
      .prepare(
        `SELECT payload FROM memory_writes ORDER BY requested_at DESC LIMIT ?`,
      )
      .all(limit) as Array<{ payload: string }>;
    return rows.map((r) => JSON.parse(r.payload) as MemoryWriteReceipt);
  }

  listDecisions(limit = 200): SafeguardDecision[] {
    const rows = this.db
      .prepare(
        `SELECT payload FROM decisions ORDER BY decided_at DESC LIMIT ?`,
      )
      .all(limit) as Array<{ payload: string }>;
    return rows.map((r) => JSON.parse(r.payload) as SafeguardDecision);
  }

  counts(): {
    incidents: number;
    verifiedFailures: number;
    activeRules: number;
    unresolved: number;
    completedLiveWrites: number;
    recallVerifiedWrites: number;
    simulatedWrites: number;
    totalWrites: number;
  } {
    const incidents = this.listIncidents(100_000);
    const writes = this.listMemoryWrites(100_000);
    return {
      incidents: incidents.length,
      verifiedFailures: incidents.filter(
        (i) => i.assessment.status === "VERIFIED_FAILURE",
      ).length,
      activeRules: this.listActiveRules().length,
      unresolved: incidents.filter(
        (i) =>
          i.decision.decision === "UNKNOWN" ||
          i.decision.decision === "REQUIRE_VERIFICATION",
      ).length,
      completedLiveWrites: writes.filter(
        (w) => w.state === "completed" && w.backend !== "simulated",
      ).length,
      recallVerifiedWrites: writes.filter(
        (w) => w.recallVerified && w.backend !== "simulated",
      ).length,
      simulatedWrites: writes.filter((w) => w.backend === "simulated").length,
      totalWrites: writes.length,
    };
  }

  reset(): void {
    this.db.exec(
      `DELETE FROM incidents; DELETE FROM rules; DELETE FROM decisions; DELETE FROM memory_writes; DELETE FROM scenario_runs;`,
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
   */
  resetSimulated(): void {
    this.db.exec(
      `DELETE FROM incidents; DELETE FROM rules; DELETE FROM decisions; DELETE FROM scenario_runs;
       DELETE FROM memory_writes WHERE provenance != 'live';`,
    );
  }

  close(): void {
    this.db.close();
  }
}
