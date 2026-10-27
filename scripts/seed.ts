/**
 * Seed AFTERMATH with genuine memories through the configured backend.
 *
 * This script exists for the Walrus Memory requirement: it runs the controlled
 * scenarios and then *reports the truth* about how many completed and
 * recall-verified writes landed on Walrus Mainnet. It never fabricates a write,
 * never counts a simulated write toward the Mainnet total, and exits non-zero
 * when the ten-write requirement is not met.
 *
 * Usage:
 *   npm run seed            # run scenarios and report
 *   npm run seed -- --check # report only, do not re-run scenarios
 */

import { loadConfig, relayerNetwork } from "../src/lib/config";
import { resolveMemoryAdapter } from "../src/lib/adapters/memory-factory";
import { AftermathStore } from "../src/lib/db/store";
import { InMemoryWorkflowStateStore } from "../src/lib/adapters/workflow-state";
import { runAllScenarios } from "../src/lib/demos/runner";

const REQUIRED_MAINNET_WRITES = 10;

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const config = loadConfig();
  const store = new AftermathStore(config.dbPath);
  const memory = resolveMemoryAdapter(config);

  const network = relayerNetwork(config.memory.serverUrl);
  console.log("AFTERMATH seed");
  console.log("──────────────");
  console.log(`memory backend : ${memory.adapter.backend}`);
  console.log(`relayer        : ${config.memory.serverUrl} (${network})`);
  console.log(`namespace      : ${config.memory.namespace}`);
  console.log(`tatum rpc      : ${config.tatum.rpcUrl}`);
  console.log(`tatum key      : ${config.tatum.apiKey ? "configured" : "NOT configured"}`);
  console.log("");

  const health = await memory.adapter.validateMemoryAvailability();
  console.log(`memory health  : ${health.ok ? "ok" : "unavailable"} — ${health.detail}`);
  console.log("");

  if (!memory.adapter.isLive) {
    console.log(
      "WARNING: the memory backend is SIMULATED. Writes made here are not\n" +
        "stored on Walrus Mainnet and do not satisfy the submission requirement.\n" +
        "Set MEMWAL_PRIVATE_KEY and MEMWAL_ACCOUNT_ID to enable live writes.\n",
    );
  }

  if (!checkOnly) {
    console.log("Running controlled scenarios…");
    const result = await runAllScenarios({
      config,
      store,
      memory: memory.adapter,
      workflowStore: new InMemoryWorkflowStateStore(),
    });
    store.saveScenarioRun(`seed-${Date.now()}`, result.ranAt, result);
    console.log(`Ran ${result.scenarios.length} scenario(s).`);
    console.log("");
  }

  const writes = store.listMemoryWrites(2000);
  const live = writes.filter((w) => w.backend !== "simulated");
  const completed = live.filter((w) => w.state === "completed");
  const verified = live.filter((w) => w.recallVerified);
  const failed = writes.filter((w) => w.state === "failed");

  console.log("Memory write report");
  console.log("───────────────────");
  console.log(`total attempts          : ${writes.length}`);
  console.log(`simulated writes        : ${writes.length - live.length}`);
  console.log(`mainnet writes completed: ${completed.length}`);
  console.log(`mainnet recall-verified : ${verified.length}`);
  console.log(`failed writes           : ${failed.length}`);
  console.log("");
  console.log(
    `Requirement: ${REQUIRED_MAINNET_WRITES} completed Mainnet writes. ` +
      `${completed.length}/${REQUIRED_MAINNET_WRITES}.`,
  );

  if (completed.length < REQUIRED_MAINNET_WRITES) {
    console.log(
      `Remaining: ${REQUIRED_MAINNET_WRITES - completed.length}. ` +
        "Not satisfied — this is reported honestly rather than padded.",
    );
  } else if (verified.length < REQUIRED_MAINNET_WRITES) {
    console.log(
      `Completed writes meet the requirement, but only ${verified.length} are ` +
        "recall-verified. Run `npm run seed -- --check` after writes settle.",
    );
  } else {
    console.log("Requirement satisfied: ten completed, recall-verified Mainnet writes.");
  }

  store.close();
  return completed.length >= REQUIRED_MAINNET_WRITES ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("seed failed:", err);
    process.exit(1);
  });
