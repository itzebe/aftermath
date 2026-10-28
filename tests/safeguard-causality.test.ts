import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeInMemoryStore } from "@/lib/db/store-factory";
import { SimulatedMemoryAdapter } from "@/lib/adapters/simulated-memory";
import { IncidentPipeline } from "@/lib/engines/pipeline";
import { makeCodingAdapter, setupCodingHarness } from "@/lib/demos/coding";
import { makeWorkflowAdapter, makeWorkflowStore, DEPLOY_WORKFLOW } from "@/lib/demos/workflow";
import type { IncidentInputDraft } from "@/lib/schemas";

/**
 * Counterfactual causality tests.
 *
 * The product's central claim is that a *learned safeguard* changes a later
 * decision — not merely that evidence determines it. These tests isolate that
 * claim by running the identical action twice: once with no active rule, and
 * once after a prior failure of the same pattern has activated one.
 *
 * If the decision is the same in both cases, the safeguard is decorative and
 * these tests fail. That is the point: they pin the causal claim rather than
 * the mere presence of a rule record.
 */

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function makeStores() {
  const dir = mkdtempSync(path.join(tmpdir(), "aftermath-cf-"));
  const store = makeInMemoryStore();
  const memory = new SimulatedMemoryAdapter("counterfactual");
  cleanups.push(() => void store.close());
  return { dir, store, memory };
}

describe("counterfactual: a learned safeguard changes the decision", () => {
  it("coding repeat: BLOCK only exists because a prior incident activated a rule", async () => {
    const { dir, store, memory } = makeStores();
    const buggy = await setupCodingHarness(path.join(dir, "coding"), "buggy");
    const pipeline = new IncidentPipeline({
      evidence: makeCodingAdapter(path.join(dir, "artifacts"), buggy.dir),
      memory,
      store,
    });

    const base: IncidentInputDraft = {
      domain: "coding",
      actionType: "report_bug_fixed",
      executionId: "cf-coding-first",
      intendedOutcome: "add() returns the arithmetic sum",
      claimedOutcome: {
        claim: "Fixed the bug. Tests pass.",
        assertedStatus: "success",
      },
      evidenceReferences: [{ kind: "test_run", ref: "calc.test.js" }],
      provenance: "simulated",
    };

    // No rule exists yet. Evidence is a verified failure, so the claim is
    // refused — but the *rule set* is empty at this moment.
    const first = await pipeline.process(base);
    expect(first.assessment.status).toBe("VERIFIED_FAILURE");
    expect(first.decision.decision).toBe("BLOCK");
    expect(first.decision.applicableRuleIds).toEqual([]);

    // The first incident activated a rule. Now the repeat carries an active
    // rule id, which is the durable artefact that changed the future.
    const repeat = await pipeline.process({ ...base, executionId: "cf-coding-repeat" });
    expect(repeat.decision.decision).toBe("BLOCK");
    expect(repeat.decision.applicableRuleIds).toContain(
      "rule-coding-unsupported_completion_claim",
    );
    expect(repeat.recalledIds.length).toBeGreaterThan(0);
  });

  it("workflow repeat: the safeguard is what turns a bare failure into a refusal", async () => {
    const { store, memory } = makeStores();
    const workflowStore = makeWorkflowStore();
    const pipeline = new IncidentPipeline({
      evidence: makeWorkflowAdapter(workflowStore),
      memory,
      store,
    });

    const base: IncidentInputDraft = {
      domain: "workflow",
      actionType: DEPLOY_WORKFLOW.operation,
      executionId: "cf-wf-first",
      intendedOutcome: "Publish the artifact to the registry",
      evidenceReferences: [{ kind: "workflow_state", ref: DEPLOY_WORKFLOW.workflowId }],
      relevantContext: { workflowId: DEPLOY_WORKFLOW.workflowId },
      provenance: "simulated",
    };
    const unmet = [{ id: "schema_validation", satisfied: false }];

    await workflowStore.recordAttempt(
      DEPLOY_WORKFLOW.workflowId,
      "failure",
      "missing prerequisite: schema_validation",
    );

    const first = await pipeline.preflight(base, unmet);
    expect(first.assessment.status).toBe("VERIFIED_FAILURE");
    expect(first.decision.applicableRuleIds).toEqual([]);

    const repeat = await pipeline.preflight({ ...base, executionId: "cf-wf-repeat" }, unmet);
    expect(repeat.decision.applicableRuleIds).toContain("rule-workflow-missing_prerequisite");
    expect(repeat.decision.decision).toBe("REQUIRE_VERIFICATION");

    // And once the prerequisite genuinely completes, the same safeguard must
    // NOT block a valid operation.
    await workflowStore.markPrerequisiteComplete(DEPLOY_WORKFLOW.workflowId, "schema_validation");
    const valid = await pipeline.preflight(
      { ...base, executionId: "cf-wf-valid" },
      [{ id: "schema_validation", satisfied: true }],
    );
    expect(valid.assessment.status).toBe("VERIFIED_SUCCESS");
    expect(valid.decision.decision).toBe("ALLOW");
  });
});
