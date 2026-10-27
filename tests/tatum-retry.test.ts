import { describe, it, expect, vi } from "vitest";
import {
  withRateLimitRetry,
  isRateLimit,
} from "@/lib/adapters/tatum-retry";
import { parseRetryAfter } from "@/lib/adapters/tatum-sui-graphql";
import { TatumSuiTransportError } from "@/lib/adapters/tatum-sui";

describe("isRateLimit", () => {
  it("recognises an HTTP 429 transport error", () => {
    expect(isRateLimit(new TatumSuiTransportError("slow down", "http", 429))).toBe(
      true,
    );
  });

  it("recognises a gRPC RESOURCE_EXHAUSTED code", () => {
    expect(isRateLimit({ code: "RESOURCE_EXHAUSTED" })).toBe(true);
  });

  it("does not treat an unrelated HTTP error as a rate limit", () => {
    // A 500 is a genuine transport failure, not a "try again shortly" signal.
    expect(isRateLimit(new TatumSuiTransportError("boom", "http", 500))).toBe(false);
  });

  it("does not treat a not-found transport error as a rate limit", () => {
    expect(isRateLimit(new TatumSuiTransportError("missing", "not_found"))).toBe(
      false,
    );
  });
});

describe("withRateLimitRetry", () => {
  const noSleep = async () => {};

  it("returns the first successful result without sleeping", async () => {
    const fn = vi.fn(async () => "ok");
    const sleep = vi.fn(noSleep);
    await expect(withRateLimitRetry(fn, { sleep })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries a 429 and succeeds on a later attempt", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new TatumSuiTransportError("rate limited", "http", 429);
      return "recovered";
    });
    await expect(withRateLimitRetry(fn, { sleep: noSleep })).resolves.toBe(
      "recovered",
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("gives up after the configured number of attempts", async () => {
    const fn = vi.fn(async () => {
      throw new TatumSuiTransportError("rate limited", "http", 429);
    });
    await expect(
      withRateLimitRetry(fn, { attempts: 3, sleep: noSleep }),
    ).rejects.toThrow(/rate limited/);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("never retries a non-rate-limit failure", async () => {
    const fn = vi.fn(async () => {
      throw new TatumSuiTransportError("auth", "auth", 401);
    });
    await expect(withRateLimitRetry(fn, { sleep: noSleep })).rejects.toThrow(
      /auth/,
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("honours a server Retry-After longer than the backoff", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 2) {
        throw new TatumSuiTransportError("rate limited", "http", 429, 5000);
      }
      return "ok";
    });
    const slept: number[] = [];
    await withRateLimitRetry(fn, {
      baseDelayMs: 250,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    expect(slept).toEqual([5000]);
  });
});

describe("parseRetryAfter", () => {
  it("parses a numeric seconds value", () => {
    expect(parseRetryAfter("1")).toBe(1000);
    expect(parseRetryAfter("0")).toBe(0);
  });

  it("returns undefined for a missing header", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("")).toBeUndefined();
  });

  it("parses an HTTP-date value into a positive delta", () => {
    const future = new Date(Date.now() + 3000).toUTCString();
    const ms = parseRetryAfter(future);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(3000);
  });

  it("returns undefined for a non-numeric, non-date value", () => {
    expect(parseRetryAfter("soon")).toBeUndefined();
  });
});
