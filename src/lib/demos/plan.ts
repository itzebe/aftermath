import path from "node:path";
import { createHash } from "node:crypto";
import { IncidentPipeline } from "@/lib/engines/pipeline";
import type { ScenarioOutcome } from "@/lib/engines/evaluation";
import type { ProcessResult } from "@/lib/engines/pipeline";
import { FinanceEvidenceAdapter } from "@/lib/adapters/finance-evidence";
import { WorkflowEvidenceAdapter } from "@/lib/adapters/workflow-evidence";
import {
  applyFix,

  makeCodingAdapter,
  runHarnessStatus,
  setupCodingHarness,
} from "@/lib/demos/coding";
import { buildSuiVerifier, runFinanceEvidenceCases } from "@/lib/demos/finance";
import { DEPLOY_WORKFLOW } from "@/lib/demos/workflow";
import type { FinanceEvidenceCase } from "@/lib/demos/finance";
import type { RunContext, StepDefinition } from "@/lib/demos/types";

/**
 * The ordered demonstration plan.
 *
 * Each scenario is an independent step with a `prepare` phase that puts the
 * world into the absolute state the scenario requires, and a `run` phase that
 * produces the report. This is the single source of truth for the
 * demonstration: both the sequential runner (tests, seed) and the resumable
 * bounded-batch runner execute exactly these steps, so they cannot drift.
 *
 * `prepare` is deliberately absolute rather than incremental. The earlier
 * in-process runner relied on running C1→C4 in order to reach each state; a
 * resumable runner cannot, because a batch may start at any step. Setting the
 * fixture absolutely from the *observed* test status makes each step
 * self-contained and reproducible.
 */

export const FINANCE_LIVE_STEP_ID = "finance-live-cases";

/** Deterministic incident id, stable across retries and instances. */
export function deterministicIncidentId(jobId: string, stepId: string): string {
  const h = createHash("sha256").update(`${jobId}:${stepId}`).digest("hex");
  // Shaped as a UUID for readability; the value is a hash, not random.
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
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

const CODING_CLAIM = {
  claim: "Fixed the add() bug. Tests pass.",
  assertedStatus: "success" as const,
};

function codingPipeline(ctx: RunContext, codingDir: string): IncidentPipeline {
  return new IncidentPipeline({
    evidence: makeCodingAdapter(ctx.paths.artifacts, codingDir),
    memory: ctx.memory,
    store: ctx.store,
  });
}

async function activeRules(ctx: RunContext, domain: "coding" | "workflow") {
  return (await ctx.store.listActiveRules()).filter(
    (r) => r.domain === domain && r.validationStatus === "active",
  );
}

/** Bring the coding fixture to a known buggy state and return its directory. */
async function prepareCoding(ctx: RunContext): Promise<string> {
  const paths = await setupCodingHarness(ctx.paths.codingBase, "buggy");
  return paths.dir;
}

export const DEMO_STEPS: StepDefinition[] = [
  // ---------------------------------------------------------------- CODING
  {
    stepId: "coding-claim-without-tests",
    ordinal: 1,
    domain: "coding",
    title: "Fix claimed with no test run",
    simulated: true,
    async prepare(ctx) {
      await prepareCoding(ctx);
    },
    async run(ctx) {
      const codingDir = path.join(ctx.paths.codingBase, "buggy");
      const c1 = await codingPipeline(ctx, codingDir).process(
        {
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
        },
        { incidentId: deterministicIncidentId(ctx.jobId, "coding-claim-without-tests") },
      );
      return {
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
      };
    },
  },
  {
    stepId: "coding-tests-fail",
    ordinal: 2,
    domain: "coding",
    title: "Tests executed and failing",
    simulated: true,
    async prepare(ctx) {
      // The bug must genuinely be present for the suite to fail.
      await prepareCoding(ctx);
    },
    async run(ctx) {
      const codingDir = path.join(ctx.paths.codingBase, "buggy");
      const c2 = await codingPipeline(ctx, codingDir).process(
        {
          domain: "coding",
          actionType: "report_bug_fixed",
          executionId: "coding-c2",
          intendedOutcome: "add() returns the arithmetic sum",
          claimedOutcome: CODING_CLAIM,
          evidenceReferences: [
            { kind: "test_run", ref: "calc.test.js", note: "controlled node:test suite" },
          ],
          provenance: "simulated",
        },
        { incidentId: deterministicIncidentId(ctx.jobId, "coding-tests-fail") },
      );
      return {
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
      };
    },
  },
  {
    stepId: "coding-tests-pass",
    ordinal: 3,
    domain: "coding",
    title: "Tests executed and passing",
    simulated: true,
    async prepare(ctx) {
      // Absolute: the fix must be present, so apply it rather than assuming a
      // prior step left it applied.
      const paths = await setupCodingHarness(ctx.paths.codingBase, "buggy");
      await applyFix(paths);
    },
    async run(ctx) {
      const codingDir = path.join(ctx.paths.codingBase, "buggy");
      const c3 = await codingPipeline(ctx, codingDir).process(
        {
          domain: "coding",
          actionType: "report_bug_fixed",
          executionId: "coding-c3",
          intendedOutcome: "add() returns the arithmetic sum",
          claimedOutcome: CODING_CLAIM,
          evidenceReferences: [
            { kind: "test_run", ref: "calc.test.js", note: "controlled node:test suite" },
          ],
          provenance: "simulated",
        },
        { incidentId: deterministicIncidentId(ctx.jobId, "coding-tests-pass") },
      );
      return {
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
      };
    },
  },
  {
    stepId: "coding-regression-with-safeguard",
    ordinal: 4,
    domain: "coding",
    title: "Regression caught by an active safeguard",
    simulated: true,
    async prepare(ctx) {
      // Re-introduce the bug so the regression is real.
      await prepareCoding(ctx);
    },
    async run(ctx) {
      const codingDir = path.join(ctx.paths.codingBase, "buggy");
      const rules = await activeRules(ctx, "coding");
      const c4 = await codingPipeline(ctx, codingDir).process(
        {
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
        },
        { incidentId: deterministicIncidentId(ctx.jobId, "coding-regression-with-safeguard") },
      );
      return {
        scenarioId: "coding-regression-with-safeguard",
        domain: "coding",
        title: "Regression caught by an active safeguard",
        description:
          "The bug is reintroduced. The safeguard stored from the earlier failure is active, so the repeat claim is refused.",
        simulated: true,
        steps: [
          {
            label: "Safeguard",
            detail: rules.length
              ? `Active rule(s): ${rules.map((r) => `${r.ruleId}@v${r.version}`).join(", ")}`
              : "No active coding rule was present.",
            tone: rules.length ? "ok" : "warn",
          },
          { label: "Test run", detail: c4.assessment.explanation, tone: "bad" },
          { label: "Decision", detail: c4.decision.reason, tone: "bad" },
        ],
        outcome: toOutcome(
          "coding-regression-with-safeguard",
          true,
          true,
          c4,
          rules.length > 0,
          true,
        ),
        incidentId: c4.incident.incidentId,
        decision: c4.decision.decision,
        evidenceStatus: c4.assessment.status,
        memoryBlobId: c4.lessonWrite?.blobId,
        recallVerified: Boolean(c4.lessonWrite?.recallVerified),
      };
    },
  },

  // -------------------------------------------------------------- WORKFLOW
  {
    stepId: "workflow-first-attempt",
    ordinal: 5,
    domain: "workflow",
    title: "First attempt skips the prerequisite",
    simulated: true,
    async prepare(ctx) {
      // Absolute: clear prior state, then record the genuine first failure.
      await ctx.workflowStore.reset(DEPLOY_WORKFLOW.workflowId);
      await ctx.workflowStore.recordAttempt(
        DEPLOY_WORKFLOW.workflowId,
        "failure",
        "missing prerequisite: schema_validation",
      );
    },
    async run(ctx) {
      const pipeline = new IncidentPipeline({
        evidence: new WorkflowEvidenceAdapter({
          definition: DEPLOY_WORKFLOW,
          store: ctx.workflowStore,
        }),
        memory: ctx.memory,
        store: ctx.store,
      });
      const w1 = await pipeline.preflight(
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
        deterministicIncidentId(ctx.jobId, "workflow-first-attempt"),
      );
      return {
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
      };
    },
  },
  {
    stepId: "workflow-repeat-refused",
    ordinal: 6,
    domain: "workflow",
    title: "Repeat attempt refused by the safeguard",
    simulated: true,
    async prepare(ctx) {
      // Absolute: the failure is recorded and the prerequisite is still unmet.
      const state = await ctx.workflowStore.get(DEPLOY_WORKFLOW.workflowId);
      if (!state || state.failures === 0) {
        await ctx.workflowStore.recordAttempt(
          DEPLOY_WORKFLOW.workflowId,
          "failure",
          "missing prerequisite: schema_validation",
        );
      }
    },
    async run(ctx) {
      const pipeline = new IncidentPipeline({
        evidence: new WorkflowEvidenceAdapter({
          definition: DEPLOY_WORKFLOW,
          store: ctx.workflowStore,
        }),
        memory: ctx.memory,
        store: ctx.store,
      });
      const rules = await activeRules(ctx, "workflow");
      const w2 = await pipeline.preflight(
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
        deterministicIncidentId(ctx.jobId, "workflow-repeat-refused"),
      );
      return {
        scenarioId: "workflow-repeat-refused",
        domain: "workflow",
        title: "Repeat attempt refused by the safeguard",
        description:
          "The same unmet prerequisite is detected. The recalled lesson and active rule prevent the repeat failure.",
        simulated: true,
        steps: [
          {
            label: "Safeguard",
            detail: rules.length
              ? `Active rule(s): ${rules.map((r) => `${r.ruleId}@v${r.version}`).join(", ")}`
              : "No active workflow rule was present.",
            tone: rules.length ? "ok" : "warn",
          },
          { label: "Decision", detail: w2.decision.reason, tone: "warn" },
        ],
        outcome: toOutcome(
          "workflow-repeat-refused",
          true,
          false,
          w2,
          rules.length > 0,
          true,
        ),
        incidentId: w2.incident.incidentId,
        decision: w2.decision.decision,
        evidenceStatus: w2.assessment.status,
        memoryBlobId: w2.lessonWrite?.blobId,
        recallVerified: Boolean(w2.lessonWrite?.recallVerified),
      };
    },
  },
  {
    stepId: "workflow-valid-allowed",
    ordinal: 7,
    domain: "workflow",
    title: "Valid operation still allowed",
    simulated: true,
    async prepare(ctx) {
      // Absolute: the prerequisite has genuinely completed.
      await ctx.workflowStore.markPrerequisiteComplete(
        DEPLOY_WORKFLOW.workflowId,
        "schema_validation",
      );
    },
    async run(ctx) {
      const pipeline = new IncidentPipeline({
        evidence: new WorkflowEvidenceAdapter({
          definition: DEPLOY_WORKFLOW,
          store: ctx.workflowStore,
        }),
        memory: ctx.memory,
        store: ctx.store,
      });
      const rules = await activeRules(ctx, "workflow");
      const w3 = await pipeline.preflight(
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
        deterministicIncidentId(ctx.jobId, "workflow-valid-allowed"),
      );
      await ctx.workflowStore.recordAttempt(DEPLOY_WORKFLOW.workflowId, "success");
      return {
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
        outcome: toOutcome(
          "workflow-valid-allowed",
          false,
          false,
          w3,
          rules.length > 0,
          false,
        ),
        incidentId: w3.incident.incidentId,
        decision: w3.decision.decision,
        evidenceStatus: w3.assessment.status,
        memoryBlobId: w3.lessonWrite?.blobId,
        recallVerified: Boolean(w3.lessonWrite?.recallVerified),
      };
    },
  },

  // --------------------------------------------------------------- FINANCE
  {
    // Internal: enumerate the live on-chain cases once, durably. Not a
    // scenario itself — it produces no incident and no memory write — but the
    // discovered digests must survive to whichever request runs the cases, so
    // it is a real durable step rather than in-request work.
    stepId: FINANCE_LIVE_STEP_ID,
    ordinal: 8,
    domain: "finance",
    title: "Discover live on-chain finance cases",
    simulated: false,
    internal: true,
    async run(ctx) {
      await discoverFinanceCases(ctx);
      return {
        scenarioId: FINANCE_LIVE_STEP_ID,
        domain: "finance",
        title: "Discover live on-chain finance cases",
        description: "Internal setup step: enumerates live Sui cases via Tatum.",
        simulated: false,
        steps: [],
        outcome: {
          scenarioId: FINANCE_LIVE_STEP_ID,
          groundTruthFailure: false,
          isRepeat: false,
          agentClaimedSuccess: false,
          decision: "ALLOW",
          evidenceStatus: "UNKNOWN",
          safeguardApplied: false,
          lessonStored: false,
          lessonRecalled: false,
          provenance: "live",
        },
        incidentId: "internal",
        decision: "ALLOW",
        evidenceStatus: "UNKNOWN",
        recallVerified: false,
      };
    },
  },
  {
    stepId: "finance-unsupported-claim",
    ordinal: 9,
    domain: "finance",
    title: "Success claimed with no authoritative lookup",
    simulated: true,
    async run(ctx) {
      const tatum = buildSuiVerifier(ctx.config.tatum);
      const pipeline = new IncidentPipeline({
        evidence: new FinanceEvidenceAdapter(tatum),
        memory: ctx.memory,
        store: ctx.store,
      });
      const f1 = await pipeline.process(
        {
          domain: "finance",
          actionType: "report_sui_transaction_success",
          executionId: "finance-f1",
          intendedOutcome: "Confirm the Sui transaction executed successfully",
          claimedOutcome: { claim: "The Sui transaction succeeded.", assertedStatus: "success" },
          evidenceReferences: [{ kind: "sui_tx_digest", ref: "unavailable-probe" }],
          provenance: "simulated",
        },
        { incidentId: deterministicIncidentId(ctx.jobId, "finance-unsupported-claim") },
      );
      return {
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
      };
    },
  },
];

/**
 * Finance live cases.
 *
 * Discovery queries the live ledger through Tatum and is not deterministic per
 * step, so it happens once in a durable internal step and the resulting cases
 * are stored on the job's scratch. Each case then becomes its own resumable
 * step, so the live on-chain lookups and their Mainnet writes are individually
 * durable.
 */
export function financeCaseStepId(scenarioId: string): string {
  return `finance-case-${scenarioId}`;
}

export async function discoverFinanceCases(ctx: RunContext): Promise<FinanceEvidenceCase[]> {
  const tatum = buildSuiVerifier(ctx.config.tatum);
  // A bounded scan keeps the discovery step's wall-clock predictable: each
  // candidate costs one authoritative lookup, and this step must fit inside a
  // single request alongside the rest of the batch.
  const { cases } = await runFinanceEvidenceCases(tatum, { scanLimit: 8 });
  // Only cases with a real digest produce a scenario step; the "unavailable"
  // case is covered by the fixed finance-unsupported-claim step.
  const withDigest = cases.filter((c) => c.digest);
  await ctx.setScratch({ ...ctx.scratch, financeCases: withDigest });
  return withDigest;
}

export function financeCaseSteps(cases: FinanceEvidenceCase[]): StepDefinition[] {
  return cases.map((c, i) => ({
    stepId: financeCaseStepId(c.scenarioId),
    ordinal: 100 + i,
    domain: "finance" as const,
    title: c.label,
    simulated: c.simulated,
    async run(ctx: RunContext) {
      const digest = c.digest!;
      const tatum = buildSuiVerifier(ctx.config.tatum);
      const pipeline = new IncidentPipeline({
        evidence: new FinanceEvidenceAdapter(tatum),
        memory: ctx.memory,
        store: ctx.store,
      });
      const claimed = c.status === "VERIFIED_SUCCESS";
      const f = await pipeline.process(
        {
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
          evidenceReferences: [{ kind: "sui_tx_digest", ref: digest }],
          provenance: c.simulated ? "simulated" : "live",
        },
        { incidentId: deterministicIncidentId(ctx.jobId, financeCaseStepId(c.scenarioId)) },
      );
      return {
        scenarioId: c.scenarioId,
        domain: "finance",
        title: c.label,
        description: c.simulated
          ? "This case does not reflect a real ledger entry and is labelled as simulated."
          : "Digest discovered from the live Sui ledger and verified through Tatum.",
        simulated: c.simulated,
        steps: [
          { label: "Digest", detail: digest, tone: "neutral" },
          {
            label: "Evidence",
            detail: f.assessment.explanation,
            tone: f.assessment.verified
              ? f.assessment.status === "VERIFIED_SUCCESS"
                ? "ok"
                : "bad"
              : "warn",
          },
          {
            label: "Decision",
            detail: f.decision.reason,
            tone: f.decision.decision === "ALLOW" ? "ok" : "warn",
          },
        ],
        outcome: toOutcome(c.scenarioId, c.status !== "VERIFIED_SUCCESS", true, f, false, false),
        incidentId: f.incident.incidentId,
        decision: f.decision.decision,
        evidenceStatus: f.assessment.status,
        memoryBlobId: f.lessonWrite?.blobId,
        recallVerified: Boolean(f.lessonWrite?.recallVerified),
      };
    },
  }));
}

/** Step metadata for persisting a plan (before the finance cases are known). */
export function planSteps(steps: StepDefinition[]) {
  return steps.map((s) => ({
    stepId: s.stepId,
    ordinal: s.ordinal,
    domain: s.domain,
    title: s.title,
    simulated: s.simulated,
    internal: s.internal ?? false,
  }));
}

/** Look up a step by id among a set. */
export function findStep(steps: StepDefinition[], stepId: string): StepDefinition | undefined {
  return steps.find((s) => s.stepId === stepId);
}

/** The step that must run before the finance cases are enumerated. */
export { runHarnessStatus };
