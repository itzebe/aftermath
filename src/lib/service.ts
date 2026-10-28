import { runtime } from "@/lib/runtime";
import { loadConfig, relayerNetwork } from "@/lib/config";
import { maskSecret } from "@/lib/util/redact";
import { runAllScenarios, type DemoRunResult } from "@/lib/demos/runner";
import { runDemoBatch, type BatchResult } from "@/lib/demos/resumable-runner";
import { evaluate, type EvaluationMetrics, type ScenarioOutcome } from "@/lib/engines/evaluation";
import type { IncidentInputDraft } from "@/lib/schemas";

export interface ConfigurationStatus {
  memory: {
    backend: string;
    isLive: boolean;
    reason: string;
    relayerUrl: string;
    network: "mainnet" | "staging" | "unknown";
    namespace: string;
    accountId: string;
    privateKey: string;
  };
  tatum: {
    grpcUrl: string;
    rpcUrl: string;
    interface: string;
    apiKey: string;
    configured: boolean;
  };
  persistence: {
    backend: "sqlite" | "postgres";
    /** True only when records are shared across instances. */
    durable: boolean;
    detail: string;
  };
}

export function configurationStatus(): ConfigurationStatus {
  const rt = runtime();
  const config = loadConfig();
  return {
    memory: {
      backend: rt.memory.adapter.backend,
      isLive: rt.memory.adapter.isLive,
      reason: rt.memory.reason,
      relayerUrl: config.memory.serverUrl,
      network: relayerNetwork(config.memory.serverUrl),
      namespace: config.memory.namespace,
      accountId: maskSecret(config.memory.accountId),
      privateKey: maskSecret(config.memory.privateKey),
    },
    tatum: {
      grpcUrl: config.tatum.grpcUrl,
      rpcUrl: config.tatum.rpcUrl,
      interface: rt.suiVerifier.sourceName,
      apiKey: maskSecret(config.tatum.apiKey),
      configured: Boolean(config.tatum.apiKey),
    },
    persistence: {
      backend: rt.store.backend,
      durable: rt.store.durable,
      detail: rt.store.detail,
    },
  };
}

export interface StoreCounts {
  incidents: number;
  verifiedFailures: number;
  activeRules: number;
  unresolved: number;
  completedLiveWrites: number;
  recallVerifiedWrites: number;
  simulatedWrites: number;
  totalWrites: number;
}

export interface OverviewPayload {
  counts: StoreCounts;
  configuration: ConfigurationStatus;
  tatumHealth: Awaited<ReturnType<ReturnType<typeof runtime>["suiVerifier"]["health"]>>;
  memoryHealth: Awaited<ReturnType<ReturnType<typeof runtime>["memory"]["adapter"]["validateMemoryAvailability"]>>;
  memoryStatus: Awaited<ReturnType<ReturnType<typeof runtime>["memory"]["adapter"]["status"]>>;
  mainnetRequirement: {
    required: number;
    completedLive: number;
    recallVerified: number;
    remaining: number;
    satisfied: boolean;
  };
  evaluation: EvaluationMetrics | null;
  lastRunAt: string | null;
}

export async function getOverview(): Promise<OverviewPayload> {
  const rt = runtime();
  const counts = await rt.store.counts();
  const [tatumHealth, memoryHealth, memoryStatus] = await Promise.all([
    rt.suiVerifier.health(),
    rt.memory.adapter.validateMemoryAvailability(),
    rt.memory.adapter.status(),
  ]);

  const lastRun = (await rt.store.listScenarioRuns(1))[0];

  let evaluation: EvaluationMetrics | null = null;
  if (lastRun) {
    const payload = lastRun.payload as DemoRunResult;
    evaluation = evaluate(payload.scenarios.map((s) => s.outcome));
  }

  const required = 10;
  const completedLive = counts.completedLiveWrites;

  return {
    counts,
    configuration: configurationStatus(),
    tatumHealth,
    memoryHealth,
    memoryStatus,
    mainnetRequirement: {
      required,
      completedLive,
      recallVerified: counts.recallVerifiedWrites,
      remaining: Math.max(0, required - completedLive),
      satisfied: completedLive >= required,
    },
    evaluation,
    lastRunAt: lastRun?.ranAt ?? null,
  };
}

export async function runScenarios(): Promise<DemoRunResult> {
  const rt = runtime();
  // A scenario run is a controlled demonstration, so it starts from a known
  // state. Without this, incidents, rules, and simulated memories accumulate
  // across runs and the same button produces different numbers each time.
  // Live Mainnet write records are preserved: they are irreversible on-chain
  // artefacts and the ledger must keep counting them.
  await rt.store.resetSimulated();
  await rt.memory.adapter.reset?.();
  const result = await runAllScenarios({
    config: loadConfig(),
    store: rt.store,
    memory: rt.memory.adapter,
    workflowStore: rt.workflowStore,
  });
  await rt.store.saveScenarioRun(`run-${Date.now()}`, result.ranAt, result);
  return result;
}

/**
 * Run one bounded batch of the resumable demonstration.
 *
 * This is the production entry point. A single serverless invocation cannot
 * complete every scenario inside the host's time limit, so the plan is advanced
 * in bounded slices and progress is persisted after each scenario. The caller
 * repeats until `continuationRequired` is false.
 */
export async function runScenarioBatch(options: {
  restart?: boolean;
  budgetMs?: number;
} = {}): Promise<BatchResult> {
  const rt = runtime();
  const result = await runDemoBatch({
    stores: rt.durable,
    config: loadConfig(),
    memory: rt.memory.adapter,
    restart: options.restart,
    budgetMs: options.budgetMs,
  });
  // Persist a run snapshot only when the job has actually reached a terminal
  // state, so the evaluation panel never shows a partial run as if it were
  // the finished demonstration. The snapshot is the *whole* job's reports,
  // loaded from the durable store, not just this request's slice.
  if (result.done || (!result.continuationRequired && result.progress.failed > 0)) {
    const rows = await rt.durable.jobs.listScenarios(result.jobId);
    const scenarios = rows
      .filter((r) => !r.internal && r.report)
      .map((r) => r.report!) as DemoRunResult["scenarios"];
    const ranAt = new Date().toISOString();
    await rt.store.saveScenarioRun(`run-${Date.now()}`, ranAt, {
      ranAt,
      scenarios,
      memoryBackend: rt.memory.adapter.backend,
      memoryDegraded: !rt.memory.adapter.isLive,
      memoryReason: rt.memory.adapter.isLive
        ? "Live Walrus Memory backend."
        : "Simulated memory backend (credentials not configured).",
    });
  }
  return result;
}

/** Progress of the current (or latest) resumable demonstration, for the UI. */
export async function getDemoProgress(): Promise<{
  jobId: string;
  status: string;
  total: number;
  completed: number;
  failed: number;
  remaining: number;
  scenarios: Array<{
    stepId: string;
    title: string;
    domain: string;
    simulated: boolean;
    state: string;
    attempts: number;
    decision?: string;
    evidenceStatus?: string;
    error?: string | null;
  }>;
} | null> {
  const rt = runtime();
  await rt.durable.migrate();
  const job = await rt.durable.jobs.latestJob();
  if (!job) return null;
  const rows = await rt.durable.jobs.listScenarios(job.jobId);
  const visible = rows.filter((r) => !r.internal);
  return {
    jobId: job.jobId,
    status: job.status,
    total: visible.length,
    completed: visible.filter((r) => r.state === "completed").length,
    failed: visible.filter((r) => r.state === "failed").length,
    remaining: visible.filter((r) => r.state === "pending" || r.state === "executing").length,
    scenarios: visible.map((r) => ({
      stepId: r.stepId,
      title: r.title,
      domain: r.domain,
      simulated: r.simulated,
      state: r.state,
      attempts: r.attempts,
      decision: r.report?.decision,
      evidenceStatus: r.report?.evidenceStatus,
      error: r.lastError,
    })),
  };
}

export async function getIncidents(limit = 200) {
  return runtime().store.listIncidents(limit);
}

export async function getRules() {
  return runtime().store.listRules();
}

export async function getMemoryWrites(limit = 500) {
  return runtime().store.listMemoryWrites(limit);
}

export async function getEvaluation(): Promise<EvaluationMetrics | null> {
  const rt = runtime();
  const lastRun = (await rt.store.listScenarioRuns(1))[0];
  if (!lastRun) return null;
  const payload = lastRun.payload as DemoRunResult;
  return evaluate(payload.scenarios.map((s) => s.outcome));
}

export async function getScenarioOutcomes(): Promise<ScenarioOutcome[]> {
  const rt = runtime();
  const lastRun = (await rt.store.listScenarioRuns(1))[0];
  if (!lastRun) return [];
  const payload = lastRun.payload as DemoRunResult;
  return payload.scenarios.map((s) => s.outcome);
}

export async function getLastRun(): Promise<DemoRunResult | null> {
  const lastRun = (await runtime().store.listScenarioRuns(1))[0];
  return lastRun ? (lastRun.payload as DemoRunResult) : null;
}

export async function resetAll(): Promise<void> {
  await runtime().store.reset();
}

export type { IncidentInputDraft };
