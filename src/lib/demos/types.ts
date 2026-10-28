import type { ScenarioOutcome } from "@/lib/engines/evaluation";
import type { AftermathConfig } from "@/lib/config";
import type { AuditStore } from "@/lib/db/audit-store";
import type { MemoryAdapter } from "@/lib/adapters/memory";
import type { WorkflowStateStore } from "@/lib/adapters/workflow-state";
import type { FinanceEvidenceCase } from "@/lib/demos/finance";

/** The report a single demonstration scenario produces. */
export interface ScenarioRunReport {
  scenarioId: string;
  domain: "finance" | "coding" | "workflow";
  title: string;
  description: string;
  simulated: boolean;
  /** Steps shown in the UI timeline. */
  steps: Array<{ label: string; detail: string; tone?: "neutral" | "ok" | "warn" | "bad" }>;
  outcome: ScenarioOutcome;
  incidentId: string;
  decision: string;
  evidenceStatus: string;
  memoryBlobId?: string;
  recallVerified: boolean;
}

export interface DemoRunResult {
  ranAt: string;
  scenarios: ScenarioRunReport[];
  memoryBackend: string;
  memoryDegraded: boolean;
  memoryReason: string;
}

/**
 * Everything a scenario step needs. Rebuilt for every request from durable
 * state, so no step may rely on process memory surviving between requests.
 *
 * `scratch` is cross-step state that must itself be durable: the finance
 * discovery results are persisted with the job so a later batch can rebuild the
 * same plan on a different instance.
 */
export interface RunContext {
  config: AftermathConfig;
  store: AuditStore;
  memory: MemoryAdapter;
  workflowStore: WorkflowStateStore;
  /** The demonstration this step belongs to; drives deterministic ids. */
  jobId: string;
  scratch: {
    financeCases?: FinanceEvidenceCase[];
  };
  /** Persist cross-step state durably so a later batch can reuse it. */
  setScratch(next: Record<string, unknown>): Promise<void>;
  /** Directory roots, derived from config so they are identical per instance. */
  paths: {
    codingBase: string;
    artifacts: string;
  };
}

/** A single, independently resumable scenario. */
export interface StepDefinition {
  stepId: string;
  ordinal: number;
  domain: "finance" | "coding" | "workflow";
  title: string;
  /** True when the scenario does not reflect a real ledger entry. */
  simulated: boolean;
  /**
   * True for a setup step (e.g. discovering the live finance cases) that must
   * run durably but is not itself one of the demonstration scenarios. Internal
   * steps are excluded from the reported scenario list and from progress
   * counts, so a judge never sees infrastructure counted as a result.
   */
  internal?: boolean;
  /**
   * Put the world into the absolute state this step requires.
   *
   * It must be idempotent and must not perform a Mainnet write, because a step
   * may be prepared again after a crash. Absolute (not incremental) setup is
   * what makes the ground truth reproducible regardless of which scenarios ran
   * before on this instance.
   */
  prepare?(ctx: RunContext): Promise<void>;
  run(ctx: RunContext): Promise<ScenarioRunReport>;
}
