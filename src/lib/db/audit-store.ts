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

export interface ScenarioRunRow {
  runId: string;
  ranAt: string;
  payload: unknown;
}

export interface AuditCounts {
  incidents: number;
  verifiedFailures: number;
  activeRules: number;
  unresolved: number;
  completedLiveWrites: number;
  recallVerifiedWrites: number;
  simulatedWrites: number;
  totalWrites: number;
}

/** Which storage engine actually backs the audit index. Surfaced in the UI. */
export type AuditStoreBackend = "sqlite" | "postgres";

/**
 * Append-only audit index for incidents, rules, decisions, and memory writes.
 *
 * This index is an *index*, not an authority: the authoritative evidence lives
 * at the source (Tatum, the test process, the workflow state store) and the
 * persistent lesson store lives in Walrus Memory. Nothing here is used to
 * override current evidence.
 *
 * Every method is asynchronous because the durable implementation talks to a
 * shared database over the network. The SQLite implementation resolves them
 * synchronously under the hood.
 */
export interface AuditStore {
  readonly backend: AuditStoreBackend;
  /**
   * True only when records written by one invocation are readable by another
   * invocation on a different host/instance. A `/tmp`-backed SQLite index is
   * process-local and therefore NOT durable, even though it is not in memory.
   */
  readonly durable: boolean;
  /** Human-readable explanation of where records live. Shown in the UI. */
  readonly detail: string;

  saveScenarioRun(runId: string, ranAt: string, payload: unknown): Promise<void>;
  listScenarioRuns(limit?: number): Promise<ScenarioRunRow[]>;

  saveIncident(record: IncidentRecord): Promise<void>;
  updateIncidentStatus(incidentId: string, status: string): Promise<void>;

  saveRule(rule: SafeguardRule): Promise<void>;

  saveMemoryWrite(
    receipt: MemoryWriteReceipt,
    refs?: { incidentId?: string; ruleId?: string },
  ): Promise<void>;

  listIncidents(limit?: number): Promise<IncidentRecord[]>;
  getIncident(incidentId: string): Promise<IncidentRecord | null>;
  listRules(): Promise<SafeguardRule[]>;
  /** Active rules, most recent version per rule id. */
  listActiveRules(): Promise<SafeguardRule[]>;
  listMemoryWrites(limit?: number): Promise<MemoryWriteReceipt[]>;
  /**
   * All memory-write receipts recorded for one incident.
   *
   * Used by the resumable runner to (a) collect the durable write ids a
   * scenario produced and (b) find writes that were accepted but never observed
   * to complete, so they can be reconciled rather than re-issued.
   */
  listMemoryWritesForIncident(incidentId: string): Promise<MemoryWriteReceipt[]>;
  listDecisions(limit?: number): Promise<SafeguardDecision[]>;
  counts(): Promise<AuditCounts>;

  reset(): Promise<void>;
  /** Clear scenario-produced state; live Mainnet write records are preserved. */
  resetSimulated(): Promise<void>;

  close(): Promise<void>;
}

/**
 * Derive the aggregate counts from the raw records.
 *
 * Kept as one pure function so the SQLite and Postgres stores cannot drift in
 * how they classify a record — the audit and evaluation semantics must not
 * change when the storage engine changes.
 */
export function computeCounts(input: {
  incidents: IncidentRecord[];
  writes: MemoryWriteReceipt[];
  activeRules: SafeguardRule[];
}): AuditCounts {
  const { incidents, writes, activeRules } = input;
  return {
    incidents: incidents.length,
    verifiedFailures: incidents.filter(
      (i) => i.assessment.status === "VERIFIED_FAILURE",
    ).length,
    activeRules: activeRules.length,
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
