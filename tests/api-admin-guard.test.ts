import { describe, expect, it } from "vitest";
import {
  adminLimiter,
  clientIpKey,
  extractAdminToken,
  guardAdminRequest,
  resetAdminLimiters,
} from "@/lib/api/verify-guard";
import { FixedWindowRateLimiter } from "@/lib/api/verify-guard";
import type { AftermathConfig } from "@/lib/config";

const TOKEN = "correct-horse-battery-staple";

function config(adminToken: string | null, limits?: AftermathConfig["adminRateLimit"]): AftermathConfig {
  return {
    memory: {
      serverUrl: "https://relayer.memory.walrus.xyz",
      accountId: null,
      privateKey: null,
      namespace: "aftermath",
      forceSimulated: true,
    },
    tatum: { rpcUrl: "x", grpcUrl: "x", graphqlUrl: "x", apiKey: null, timeoutMs: 12000 },
    ai: { provider: "none", model: "openai/gpt-oss-120b", apiKey: null, timeoutMs: 20000, maxOutputTokens: 8192 },
    aiVerify: { token: null, maxRequests: 3, windowMs: 60_000 },
    adminToken,
    adminRateLimit: limits ?? {
      "incidents/submit": { maxRequests: 5, windowMs: 60_000 },
      "scenarios/run": { maxRequests: 1, windowMs: 60_000 },
      "memory-verify": { maxRequests: 5, windowMs: 60_000 },
      reset: { maxRequests: 2, windowMs: 60_000 },
    },
    bodyLimitBytes: 65_536,
    dbPath: ":memory:",
    harnessDir: "/tmp/h",
    databaseUrl: null,
  };
}

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://test/api/reset", { method: "POST", headers });
}

describe("admin access control", () => {
  it("fails closed with 503 when no admin token is configured", () => {
    const result = guardAdminRequest(req(), config(null));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(503);
  });

  it("rejects a missing credential with 401", async () => {
    const result = guardAdminRequest(req(), config(TOKEN));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    const body = (await result.response.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("rejects a wrong credential with 401", () => {
    const result = guardAdminRequest(
      req({ authorization: "Bearer wrong" }),
      config(TOKEN),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
  });

  it("accepts the token from an Authorization bearer header", () => {
    expect(guardAdminRequest(req({ authorization: `Bearer ${TOKEN}` }), config(TOKEN)).ok).toBe(true);
  });

  it("accepts the token from the dedicated header", () => {
    expect(guardAdminRequest(req({ "x-aftermath-admin-token": TOKEN }), config(TOKEN)).ok).toBe(true);
  });

  it("never echoes the expected token in a rejection body", async () => {
    const result = guardAdminRequest(req({ authorization: "Bearer nope" }), config(TOKEN));
    if (result.ok) throw new Error("expected rejection");
    const text = JSON.stringify(await result.response.json());
    expect(text).not.toContain(TOKEN);
  });

  it("extracts an admin token only from headers", () => {
    expect(extractAdminToken(req({ "x-aftermath-admin-token": "abc" }))).toBe("abc");
    expect(extractAdminToken(req({ authorization: "Bearer abc" }))).toBe("abc");
    expect(extractAdminToken(req())).toBeNull();
  });
});

describe("clientIpKey", () => {
  it("prefers x-real-ip", () => {
    expect(clientIpKey(req({ "x-real-ip": "203.0.113.7" }))).toBe("ip:203.0.113.7");
  });

  it("uses the right-most forwarded-for entry, not the client-controlled left one", () => {
    expect(
      clientIpKey(req({ "x-forwarded-for": "1.2.3.4, 10.0.0.1, 203.0.113.9" })),
    ).toBe("ip:203.0.113.9");
  });

  it("falls back to a shared bucket so the cap never fails open", () => {
    expect(clientIpKey(req())).toBe("ip:unknown");
  });
});

describe("admin rate limiting", () => {
  it("permits up to the limit and then returns 429 with retry-after", async () => {
    resetAdminLimiters();
    const cfg = config(TOKEN);
    const limiter = adminLimiter("reset", cfg); // 2 / minute

    const first = guardAdminRequest(req({ authorization: `Bearer ${TOKEN}` }), cfg, { limiter }, 1_000);
    const second = guardAdminRequest(req({ authorization: `Bearer ${TOKEN}` }), cfg, { limiter }, 1_000);
    const third = guardAdminRequest(req({ authorization: `Bearer ${TOKEN}` }), cfg, { limiter }, 1_000);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(third.ok).toBe(false);
    if (third.ok) return;
    expect(third.response.status).toBe(429);
    expect(third.response.headers.get("retry-after")).toBe("60");
  });

  it("keys the window per client address", () => {
    const limiter = new FixedWindowRateLimiter({ maxRequests: 1, windowMs: 60_000 });
    const cfg = config(TOKEN);
    const a = guardAdminRequest(
      req({ authorization: `Bearer ${TOKEN}`, "x-real-ip": "10.0.0.1" }),
      cfg,
      { limiter },
      0,
    );
    const b = guardAdminRequest(
      req({ authorization: `Bearer ${TOKEN}`, "x-real-ip": "10.0.0.2" }),
      cfg,
      { limiter },
      0,
    );
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });

  it("still enforces the token when the limiter is bypassed", () => {
    const cfg = config(TOKEN);
    const result = guardAdminRequest(req(), cfg, { rateLimit: false });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
  });

  it("does not let an unauthenticated caller consume the limiter budget", () => {
    const limiter = new FixedWindowRateLimiter({ maxRequests: 1, windowMs: 60_000 });
    const cfg = config(TOKEN);
    // Two unauthenticated attempts: both rejected, neither charged to the window.
    guardAdminRequest(req({ "x-real-ip": "10.0.0.9" }), cfg, { limiter }, 0);
    guardAdminRequest(req({ "x-real-ip": "10.0.0.9" }), cfg, { limiter }, 0);
    // The authenticated caller still has its full budget.
    const ok = guardAdminRequest(
      req({ authorization: `Bearer ${TOKEN}`, "x-real-ip": "10.0.0.9" }),
      cfg,
      { limiter },
      0,
    );
    expect(ok.ok).toBe(true);
  });
});
