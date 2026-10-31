import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeCounts, type IncidentRecord } from "@/lib/db/audit-store";
import type { MemoryWriteReceipt } from "@/lib/adapters/memory";
import type { SafeguardRecord, SafeguardRule } from "@/lib/schemas";

/**
 * The aggregate counts must be identical whether they are computed in SQL
 * (the store) or in Node (the reference reducer `computeCounts`). This suite
 * seeds a known mix of records and asserts the two agree, which is the guard
 * against the SQL rewrite silently changing what a "completed live write" or an
 * "unresolved incident" means.
 */

function incident(id: string, status: IncidentRecord["assessment"]["status"], decision: string): IncidentRecord {
  const now = new Date().toISOString();
  return {
    incident: {
      incidentId: id,
      domain: "coding",
      actionType: "report_bug_fixed",
      executionId: `exec-${id}`,
      intendedOutcome: "add() returns the sum",
      evidenceReferences: [],
      relevantContext: {},
      provenance: "simulated",
      createdAt: now,
      currentStatus: "unresolved",
    },
    assessment: {
      status,
      verified: status === "VERIFIED_FAILURE",
      evidenceType: "test_run",
      evidenceReference: "calc.test.js",
      observedAt: now,
      explanation: "observed",
    },
    diagnosis: {
      pattern: "unsupported_completion_claim",
      observedFacts: ["claimed success without a passing test run"],
      actionable: true,
    } as IncidentRecord["diagnosis"],
    decision: {
      decision,
      reason: "policy",
      applicableRuleIds: [],
      evidenceReferences: [],
      recalledMemoryIds: [],
      missingPreconditions: [],
      decidedAt: now,
      policyVersion: "aftermath-policy-1.0",
      trace: [],
    } as unknown as IncidentRecord["decision"],
  };
}

function rule(id: string, status: SafeguardRule["validationStatus"]): SafeguardRule {
  const now = new Date().toISOString();
  return {
    ruleId: id,
    version: 1,
    domain: "coding",
    failurePattern: "unsupported_completion_claim",
    statement: "require a passing test run",
    applicabilityConditions: ["a fix is claimed"],
    requiredEvidence: ["a passing test run"],
    action: "BLOCK",
    severity: "high",
    validationStatus: status,
    supportingIncidentIds: ["i-1"],
    createdAt: now,
    updatedAt: now,
    provenance: "simulated",
  };
}

function write(
  id: string,
  over: Partial<MemoryWriteReceipt> = {},
): MemoryWriteReceipt {
  return {
    writeId: id,
    kind: "lesson",
    jobId: "job-1",
    state: "completed",
    blobId: "blob",
    recallVerified: false,
    backend: "memwal-mainnet",
    provenance: "live",
    requestedAt: new Date().toISOString(),
    text: "lesson",
    ...over,
  };
}

function record(id: string): SafeguardRecord {
  return {
    recordId: id,
    incidentId: id,
    createdAt: new Date().toISOString(),
    provenance: "simulated",
    investigation: { domain: "incident" },
    verification: { state: "test_executed" },
  } as unknown as SafeguardRecord;
}

/** The seeded mix, shared by both engine tests so they compare equal inputs. */
const INCIDENTS = [
  incident("i-vf-1", "VERIFIED_FAILURE", "BLOCK"),
  incident("i-vf-2", "VERIFIED_FAILURE", "BLOCK"),
  incident("i-un-1", "UNKNOWN", "UNKNOWN"),
  incident("i-un-2", "PENDING", "REQUIRE_VERIFICATION"),
  incident("i-ok-1", "VERIFIED_SUCCESS", "ALLOW"),
];

const WRITES = [
  write("w-live-done", { state: "completed", backend: "memwal-mainnet", recallVerified: true }),
  write("w-live-done2", { state: "completed", backend: "memwal-mainnet", recallVerified: false }),
  write("w-live-processing", { state: "processing", backend: "memwal-mainnet", recallVerified: false }),
  write("w-live-failed", { state: "failed", backend: "memwal-mainnet", recallVerified: false }),
  write("w-sim-1", { state: "completed", backend: "simulated", provenance: "simulated", recallVerified: true }),
  write("w-sim-2", { state: "completed", backend: "simulated", provenance: "simulated", recallVerified: false }),
];

const RULES = [rule("r-active", "active"), rule("r-proposed", "proposed")];
const RECORDS = [record("rec-1"), record("rec-2")];

const EXPECTED = computeCounts({
  incidents: INCIDENTS,
  writes: WRITES,
  activeRules: RULES.filter((r) => r.validationStatus === "active"),
  records: RECORDS.length,
});

describe("SQLite aggregate counts", () => {
  it("match the Node reference reducer exactly", async () => {
    const { SqliteAuditStore } = await import("@/lib/db/sqlite-audit-store");
    const store = new SqliteAuditStore(":memory:", { durable: false });
    try {
      for (const i of INCIDENTS) await store.saveIncident(i);
      for (const w of WRITES) await store.saveMemoryWrite(w, { incidentId: "i-vf-1" });
      for (const r of RULES) await store.saveRule(r);
      for (const rec of RECORDS) await store.saveSafeguardRecord(rec);

      expect(await store.counts()).toEqual(EXPECTED);
    } finally {
      await store.close();
    }
  });

  it("reports zeros on an empty store", async () => {
    const { SqliteAuditStore } = await import("@/lib/db/sqlite-audit-store");
    const store = new SqliteAuditStore(":memory:", { durable: false });
    try {
      expect(await store.counts()).toEqual({
        incidents: 0,
        verifiedFailures: 0,
        activeRules: 0,
        unresolved: 0,
        completedLiveWrites: 0,
        recallVerifiedWrites: 0,
        simulatedWrites: 0,
        totalWrites: 0,
        records: 0,
      });
    } finally {
      await store.close();
    }
  });

  it("does not confuse simulated writes with live ones", async () => {
    const { SqliteAuditStore } = await import("@/lib/db/sqlite-audit-store");
    const store = new SqliteAuditStore(":memory:", { durable: false });
    try {
      for (const w of WRITES) await store.saveMemoryWrite(w, {});
      const counts = await store.counts();
      expect(counts.simulatedWrites).toBe(2);
      expect(counts.totalWrites).toBe(6);
      // Only the two completed live writes count, never the simulated ones.
      expect(counts.completedLiveWrites).toBe(2);
      expect(counts.recallVerifiedWrites).toBe(1);
    } finally {
      await store.close();
    }
  });
});

/**
 * The same equivalence, against a real PostgreSQL. Skipped unless
 * AFTERMATH_TEST_DATABASE_URL is provided (a real database is required, because
 * the property is that the SQL engine returns the same numbers).
 */
const url = process.env.AFTERMATH_TEST_DATABASE_URL;
const maybe = url ? describe : describe.skip;

maybe("PostgreSQL aggregate counts", () => {
  let store: import("@/lib/db/postgres-audit-store").PostgresAuditStore;

  beforeAll(async () => {
    const { PostgresAuditStore } = await import("@/lib/db/postgres-audit-store");
    store = new PostgresAuditStore(url!);
    await store.reset();
  });

  afterAll(async () => {
    await store.reset();
    await store.close();
  });

  it("match the Node reference reducer exactly", async () => {
    for (const i of INCIDENTS) await store.saveIncident(i);
    for (const w of WRITES) await store.saveMemoryWrite(w, { incidentId: "i-vf-1" });
    for (const r of RULES) await store.saveRule(r);
    for (const rec of RECORDS) await store.saveSafeguardRecord(rec);

    expect(await store.counts()).toEqual(EXPECTED);
  });
});
