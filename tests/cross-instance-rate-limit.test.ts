import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PostgresAuditStore } from "@/lib/db/postgres-audit-store";

/**
 * Cross-instance rate limiting, over real PostgreSQL.
 *
 * The unit suite (`tests/rate-limit.test.ts`) proves the limiter's *logic* over
 * an in-memory store. That cannot show the property that matters in production:
 * that a counter charged by one serverless instance is observed by a different
 * instance. This suite spawns several fully independent Node processes — each
 * with its own module state and its own in-process fallback limiter — pointed at
 * the *same* database, and asserts they share one counter.
 *
 * It is gated on `AFTERMATH_TEST_DATABASE_URL` and skipped without it, exactly
 * like the other durable suites. Run it with:
 *
 *   AFTERMATH_TEST_DATABASE_URL=postgres://... npx vitest run tests/cross-instance-rate-limit.test.ts
 */
const url = process.env.AFTERMATH_TEST_DATABASE_URL;
const maybe = url ? describe : describe.skip;

const probe = path.resolve(__dirname, "fixtures/rate-limit-probe.ts");
const projectRoot = path.resolve(__dirname, "..");

/** A short per-client cap so the shared window is exhausted in a few hits. */
const PER_CLIENT_MAX = 3;
/** A window long enough that the run cannot cross a boundary and reset. */
const WINDOW_MS = 10 * 60_000;

const tmpDirs: string[] = [];
function freshTmp(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

interface ProbeResult {
  ok: boolean;
  allowed: number;
  rounds: number;
  lastAllowed?: boolean;
  degraded?: boolean;
  globalLimited?: boolean;
  backend: string;
  durable: boolean;
}

/**
 * Run the probe in a fresh process. Each call is a distinct "instance": no
 * module state, no memory, and its own temporary directory survive between
 * calls.
 */
function runInstance(
  key: string,
  count: number,
  opts: { databaseUrl?: string | null } = {},
): ProbeResult {
  const tmp = freshTmp("aftermath-rl-");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Each instance gets its own throwaway local paths, so nothing but the
    // shared database can carry a counter across processes.
    AFTERMATH_DB_PATH: path.join(tmp, "instance.db"),
    TMPDIR: tmp,
    AFTERMATH_HARNESS_DIR: path.join(tmp, "harness"),
    // Force the shared cap and a stable, non-crossing window.
    AFTERMATH_RL_PUBLIC_READ_MAX: String(PER_CLIENT_MAX),
    AFTERMATH_RL_PUBLIC_READ_WINDOW_MS: String(WINDOW_MS),
    // Keep the global backstop far above the test's traffic so it never fires.
    AFTERMATH_RL_PUBLIC_READ_GLOBAL_MAX: "1000000",
  };
  const dbUrl = opts.databaseUrl === undefined ? url : opts.databaseUrl;
  if (dbUrl) env.DATABASE_URL = dbUrl;
  else delete env.DATABASE_URL;

  const out = execFileSync("npx", ["tsx", probe, "hits", "public-read", key, String(count)], {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 60_000,
    env,
  });
  return JSON.parse(out.trim()) as ProbeResult;
}

maybe("shared rate limiting across independent instances", () => {
  let cleanup: PostgresAuditStore;

  beforeAll(() => {
    cleanup = new PostgresAuditStore(url!);
  });

  afterAll(async () => {
    await cleanup.close();
    for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
  });

  it("a counter charged by one instance is observed by another", () => {
    const key = `rl-shared-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Instance A spends 2 of the 3 allowed hits.
    const a = runInstance(key, 2);
    expect(a.ok).toBe(true);
    expect(a.backend).toBe("postgres");
    expect(a.durable).toBe(true);
    expect(a.allowed).toBe(2);

    // Instance B — a separate process — gets the *third* hit allowed and the
    // *fourth* refused. If the counter were per-process, B would allow 3.
    const b = runInstance(key, 2);
    expect(b.ok).toBe(true);
    expect(b.allowed).toBe(1);
    expect(b.lastAllowed).toBe(false);

    // Instance C — a third process — is already over the shared cap.
    const c = runInstance(key, 1);
    expect(c.ok).toBe(true);
    expect(c.allowed).toBe(0);
    expect(c.lastAllowed).toBe(false);
  });

  it("a second client is unaffected by the first client's exhausted counter", () => {
    const spentKey = `rl-spent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    runInstance(spentKey, PER_CLIENT_MAX + 1); // exhaust one client

    const otherKey = `rl-other-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const other = runInstance(otherKey, 2);
    expect(other.ok).toBe(true);
    expect(other.allowed).toBe(2);
  });

  it("the shared verdict is not degraded (the durable store was reachable)", () => {
    const key = `rl-degraded-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const res = runInstance(key, 1);
    expect(res.degraded).toBe(false);
  });

  it("negative control: without a shared database, counters do NOT cross instances", () => {
    // The same two-instance sequence, but with the durable database switched
    // off, so each instance falls back to its own local store. Instance B must
    // then see a fresh window and allow its full per-client cap — which proves
    // the positive result above comes from the shared database and not from a
    // stray shared file.
    const key = `rl-iso-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const a = runInstance(key, 2, { databaseUrl: null });
    expect(a.backend).not.toBe("postgres");
    expect(a.allowed).toBe(2);

    const b = runInstance(key, 2, { databaseUrl: null });
    expect(b.backend).not.toBe("postgres");
    expect(b.allowed).toBe(2); // fresh per-instance window
  });
});
