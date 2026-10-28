import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresAuditStore } from "@/lib/db/postgres-audit-store";
import type { IncidentRecord } from "@/lib/db/audit-store";
import type { MemoryWriteReceipt } from "@/lib/adapters/memory";

/**
 * Cross-instance durability.
 *
 * These tests need a real PostgreSQL database, because the property under test
 * is that a record committed by one process is visible to *another* process.
 * A mock cannot demonstrate that. Provide the connection string in
 * AFTERMATH_TEST_DATABASE_URL; without it the suite is skipped.
 *
 *   AFTERMATH_TEST_DATABASE_URL=postgres://... npx vitest run tests/durable-store.test.ts
 */
const url = process.env.AFTERMATH_TEST_DATABASE_URL;
const maybe = url ? describe : describe.skip;

function incident(id: string): IncidentRecord {
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
      status: "VERIFIED_FAILURE",
      verified: true,
      evidenceType: "test_run",
      evidenceReference: "calc.test.js",
      observedAt: now,
      explanation: "the test process exited non-zero",
    },
    diagnosis: {
      pattern: "unsupported_completion_claim",
      observedFacts: ["claimed success without a passing test run"],
      actionable: true,
    } as IncidentRecord["diagnosis"],
    decision: {
      decision: "BLOCK",
      reason: "no passing test run",
      applicableRuleIds: [],
      evidenceReferences: ["calc.test.js"],
      recalledMemoryIds: [],
      missingPreconditions: [],
      decidedAt: now,
      policyVersion: "aftermath-policy-1.0",
      trace: [],
    } as unknown as IncidentRecord["decision"],
  };
}

function writeReceipt(id: string): MemoryWriteReceipt {
  return {
    writeId: id,
    kind: "lesson",
    jobId: "job-1",
    state: "completed",
    blobId: "blob-abc",
    recallVerified: true,
    backend: "memwal-mainnet",
    provenance: "live",
    requestedAt: new Date().toISOString(),
    text: "require the test run",
  };
}

maybe("durable audit store across instances", () => {
  // Two independent stores with their own connection pools stand in for two
  // serverless instances that share one database but no process memory.
  const writer = new PostgresAuditStore(url!);
  const reader = new PostgresAuditStore(url!);

  beforeAll(async () => {
    await writer.reset();
  });

  afterAll(async () => {
    await writer.reset();
    await writer.close();
    await reader.close();
  });

  it("a record written by one instance is read by another", async () => {
    const rec = incident("cross-instance-1");
    await writer.saveIncident(rec);

    // The reader never saw the write in memory; it must come from the database.
    const seen = await reader.getIncident("cross-instance-1");
    expect(seen).not.toBeNull();
    expect(seen!.incident.currentStatus).toBe("unresolved");
    expect(seen!.assessment.status).toBe("VERIFIED_FAILURE");
  });

  it("counts computed by a second instance reflect the first instance's writes", async () => {
    await writer.saveMemoryWrite(writeReceipt("w-cross-1"), {
      incidentId: "cross-instance-1",
    });
    const counts = await reader.counts();
    expect(counts.incidents).toBeGreaterThanOrEqual(1);
    expect(counts.verifiedFailures).toBeGreaterThanOrEqual(1);
    expect(counts.completedLiveWrites).toBeGreaterThanOrEqual(1);
    expect(counts.recallVerifiedWrites).toBeGreaterThanOrEqual(1);
  });

  it("a scenario run saved by one instance is visible to another", async () => {
    await writer.saveScenarioRun("run-cross", "2026-01-01T00:00:00.000Z", {
      scenarios: [],
    });
    const runs = await reader.listScenarioRuns(5);
    expect(runs.some((r) => r.runId === "run-cross")).toBe(true);
  });

  it("reports itself as durable", () => {
    expect(writer.backend).toBe("postgres");
    expect(writer.durable).toBe(true);
  });

  it("resetSimulated keeps live writes but clears simulated ones", async () => {
    await writer.saveMemoryWrite(
      { ...writeReceipt("w-sim"), provenance: "simulated", backend: "simulated" },
      {},
    );
    await writer.resetSimulated();
    const writes = await reader.listMemoryWrites(100);
    expect(writes.some((w) => w.writeId === "w-sim")).toBe(false);
    expect(writes.some((w) => w.writeId === "w-cross-1")).toBe(true);
  });
});
