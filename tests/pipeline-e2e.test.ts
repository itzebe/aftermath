import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "@/lib/config";
import { makeInMemoryStore } from "@/lib/db/store-factory";
import { SimulatedMemoryAdapter } from "@/lib/adapters/simulated-memory";
import { InMemoryWorkflowStateStore } from "@/lib/adapters/workflow-state";
import { runAllScenarios } from "@/lib/demos/runner";
import { evaluate } from "@/lib/engines/evaluation";

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "aftermath-run-"));
  dirs.push(d);
  return d;
}
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

/**
 * End-to-end pipeline test over the real adapters.
 *
 * The memory backend is the SDK's in-process mock (explicitly simulated), but
 * the coding harness runs a genuine `node --test` process and the workflow
 * store is the real one, so the evidence path under test is real.
 */
async function runOnce() {
  const base = await tempDir();
  const config = { ...loadConfig(), harnessDir: path.join(base, "harness") };
  const store = makeInMemoryStore();
  const memory = new SimulatedMemoryAdapter(config.memory.namespace);
  const result = await runAllScenarios({
    config,
    store,
    memory,
    workflowStore: new InMemoryWorkflowStateStore(),
  });
  const metrics = evaluate(result.scenarios.map((s) => s.outcome));
  await store.close();
  return { result, metrics };
}

describe("end-to-end scenario pipeline", () => {
  it("runs all eight controlled scenarios", async () => {
    const { result } = await runOnce();
    expect(result.scenarios).toHaveLength(8);
    const ids = result.scenarios.map((s) => s.scenarioId);
    expect(ids).toContain("coding-tests-fail");
    expect(ids).toContain("coding-tests-pass");
    expect(ids).toContain("workflow-repeat-refused");
  });

  it("blocks the coding claim that a failing fix is verified", async () => {
    const { result } = await runOnce();
    const s = result.scenarios.find((x) => x.scenarioId === "coding-tests-fail");
    expect(s?.evidenceStatus).toBe("VERIFIED_FAILURE");
    expect(s?.decision).toBe("BLOCK");
  });

  it("allows a fix once the tests genuinely pass", async () => {
    const { result } = await runOnce();
    const s = result.scenarios.find((x) => x.scenarioId === "coding-tests-pass");
    expect(s?.evidenceStatus).toBe("VERIFIED_SUCCESS");
    expect(s?.decision).toBe("ALLOW");
  });

  it("requires verification for an unsupported claim with no test run", async () => {
    const { result } = await runOnce();
    const s = result.scenarios.find(
      (x) => x.scenarioId === "coding-claim-without-tests",
    );
    expect(s?.evidenceStatus).toBe("UNKNOWN");
    expect(s?.decision).not.toBe("ALLOW");
  });

  it("does not allow a repeat failure to slip through", async () => {
    const { metrics } = await runOnce();
    expect(metrics.repeatFailuresSlippedThrough).toBe(0);
    expect(metrics.repeatPreventionRate).toBe(1);
  });

  it("never blocks a valid action", async () => {
    const { metrics } = await runOnce();
    expect(metrics.falseBlockRate).toBe(0);
  });

  it("keeps the workflow's valid run allowed after the safeguard exists", async () => {
    const { result } = await runOnce();
    const s = result.scenarios.find(
      (x) => x.scenarioId === "workflow-valid-allowed",
    );
    expect(s?.decision).toBe("ALLOW");
  });
});

describe("evaluation metrics", () => {
  it("is deterministic for the same scenario inputs", async () => {
    const a = await runOnce();
    const b = await runOnce();
    const strip = (m: ReturnType<typeof evaluate>) => ({
      ...m,
      // decisions is an object; compare its contents, not identity
      decisions: { ...m.decisions },
    });
    expect(strip(a.metrics)).toEqual(strip(b.metrics));
  });
});
