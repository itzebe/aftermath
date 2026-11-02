import { describe, expect, it } from "vitest";
import {
  assessLearning,
  assessOverview,
  type LearningLoopShape,
  type OverviewShape,
} from "../scripts/verify-production";

/**
 * The production verifier is a claim-checking tool: it must fail loudly when the
 * deployment does not actually satisfy a property, and it must never pass a
 * check because a field was merely present. These tests pin that behaviour so
 * the honesty rules cannot silently weaken.
 */

function check(checks: ReturnType<typeof assessOverview>, name: string) {
  const found = checks.find((c) => c.name.includes(name));
  if (!found) throw new Error(`no check matching "${name}"`);
  return found;
}

const liveOverview: OverviewShape = {
  counts: {},
  configuration: {
    persistence: { backend: "postgres", durable: true, detail: "PostgreSQL at db/aftermath" },
    memory: { backend: "memwal-mainnet", isLive: true, network: "mainnet", reason: "live" },
    tatum: { configured: true, interface: "gRPC" },
  },
  mainnetRequirement: {
    required: 10,
    completedLive: 12,
    recallVerified: 12,
    remaining: 0,
    satisfied: true,
  },
  tatumHealth: { ok: true, detail: "chain mainnet" },
  memoryStatus: { state: "MAINNET_AUTH_CONFIRMED", authenticated: true, detail: "ok" },
};

describe("production verifier", () => {
  it("passes every check for a fully live deployment", () => {
    const checks = assessOverview(liveOverview);
    expect(checks.every((c) => c.ok)).toBe(true);
  });

  it("fails the durability check when the persistence block is missing", () => {
    const stale: OverviewShape = {
      ...liveOverview,
      configuration: {
        memory: liveOverview.configuration!.memory,
        tatum: liveOverview.configuration!.tatum,
      },
    };
    const checks = assessOverview(stale);
    expect(check(checks, "durable").ok).toBe(false);
    expect(check(checks, "durable").detail).toContain("missing");
  });

  it("fails the durability check when the backend reports itself as not durable", () => {
    const sqlite: OverviewShape = {
      ...liveOverview,
      configuration: {
        ...liveOverview.configuration,
        persistence: { backend: "sqlite", durable: false, detail: "per-instance" },
      },
    };
    expect(check(assessOverview(sqlite), "durable").ok).toBe(false);
  });

  it("does not pass 'reaches Mainnet (live)' for a simulated backend", () => {
    const simulated: OverviewShape = {
      ...liveOverview,
      configuration: {
        ...liveOverview.configuration,
        memory: {
          backend: "simulated",
          isLive: false,
          network: "mainnet",
          reason: "credentials not configured",
        },
      },
      memoryStatus: { state: "SIMULATED_BACKEND", authenticated: false, detail: "no network call" },
    };
    const checks = assessOverview(simulated);
    expect(check(checks, "reaches Mainnet").ok).toBe(false);
    expect(check(checks, "backend is live").ok).toBe(false);
    expect(check(checks, "credentials accepted").ok).toBe(false);
  });

  it("requires ten completed and ten recall-verified writes", () => {
    const nine: OverviewShape = {
      ...liveOverview,
      mainnetRequirement: {
        required: 10,
        completedLive: 9,
        recallVerified: 9,
        remaining: 1,
        satisfied: false,
      },
    };
    const checks = assessOverview(nine);
    expect(check(checks, "completed Mainnet writes").ok).toBe(false);
    expect(check(checks, "recall-verified Mainnet writes").ok).toBe(false);
  });

  it("treats a missing overview payload as a failure, not a pass", () => {
    const checks = assessOverview(null);
    expect(checks).toHaveLength(1);
    expect(checks[0].ok).toBe(false);
  });
});

describe("production verifier — learning loop", () => {
  const liveLearning: LearningLoopShape = {
    retrieval: [
      {
        memoryId: "safeguard-incident-unsupported_completion_claim",
        originalIncidentId: "inc-1",
        applicable: true,
        changedBehaviour: true,
        blobId: "blob-abc",
      },
      {
        memoryId: "other-memory",
        originalIncidentId: "inc-2",
        applicable: false,
        changedBehaviour: false,
      },
    ],
    behaviourChanges: [
      {
        changed: true,
        attributableToMemory: true,
        beforeDecision: "REQUIRE_VERIFICATION",
        afterDecision: "REQUIRE_VERIFICATION",
        addedRequiredChecks: ["Capture the authoritative record."],
        changedByMemoryId: "safeguard-incident-unsupported_completion_claim",
      },
    ],
    impact: {
      totalVerifiedSafeguards: 1,
      safeguardsPersisted: 1,
      memoriesRecalled: 2,
      memoriesApplied: 1,
      investigationsInfluenced: 1,
      verificationRequirementsStrengthened: 1,
      demonstratedRepeatPreventions: 0,
    },
    provenance: [
      {
        memoryId: "safeguard-incident-unsupported_completion_claim",
        persisted: true,
        recallVerified: true,
      },
    ],
  };

  it("passes for an internally consistent learning loop", () => {
    expect(assessLearning(liveLearning).every((c) => c.ok)).toBe(true);
  });

  it("fails when an influenced investigation has no behaviour change behind it", () => {
    const inconsistent: LearningLoopShape = {
      ...liveLearning,
      behaviourChanges: [],
    };
    const found = assessLearning(inconsistent).find((c) =>
      c.name.includes("behaviour change"),
    );
    expect(found?.ok).toBe(false);
  });

  it("fails when the applied counter disagrees with the retrievals", () => {
    const inflated: LearningLoopShape = {
      ...liveLearning,
      impact: { ...liveLearning.impact, memoriesApplied: 5 },
    };
    const found = assessLearning(inflated).find((c) => c.name.includes("applied counter"));
    expect(found?.ok).toBe(false);
  });

  it("fails when a persisted memory is not recall-verified", () => {
    const unverified: LearningLoopShape = {
      ...liveLearning,
      provenance: [
        { memoryId: "safeguard-incident-unsupported_completion_claim", persisted: true, recallVerified: false },
      ],
    };
    const found = assessLearning(unverified).find((c) =>
      c.name.includes("recall-verified"),
    );
    expect(found?.ok).toBe(false);
  });

  it("fails when a changed behaviour is not attributable to the memory", () => {
    const noop: LearningLoopShape = {
      ...liveLearning,
      behaviourChanges: [
        {
          changed: true,
          attributableToMemory: false,
          beforeDecision: "REQUIRE_VERIFICATION",
          afterDecision: "REQUIRE_VERIFICATION",
          addedRequiredChecks: [],
          changedByMemoryId: "safeguard-incident-unsupported_completion_claim",
        },
      ],
    };
    const found = assessLearning(noop).find((c) => c.name.includes("memory-caused effect"));
    expect(found?.ok).toBe(false);
  });

  it("treats a missing learning payload as a failure, not a pass", () => {
    const checks = assessLearning(null);
    expect(checks).toHaveLength(1);
    expect(checks[0].ok).toBe(false);
  });
});
