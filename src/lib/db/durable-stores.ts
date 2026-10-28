import { Pool } from "pg";
import type { AuditStore } from "@/lib/db/audit-store";
import { PostgresAuditStore } from "@/lib/db/postgres-audit-store";
import { SqliteAuditStore } from "@/lib/db/sqlite-audit-store";
import { PgDb, SqliteDb, type Db } from "@/lib/db/sql";
import { SqlDemoJobStore, type DemoJobStore } from "@/lib/db/demo-job-store";
import { DbWorkflowStateStore } from "@/lib/adapters/workflow-state";
import type { WorkflowStateStore } from "@/lib/adapters/workflow-state";
import { loadConfig, type AftermathConfig } from "@/lib/config";
import path from "node:path";

/**
 * The durable stores a resumable demonstration needs, resolved together so
 * they share one connection.
 *
 * The audit index already had a durable Postgres backend. The demonstration
 * job tracker and the workflow prerequisite state need the same property —
 * visible to whichever instance handles the next request — so they are built
 * on the same connection rather than each opening its own.
 *
 * Backend selection mirrors the audit store exactly: `DATABASE_URL` (or a
 * Neon/Vercel alias) selects Postgres; otherwise a SQLite file is used, which
 * is durable for a local long-running host but per-instance on serverless.
 */
export interface DurableStores {
  audit: AuditStore;
  jobs: DemoJobStore;
  workflow: WorkflowStateStore;
  backend: "sqlite" | "postgres";
  durable: boolean;
  detail: string;
  /** Run the idempotent migrations for the job and workflow tables. */
  migrate(): Promise<void>;
  close(): Promise<void>;
}

export function resolveDurableStores(
  config: AftermathConfig = loadConfig(),
): DurableStores {
  if (config.databaseUrl) {
    const pool = new Pool({
      connectionString: config.databaseUrl,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on("error", () => {});
    const audit = new PostgresAuditStore(config.databaseUrl, { pool });
    const db = new PgDb(pool);
    const jobs = new SqlDemoJobStore(db, "postgres");
    const workflow = new DbWorkflowStateStore(db);
    let migrated: Promise<void> | null = null;
    return {
      audit,
      jobs,
      workflow,
      backend: "postgres",
      durable: true,
      detail: audit.detail,
      migrate() {
        if (!migrated) migrated = jobs.migrate().then(() => workflow.migrate());
        return migrated;
      },
      async close() {
        await audit.close();
        await pool.end();
      },
    };
  }

  const audit = new SqliteAuditStore(config.dbPath, {
    durable: isDurableSqlite(config.dbPath),
    detail: isDurableSqlite(config.dbPath)
      ? `SQLite file at ${config.dbPath}`
      : `SQLite at ${config.dbPath} — a per-instance temporary location. Records are ` +
        "not shared between serverless instances. Set DATABASE_URL for durable storage.",
  });
  const db: Db = new SqliteDb(audit.getHandle());
  const jobs = new SqlDemoJobStore(db, "sqlite");
  const workflow = new DbWorkflowStateStore(db);
  let migrated: Promise<void> | null = null;
  return {
    audit,
    jobs,
    workflow,
    backend: "sqlite",
    durable: audit.durable,
    detail: audit.detail,
    migrate() {
      if (!migrated) migrated = jobs.migrate().then(() => workflow.migrate());
      return migrated;
    },
    async close() {
      await audit.close();
    },
  };
}

function isDurableSqlite(dbPath: string): boolean {
  const durableDir = path.resolve(process.cwd(), "data");
  return path.resolve(dbPath).startsWith(durableDir + path.sep);
}
