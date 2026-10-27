/**
 * Fresh-process recall demonstration.
 *
 * This script exists to prove one specific causal claim, in a process that
 * starts with *no* in-memory state: a lesson written earlier to Walrus
 * Mainnet, recalled from the live relayer, changes a later safeguard decision.
 *
 * The mechanism is the decision engine's UNKNOWN-evidence branch: with no
 * recalled lesson the outcome is undecided (UNKNOWN); with a recalled
 * corrective lesson the same action is deferred (REQUIRE_VERIFICATION). Both
 * arms use identical evidence — only the presence of a recalled Mainnet lesson
 * differs — so the difference is attributable to recall alone.
 *
 * The control arm uses an empty in-process store, which is the honest way to
 * represent "the state before any lesson was learned". The live arm uses the
 * real MemWal client against https://relayer.memory.walrus.xyz.
 *
 * Usage: npm run recall:demo
 */

import { loadConfig } from "../src/lib/config";
import { resolveMemoryAdapter } from "../src/lib/adapters/memory-factory";
import { AftermathStore } from "../src/lib/db/store";
import { IncidentPipeline } from "../src/lib/engines/pipeline";
import { FinanceEvidenceAdapter } from "../src/lib/adapters/finance-evidence";
import { buildSuiVerifier } from "../src/lib/demos/finance";
import { SimulatedMemoryAdapter } from "../src/lib/adapters/simulated-memory";
import type { IncidentInputDraft } from "../src/lib/schemas";

// An evidence lookup that cannot be completed, so the outcome is UNKNOWN.
// The engine must never turn this into success or failure.
const UNRESOLVABLE_DIGEST = "unavailable-probe";

function financeIncident(): IncidentInputDraft {
  return {
    domain: "finance",
    actionType: "report_sui_transaction_success",
    executionId: `recall-demo-${Date.now()}`,
    intendedOutcome: "Confirm the Sui transaction executed successfully",
    claimedOutcome: {
      claim: "The Sui transaction succeeded.",
      assertedStatus: "success",
    },
    evidenceReferences: [{ kind: "sui_tx_digest", ref: UNRESOLVABLE_DIGEST }],
    provenance: "simulated",
  };
}

async function main(): Promise<number> {
  const config = loadConfig();
  const store = new AftermathStore(":memory:");
  const memory = resolveMemoryAdapter(config);
  const tatum = buildSuiVerifier(config.tatum);

  const status = await memory.adapter.status();
  console.log("AFTERMATH recall demonstration (fresh process)");
  console.log("──────────────────────────────────────────────");
  console.log(`memory backend : ${memory.adapter.backend}`);
  console.log(`backend state  : ${status.state}`);
  console.log(`authenticated  : ${status.authenticated ? "yes" : "no"}`);
  console.log("");

  if (!memory.adapter.isLive || !status.authenticated) {
    console.log(
      "STOP: this demonstration requires a live, authenticated Mainnet backend.\n" +
        `Current state: ${status.state}. Fix credentials and retry.\n`,
    );
    store.close();
    return 1;
  }

  // ---- ARM A: the live backend, which recalls lessons written earlier -------
  const livePipeline = new IncidentPipeline({
    evidence: new FinanceEvidenceAdapter(tatum),
    memory: memory.adapter,
    store,
  });
  const live = await livePipeline.process(financeIncident(), {
    persistIncidentMemory: false,
    persistLessonMemory: false,
  });

  // ---- ARM B: the control — an empty store, i.e. before any lesson existed --
  const controlStore = new AftermathStore(":memory:");
  const controlPipeline = new IncidentPipeline({
    evidence: new FinanceEvidenceAdapter(tatum),
    memory: new SimulatedMemoryAdapter("recall-demo-control"),
    store: controlStore,
  });
  const control = await controlPipeline.process(financeIncident(), {
    persistIncidentMemory: false,
    persistLessonMemory: false,
  });

  console.log("Evidence (identical in both arms)");
  console.log("─────────────────────────────────");
  console.log(`status         : ${live.assessment.status}`);
  console.log(`verified       : ${live.assessment.verified}`);
  console.log(`explanation    : ${live.assessment.explanation}`);
  console.log("");

  console.log("Arm A — live Walrus Mainnet recall");
  console.log("──────────────────────────────────");
  console.log(`recalled lessons : ${live.recalledLessons}`);
  for (const id of live.recalledIds) console.log(`  blob id        : ${id}`);
  console.log(`decision         : ${live.decision.decision}`);
  console.log(`reason           : ${live.decision.reason}`);
  console.log("");

  console.log("Arm B — control (no prior lesson)");
  console.log("─────────────────────────────────");
  console.log(`recalled lessons : ${control.recalledLessons}`);
  console.log(`decision         : ${control.decision.decision}`);
  console.log(`reason           : ${control.decision.reason}`);
  console.log("");

  const changed = live.decision.decision !== control.decision.decision;
  const causedByRecall =
    live.recalledLessons > 0 &&
    live.decision.decision === "REQUIRE_VERIFICATION" &&
    control.decision.decision === "UNKNOWN";

  console.log("Conclusion");
  console.log("──────────");
  console.log(`decision changed by recalled Mainnet lesson : ${changed}`);
  console.log(`the change is attributable to recall        : ${causedByRecall}`);

  store.close();
  controlStore.close();
  return causedByRecall ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("recall demonstration failed:", err);
    process.exit(1);
  });
