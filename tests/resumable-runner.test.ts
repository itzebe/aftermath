import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "@/lib/config";
import { resolveDurableStores } from "@/lib/db/durable-stores";
import { SimulatedMemoryAdapter } from "@/lib/adapters/simulated-memory";
import { runDemoBatch } from "@/lib/demos/resumable-runner";
import { DEMO_STEPS, planSteps } from "@/lib/demos/plan";

/**
 * Resumable runner tests.
 *
 * The point of this runner is that the demonstration completes across several
 * bounded requests, each of which may run on a *different* instance. These
 * tests therefore open a brand-new set of stores for every batch, over the same
 * on-disk database, and assert that progress accumulates rather than restarting.
 */

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "aftermath-resume-"));
  dirs.push(d);
  return d;
}
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function makeConfig(base: string) {
  const config = loadConfig();
  return {
    ...config,
    databaseUrl: null,
    dbPath: path.join(base, "aftermath.db"),
    harnessDir: path.join(base, "harness"),
  };
}

/** A fresh store bundle + memory adapter, as a new serverless instance would build. */
async function newInstance(base: string) {
  const config = await makeConfig(base);
  const stores = resolveDurableStores(config);
  const memory = new SimulatedMemoryAdapter(config.memory.namespace);
  return { config, stores, memory };
}

/**
 * Wrap a memory adapter so every recall throws `message`. Used to prove a
 * transient dependency condition is deferred rather than failed.
 */
function rateLimitedAdapter(base: SimulatedMemoryAdapter, message: string) {
  const wrapped = Object.create(base) as SimulatedMemoryAdapter;
  Object.defineProperty(wrapped, "recallRelevantLessons", {
    value: async () => {
      throw new Error(message);
    },
  });
  return wrapped;
}

describe("resumable demonstration runner", () => {
  it("advances the plan in bounded batches and completes it", async () => {
    const base = await tempDir();

    let guard = 0;
    let done = false;
    let totalCompleted = 0;
    let jobId: string | null = null;

    while (!done && guard < 40) {
      guard += 1;
      // A brand-new instance every iteration: nothing may rely on process
      // memory from the previous batch.
      const inst = await newInstance(base);
      const result = await runDemoBatch({
        stores: inst.stores,
        config: inst.config,
        memory: inst.memory,
        // A one-millisecond budget forces roughly one scenario per request,
        // which is the strongest test of resumability.
        budgetMs: 1,
      });
      jobId = result.jobId;
      expect(result.busy).toBe(false);
      totalCompleted += result.completedThisRequest;
      done = result.done;
      await inst.stores.close();
    }

    expect(done).toBe(true);
    // Every visible scenario ran exactly once across the batches.
    const expected = planSteps(DEMO_STEPS).filter((s) => !s.internal).length;
    expect(totalCompleted).toBe(expected);

    // The final job is complete and no scenario is left pending or executing.
    const finalInst = await newInstance(base);
    const progress = await finalInst.stores.jobs.listScenarios(jobId!);
    const visible = progress.filter((r) => !r.internal);
    expect(visible.every((r) => r.state === "completed")).toBe(true);
    const job = await finalInst.stores.jobs.getJob(jobId!);
    expect(job?.status).toBe("completed");
    await finalInst.stores.close();
  });

  it("reports continuation required until the plan is finished", async () => {
    const base = await tempDir();
    const first = await newInstance(base);
    const r1 = await runDemoBatch({
      stores: first.stores,
      config: first.config,
      memory: first.memory,
      budgetMs: 1,
    });
    expect(r1.continuationRequired).toBe(true);
    expect(r1.remaining).toBeGreaterThan(0);
    await first.stores.close();
  });

  it("does not duplicate work when another worker holds the job lease", async () => {
    const base = await tempDir();
    const inst = await newInstance(base);
    // Create the job first so its id is known.
    const first = await runDemoBatch({
      stores: inst.stores,
      config: inst.config,
      memory: inst.memory,
      budgetMs: 1,
    });
    // A second worker holds the lease; the next request must not duplicate it.
    await inst.stores.jobs.acquireJobLease(first.jobId, "other-worker", 60_000);
    const blocked = await runDemoBatch({
      stores: inst.stores,
      config: inst.config,
      memory: inst.memory,
      budgetMs: 1,
    });
    expect(blocked.busy).toBe(true);
    expect(blocked.completedThisRequest).toBe(0);
    await inst.stores.close();
  });

  it("labels the memory backend as simulated when credentials are absent", async () => {
    const base = await tempDir();
    const inst = await newInstance(base);
    const r = await runDemoBatch({
      stores: inst.stores,
      config: inst.config,
      memory: inst.memory,
      budgetMs: 1,
    });
    expect(r.memorySimulated).toBe(true);
    await inst.stores.close();
  });

  it("defers rather than fails a scenario when the dependency is rate-limited", async () => {
    const base = await tempDir();
    const inst = await newInstance(base);
    // A dependency that answers every recall with a rate limit. The runner must
    // not record that as a scenario failure — no verdict was reached.
    const rateLimited = rateLimitedAdapter(
      inst.memory,
      'Walrus Memory server error (429): {"error":"Rate limit exceeded","retry_after_seconds":120}',
    );

    const r = await runDemoBatch({
      stores: inst.stores,
      config: inst.config,
      memory: rateLimited,
      budgetMs: 60_000,
    });

    expect(r.failedThisRequest).toBe(0);
    expect(r.deferred.length).toBeGreaterThan(0);
    expect(r.retryAfterMs).toBe(120_000);
    // The job is not reported as failed; the scenario is still unresolved.
    const rows = await inst.stores.jobs.listScenarios(r.jobId);
    const visible = rows.filter((row) => !row.internal);
    expect(visible.some((row) => row.state === "failed")).toBe(false);
    expect(visible.some((row) => row.state === "pending" && row.notBefore)).toBe(true);
    await inst.stores.close();
  });

  it("honours a deferral gate: an immediate retry does no work and reports the wait", async () => {
    const base = await tempDir();
    const inst = await newInstance(base);
    const rateLimited = rateLimitedAdapter(inst.memory, "429 Too Many Requests");

    const first = await runDemoBatch({
      stores: inst.stores,
      config: inst.config,
      memory: rateLimited,
      budgetMs: 60_000,
    });
    expect(first.deferred.length).toBeGreaterThan(0);

    // Retry immediately. The gate is still closed, so nothing may be claimed
    // and the response must still report a wait rather than a pass.
    const second = await runDemoBatch({
      stores: inst.stores,
      config: inst.config,
      memory: rateLimited,
      budgetMs: 60_000,
    });
    expect(second.completedThisRequest).toBe(0);
    expect(second.failedThisRequest).toBe(0);
    expect(second.retryAfterMs).toBeGreaterThan(0);
    await inst.stores.close();
  });
});
