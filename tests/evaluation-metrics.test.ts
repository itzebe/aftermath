import { describe, expect, it } from "vitest";
import { evaluate, type ScenarioOutcome } from "@/lib/engines/evaluation";

/**
 * The evaluation metrics are the submission's quantitative claims, so they are
 * pinned here. In particular: an unsupported completion claim must never be
 * counted as accepted, and the three claim buckets must always partition the
 * total exactly.
 */

function outcome(over: Partial<ScenarioOutcome>): ScenarioOutcome {
  return {
    scenarioId: "s",
    groundTruthFailure: true,
    isRepeat: false,
    agentClaimedSuccess: true,
    decision: "REQUIRE_VERIFICATION",
    evidenceStatus: "UNKNOWN",
    safeguardApplied: false,
    lessonStored: true,
    lessonRecalled: false,
    provenance: "simulated",
    ...over,
  };
}

describe("evaluate: unsupported-claim accounting", () => {
  it("partitions every unsupported claim into exactly one bucket", () => {
    const outcomes: ScenarioOutcome[] = [
      outcome({ scenarioId: "caught-block", decision: "BLOCK" }),
      outcome({ scenarioId: "caught-verify", decision: "REQUIRE_VERIFICATION" }),
      outcome({ scenarioId: "unresolved", decision: "UNKNOWN" }),
      // Not unsupported: a claim on a genuinely valid action.
      outcome({
        scenarioId: "valid",
        groundTruthFailure: false,
        decision: "ALLOW",
        evidenceStatus: "VERIFIED_SUCCESS",
      }),
      // Not a claim at all.
      outcome({ scenarioId: "no-claim", agentClaimedSuccess: false, decision: "ALLOW" }),
    ];

    const m = evaluate(outcomes);
    expect(m.unsupportedClaims).toBe(3);
    expect(m.unsupportedClaimsCaught).toBe(2);
    expect(m.unsupportedClaimsUnresolved).toBe(1);
    expect(m.unsupportedClaimsAllowed).toBe(0);
    expect(m.unsupportedClaimsCaught + m.unsupportedClaimsUnresolved + m.unsupportedClaimsAllowed).toBe(
      m.unsupportedClaims,
    );
  });

  it("flags an unsupported claim that was allowed to stand", () => {
    const m = evaluate([
      outcome({ scenarioId: "leaked", decision: "ALLOW", evidenceStatus: "VERIFIED_FAILURE" }),
    ]);
    expect(m.unsupportedClaimsAllowed).toBe(1);
    expect(m.unsupportedClaimsCaught).toBe(0);
  });

  it("counts a repeat as prevented only when it was not allowed", () => {
    const m = evaluate([
      outcome({ scenarioId: "r1", isRepeat: true, decision: "BLOCK" }),
      outcome({ scenarioId: "r2", isRepeat: true, decision: "ALLOW" }),
    ]);
    expect(m.repeatScenarios).toBe(2);
    expect(m.repeatPreventionRate).toBe(0.5);
    expect(m.repeatFailuresSlippedThrough).toBe(1);
  });

  it("treats a blocked valid action as a false block", () => {
    const m = evaluate([
      outcome({
        scenarioId: "v",
        groundTruthFailure: false,
        decision: "BLOCK",
        evidenceStatus: "VERIFIED_SUCCESS",
      }),
    ]);
    expect(m.falseBlockRate).toBe(1);
  });
});
