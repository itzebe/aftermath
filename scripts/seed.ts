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
import { resolveAuditStore } from "../src/lib/db/store-factory";
import { InMemoryWorkflowStateStore } from "../src/lib/adapters/workflow-state";
import { runAllScenarios } from "../src/lib/demos/runner";

const REQUIRED_MAINNET_WRITES = 10;

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const config = loadConfig();
  const store = resolveAuditStore(config);
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
  const status = await memory.adapter.status();
  console.log(`memory health  : ${health.ok ? "ok" : "unavailable"} — ${health.detail}`);
  console.log(`backend state  : ${status.state}`);
  console.log(`authenticated  : ${status.authenticated ? "yes" : "no"}`);
  console.log(`relayer transport: ${status.reachable ? "reachable" : "not reached"}`);
  console.log("");

  if (status.authFailed) {
    console.log(
      "STOP: the relayer is reachable but rejected the Walrus Memory credentials.\n" +
        "No Mainnet write can be attempted, so this run cannot satisfy the\n" +
        "requirement. Fix the credentials and retry:\n" +
        "  - the account ID must be a MemWalAccount object id (0x...), not a wallet address\n" +
        "  - the delegate public key must be registered on that account, on the SAME network\n" +
        "  - the relayer must be the Mainnet relayer for a Mainnet account\n" +
        `Detail: ${status.detail}\n`,
    );
    await store.close();
    return 1;
  }

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
    await store.saveScenarioRun(`seed-${Date.now()}`, result.ranAt, result);
    console.log(`Ran ${result.scenarios.length} scenario(s).`);
    console.log("");
  }

  const writes = await store.listMemoryWrites(2000);
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

  await store.close();
  return completed.length >= REQUIRED_MAINNET_WRITES ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("seed failed:", err);
    process.exit(1);
  });
