/**
 * Seed the isolated E2E database with a real scenario run.
 *
 * This is the counterpart to `global-setup.ts`: it is a small `tsx` program, run
 * once before the browser suite, that executes the genuine controlled scenarios
 * against the *simulated* memory backend and persists the result to the
 * E2E SQLite file. That gives the operator surfaces (the scenario table, the
 * incident explorer, the evaluation metrics) the state they render, so the
 * browser tests assert the populated product instead of its empty state.
 *
 * It is deliberately NOT a fixture: it does not hand-write rows. It calls the
 * same `runAllScenarios` the seed script and the production operator use, so the
 * records it produces are the records the product produces. The only difference
 * from production is the memory backend (simulated) and the database file
 * (isolated), both of which the E2E suite already asserts are labelled as such.
 */

import { loadConfig } from "../src/lib/config";
import { resolveAuditStore } from "../src/lib/db/store-factory";
import { resolveMemoryAdapter } from "../src/lib/adapters/memory-factory";
import { InMemoryWorkflowStateStore } from "../src/lib/adapters/workflow-state";
import { runAllScenarios } from "../src/lib/demos/runner";

async function main(): Promise<void> {
  const config = loadConfig();
  const store = resolveAuditStore(config);
  const memory = resolveMemoryAdapter(config);

  if (memory.adapter.isLive) {
    throw new Error(
      "Refusing to seed the E2E database against a live memory backend. " +
        "AFTERMATH_FORCE_MOCK_MEMORY must be set to 1.",
    );
  }

  const result = await runAllScenarios({
    config,
    store,
    memory: memory.adapter,
    workflowStore: new InMemoryWorkflowStateStore(),
  });
  await store.saveScenarioRun(`e2e-seed-${Date.now()}`, result.ranAt, result);
  await store.close();

  console.log(
    `E2E seed: ran ${result.scenarios.length} controlled scenario(s) against the ` +
      `simulated backend into ${config.dbPath}.`,
  );
}

main().catch((err) => {
  console.error("E2E seed failed:", err);
  process.exit(1);
});
