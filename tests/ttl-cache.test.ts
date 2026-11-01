import { describe, expect, it, vi } from "vitest";
import { TtlCache } from "@/lib/api/cache";

/**
 * The read cache must (a) reuse a fresh value, (b) never cache a failure, and
 * (c) collapse a burst of concurrent misses into one load. The last property is
 * what stops a refresh loop from becoming one upstream call per request.
 */
describe("TtlCache", () => {
  it("loads once, then serves the cached value within the TTL", async () => {
    const cache = new TtlCache();
    let loads = 0;
    const load = async () => {
      loads += 1;
      return { n: loads };
    };
    const first = await cache.getOrLoad("k", 10_000, load, 1_000);
    const second = await cache.getOrLoad("k", 10_000, load, 5_000);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.value).toEqual({ n: 1 });
    expect(second.ageMs).toBe(4_000);
    expect(loads).toBe(1);
  });

  it("reloads after the TTL elapses", async () => {
    const cache = new TtlCache();
    let loads = 0;
    const load = async () => {
      loads += 1;
      return loads;
    };
    await cache.getOrLoad("k", 10_000, load, 1_000);
    await cache.getOrLoad("k", 10_000, load, 11_001);
    expect(loads).toBe(2);
  });

  it("does not cache a failure: the error propagates and the next call retries", async () => {
    const cache = new TtlCache();
    let calls = 0;
    const load = async () => {
      calls += 1;
      if (calls === 1) throw new Error("upstream down");
      return "recovered";
    };
    await expect(cache.getOrLoad("k", 10_000, load, 1_000)).rejects.toThrow("upstream down");
    const ok = await cache.getOrLoad("k", 10_000, load, 1_000);
    expect(ok.value).toBe("recovered");
    expect(ok.cached).toBe(false);
    expect(calls).toBe(2);
  });

  it("collapses concurrent misses into a single load", async () => {
    const cache = new TtlCache();
    const load = vi.fn(
      () => new Promise<number>((resolve) => setTimeout(() => resolve(42), 20)),
    );
    const results = await Promise.all(
      Array.from({ length: 5 }, () => cache.getOrLoad("k", 10_000, load, 1_000)),
    );
    expect(load).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.value === 42)).toBe(true);
  });

  it("clear drops every entry", async () => {
    const cache = new TtlCache();
    let loads = 0;
    const load = async () => {
      loads += 1;
      return loads;
    };
    await cache.getOrLoad("k", 10_000, load, 1_000);
    cache.clear();
    await cache.getOrLoad("k", 10_000, load, 1_500);
    expect(loads).toBe(2);
  });
});
