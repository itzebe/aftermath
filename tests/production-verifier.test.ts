import { describe, expect, it } from "vitest";
import { assessOverview, type OverviewShape } from "../scripts/verify-production";

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
