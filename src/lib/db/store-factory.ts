import type { AuditStore } from "@/lib/db/audit-store";
import { SqliteAuditStore } from "@/lib/db/sqlite-audit-store";
import { PostgresAuditStore } from "@/lib/db/postgres-audit-store";
import { loadConfig, resolveDataBaseDir, type AftermathConfig } from "@/lib/config";
import path from "node:path";

/**
 * Select the audit-index engine.
 *
 * `DATABASE_URL` (or a Neon/Vercel alias) selects the durable PostgreSQL store,
 * which is shared across instances. Without it the SQLite store is used, which
 * is correct for local development and tests but is process-local on a
 * serverless host.
 *
 * There is deliberately **no silent fallback**: if a durable database is
 * configured but unreachable, operations throw rather than quietly writing to a
 * temp file and reporting success. The caller (and the UI) must see the failure.
 */
export function resolveAuditStore(config: AftermathConfig = loadConfig()): AuditStore {
  if (config.databaseUrl) {
    return new PostgresAuditStore(config.databaseUrl);
  }
  return makeSqliteStore(config);
}

function makeSqliteStore(config: AftermathConfig): AuditStore {
  // A SQLite file is only genuinely durable when it lives in the persistent
  // project directory. When the host forced a fallback to the OS temp
  // directory (read-only deployment bundle), records do not survive the
  // instance, and the store reports that honestly.
  const durableDir = path.resolve(process.cwd(), "data");
  const usingProjectDir = path.resolve(config.dbPath).startsWith(durableDir + path.sep);
  return new SqliteAuditStore(config.dbPath, {
    durable: usingProjectDir,
    detail: usingProjectDir
      ? `SQLite file at ${config.dbPath}`
      : `SQLite at ${config.dbPath} — a per-instance temporary location. Records are ` +
        "not shared between serverless instances. Set DATABASE_URL for durable storage.",
  });
}

/** Exported for tests that need a temp-backed SQLite store explicitly. */
export function makeInMemoryStore(): AuditStore {
  return new SqliteAuditStore(":memory:", {
    durable: false,
    detail: "In-memory SQLite (test only)",
  });
}

export { resolveDataBaseDir };
