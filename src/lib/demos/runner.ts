import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AuditStore } from "@/lib/db/audit-store";
import type { MemoryAdapter } from "@/lib/adapters/memory";
import type { WorkflowStateStore } from "@/lib/adapters/workflow-state";
import type { AftermathConfig } from "@/lib/config";
import { runHarnessOnce, setupCodingHarness } from "@/lib/demos/coding";
import {
  DEMO_STEPS,
  financeCaseSteps,
  planSteps,
  runHarnessStatus,
} from "@/lib/demos/plan";
import type {
  DemoRunResult,
  RunContext,
  ScenarioRunReport,
  StepDefinition,
} from "@/lib/demos/types";

export type { DemoRunResult, ScenarioRunReport } from "@/lib/demos/types";
export { runHarnessStatus };

/**
 * Sequential runner: executes the whole plan in one pass, in process.
 *
 * This is a second executor for the same plan the resumable bounded-batch
 * runner executes. It is used by the test suite and the seed script, where a
 * single long-lived process is available. The production route uses the
 * resumable runner instead, because a serverless function cannot run the whole
 * plan inside its time limit.
 *
 * Keeping both means a step's `prepare` must be genuinely self-contained: if it
 * silently depends on an earlier step having run in the same process, running
 * the plan this way would hide it while the batch runner would not.
 */
export async function runAllScenarios(deps: {
  config: AftermathConfig;
  store: AuditStore;
  memory: MemoryAdapter;
  workflowStore: WorkflowStateStore;
}): Promise<DemoRunResult> {
  const { config, store, memory, workflowStore } = deps;
  const jobId = `seq-${Date.now()}-${randomUUID().slice(0, 8)}`;

  // A scenario run is a controlled demonstration, so it must start from a
  // known state. Clearing simulated state and workflow state here (while
  // leaving live Mainnet write records intact) makes every run reproducible.
  await store.resetSimulated();
  await workflowStore.resetAll();

  const scratch: RunContext["scratch"] = {};
  const ctx: RunContext = {
    config,
    store,
    memory,
    workflowStore,
    jobId,
    scratch,
    async setScratch(next) {
      Object.assign(scratch, next);
    },
    paths: {
      codingBase: path.join(config.harnessDir, "coding"),
      artifacts: path.join(config.harnessDir, "artifacts"),
    },
  };

  const scenarios: ScenarioRunReport[] = [];
  const runStep = async (step: StepDefinition) => {
    if (step.prepare) await step.prepare(ctx);
    const report = await step.run(ctx);
    if (!step.internal) scenarios.push(report);
  };

  for (const step of DEMO_STEPS) {
    await runStep(step);
    // Finance discovery populates scratch; its case steps are appended here.
    if (step.stepId === "finance-live-cases") {
      for (const caseStep of financeCaseSteps(ctx.scratch.financeCases ?? [])) {
        await runStep(caseStep);
      }
    }
  }

  return {
    ranAt: new Date().toISOString(),
    scenarios,
    memoryBackend: memory.backend,
    memoryDegraded: !memory.isLive,
    memoryReason: memory.isLive
      ? "Live Walrus Memory backend."
      : "Simulated memory backend (credentials not configured).",
  };
}

/** Exported for tests: run a single harness pass and return raw evidence. */
export async function runCodingHarnessEvidence(
  harnessDir: string,
  variant: "buggy" | "fixed",
) {
  const paths = await setupCodingHarness(harnessDir, variant);
  return runHarnessOnce(paths.dir, path.join(harnessDir, `raw-${variant}.json`));
}

/** Exported for tests: the persisted plan shape, without running anything. */
export function demoPlan() {
  return planSteps(DEMO_STEPS);
}
