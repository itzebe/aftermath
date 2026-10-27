import path from "node:path";
import type { ProcessResult } from "@/lib/engines/pipeline";
import { IncidentPipeline } from "@/lib/engines/pipeline";
import type { ScenarioOutcome } from "@/lib/engines/evaluation";
import { TatumSuiAdapter } from "@/lib/adapters/tatum-sui";
import { FinanceEvidenceAdapter } from "@/lib/adapters/finance-evidence";
import { WorkflowEvidenceAdapter } from "@/lib/adapters/workflow-evidence";
import type { InMemoryWorkflowStateStore } from "@/lib/adapters/workflow-state";
import type { AftermathStore } from "@/lib/db/store";
import type { MemoryAdapter } from "@/lib/adapters/memory";
import type { AftermathConfig } from "@/lib/config";
import {
  applyFix,
  applyRegression,
  makeCodingAdapter,
  runHarnessOnce,
  setupCodingHarness,
} from "@/lib/demos/coding";
import { runFinanceEvidenceCases } from "@/lib/demos/finance";
import { DEPLOY_WORKFLOW } from "@/lib/demos/workflow";

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

function toOutcome(
  scenarioId: string,
  groundTruthFailure: boolean,
  agentClaimedSuccess: boolean,
  result: ProcessResult,
  safeguardApplied: boolean,
  isRepeat: boolean,
): ScenarioOutcome {
  return {
    scenarioId,
    groundTruthFailure,
    isRepeat,
    agentClaimedSuccess,
    decision: result.decision.decision,
    evidenceStatus: result.assessment.status,
    safeguardApplied,
    lessonStored: Boolean(result.lessonWrite?.state === "completed"),
    lessonRecalled: result.recalledLessons > 0,
    provenance: result.incident.provenance,
  };
}

/**
 * Run every controlled scenario in order. Scenarios share one store so that a
 * safeguard activated by an early failure is available to a later scenario —
 * that is the whole point of the product.
 */
export async function runAllScenarios(deps: {
  config: AftermathConfig;
  store: AftermathStore;
  memory: MemoryAdapter;
  workflowStore: InMemoryWorkflowStateStore;
}): Promise<DemoRunResult> {
  const { config, store, memory, workflowStore } = deps;
  const scenarios: ScenarioRunReport[] = [];

  // A scenario run is a controlled demonstration, so it must start from a
  // known state. The workflow store is the only store that survives between
  // runs (the incident store is reset separately); without this, a second run
  // would see the prerequisite already completed and the workflow scenarios
  // would invert. Reset it here so every run reproduces the first.
  await workflowStore.resetAll();

  // ---- CODING ------------------------------------------------------------
  const codingBase = path.join(config.harnessDir, "coding");
  const buggy = await setupCodingHarness(codingBase, "buggy");
  const codingEvidence = makeCodingAdapter(path.join(config.harnessDir, "artifacts"), buggy.dir);
  const codingPipeline = new IncidentPipeline({ evidence: codingEvidence, memory, store });

  // C1: agent claims the bug is fixed, but never ran the tests.
  const c1 = await codingPipeline.process({
    domain: "coding",
    actionType: "report_bug_fixed",
    executionId: "coding-c1",
    intendedOutcome: "add() returns the arithmetic sum",
    claimedOutcome: {
      claim: "Fixed the add() bug. The function now returns a + b.",
      assertedStatus: "success",
    },
    evidenceReferences: [],
    provenance: "simulated",
  });
  scenarios.push({
    scenarioId: "coding-claim-without-tests",
    domain: "coding",
    title: "Fix claimed with no test run",
    description:
      "A coding agent asserts the bug is fixed but supplies no test-run evidence.",
    simulated: true,
    steps: [
      { label: "Agent claim", detail: c1.incident.claimedOutcome?.claim ?? "", tone: "neutral" },
      { label: "Evidence", detail: c1.assessment.explanation, tone: "warn" },
      { label: "Decision", detail: c1.decision.reason, tone: "warn" },
    ],
    outcome: toOutcome("coding-claim-without-tests", true, true, c1, false, false),
    incidentId: c1.incident.incidentId,
    decision: c1.decision.decision,
    evidenceStatus: c1.assessment.status,
    memoryBlobId: c1.lessonWrite?.blobId,
    recallVerified: Boolean(c1.lessonWrite?.recallVerified),
  });

  // C2: the tests really are run against the still-buggy code and fail.
  const c2 = await codingPipeline.process({
    domain: "coding",
    actionType: "report_bug_fixed",
    executionId: "coding-c2",
    intendedOutcome: "add() returns the arithmetic sum",
    claimedOutcome: {
      claim: "Fixed the add() bug. Tests pass.",
      assertedStatus: "success",
    },
    evidenceReferences: [
      { kind: "test_run", ref: "calc.test.js", note: "controlled node:test suite" },
    ],
    provenance: "simulated",
  });
  scenarios.push({
    scenarioId: "coding-tests-fail",
    domain: "coding",
    title: "Tests executed and failing",
    description:
      "The controlled test suite runs against the unfixed module. The exit code and failure count are captured from the process.",
    simulated: true,
    steps: [
      { label: "Agent claim", detail: c2.incident.claimedOutcome?.claim ?? "", tone: "neutral" },
      { label: "Test run", detail: c2.assessment.explanation, tone: "bad" },
      { label: "Decision", detail: c2.decision.reason, tone: "bad" },
    ],
    outcome: toOutcome("coding-tests-fail", true, true, c2, false, false),
    incidentId: c2.incident.incidentId,
    decision: c2.decision.decision,
    evidenceStatus: c2.assessment.status,
    memoryBlobId: c2.lessonWrite?.blobId,
    recallVerified: Boolean(c2.lessonWrite?.recallVerified),
  });

  // C3: the real fix is applied, the tests run, and they pass.
  await applyFix(buggy);
  const c3 = await codingPipeline.process({
    domain: "coding",
    actionType: "report_bug_fixed",
    executionId: "coding-c3",
    intendedOutcome: "add() returns the arithmetic sum",
    claimedOutcome: {
      claim: "Fixed the add() bug. Tests pass.",
      assertedStatus: "success",
    },
    evidenceReferences: [
      { kind: "test_run", ref: "calc.test.js", note: "controlled node:test suite" },
    ],
    provenance: "simulated",
  });
  scenarios.push({
    scenarioId: "coding-tests-pass",
    domain: "coding",
    title: "Tests executed and passing",
    description:
      "The fix is applied for real and the same suite is re-run. Verification now succeeds.",
    simulated: true,
    steps: [
      { label: "Fix applied", detail: "add() now returns a + b", tone: "neutral" },
      { label: "Test run", detail: c3.assessment.explanation, tone: "ok" },
      { label: "Decision", detail: c3.decision.reason, tone: "ok" },
    ],
    outcome: toOutcome("coding-tests-pass", false, true, c3, false, false),
    incidentId: c3.incident.incidentId,
    decision: c3.decision.decision,
    evidenceStatus: c3.assessment.status,
    memoryBlobId: c3.lessonWrite?.blobId,
    recallVerified: Boolean(c3.lessonWrite?.recallVerified),
  });

  // C4: a regression is reintroduced and a *new* claim of success is made.
  //     The active safeguard from C2 must catch it.
  await applyRegression(buggy);
  const activeCodingRules = store
    .listActiveRules()
    .filter((r) => r.domain === "coding" && r.validationStatus === "active");
  const c4 = await codingPipeline.process({
    domain: "coding",
    actionType: "report_bug_fixed",
    executionId: "coding-c4",
    intendedOutcome: "add() returns the arithmetic sum",
    claimedOutcome: {
      claim: "Fixed the add() bug. Tests pass.",
      assertedStatus: "success",
    },
    evidenceReferences: [
      { kind: "test_run", ref: "calc.test.js", note: "controlled node:test suite" },
    ],
    provenance: "simulated",
  });
  scenarios.push({
    scenarioId: "coding-regression-with-safeguard",
    domain: "coding",
    title: "Regression caught by an active safeguard",
    description:
      "The bug is reintroduced. The safeguard stored from the earlier failure is active, so the repeat claim is refused.",
    simulated: true,
    steps: [
      {
        label: "Safeguard",
        detail: activeCodingRules.length
          ? `Active rule(s): ${activeCodingRules.map((r) => `${r.ruleId}@v${r.version}`).join(", ")}`
          : "No active coding rule was present.",
        tone: activeCodingRules.length ? "ok" : "warn",
      },
      { label: "Test run", detail: c4.assessment.explanation, tone: "bad" },
      { label: "Decision", detail: c4.decision.reason, tone: "bad" },
    ],
    outcome: toOutcome(
      "coding-regression-with-safeguard",
      true,
      true,
      c4,
      activeCodingRules.length > 0,
      true,
    ),
    incidentId: c4.incident.incidentId,
    decision: c4.decision.decision,
    evidenceStatus: c4.assessment.status,
    memoryBlobId: c4.lessonWrite?.blobId,
    recallVerified: Boolean(c4.lessonWrite?.recallVerified),
  });

  // ---- WORKFLOW ----------------------------------------------------------
  const workflowEvidence = new WorkflowEvidenceAdapter({
    definition: DEPLOY_WORKFLOW,
    store: workflowStore,
  });
  const workflowPipeline = new IncidentPipeline({
    evidence: workflowEvidence,
    memory,
    store,
  });

  // W1: the operation is attempted before the validation step has run. The
  //     attempt genuinely fails and the failure is written to persisted state
  //     *first*, so the evidence the engine reads is authoritative rather than
  //     a prediction. Only then is the incident evaluated.
  await workflowStore.recordAttempt(
    DEPLOY_WORKFLOW.workflowId,
    "failure",
    "missing prerequisite: schema_validation",
  );
  const w1 = await workflowPipeline.preflight(
    {
      domain: "workflow",
      actionType: DEPLOY_WORKFLOW.operation,
      executionId: "workflow-w1",
      intendedOutcome: "Publish the artifact to the registry",
      evidenceReferences: [{ kind: "workflow_state", ref: DEPLOY_WORKFLOW.workflowId }],
      relevantContext: { workflowId: DEPLOY_WORKFLOW.workflowId },
      provenance: "simulated",
    },
    [
      {
        id: "schema_validation",
        satisfied: false,
        description: DEPLOY_WORKFLOW.requiredPrerequisites[0].description,
      },
    ],
  );
  scenarios.push({
    scenarioId: "workflow-first-attempt",
    domain: "workflow",
    title: "First attempt skips the prerequisite",
    description:
      "The operation was attempted before the validation step ran. It failed, and the failure plus the missing prerequisite were written to persisted state.",
    simulated: true,
    steps: [
      { label: "Attempt", detail: "Operation attempted with schema_validation incomplete.", tone: "bad" },
      { label: "Evidence", detail: w1.assessment.explanation, tone: "bad" },
      { label: "Decision", detail: w1.decision.reason, tone: "warn" },
    ],
    outcome: toOutcome("workflow-first-attempt", true, false, w1, false, false),
    incidentId: w1.incident.incidentId,
    decision: w1.decision.decision,
    evidenceStatus: w1.assessment.status,
    memoryBlobId: w1.lessonWrite?.blobId,
    recallVerified: Boolean(w1.lessonWrite?.recallVerified),
  });

  // W2: second attempt, still missing the prerequisite. The safeguard from W1
  //     is now active and must block the repeat.
  const activeWorkflowRules = store
    .listActiveRules()
    .filter((r) => r.domain === "workflow" && r.validationStatus === "active");
  const w2 = await workflowPipeline.preflight(
    {
      domain: "workflow",
      actionType: DEPLOY_WORKFLOW.operation,
      executionId: "workflow-w2",
      intendedOutcome: "Publish the artifact to the registry",
      evidenceReferences: [{ kind: "workflow_state", ref: DEPLOY_WORKFLOW.workflowId }],
      relevantContext: { workflowId: DEPLOY_WORKFLOW.workflowId },
      provenance: "simulated",
    },
    [
      {
        id: "schema_validation",
        satisfied: false,
        description: DEPLOY_WORKFLOW.requiredPrerequisites[0].description,
      },
    ],
  );
  scenarios.push({
    scenarioId: "workflow-repeat-refused",
    domain: "workflow",
    title: "Repeat attempt refused by the safeguard",
    description:
      "The same unmet prerequisite is detected. The recalled lesson and active rule prevent the repeat failure.",
    simulated: true,
    steps: [
      {
        label: "Safeguard",
        detail: activeWorkflowRules.length
          ? `Active rule(s): ${activeWorkflowRules.map((r) => `${r.ruleId}@v${r.version}`).join(", ")}`
          : "No active workflow rule was present.",
        tone: activeWorkflowRules.length ? "ok" : "warn",
      },
      { label: "Decision", detail: w2.decision.reason, tone: "warn" },
    ],
    outcome: toOutcome(
      "workflow-repeat-refused",
      true,
      false,
      w2,
      activeWorkflowRules.length > 0,
      true,
    ),
    incidentId: w2.incident.incidentId,
    decision: w2.decision.decision,
    evidenceStatus: w2.assessment.status,
    memoryBlobId: w2.lessonWrite?.blobId,
    recallVerified: Boolean(w2.lessonWrite?.recallVerified),
  });

  // W3: the prerequisite genuinely completes. The operation must now be allowed.
  await workflowStore.markPrerequisiteComplete(DEPLOY_WORKFLOW.workflowId, "schema_validation");
  const w3 = await workflowPipeline.preflight(
    {
      domain: "workflow",
      actionType: DEPLOY_WORKFLOW.operation,
      executionId: "workflow-w3",
      intendedOutcome: "Publish the artifact to the registry",
      evidenceReferences: [{ kind: "workflow_state", ref: DEPLOY_WORKFLOW.workflowId }],
      relevantContext: { workflowId: DEPLOY_WORKFLOW.workflowId },
      provenance: "simulated",
    },
    [
      {
        id: "schema_validation",
        satisfied: true,
        description: DEPLOY_WORKFLOW.requiredPrerequisites[0].description,
      },
    ],
  );
  await workflowStore.recordAttempt(DEPLOY_WORKFLOW.workflowId, "success");
  scenarios.push({
    scenarioId: "workflow-valid-allowed",
    domain: "workflow",
    title: "Valid operation still allowed",
    description:
      "Once the prerequisite genuinely completes, the safeguard permits the operation. Safeguards must not block everything.",
    simulated: true,
    steps: [
      { label: "Prerequisite", detail: "schema_validation completed (persisted).", tone: "ok" },
      { label: "Decision", detail: w3.decision.reason, tone: "ok" },
    ],
    outcome: toOutcome("workflow-valid-allowed", false, false, w3, activeWorkflowRules.length > 0, false),
    incidentId: w3.incident.incidentId,
    decision: w3.decision.decision,
    evidenceStatus: w3.assessment.status,
    memoryBlobId: w3.lessonWrite?.blobId,
    recallVerified: Boolean(w3.lessonWrite?.recallVerified),
  });

  // ---- FINANCE -----------------------------------------------------------
  const tatum = new TatumSuiAdapter(config.tatum);
  const financeEvidence = new FinanceEvidenceAdapter(tatum);
  const financePipeline = new IncidentPipeline({
    evidence: financeEvidence,
    memory,
    store,
  });
  const financeCases = await runFinanceEvidenceCases(config.tatum);

  // F1: unavailable evidence. The agent claims success; the engine must not
  //     accept it and must not claim the transaction failed either.
  const unavailableDigest = "unavailable-probe";
  const f1 = await financePipeline.process({
    domain: "finance",
    actionType: "report_sui_transaction_success",
    executionId: "finance-f1",
    intendedOutcome: "Confirm the Sui transaction executed successfully",
    claimedOutcome: {
      claim: "The Sui transaction succeeded.",
      assertedStatus: "success",
    },
    evidenceReferences: [{ kind: "sui_tx_digest", ref: unavailableDigest }],
    provenance: "simulated",
  });
  scenarios.push({
    scenarioId: "finance-unsupported-claim",
    domain: "finance",
    title: "Success claimed with no authoritative lookup",
    description:
      "The agent reports a Sui transaction as successful. No authoritative lookup can be completed, so success is not established.",
    simulated: true,
    steps: [
      { label: "Agent claim", detail: f1.incident.claimedOutcome?.claim ?? "", tone: "neutral" },
      { label: "Evidence", detail: f1.assessment.explanation, tone: "warn" },
      { label: "Decision", detail: f1.decision.reason, tone: "warn" },
    ],
    outcome: toOutcome("finance-unsupported-claim", true, true, f1, false, false),
    incidentId: f1.incident.incidentId,
    decision: f1.decision.decision,
    evidenceStatus: f1.assessment.status,
    memoryBlobId: f1.lessonWrite?.blobId,
    recallVerified: Boolean(f1.lessonWrite?.recallVerified),
  });

  // F2+: live on-chain cases, when a key is configured.
  for (const c of financeCases.cases) {
    if (!c.digest) continue;
    const claimed = c.status === "VERIFIED_SUCCESS";
    const f = await financePipeline.process({
      domain: "finance",
      actionType: "report_sui_transaction_success",
      executionId: `finance-${c.scenarioId}`,
      intendedOutcome: "Confirm the Sui transaction executed successfully",
      claimedOutcome: {
        claim: claimed
          ? "The Sui transaction succeeded."
          : "The Sui transaction succeeded.",
        assertedStatus: "success",
      },
      evidenceReferences: [{ kind: "sui_tx_digest", ref: c.digest }],
      provenance: c.simulated ? "simulated" : "live",
    });
    scenarios.push({
      scenarioId: c.scenarioId,
      domain: "finance",
      title: c.label,
      description: c.simulated
        ? "This case does not reflect a real ledger entry and is labelled as simulated."
        : "Digest discovered from the live Sui ledger and verified through Tatum.",
      simulated: c.simulated,
      steps: [
        { label: "Digest", detail: c.digest, tone: "neutral" },
        { label: "Evidence", detail: f.assessment.explanation, tone: f.assessment.verified ? (f.assessment.status === "VERIFIED_SUCCESS" ? "ok" : "bad") : "warn" },
        { label: "Decision", detail: f.decision.reason, tone: f.decision.decision === "ALLOW" ? "ok" : "warn" },
      ],
      outcome: toOutcome(
        c.scenarioId,
        c.status !== "VERIFIED_SUCCESS",
        true,
        f,
        false,
        false,
      ),
      incidentId: f.incident.incidentId,
      decision: f.decision.decision,
      evidenceStatus: f.assessment.status,
      memoryBlobId: f.lessonWrite?.blobId,
      recallVerified: Boolean(f.lessonWrite?.recallVerified),
    });
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
