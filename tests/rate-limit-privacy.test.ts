import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { AftermathConfig } from "@/lib/config";
import { guardIncidentSubmission } from "@/lib/api/public-submit-guard";
import { adminWriteLimiter, guardAdminWrite } from "@/lib/api/admin-write-guard";
import { rateLimitKey, resetSharedLimiters } from "@/lib/api/rate-limit";

/**
 * Rate-limit counters must not persist a caller's raw address.
 *
 * The counter key is written to a shared table that an operator (or a leaked
 * backup) can read. The public-read guard already stores a salted hash; the
 * admin-write and public-submit paths must do the same, or the shared database
 * becomes a log of every caller's IP. These exercise the real guards over real
 * PostgreSQL and assert the raw address never reaches a row.
 *
 * Gated on `AFTERMATH_TEST_DATABASE_URL`; skipped without it.
 */
const url = process.env.AFTERMATH_TEST_DATABASE_URL;
const maybe = url ? describe : describe.skip;

const CLIENT_IP = "198.51.100.77";

function config(overrides: Partial<AftermathConfig> = {}): AftermathConfig {
  const base: AftermathConfig = {
    memory: {
      serverUrl: "https://relayer.memory.walrus.xyz",
      accountId: null,
      privateKey: null,
      namespace: "aftermath",
      forceSimulated: true,
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
    // Disabled, so the submission guard takes the admin fallback — the path a
    // production deployment is actually on while public submission is off.
    publicSubmission: { enabled: false },
    adminRateLimit: { "incidents/submit": { maxRequests: 5, windowMs: 60_000 } },
    publicReadLimit: {
      read: { maxRequests: 120, windowMs: 60_000 },
      heavy: { maxRequests: 60, windowMs: 60_000 },
      status: { maxRequests: 60, windowMs: 60_000 },
    },
    publicReadGlobalLimit: { read: 1200, heavy: 600, status: 600 },
    rateLimitSalt: "privacy-test-salt",
    rateLimitRetentionMs: 120_000,
    bodyLimitBytes: 65_536,
    dbPath: ":memory:",
    harnessDir: "/tmp/h",
    databaseUrl: url ?? null,
  };
  return { ...base, ...overrides };
}

function post(ip: string, token?: string): Request {
  const headers: Record<string, string> = { "x-real-ip": ip };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request("http://test/api/incidents/submit", { method: "POST", headers });
}

maybe("rate-limit counters carry no raw client address", () => {
  let pool: Pool;
  const prevDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(() => {
    process.env.DATABASE_URL = url!;
    pool = new Pool({ connectionString: url!, max: 2 });
  });

  afterAll(async () => {
    resetSharedLimiters();
    await pool.end();
    if (prevDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDatabaseUrl;
  });

  async function rowsMatching(fragment: string): Promise<string[]> {
    const res = await pool.query<{ bucket_key: string }>(
      "SELECT bucket_key FROM rate_limit_counters WHERE bucket_key LIKE $1",
      [`%${fragment}%`],
    );
    return res.rows.map((r) => r.bucket_key);
  }

  // The counter table is shared and durable, and the fixture's buckets use a
  // fixed salt and client, so hits from an earlier run in the same window would
  // carry over — a raw row left by a revert-only-fix run would fail the
  // assertion, and a hashed row would push the counter past its cap and turn
  // `res.ok` into a 429. Clear this fixture's own rows first so the result
  // reflects this run alone.
  beforeEach(async () => {
    await pool.query(
      "DELETE FROM rate_limit_counters WHERE bucket_key LIKE $1 OR bucket_key LIKE $2 OR bucket_key LIKE $3",
      [`%${CLIENT_IP}%`, "admin:incidents/submit:%", "public:incidents/submit:%"],
    );
  });

  it("the admin-write guard stores a hash, never the raw address", async () => {
    resetSharedLimiters();
    const cfg = config();
    const res = await guardAdminWrite(post(CLIENT_IP, "tok"), cfg, {
      limiter: adminWriteLimiter("incidents/submit", cfg),
    });
    expect(res.ok).toBe(true);

    // Give the fire-and-forget sweep a moment to settle, then read the table.
    await new Promise((r) => setTimeout(r, 200));
    expect(await rowsMatching(CLIENT_IP)).toEqual([]);
    const hashed = await rowsMatching("admin:incidents/submit:");
    expect(hashed.length).toBeGreaterThan(0);
  });

  it("the submission guard (admin fallback) stores a hash, never the raw address", async () => {
    resetSharedLimiters();
    const cfg = config();
    const guard = await guardIncidentSubmission(post(CLIENT_IP, "tok"), cfg);
    expect(guard.ok).toBe(true);
    if (guard.ok) expect(guard.anonymous).toBe(false);

    await new Promise((r) => setTimeout(r, 200));
    expect(await rowsMatching(CLIENT_IP)).toEqual([]);
  });

  it("the derived key is a salted hash that does not contain the address", () => {
    for (const bucket of ["admin:incidents/submit", "public:incidents/submit"]) {
      const key = rateLimitKey(bucket, `ip:${CLIENT_IP}`, "privacy-test-salt");
      expect(key.startsWith(`${bucket}:`)).toBe(true);
      expect(key).not.toContain(CLIENT_IP);
      // The same client under a different salt yields a different counter, so
      // the stored value cannot be reversed by hashing candidate addresses.
      const other = rateLimitKey(bucket, `ip:${CLIENT_IP}`, "another-salt");
      expect(other).not.toBe(key);
    }
  });
});
