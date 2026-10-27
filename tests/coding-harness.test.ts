import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CodingEvidenceAdapter } from "@/lib/adapters/coding-evidence";
import { runTestHarness, parseTestCounts } from "@/lib/adapters/coding-harness";
import { setupCodingHarness, applyFix, applyRegression } from "@/lib/demos/coding";
import { IncidentSchema } from "@/lib/schemas";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "aftermath-coding-"));
  dirs.push(d);
  return d;
}

afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

function codingIncident(evidence: Array<{ kind: string; ref: string }>) {
  return IncidentSchema.parse({
    domain: "coding",
    actionType: "report_bug_fixed",
    executionId: "coding-test",
    intendedOutcome: "add() returns the sum",
    claimedOutcome: { claim: "fixed", assertedStatus: "success" },
    evidenceReferences: evidence,
    relevantContext: {},
    provenance: "simulated",
    incidentId: "i1",
    createdAt: new Date().toISOString(),
    currentStatus: "open",
  });
}

function adapterFor(harnessDir: string, targetDir: string) {
  return new CodingEvidenceAdapter({
    harnessDir,
    runnerCommand: process.execPath,
    runnerArgs: ["--test", path.join(targetDir, "calc.test.js")],
    timeoutMs: 30_000,
  });
}

describe("test harness captures real process evidence", () => {
  it("records a non-zero exit code and a failing count for buggy code", async () => {
    const base = await tempDir();
    const paths = await setupCodingHarness(base, "buggy");
    const run = await runTestHarness({
      cwd: paths.dir,
      command: process.execPath,
      args: ["--test", path.join(paths.dir, "calc.test.js")],
      artifactPath: path.join(base, "run.json"),
    });
    expect(run.exitCode).not.toBe(0);
    expect(run.testsFailed).toBeGreaterThan(0);
    expect(run.testsPassed).toBe(0);
  });

  it("records exit code 0 and passing tests for fixed code", async () => {
    const base = await tempDir();
    const paths = await setupCodingHarness(base, "fixed");
    const run = await runTestHarness({
      cwd: paths.dir,
      command: process.execPath,
      args: ["--test", path.join(paths.dir, "calc.test.js")],
      artifactPath: path.join(base, "run.json"),
    });
    expect(run.exitCode).toBe(0);
    expect(run.testsPassed).toBeGreaterThan(0);
    expect(run.testsFailed).toBe(0);
  });

  it("parses the runner's own summary counts", () => {
    const counts = parseTestCounts("# tests 3\n# pass 2\n# fail 1\n");
    expect(counts).toEqual({ run: 3, passed: 2, failed: 1 });
  });

  it("reports zero counts when the runner printed no summary", () => {
    expect(parseTestCounts("no summary here")).toEqual({ run: 0, passed: 0, failed: 0 });
  });
});

describe("CodingEvidenceAdapter — verification requires real tests", () => {
  it("returns UNKNOWN when a fix is claimed with no test run recorded", async () => {
    const base = await tempDir();
    const paths = await setupCodingHarness(base, "fixed");
    const adapter = adapterFor(path.join(base, "artifacts"), paths.dir);
    const a = await adapter.verifyEvidence(codingIncident([]));
    expect(a.status).toBe("UNKNOWN");
    expect(a.verified).toBe(false);
  });

  it("returns VERIFIED_FAILURE when the tests fail", async () => {
    const base = await tempDir();
    const paths = await setupCodingHarness(base, "buggy");
    const adapter = adapterFor(path.join(base, "artifacts"), paths.dir);
    const a = await adapter.verifyEvidence(
      codingIncident([{ kind: "test_run", ref: "calc.test.js" }]),
    );
    expect(a.status).toBe("VERIFIED_FAILURE");
    expect(a.verified).toBe(true);
  });

  it("returns VERIFIED_SUCCESS only after the tests genuinely pass", async () => {
    const base = await tempDir();
    const paths = await setupCodingHarness(base, "buggy");
    const adapter = adapterFor(path.join(base, "artifacts"), paths.dir);

    const before = await adapter.verifyEvidence(
      codingIncident([{ kind: "test_run", ref: "calc.test.js" }]),
    );
    expect(before.status).toBe("VERIFIED_FAILURE");

    await applyFix(paths);

    const after = await adapter.verifyEvidence(
      codingIncident([{ kind: "test_run", ref: "calc.test.js" }]),
    );
    expect(after.status).toBe("VERIFIED_SUCCESS");
    expect(after.verified).toBe(true);
  });

  it("re-detects a reintroduced regression", async () => {
    const base = await tempDir();
    const paths = await setupCodingHarness(base, "fixed");
    const adapter = adapterFor(path.join(base, "artifacts"), paths.dir);

    const passing = await adapter.verifyEvidence(
      codingIncident([{ kind: "test_run", ref: "calc.test.js" }]),
    );
    expect(passing.status).toBe("VERIFIED_SUCCESS");

    await applyRegression(paths);

    const failing = await adapter.verifyEvidence(
      codingIncident([{ kind: "test_run", ref: "calc.test.js" }]),
    );
    expect(failing.status).toBe("VERIFIED_FAILURE");
  });
});
