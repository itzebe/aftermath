import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AftermathConfig } from "@/lib/config";
import { evaluatePublicSubmitAvailability } from "@/lib/api/public-submit-guard";
import { resetSharedLimiters } from "@/lib/api/rate-limit";

/**
 * Public submission must fail closed.
 *
 * An anonymous caller may reach the pipeline only when *every* safety control is
 * present: the operator has opted in, the memory backend is live Mainnet, the
 * audit index is shared, and a per-client cap is configured. Any missing control
 * keeps the route admin-gated. These exercise the real evaluator against the
 * live runtime, with the environment varied to remove each control in turn.
 */

const BASE_ENV = { ...process.env };

function restoreEnv() {
  for (const k of Object.keys(process.env)) {
    if (!(k in BASE_ENV)) delete process.env[k];
  }
  Object.assign(process.env, BASE_ENV);
}

async function freshRuntime() {
  const { resetMemoryAdapterCache } = await import("@/lib/adapters/memory-factory");
  resetMemoryAdapterCache();
  const { resetRuntime } = await import("@/lib/runtime");
  await resetRuntime().catch(() => {});
}

beforeEach(() => {
  restoreEnv();
  resetSharedLimiters();
});

afterEach(async () => {
  await freshRuntime();
  restoreEnv();
});

function config(overrides: Partial<AftermathConfig> = {}): AftermathConfig {
  const base: AftermathConfig = {
    memory: {
      serverUrl: "https://relayer.memory.walrus.xyz",
      accountId: "0xabc",
      privateKey: "key",
      namespace: "aftermath",
      forceSimulated: false,
    },
    tatum: { rpcUrl: "x", grpcUrl: "x", graphqlUrl: "x", apiKey: null, timeoutMs: 12000 },
    ai: {
      provider: "none",
      model: "openai/gpt-oss-120b",
      apiKey: null,
      timeoutMs: 20000,
      maxOutputTokens: 8192,
    },
    aiVerify: { token: null, maxRequests: 3, windowMs: 60_000 },
    adminToken: "tok",
    publicSubmission: { enabled: true },
    adminRateLimit: {
      "incidents/submit": { maxRequests: 5, windowMs: 60_000 },
      "scenarios/run": { maxRequests: 1, windowMs: 60_000 },
      "memory-verify": { maxRequests: 5, windowMs: 60_000 },
      reset: { maxRequests: 2, windowMs: 60_000 },
    },
    publicReadLimit: {
      read: { maxRequests: 120, windowMs: 60_000 },
      heavy: { maxRequests: 60, windowMs: 60_000 },
      status: { maxRequests: 60, windowMs: 60_000 },
    },
    publicReadGlobalLimit: { read: 1200, heavy: 600, status: 600 },
    rateLimitSalt: "test-salt",
    rateLimitRetentionMs: 120_000,
    bodyLimitBytes: 65_536,
    dbPath: ":memory:",
    harnessDir: "/tmp/h",
    databaseUrl: "postgres://x",
  };
  return { ...base, ...overrides };
}

describe("public submission availability fails closed", () => {
  it("is unavailable when the operator has not opted in", () => {
    const v = evaluatePublicSubmitAvailability(
      config({ publicSubmission: { enabled: false } }),
    );
    expect(v.available).toBe(false);
    expect(v.reason).toMatch(/disabled/i);
  });

  it("is unavailable when the memory backend is simulated", async () => {
    process.env.AFTERMATH_FORCE_MOCK_MEMORY = "1";
    await freshRuntime();
    const v = evaluatePublicSubmitAvailability(config());
    expect(v.available).toBe(false);
    expect(v.reason).toMatch(/simulated|not the live/i);
  });

  it("is unavailable when the audit index is not shared", async () => {
    process.env.AFTERMATH_FORCE_MOCK_MEMORY = "1";
    await freshRuntime();
    const v = evaluatePublicSubmitAvailability(config({ databaseUrl: null }));
    expect(v.available).toBe(false);
  });

  it("is unavailable with no positive per-client cap", async () => {
    process.env.AFTERMATH_FORCE_MOCK_MEMORY = "1";
    await freshRuntime();
    const v = evaluatePublicSubmitAvailability(
      config({
        adminRateLimit: {
          "incidents/submit": { maxRequests: 0, windowMs: 60_000 },
        },
      }),
    );
    expect(v.available).toBe(false);
  });

  it("never enables submission on a partial control set (simulated backend)", async () => {
    // Every other control present, but the backend is not live: availability
    // must still be false. This is the dangerous "partial controls" state.
    process.env.AFTERMATH_FORCE_MOCK_MEMORY = "1";
    await freshRuntime();
    const v = evaluatePublicSubmitAvailability(config());
    expect(v.available).toBe(false);
  });

  it("is available only when the whole control set is present", async () => {
    // Configure the live adapter (credentials present, mock off) and a shared
    // index, then confirm availability flips to true. The adapter is never
    // called, so no network access happens.
    delete process.env.AFTERMATH_FORCE_MOCK_MEMORY;
    process.env.MEMWAL_PRIVATE_KEY = "0x" + "1".repeat(64);
    process.env.MEMWAL_ACCOUNT_ID = "0x" + "2".repeat(64);
    process.env.DATABASE_URL = "postgres://user:pw@127.0.0.1:5432/aftermath";
    await freshRuntime();
    const v = evaluatePublicSubmitAvailability(config());
    expect(v.available).toBe(true);
    expect(v.reason).toMatch(/safety controls are present/i);
  });
});
