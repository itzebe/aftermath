import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteDb } from "@/lib/db/sql";
import { SqlDemoJobStore, type PlanStep } from "@/lib/db/demo-job-store";
import { DbWorkflowStateStore } from "@/lib/adapters/workflow-state";
import type { ScenarioRunReport } from "@/lib/demos/types";

/**
 * Concurrency and durability tests for the resumable demonstration's job store.
 *
 * These exercise the two properties the whole design rests on:
 *   1. two workers can never claim the same scenario;
 *   2. progress survives a new store instance over the same database.
 */

const dirs: string[] = [];
async function tempDbPath(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "aftermath-jobs-"));
  dirs.push(d);
  return path.join(d, "jobs.db");
}
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

const PLAN: PlanStep[] = [
  { stepId: "s1", ordinal: 1, domain: "coding", title: "one", simulated: true },
  { stepId: "s2", ordinal: 2, domain: "coding", title: "two", simulated: true },
  { stepId: "s3", ordinal: 3, domain: "workflow", title: "three", simulated: true },
];

function report(scenarioId: string): ScenarioRunReport {
  return {
    scenarioId,
    domain: "coding" as const,
    title: scenarioId,
    description: "test",
    simulated: true,
    steps: [],
    outcome: {
      scenarioId,
      groundTruthFailure: false,
      isRepeat: false,
      agentClaimedSuccess: false,
      decision: "ALLOW",
      evidenceStatus: "VERIFIED_SUCCESS",
      safeguardApplied: false,
      lessonStored: false,
      lessonRecalled: false,
      provenance: "simulated" as const,
    },
    incidentId: `inc-${scenarioId}`,
    decision: "ALLOW",
    evidenceStatus: "VERIFIED_SUCCESS",
    recallVerified: true,
  };
}

async function makeStore(dbPath: string) {
  const handle = new DatabaseSync(dbPath);
  handle.exec("PRAGMA journal_mode = WAL;");
  const store = new SqlDemoJobStore(new SqliteDb(handle), "sqlite");
  await store.migrate();
  return store;
}

describe("demo job store", () => {
  it("creates a job with a pending scenario per plan step", async () => {
    const store = await makeStore(await tempDbPath());
    const job = await store.createJob("job-1", PLAN);
    expect(job.total).toBe(3);
    const rows = await store.listScenarios("job-1");
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.state === "pending")).toBe(true);
  });

  it("claims scenarios in ordinal order, one at a time", async () => {
    const store = await makeStore(await tempDbPath());
    await store.createJob("job-1", PLAN);
    const a = await store.claimNextScenario("job-1", "w1", 60_000);
    expect(a?.scenario.stepId).toBe("s1");
    const b = await store.claimNextScenario("job-1", "w1", 60_000);
    expect(b?.scenario.stepId).toBe("s2");
    expect(a?.scenario.stepId).not.toBe(b?.scenario.stepId);
  });

  it("never lets two workers claim the same scenario", async () => {
    const store = await makeStore(await tempDbPath());
    await store.createJob("job-1", PLAN);
    // Two concurrent claimers race for the lowest-ordinal pending scenario.
    // Each claim must yield a *distinct* step — the atomic
    // UPDATE ... WHERE state='pending' guarantees a scenario is never handed
    // to two workers at once.
    const [a, b] = await Promise.all([
      store.claimNextScenario("job-1", "w1", 60_000),
      store.claimNextScenario("job-1", "w2", 60_000),
    ]);
    const claimed = [a, b].filter(Boolean);
    expect(claimed).toHaveLength(2);
    const ids = claimed.map((c) => c!.scenario.stepId);
    expect(new Set(ids).size).toBe(2);
    // The lowest ordinal is claimed first.
    expect(ids).toContain("s1");
  });

  it("does not let a second worker take a leased job", async () => {
    const store = await makeStore(await tempDbPath());
    await store.createJob("job-1", PLAN);
    const first = await store.acquireJobLease("job-1", "w1", 60_000);
    expect(first).not.toBeNull();
    const second = await store.acquireJobLease("job-1", "w2", 60_000);
    expect(second).toBeNull();
  });

  it("lets the same owner re-acquire its own lease", async () => {
    const store = await makeStore(await tempDbPath());
    await store.createJob("job-1", PLAN);
    await store.acquireJobLease("job-1", "w1", 60_000);
    const again = await store.acquireJobLease("job-1", "w1", 60_000);
    expect(again).not.toBeNull();
  });

  it("renews a held lease but refuses one held by another worker", async () => {
    const store = await makeStore(await tempDbPath());
    await store.createJob("job-1", PLAN);
    await store.acquireJobLease("job-1", "w1", 60_000);

    // The owner can extend its own claim...
    expect(await store.renewJobLease("job-1", "w1", 60_000)).toBe(true);

    // ...but a non-owner cannot, which is what stops a second worker from
    // stealing a job whose scenario is mid-write.
    expect(await store.renewJobLease("job-1", "w2", 60_000)).toBe(false);

    // A released lease can no longer be renewed by the old owner.
    await store.releaseJobLease("job-1", "w1");
    expect(await store.renewJobLease("job-1", "w1", 60_000)).toBe(false);
  });

  it("reclaims a scenario whose executing lease expired", async () => {
    const store = await makeStore(await tempDbPath());
    await store.createJob("job-1", PLAN);
    // Claim with an already-expired lease to simulate a worker that died.
    const first = await store.claimNextScenario("job-1", "dead", -1);
    expect(first?.scenario.stepId).toBe("s1");
    // A new worker must be able to reclaim it rather than stalling forever.
    const reclaimed = await store.claimNextScenario("job-1", "alive", 60_000);
    expect(reclaimed?.scenario.stepId).toBe("s1");
    expect(reclaimed?.scenario.attempts).toBe(2);
  });

  it("persists progress across store instances over the same database", async () => {
    const dbPath = await tempDbPath();
    const store1 = await makeStore(dbPath);
    await store1.createJob("job-1", PLAN);
    const claimed = await store1.claimNextScenario("job-1", "w1", 60_000);
    await store1.completeScenario("job-1", claimed!.scenario.stepId, report("s1"), ["w-1"]);

    // A brand-new instance, as a later serverless invocation would create.
    const store2 = await makeStore(dbPath);
    const rows = await store2.listScenarios("job-1");
    const done = rows.find((r) => r.stepId === "s1");
    expect(done?.state).toBe("completed");
    expect(done?.report?.scenarioId).toBe("s1");
    expect(done?.writeIds).toEqual(["w-1"]);
    const next = await store2.claimNextScenario("job-1", "w2", 60_000);
    expect(next?.scenario.stepId).toBe("s2");
  });

  it("reports per-state counts", async () => {
    const store = await makeStore(await tempDbPath());
    await store.createJob("job-1", PLAN);
    const c = await store.claimNextScenario("job-1", "w1", 60_000);
    await store.completeScenario("job-1", c!.scenario.stepId, report("s1"), []);
    await store.claimNextScenario("job-1", "w1", 60_000);
    await store.failScenario("job-1", "s2", "boom");
    const counts = await store.countScenarios("job-1");
    expect(counts.completed).toBe(1);
    expect(counts.failed).toBe(1);
    expect(counts.pending).toBe(1);
  });

  it("adds scenarios to a job and updates the total", async () => {
    const store = await makeStore(await tempDbPath());
    await store.createJob("job-1", PLAN);
    await store.addScenarios("job-1", [
      { stepId: "s4", ordinal: 100, domain: "finance", title: "four", simulated: false },
    ]);
    const job = await store.getJob("job-1");
    expect(job?.total).toBe(4);
    const rows = await store.listScenarios("job-1");
    expect(rows.map((r) => r.stepId)).toContain("s4");
  });

  it("does not re-open a completed job for a new lease", async () => {
    const store = await makeStore(await tempDbPath());
    await store.createJob("job-1", PLAN);
    await store.finishJob("job-1", "completed");
    const lease = await store.acquireJobLease("job-1", "w1", 60_000);
    expect(lease).toBeNull();
  });

  it("persists scratch for a later batch", async () => {
    const dbPath = await tempDbPath();
    const store1 = await makeStore(dbPath);
    await store1.createJob("job-1", PLAN);
    await store1.setScratch("job-1", { financeCases: [{ scenarioId: "x" }] });
    const store2 = await makeStore(dbPath);
    const job = await store2.getJob("job-1");
    expect(job?.scratch).toEqual({ financeCases: [{ scenarioId: "x" }] });
  });
});

describe("durable workflow state store", () => {
  let store: DbWorkflowStateStore;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = await tempDbPath();
    store = new DbWorkflowStateStore(new SqliteDb(new DatabaseSync(dbPath)));
    await store.migrate();
  });

  it("persists completed prerequisites across instances", async () => {
    await store.markPrerequisiteComplete("wf", "schema_validation");
    const store2 = new DbWorkflowStateStore(new SqliteDb(new DatabaseSync(dbPath)));
    const state = await store2.get("wf");
    expect(state?.completedPrerequisites).toEqual(["schema_validation"]);
  });

  it("records attempts and failures", async () => {
    await store.recordAttempt("wf", "failure", "missing prerequisite");
    await store.recordAttempt("wf", "failure", "missing prerequisite");
    await store.recordAttempt("wf", "success");
    const state = await store.get("wf");
    expect(state?.attempts).toBe(3);
    expect(state?.failures).toBe(2);
    expect(state?.lastFailureReason).toBe("missing prerequisite");
  });

  it("does not duplicate a prerequisite recorded twice", async () => {
    await store.markPrerequisiteComplete("wf", "a");
    await store.markPrerequisiteComplete("wf", "a");
    const state = await store.get("wf");
    expect(state?.completedPrerequisites).toEqual(["a"]);
  });
});
