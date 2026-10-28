import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresAuditStore } from "@/lib/db/postgres-audit-store";

/**
 * Cross-process durability — the defect this phase fixes.
 *
 * The original store kept the audit index in a SQLite file under the process
 * working directory, which on a serverless host is either read-only (falling
 * back to the OS temp directory) or unique per instance. Either way a record
 * written by one invocation was invisible to the next.
 *
 * This test starts two *separate Node processes*. The writer records an
 * incident; the reader — given a different working directory, a different
 * `AFTERMATH_DB_PATH`, and a different `TMPDIR` — must still find it. The only
 * shared thing between them is the database, so a pass cannot be explained by
 * process memory, a shared temp file, or the deployment bundle.
 *
 * Requires AFTERMATH_TEST_DATABASE_URL; skipped without it.
 */
const url = process.env.AFTERMATH_TEST_DATABASE_URL;
const maybe = url ? describe : describe.skip;

const probe = path.resolve(__dirname, "fixtures/store-probe.ts");
const projectRoot = path.resolve(__dirname, "..");

const tmpDirs: string[] = [];

function freshTmp(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function runProbe(
  cmd: string,
  key: string,
  opts: { tmp: string; dbPath: string; databaseUrl?: string | null },
): { ok: boolean; backend: string; durable?: boolean; found?: boolean } {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Deliberately differ from the writer's, and point at throwaway dirs,
    // so nothing but the database can carry the record across.
    AFTERMATH_DB_PATH: opts.dbPath,
    TMPDIR: opts.tmp,
    AFTERMATH_HARNESS_DIR: path.join(opts.tmp, "harness"),
  };
  const dbUrl = opts.databaseUrl === undefined ? url : opts.databaseUrl;
  if (dbUrl) env.DATABASE_URL = dbUrl;
  else delete env.DATABASE_URL;

  const out = execFileSync(
    "npx",
    ["tsx", probe, cmd, key],
    { cwd: projectRoot, encoding: "utf8", timeout: 60_000, env },
  );
  return JSON.parse(out.trim());
}

maybe("cross-process durability", () => {
  const key = `probe-${Date.now()}`;
  const cleanup = new PostgresAuditStore(url!);

  beforeAll(async () => {
    await cleanup.reset();
  });

  afterAll(async () => {
    await cleanup.reset();
    await cleanup.close();
    for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
  });

  it("a record written by one process is readable by a completely separate process", () => {
    const writerTmp = freshTmp("aftermath-writer-");
    const readerTmp = freshTmp("aftermath-reader-");

    const write = runProbe("write", key, {
      tmp: writerTmp,
      dbPath: path.join(writerTmp, "writer.db"),
    });
    expect(write.ok).toBe(true);
    expect(write.backend).toBe("postgres");
    expect(write.durable).toBe(true);

    const read = runProbe("read", key, {
      tmp: readerTmp,
      dbPath: path.join(readerTmp, "reader.db"),
    });
    expect(read.ok).toBe(true);
    expect(read.found).toBe(true);
  });

  it("the reader is genuinely on the durable backend, not a local file", () => {
    const tmp = freshTmp("aftermath-check-");
    const backend = runProbe("backend", key, {
      tmp,
      dbPath: path.join(tmp, "check.db"),
    });
    expect(backend.backend).toBe("postgres");
    expect(backend.durable).toBe(true);
  });

  it("negative control: without a database URL the record does not cross processes", () => {
    // The same write/read pair, but with the durable database switched off.
    // The reader falls back to per-instance SQLite and must NOT see the record.
    // This proves the positive result above comes from the database rather than
    // from a stray shared file that happened to survive.
    const controlKey = `control-${Date.now()}`;
    const writerTmp = freshTmp("aftermath-ctl-w-");
    const readerTmp = freshTmp("aftermath-ctl-r-");

    const write = runProbe("write", controlKey, {
      tmp: writerTmp,
      dbPath: path.join(writerTmp, "writer.db"),
      databaseUrl: null,
    });
    expect(write.backend).toBe("sqlite");
    expect(write.durable).toBe(false);

    const read = runProbe("read", controlKey, {
      tmp: readerTmp,
      dbPath: path.join(readerTmp, "reader.db"),
      databaseUrl: null,
    });
    expect(read.backend).toBe("sqlite");
    expect(read.found).toBe(false);
  });
});
