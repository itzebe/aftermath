import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeCodingAdapter, setupCodingHarness, applyFix } from "@/lib/demos/coding";
import { IncidentSchema } from "@/lib/schemas";

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "aftermath-wiring-"));
  dirs.push(d);
  return d;
}
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

function incident() {
  return IncidentSchema.parse({
    domain: "coding",
    actionType: "report_bug_fixed",
    executionId: "wiring-1",
    intendedOutcome: "add() returns the sum",
    claimedOutcome: { claim: "fixed", assertedStatus: "success" },
    evidenceReferences: [{ kind: "test_run", ref: "calc.test.js" }],
    relevantContext: {},
    provenance: "simulated",
    incidentId: "i1",
    createdAt: new Date().toISOString(),
    currentStatus: "open",
  });
}

/**
 * Regression guard for a real defect: the test process was spawned with the
 * artifacts directory as its cwd, so the runner could not find the suite and
 * every coding scenario silently resolved to UNKNOWN.
 */
describe("coding demo wiring", () => {
  it("runs the suite from the module directory, not the artifact directory", async () => {
    const base = await tempDir();
    const paths = await setupCodingHarness(path.join(base, "coding"), "buggy");
    const adapter = makeCodingAdapter(path.join(base, "artifacts"), paths.dir);

    const a = await adapter.verifyEvidence(incident());
    expect(a.status).toBe("VERIFIED_FAILURE");
    expect(a.verified).toBe(true);
    expect((a.raw as { testsRun: number }).testsRun).toBeGreaterThan(0);
  });

  it("reports VERIFIED_SUCCESS once the fix is applied", async () => {
    const base = await tempDir();
    const paths = await setupCodingHarness(path.join(base, "coding"), "buggy");
    const adapter = makeCodingAdapter(path.join(base, "artifacts"), paths.dir);

    await applyFix(paths);
    const a = await adapter.verifyEvidence(incident());
    expect(a.status).toBe("VERIFIED_SUCCESS");
  });

  it("works when invoked from a different working directory", async () => {
    const base = await tempDir();
    const paths = await setupCodingHarness(path.join(base, "coding"), "fixed");
    const adapter = makeCodingAdapter(path.join(base, "artifacts"), paths.dir);
    const previous = process.cwd();
    process.chdir(tmpdir());
    try {
      const a = await adapter.verifyEvidence(incident());
      expect(a.status).toBe("VERIFIED_SUCCESS");
    } finally {
      process.chdir(previous);
    }
  });
});
