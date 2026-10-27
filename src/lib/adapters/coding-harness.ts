import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface TestRunResult {
  /** Exit code of the test process. null when the process failed to spawn. */
  exitCode: number | null;
  signal: string | null;
  command: string;
  args: string[];
  cwd: string;
  durationMs: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  startedAt: string;
  finishedAt: string;
  /** Counts parsed from the runner's own output, not inferred. */
  testsRun: number;
  testsPassed: number;
  testsFailed: number;
  artifactPath: string;
}

export interface TestHarnessOptions {
  cwd: string;
  command: string;
  args: string[];
  timeoutMs?: number;
  /** Absolute path where the full run result JSON is written. */
  artifactPath: string;
  env?: Record<string, string>;
}

/**
 * Run a real test process and capture its actual exit code and output.
 *
 * This is the coding domain's authoritative evidence source. Nothing here
 * infers success: the exit code and the runner's own summary are recorded
 * verbatim. Whether that output constitutes a *verification* is decided
 * separately, in the evidence adapter.
 */
export async function runTestHarness(
  opts: TestHarnessOptions,
): Promise<TestRunResult> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const startedAt = new Date().toISOString();
  const start = Date.now();

  await mkdir(opts.cwd, { recursive: true });
  await mkdir(path.dirname(opts.artifactPath), { recursive: true });

  const child = spawn(opts.command, opts.args, {
    cwd: opts.cwd,
    env: { ...process.env, ...(opts.env ?? {}), NO_COLOR: "1" },
    shell: false,
  });

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let spawnError: string | null = null;

  child.stdout?.on("data", (d: Buffer) => {
    stdout += d.toString();
  });
  child.stderr?.on("data", (d: Buffer) => {
    stderr += d.toString();
  });

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);

  const exitCode: number | null = await new Promise((resolve) => {
    child.on("error", (err) => {
      spawnError = err.message;
      resolve(null);
    });
    child.on("close", (code) => resolve(code));
  });
  clearTimeout(timer);

  if (spawnError) stderr += `\n[spawn error] ${spawnError}`;

  const finishedAt = new Date().toISOString();
  const counts = parseTestCounts(`${stdout}\n${stderr}`);

  const result: TestRunResult = {
    exitCode,
    signal: child.signalCode,
    command: opts.command,
    args: opts.args,
    cwd: opts.cwd,
    durationMs: Date.now() - start,
    stdout,
    stderr,
    timedOut,
    startedAt,
    finishedAt,
    testsRun: counts.run,
    testsPassed: counts.passed,
    testsFailed: counts.failed,
    artifactPath: opts.artifactPath,
  };

  await writeFile(opts.artifactPath, JSON.stringify(result, null, 2), "utf8");
  return result;
}

/**
 * Parse the test runner's own summary counts.
 *
 * Node's default reporter prefixes summary lines with `#` in TAP mode and with
 * a symbol (e.g. `ℹ`) in spec mode, so the prefix is matched generically. Only
 * counts the runner printed itself are read; if it printed none, the counts
 * stay 0 and the adapter treats the run as inconclusive.
 *
 * The summary is printed after the test list, so the *last* match for each
 * label is used — a test whose name happens to contain "tests 5" cannot win.
 */
export function parseTestCounts(output: string): {
  run: number;
  passed: number;
  failed: number;
} {
  const lastOf = (label: string): number | null => {
    const re = new RegExp(`^[^\\w\\n]*${label}\\s+(\\d+)\\s*$`, "gm");
    let match: RegExpExecArray | null;
    let found: number | null = null;
    while ((match = re.exec(output)) !== null) {
      found = Number(match[1]);
    }
    return found;
  };

  const tests = lastOf("tests");
  const pass = lastOf("pass");
  const fail = lastOf("fail");
  if (tests === null && pass === null && fail === null) {
    return { run: 0, passed: 0, failed: 0 };
  }
  return { run: tests ?? 0, passed: pass ?? 0, failed: fail ?? 0 };
}

export async function readTestRunArtifact(
  artifactPath: string,
): Promise<TestRunResult | null> {
  try {
    const raw = await readFile(artifactPath, "utf8");
    return JSON.parse(raw) as TestRunResult;
  } catch {
    return null;
  }
}
