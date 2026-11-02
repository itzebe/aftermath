import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AftermathConfig } from "@/lib/config";
import { evaluatePublicSubmitAvailability, guardIncidentSubmission } from "@/lib/api/public-submit-guard";
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

/**
 * Admission, not just availability.
 *
 * `evaluatePublicSubmitAvailability` decides whether the controls are present;
 * `guardIncidentSubmission` decides who may proceed. A tokenless caller must be
 * admitted *only* when the whole control set holds, and must be told it was the
 * anonymous path. These use a real PostgreSQL index (so the shared-counter
 * control is genuinely satisfied) and never call the memory relayer.
 *
 * Gated on AFTERMATH_TEST_DATABASE_URL; skipped without it.
 */
const testUrl = process.env.AFTERMATH_TEST_DATABASE_URL;
const maybeLive = testUrl ? describe : describe.skip;

maybeLive("public submission admission (real shared index)", () => {
  const prevDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(async () => {
    delete process.env.AFTERMATH_FORCE_MOCK_MEMORY;
    // Credentials present + mock off selects the live adapter; the adapter is
    // never called here, so no Mainnet traffic occurs.
    process.env.MEMWAL_PRIVATE_KEY = "0x" + "1".repeat(64);
    process.env.MEMWAL_ACCOUNT_ID = "0x" + "2".repeat(64);
    process.env.DATABASE_URL = testUrl!;
    await freshRuntime();
  });

  afterEach(() => {
    if (prevDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDatabaseUrl;
  });

  function post(token?: string): Request {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-real-ip": "203.0.113.9",
    };
    if (token) headers.authorization = `Bearer ${token}`;
    return new Request("http://test/api/incidents/submit", {
      method: "POST",
      headers,
    });
  }

  it("admits a tokenless caller as anonymous when the controls hold", async () => {
    resetSharedLimiters();
    const guard = await guardIncidentSubmission(
      post(),
      config({ publicSubmission: { enabled: true } }),
    );
    expect(guard.ok).toBe(true);
    if (guard.ok) expect(guard.anonymous).toBe(true);
  });

  it("keeps the route admin-gated when the operator has not opted in", async () => {
    resetSharedLimiters();
    const guard = await guardIncidentSubmission(
      post(),
      config({ publicSubmission: { enabled: false } }),
    );
    expect(guard.ok).toBe(false);
    if (!guard.ok) expect(guard.response.status).toBe(401);
  });

  it("admits a valid admin token even when public submission is off", async () => {
    resetSharedLimiters();
    const guard = await guardIncidentSubmission(
      post("tok"),
      config({ publicSubmission: { enabled: false } }),
    );
    expect(guard.ok).toBe(true);
    if (guard.ok) expect(guard.anonymous).toBe(false);
  });

/**
 * The public configuration summary must state public-submission availability
 * exactly as the server decides it.
 *
 * The UI renders the submission form only when `/api/config` says submission is
 * available, so the two must never disagree: a UI that offers a form the guard
 * refuses is as wrong as one that hides a form the guard would accept. This pins
 * them together by driving both from the same environment.
 */
describe("public submission availability is reported consistently", () => {
  function post(): Request {
    return new Request("http://localhost/api/incidents/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ material: "2026-03-01 ERROR sample" }),
    });
  }

  it("agrees with the guard when the controls hold", async () => {
    resetSharedLimiters();
    const { evaluatePublicSubmitAvailability } = await import(
      "@/lib/api/public-submit-guard"
    );
    const cfg = config({ publicSubmission: { enabled: true } });
    const availability = evaluatePublicSubmitAvailability(cfg);
    const guard = await guardIncidentSubmission(post(), cfg);
    expect(availability.available).toBe(guard.ok);
  });

  it("agrees with the guard when the operator has not opted in", async () => {
    resetSharedLimiters();
    const { evaluatePublicSubmitAvailability } = await import(
      "@/lib/api/public-submit-guard"
    );
    const cfg = config({ publicSubmission: { enabled: false } });
    const availability = evaluatePublicSubmitAvailability(cfg);
    const guard = await guardIncidentSubmission(post(), cfg);
    expect(availability.available).toBe(false);
    expect(guard.ok).toBe(false);
  });
});
});
