import { describe, expect, it } from "vitest";
import {
  FixedWindowRateLimiter,
  callerId,
  constantTimeEqual,
  extractToken,
  guardVerifyRequest,
} from "@/lib/api/verify-guard";
import type { AftermathConfig } from "@/lib/config";

function config(token: string | null): AftermathConfig {
  return {
    memory: {
      serverUrl: "https://relayer.memory.walrus.xyz",
      accountId: null,
      privateKey: null,
      namespace: "aftermath",
      forceSimulated: true,
    },
    tatum: { rpcUrl: "x", grpcUrl: "x", graphqlUrl: "x", apiKey: null, timeoutMs: 12000 },
    ai: { provider: "none", model: "openai/gpt-oss-120b", apiKey: null, timeoutMs: 20000 },
    aiVerify: { token, maxRequests: 3, windowMs: 60_000 },
    dbPath: ":memory:",
    harnessDir: "/tmp/h",
    databaseUrl: null,
  };
}

function req(headers: Record<string, string>): Request {
  return new Request("http://test/api/ai/verify", { method: "POST", headers });
}

describe("verify-guard", () => {
  it("compares tokens in constant time, with correct equality", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcdef")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
  });

  it("extracts a bearer token, or the dedicated header", () => {
    expect(extractToken(req({ authorization: "Bearer secret" }))).toBe("secret");
    expect(extractToken(req({ "x-aftermath-verify-token": "secret" }))).toBe("secret");
    expect(extractToken(req({}))).toBeNull();
  });

  it("refuses to serve when no token is configured (fail closed)", () => {
    const res = guardVerifyRequest(req({}), config(null), new FixedWindowRateLimiter({ maxRequests: 3, windowMs: 1000 }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(503);
  });

  it("rejects a wrong token with 401", () => {
    const res = guardVerifyRequest(
      req({ authorization: "Bearer wrong" }),
      config("right"),
      new FixedWindowRateLimiter({ maxRequests: 3, windowMs: 1000 }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(401);
  });

  it("cannot be evaded by rotating the spoofable forwarded-for header", () => {
    const limiter = new FixedWindowRateLimiter({ maxRequests: 2, windowMs: 60_000 });
    const cfg = config("tok");
    const statuses = ["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4"].map((ip) => {
      const res = guardVerifyRequest(
        req({ authorization: "Bearer tok", "x-forwarded-for": ip }),
        cfg,
        limiter,
        1000,
      );
      return res.ok ? 200 : res.response.status;
    });
    // The third distinct IP is still capped, because the bucket is the token.
    expect(statuses).toEqual([200, 200, 429, 429]);
  });

  it("keys the bucket on the token, not the IP", () => {
    const a = callerId(req({ authorization: "Bearer t1", "x-forwarded-for": "9.9.9.9" }));
    const b = callerId(req({ authorization: "Bearer t1", "x-forwarded-for": "8.8.8.8" }));
    expect(a).toBe(b);
  });

  it("reopens the window after it elapses", () => {
    const limiter = new FixedWindowRateLimiter({ maxRequests: 1, windowMs: 1000 });
    expect(limiter.check("k", 0).allowed).toBe(true);
    expect(limiter.check("k", 500).allowed).toBe(false);
    expect(limiter.check("k", 1000).allowed).toBe(true);
  });
});
