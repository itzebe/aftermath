import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CodingEvidenceAdapter } from "@/lib/adapters/coding-evidence";
import { runTestHarness } from "@/lib/adapters/coding-harness";

/**
 * Coding demonstration harness.
 *
 * A tiny real project is materialised on disk and exercised with `node --test`.
 * The bug and its fix are real code changes; the exit codes and pass/fail
 * counts come from the test process itself. Nothing about the outcome is
 * inferred from the agent's claim.
 */

export interface HarnessPaths {
  dir: string;
  modulePath: string;
  testPath: string;
}

/** A module with a genuine bug: `add` subtracts. */
const BUGGY_MODULE = `export function add(a, b) {
  return a - b;
}
`;

const FIXED_MODULE = `export function add(a, b) {
  return a + b;
}
`;

const TEST_FILE = `import { test } from "node:test";
import assert from "node:assert/strict";
import { add } from "./calc.js";

test("add sums two positive numbers", () => {
  assert.equal(add(2, 3), 5);
});

test("add sums a negative and a positive number", () => {
  assert.equal(add(-4, 10), 6);
});
`;

const PACKAGE_JSON = `{
  "name": "aftermath-coding-harness",
  "private": true,
  "type": "module"
}
`;

export async function setupCodingHarness(
  baseDir: string,
  variant: "buggy" | "fixed",
): Promise<HarnessPaths> {
  const dir = path.join(baseDir, variant === "buggy" ? "buggy" : "fixed");
  await mkdir(dir, { recursive: true });
  const modulePath = path.join(dir, "calc.js");
  const testPath = path.join(dir, "calc.test.js");
  await writeFile(
    modulePath,
    variant === "buggy" ? BUGGY_MODULE : FIXED_MODULE,
    "utf8",
  );
  await writeFile(testPath, TEST_FILE, "utf8");
  await writeFile(path.join(dir, "package.json"), PACKAGE_JSON, "utf8");
  return { dir, modulePath, testPath };
}

/** Apply the real fix by rewriting the module. */
export async function applyFix(paths: HarnessPaths): Promise<void> {
  await writeFile(paths.modulePath, FIXED_MODULE, "utf8");
}

/** Re-introduce the bug, to reproduce a failure deterministically. */
export async function applyRegression(paths: HarnessPaths): Promise<void> {
  await writeFile(paths.modulePath, BUGGY_MODULE, "utf8");
}

export function makeCodingAdapter(
  artifactsDir: string,
  targetDir: string,
): CodingEvidenceAdapter {
  const resolvedTarget = path.resolve(targetDir);
  return new CodingEvidenceAdapter({
    harnessDir: artifactsDir,
    runnerCommand: process.execPath,
    // cwd is the module directory so relative imports inside the test resolve;
    // the test path is absolute so a wrong cwd fails loudly rather than
    // silently finding no tests.
    runnerArgs: ["--test", path.join(resolvedTarget, "calc.test.js")],
    cwd: resolvedTarget,
    timeoutMs: 30_000,
  });
}

/** Run the harness directly (used by the demo route to capture raw evidence). */
export async function runHarnessOnce(
  targetDir: string,
  artifactPath: string,
): Promise<Awaited<ReturnType<typeof runTestHarness>>> {
  const resolvedTarget = path.resolve(targetDir);
  return runTestHarness({
    cwd: resolvedTarget,
    command: process.execPath,
    args: ["--test", path.join(resolvedTarget, "calc.test.js")],
    artifactPath,
    timeoutMs: 30_000,
  });
}
