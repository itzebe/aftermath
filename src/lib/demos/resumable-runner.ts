import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AftermathConfig } from "@/lib/config";
import type { MemoryAdapter } from "@/lib/adapters/memory";
import type { DurableStores } from "@/lib/db/durable-stores";
import type { DemoJob, DemoScenarioRow } from "@/lib/db/demo-job-store";
import {
  DEMO_STEPS,
  deterministicIncidentId,
  financeCaseSteps,
  findStep,
  planSteps,
} from "@/lib/demos/plan";
import type { RunContext, ScenarioRunReport, StepDefinition } from "@/lib/demos/types";
import type { FinanceEvidenceCase } from "@/lib/demos/finance";
import { redact } from "@/lib/util/redact";
import { classifyTransient } from "@/lib/util/transient";

/**
 * Resumable demonstration runner.
 *
 * A single request executes at most a bounded slice of the plan, persisting
 * progress after every scenario, so the whole demonstration completes across
 * several requests rather than inside one serverless function's time limit.
 *
 * Correctness rests on three durable mechanisms, none of which assume the next
 * request runs on the same instance as the last:
 *   1. a job lease, so two workers never advance the same job at once;
 *   2. atomic scenario claims, so two workers never run the same scenario;
 *   3. deterministic write ids and content idempotency keys, so a retry after a
 *      crash dedupes at the relayer instead of writing a duplicate memory.
 */

export interface BatchOptions {
  stores: DurableStores;
  config: AftermathConfig;
  memory: MemoryAdapter;
  /** Wall-clock budget for this request. Kept below the host's limit. */
  budgetMs?: number;
  /** Lease length; must outlast the budget so a live worker keeps its claim. */
  leaseMs?: number;
  /** Force a fresh job instead of resuming the latest unfinished one. */
  restart?: boolean;
  /** Test seam for the clock. */
  now?: () => number;
}

export interface JobProgress {
  jobId: string;
  status: DemoJob["status"];
  total: number;
  completed: number;
  failed: number;
  remaining: number;
  executing: number;
}

export interface BatchResult {
  jobId: string;
  /** Scenarios completed in *this* request. */
  completedThisRequest: number;
  /** Scenarios that failed in this request (honest, never retried into a pass). */
  failedThisRequest: number;
  /** Scenarios remaining when the request returned. */
  remaining: number;
  /** True when every scenario has reached a terminal state and none failed. */
  done: boolean;
  /** True when the caller must issue another request to finish. */
  continuationRequired: boolean;
  /** True when another worker holds the job and this request did no work. */
  busy: boolean;
  progress: JobProgress;
  /** Reports produced by the scenarios completed in this request. */
  reports: ScenarioRunReport[];
  /** Failures observed in this request, with their reason. */
  failures: Array<{ stepId: string; title: string; error: string }>;
  /**
   * Scenarios this request could not reach a verdict on because a dependency
   * was transiently unavailable (a rate limit, a timeout). They are neither
   * passed nor failed; the caller should continue after the wait.
   */
  deferred: Array<{ stepId: string; title: string; reason: string; retryAfterMs: number }>;
  /**
   * When the batch stopped early because of a transient condition, the minimum
   * time the caller should wait before the next request. Null when no deferral
   * happened. The UI uses this to space out requests instead of hammering a
   * rate-limited dependency.
   */
  retryAfterMs: number | null;
  /** True when the memory backend is the simulated one, not Mainnet. */
  memorySimulated: boolean;
  detail: string;
}

const DEFAULT_BUDGET_MS = 180_000;
const DEFAULT_LEASE_MS = 300_000;

/** Every step this job can run, static plan plus any discovered finance cases. */
function resolveStep(
  stepId: string,
  scratch: Record<string, unknown>,
): StepDefinition | null {
  const staticStep = findStep(DEMO_STEPS, stepId);
  if (staticStep) return staticStep;
  const cases = (scratch.financeCases as FinanceEvidenceCase[] | undefined) ?? [];
  const dynamic = financeCaseSteps(cases);
  return findStep(dynamic, stepId) ?? null;
}

async function buildContext(
  opts: BatchOptions,
  job: DemoJob,
): Promise<RunContext> {
  return {
    config: opts.config,
    store: opts.stores.audit,
    memory: opts.memory,
    workflowStore: opts.stores.workflow,
    jobId: job.jobId,
    scratch: { ...(job.scratch as RunContext["scratch"]) },
    async setScratch(next) {
      // Re-read the latest scratch so a concurrent field is not clobbered, then
      // merge and persist.
      const fresh = (await opts.stores.jobs.getJob(job.jobId))?.scratch ?? {};
      const merged = { ...fresh, ...next };
      await opts.stores.jobs.setScratch(job.jobId, merged);
    },
    paths: {
      codingBase: path.join(opts.config.harnessDir, "coding"),
      artifacts: path.join(opts.config.harnessDir, "artifacts"),
    },
  };
}

async function writeIdsForIncident(
  stores: DurableStores,
  incidentId: string,
): Promise<string[]> {
  const writes = await stores.audit.listMemoryWritesForIncident(incidentId);
  return writes.map((w) => w.writeId);
}

/**
 * Reconcile writes that were accepted but never observed to complete.
 *
 * Called before re-running a scenario that previously left a durable write in
 * the `requested`/`processing` state (its worker died mid-write). The adapter
 * resolves the *existing* job by id; the write is never re-issued, so a crash
 * cannot produce a duplicate Mainnet memory.
 */
async function reconcilePendingWrites(
  stores: DurableStores,
  memory: MemoryAdapter,
  incidentId: string,
): Promise<void> {
  if (!memory.reconcileWrite) return;
  const writes = await stores.audit.listMemoryWritesForIncident(incidentId);
  const pending = writes.filter(
    (w) =>
      w.backend !== "simulated" &&
      (w.state === "requested" || w.state === "processing") &&
      w.jobId,
  );
  for (const w of pending) {
    const resolved = await memory.reconcileWrite(w.jobId!, w);
    await stores.audit.saveMemoryWrite(resolved, { incidentId });
  }
}

/** Load the active job, creating one when none is resumable. */
async function openJob(
  stores: DurableStores,
  memory: MemoryAdapter,
  restart: boolean,
): Promise<DemoJob> {
  if (!restart) {
    const latest = await stores.jobs.latestJob();
    if (latest && latest.status !== "completed") return latest;
  }
  const jobId = `demo-${Date.now()}-${randomUUID().slice(0, 8)}`;
  // A fresh demonstration starts from a known state: prior simulated incidents,
  // rules, and memories are cleared so the run is reproducible. Live Mainnet
  // write records are preserved — they are irreversible on-chain artefacts.
  await stores.audit.resetSimulated();
  await stores.workflow.resetAll();
  if (!memory.isLive) await memory.reset?.();
  await stores.jobs.createJob(jobId, planSteps(DEMO_STEPS));
  return (await stores.jobs.getJob(jobId))!;
}

export async function runDemoBatch(opts: BatchOptions): Promise<BatchResult> {
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const leaseMs = opts.leaseMs ?? DEFAULT_LEASE_MS;
  const now = opts.now ?? (() => Date.now());
  const { stores, memory } = opts;

  await stores.migrate();
  const job = await openJob(stores, memory, opts.restart ?? false);
  const owner = `worker-${randomUUID()}`;
  const start = now();

  const progressOf = async (): Promise<JobProgress> => {
    const counts = await stores.jobs.countScenarios(job.jobId);
    const rows = await stores.jobs.listScenarios(job.jobId);
    const total = rows.filter((r) => !r.internal).length;
    const completed = rows.filter((r) => !r.internal && r.state === "completed").length;
    const failed = rows.filter((r) => !r.internal && r.state === "failed").length;
    return {
      jobId: job.jobId,
      status: (await stores.jobs.getJob(job.jobId))!.status,
      total,
      completed,
      failed,
      remaining: Math.max(0, total - completed - failed),
      executing: counts.executing,
    };
  };

  const leased = await stores.jobs.acquireJobLease(job.jobId, owner, leaseMs);
  if (!leased) {
    // Another worker is advancing this job. Report the current state truthfully
    // rather than duplicating its work.
    const progress = await progressOf();
    return {
      jobId: job.jobId,
      completedThisRequest: 0,
      failedThisRequest: 0,
      remaining: progress.remaining,
      done: false,
      continuationRequired: progress.remaining > 0,
      busy: true,
      progress,
      reports: [],
      failures: [],
      deferred: [],
      retryAfterMs: null,
      memorySimulated: !memory.isLive,
      detail:
        "Another request is currently advancing this job; no work was started " +
        "to avoid a duplicate Mainnet write. Retry shortly to continue.",
    };
  }

  const reports: ScenarioRunReport[] = [];
  const failures: Array<{ stepId: string; title: string; error: string }> = [];
  const deferred: Array<{ stepId: string; title: string; reason: string; retryAfterMs: number }> = [];

  try {
    // Refresh the job so scratch reflects the latest durable state.
    let currentJob = (await stores.jobs.getJob(job.jobId))!;

    // Run at least one scenario, then keep going while the budget allows.
    // Making progress is unconditional: a caller that asks for a batch expects
    // at least one scenario to advance, even if its time budget is tiny, and
    // the budget is a *soft* ceiling checked between scenarios rather than a
    // hard stop that could return having done nothing.
    let first = true;
    while (first || now() - start < budgetMs) {
      first = false;
      // Re-assert ownership before claiming. A single scenario's two Mainnet
      // writes are not interruptible, so the batch can outlive a lease sized
      // for the request budget; renewing keeps a live worker's claim valid and
      // stops a second worker from starting the same job.
      const stillOurs = await stores.jobs.renewJobLease(job.jobId, owner, leaseMs);
      if (!stillOurs) break;

      const claimed = await stores.jobs.claimNextScenario(job.jobId, owner, leaseMs);
      if (!claimed) break;

      const { scenario } = claimed;
      const step = resolveStep(scenario.stepId, currentJob.scratch);
      if (!step) {
        const msg = `no step definition found for "${scenario.stepId}"`;
        await stores.jobs.failScenario(job.jobId, scenario.stepId, msg);
        failures.push({ stepId: scenario.stepId, title: scenario.title, error: msg });
        continue;
      }

      const ctx = await buildContext(opts, currentJob);
      try {
        // A scenario may be re-run after a crash; reconcile any write that was
        // accepted but never observed to complete before doing anything else.
        if (!step.internal) {
          await reconcilePendingWrites(stores, memory, deterministicIncidentId(currentJob.jobId, scenario.stepId));
        }
        if (step.prepare) await step.prepare(ctx);
        const report = await step.run(ctx);

        if (step.internal) {
          // An internal step persists scratch but is not a scenario result.
          await stores.jobs.completeScenario(job.jobId, scenario.stepId, report, []);
          currentJob = (await stores.jobs.getJob(job.jobId))!;
          // Finance discovery appends the live-case steps to the plan.
          if (scenario.stepId === "finance-live-cases") {
            const cases = (currentJob.scratch.financeCases as FinanceEvidenceCase[]) ?? [];
            await stores.jobs.addScenarios(job.jobId, planSteps(financeCaseSteps(cases)));
            currentJob = (await stores.jobs.getJob(job.jobId))!;
          }
          continue;
        }

        const writeIds = await writeIdsForIncident(stores, report.incidentId);
        await stores.jobs.completeScenario(job.jobId, scenario.stepId, report, writeIds);
        reports.push(report);
      } catch (err) {
        const msg = redact((err as Error).message ?? String(err));
        const transient = classifyTransient(err);
        if (transient.transient) {
          // The dependency refused to answer (rate limit, timeout, 5xx). That is
          // missing evidence, not a failed scenario: defer the row and stop the
          // batch so we do not hammer a dependency that just asked us to wait.
          const waitMs = transient.retryAfterMs ?? 30_000;
          await stores.jobs.deferScenario(
            job.jobId,
            scenario.stepId,
            `${transient.reason}: ${msg}`,
            new Date(now() + waitMs).toISOString(),
          );
          deferred.push({
            stepId: scenario.stepId,
            title: scenario.title,
            reason: `${transient.reason}: ${msg}`,
            retryAfterMs: waitMs,
          });
          break;
        }
        await stores.jobs.failScenario(job.jobId, scenario.stepId, msg);
        failures.push({ stepId: scenario.stepId, title: scenario.title, error: msg });
      }
    }
  } finally {
    await stores.jobs.releaseJobLease(job.jobId, owner);
  }

  // Decide the terminal state from durable state, not from this request alone.
  const rows = await stores.jobs.listScenarios(job.jobId);
  const scenarioRows = rows.filter((r) => !r.internal);
  const anyFailed = scenarioRows.some((r) => r.state === "failed");
  const allTerminal = scenarioRows.every(
    (r) => r.state === "completed" || r.state === "failed",
  );
  const remaining = scenarioRows.filter((r) => r.state === "pending" || r.state === "executing").length;

  if (allTerminal) {
    // A job with any failed scenario is reported as `failed`, not completed —
    // the brief forbids claiming a full demonstration completed unless every
    // required scenario reached its defined terminal state.
    await stores.jobs.finishJob(job.jobId, anyFailed ? "failed" : "completed", anyFailed
      ? `${scenarioRows.filter((r) => r.state === "failed").length} scenario(s) failed`
      : null);
  }

  const progress = await progressOf();
  const done = allTerminal && !anyFailed;
  const memorySimulated = !memory.isLive;
  // If the batch stopped early for a transient reason, the next request must
  // wait at least as long as the dependency asked. A retry that arrives before
  // the gate opens claims nothing, so derive the wait from the deferred rows'
  // `not_before` as well as from this request's own deferrals.
  const nowMs = now();
  const gatedWaits = scenarioRows
    .filter((r) => r.state === "pending" && r.notBefore)
    .map((r) => Math.max(0, Date.parse(r.notBefore as string) - nowMs))
    .filter((ms) => Number.isFinite(ms));
  const retryAfterMs = deferred.length
    ? Math.max(...deferred.map((d) => d.retryAfterMs))
    : gatedWaits.length
      ? Math.max(...gatedWaits)
      : null;

  return {
    jobId: job.jobId,
    completedThisRequest: reports.length,
    failedThisRequest: failures.length,
    remaining,
    done,
    continuationRequired: !allTerminal && remaining > 0,
    busy: false,
    progress,
    reports,
    failures,
    deferred,
    retryAfterMs,
    memorySimulated,
    detail: done
      ? "All scenarios reached their terminal state."
      : anyFailed
        ? `Job finished with failures: ${failures.map((f) => f.stepId).join(", ") || "see per-scenario errors"}.`
        : deferred.length
          ? `A dependency was transiently unavailable, so ${deferred.length} scenario(s) were deferred without a verdict. ${remaining} remaining; retry in ${Math.round((retryAfterMs ?? 0) / 1000)}s.`
          : retryAfterMs !== null
            ? `${remaining} scenario(s) are waiting out a transient dependency condition; retry in ${Math.round(retryAfterMs / 1000)}s.`
            : `Bounded batch complete (${reports.length} scenario(s) this request). ${remaining} remaining; call again to continue.`,
  };
}

/** Convenience: load a job's full scenario rows for the UI/verifier. */
export async function getJobScenarios(
  stores: DurableStores,
  jobId: string,
): Promise<DemoScenarioRow[]> {
  await stores.migrate();
  return stores.jobs.listScenarios(jobId);
}
