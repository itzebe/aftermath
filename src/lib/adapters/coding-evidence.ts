import path from "node:path";
import { EvidenceAssessmentSchema, type EvidenceAssessment, type Incident } from "@/lib/schemas";
import type { EvidenceAdapter } from "@/lib/adapters/evidence";
import { runTestHarness, type TestRunResult } from "@/lib/adapters/coding-harness";

export interface CodingAdapterConfig {
  harnessDir: string;
  /** Command used to run the controlled test suite, e.g. "node". */
  runnerCommand: string;
  runnerArgs: string[];
  /** Working directory for the test process. Defaults to harnessDir. */
  cwd?: string;
  timeoutMs: number;
}

/**
 * Coding-domain evidence adapter.
 *
 * The authoritative evidence is the *test process*: its exit code, the runner's
 * own pass/fail counts, and its raw output. An agent's claim that "the bug is
 * fixed" is never evidence. A run that did not execute the required tests is
 * not a verification, even if the process exited 0.
 */
export class CodingEvidenceAdapter implements EvidenceAdapter {
  readonly domain = "coding" as const;
  readonly sourceName = "controlled test harness (node:test)";

  constructor(
    private readonly config: CodingAdapterConfig,
    private readonly runHarness = runTestHarness,
  ) {}

  async verifyEvidence(incident: Incident): Promise<EvidenceAssessment> {
    const observedAt = new Date().toISOString();
    const executionId = incident.executionId;
    const artifactPath = path.join(
      this.config.harnessDir,
      `${executionId}.json`,
    );
    const reference = `coding:testrun:${executionId}`;

    const requested = incident.evidenceReferences.find(
      (e) => e.kind === "test_run" || e.kind === "vitest_run",
    );

    // Case 1: the agent claimed a fix but supplied no test-run evidence at all.
    // A claim of a fix without a test run is inadequate verification.
    if (!requested && incident.claimedOutcome?.assertedStatus === "success") {
      return EvidenceAssessmentSchema.parse({
        status: "UNKNOWN",
        verified: false,
        evidenceType: "test_run",
        evidenceReference: reference,
        observedAt,
        explanation:
          "The agent asserted the fix was verified but no test run was " +
          "recorded. A claim without a test run is not evidence.",
        failureReason: "no test_run evidence reference supplied",
        raw: { requiredTests: this.config.runnerArgs.join(" ") },
      });
    }

    let run: TestRunResult;
    try {
      run = await this.runHarness({
        cwd: this.config.cwd ?? this.config.harnessDir,
        command: this.config.runnerCommand,
        args: this.config.runnerArgs,
        timeoutMs: this.config.timeoutMs,
        artifactPath,
      });
    } catch (err) {
      return EvidenceAssessmentSchema.parse({
        status: "UNKNOWN",
        verified: false,
        evidenceType: "test_run",
        evidenceReference: reference,
        observedAt,
        explanation:
          "The test process could not be executed, so the fix is neither " +
          "confirmed nor refuted.",
        failureReason: (err as Error).message,
        raw: { artifactPath },
      });
    }

    const raw = {
      artifactPath: run.artifactPath,
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      testsRun: run.testsRun,
      testsPassed: run.testsPassed,
      testsFailed: run.testsFailed,
      durationMs: run.durationMs,
    };

    if (run.timedOut) {
      return EvidenceAssessmentSchema.parse({
        status: "PENDING",
        verified: false,
        evidenceType: "test_run",
        evidenceReference: reference,
        observedAt,
        explanation: "The test process exceeded its time limit and was killed.",
        failureReason: "test run timed out",
        raw,
      });
    }

    if (run.exitCode === null) {
      return EvidenceAssessmentSchema.parse({
        status: "UNKNOWN",
        verified: false,
        evidenceType: "test_run",
        evidenceReference: reference,
        observedAt,
        explanation: "The test process failed to start.",
        failureReason: "spawn failure",
        raw,
      });
    }

    // A run that executed no tests cannot verify anything, even at exit 0.
    if (run.testsRun === 0) {
      return EvidenceAssessmentSchema.parse({
        status: "UNKNOWN",
        verified: false,
        evidenceType: "test_run",
        evidenceReference: reference,
        observedAt,
        explanation:
          `The test process exited ${run.exitCode} but reported no executed ` +
          "tests. A run that exercises nothing does not verify the fix.",
        failureReason: "no tests executed",
        raw,
      });
    }

    if (run.exitCode === 0 && run.testsFailed === 0) {
      return EvidenceAssessmentSchema.parse({
        status: "VERIFIED_SUCCESS",
        verified: true,
        evidenceType: "test_run",
        evidenceReference: reference,
        observedAt,
        explanation:
          `The test process exited 0 and its own summary reports ` +
          `${run.testsPassed} passing, ${run.testsFailed} failing. The fix is verified.`,
        raw,
      });
    }

    return EvidenceAssessmentSchema.parse({
      status: "VERIFIED_FAILURE",
      verified: true,
      evidenceType: "test_run",
      evidenceReference: reference,
      observedAt,
      explanation:
        `The test process exited ${run.exitCode} with ` +
        `${run.testsFailed} failing test(s). The fix is not verified.`,
      failureReason: `${run.testsFailed} failing test(s)`,
      raw,
    });
  }
}
