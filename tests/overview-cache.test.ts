import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The overview is the homepage's data source and makes three external calls
 * (Tatum health, Walrus availability, Walrus status). Those must be made once
 * per cache window, not once per visitor. This suite counts the calls to prove
 * the cache is doing its job, and checks the output contract is unchanged.
 */

let dir: string;
let getOverview: () => Promise<import("@/lib/service").OverviewPayload>;
let resetOverviewCache: () => void;
let runtime: () => import("@/lib/runtime").Runtime;

let tatumHealthCalls = 0;
let memoryAvailCalls = 0;
let memoryStatusCalls = 0;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "aftermath-overview-"));
  process.env.AFTERMATH_FORCE_MOCK_MEMORY = "1";
  process.env.AFTERMATH_DB_PATH = path.join(dir, "aftermath.db");
  process.env.DATABASE_URL = "";
  process.env.POSTGRES_URL = "";
  process.env.AFTERMATH_DATABASE_URL = "";

  ({ getOverview, resetOverviewCache } = await import("@/lib/service"));
  ({ runtime } = await import("@/lib/runtime"));
});

afterAll(async () => {
  const { resetRuntime } = await import("@/lib/runtime");
  await resetRuntime().catch(() => {});
  await rm(dir, { recursive: true, force: true });
  delete process.env.AFTERMATH_FORCE_MOCK_MEMORY;
  delete process.env.AFTERMATH_DB_PATH;
});

beforeEach(() => {
  tatumHealthCalls = 0;
  memoryAvailCalls = 0;
  memoryStatusCalls = 0;
  resetOverviewCache();
  // Count calls at the external boundary without changing behaviour.
  const rt = runtime();
  const sui = rt.suiVerifier;
  vi.spyOn(sui, "health").mockImplementation(async () => {
    tatumHealthCalls += 1;
    return { ok: true, detail: "stub" };
  });
  vi.spyOn(rt.memory.adapter, "validateMemoryAvailability").mockImplementation(async () => {
    memoryAvailCalls += 1;
    return { ok: true, detail: "stub" };
  });
  vi.spyOn(rt.memory.adapter, "status").mockImplementation(async () => {
    memoryStatusCalls += 1;
    return { state: "ready", authenticated: true, detail: "stub" } as never;
  });
});

describe("getOverview caching", () => {
  it("makes one external health check per cache window", async () => {
    const now = vi.spyOn(Date, "now");
    const t0 = 1_000_000_000_000;
    now.mockReturnValue(t0);

    await getOverview();
    await getOverview();
    now.mockReturnValue(t0 + 5_000);
    await getOverview();

    expect(tatumHealthCalls).toBe(1);
    expect(memoryAvailCalls).toBe(1);
    expect(memoryStatusCalls).toBe(1);

    // Past the 10s window, it re-checks once.
    now.mockReturnValue(t0 + 11_000);
    await getOverview();
    expect(tatumHealthCalls).toBe(2);

    now.mockRestore();
  });

  it("returns a payload with the unchanged contract", async () => {
    const overview = await getOverview();
    expect(overview).toHaveProperty("counts");
    expect(overview).toHaveProperty("configuration");
    expect(overview).toHaveProperty("tatumHealth");
    expect(overview).toHaveProperty("memoryHealth");
    expect(overview).toHaveProperty("memoryStatus");
    expect(overview).toHaveProperty("mainnetRequirement");
    expect(overview).toHaveProperty("evaluation");
    expect(overview).toHaveProperty("lastRunAt");

    const counts = overview.counts as unknown as Record<string, number>;
    for (const key of [
      "incidents",
      "verifiedFailures",
      "activeRules",
      "unresolved",
      "completedLiveWrites",
      "recallVerifiedWrites",
      "simulatedWrites",
      "totalWrites",
      "records",
    ]) {
      expect(typeof counts[key]).toBe("number");
    }
  });

  it("does not cache a failure: the error propagates and the next call retries", async () => {
    const rt = runtime();
    let calls = 0;
    vi.spyOn(rt.suiVerifier, "health").mockImplementation(async () => {
      calls += 1;
      if (calls === 1) throw new Error("tatum down");
      return { ok: true, detail: "recovered" };
    });

    await expect(getOverview()).rejects.toThrow("tatum down");
    // The failure was not memoised; the next call rebuilds successfully.
    const recovered = await getOverview();
    expect(recovered).toHaveProperty("counts");
    expect(calls).toBe(2);
  });
});
