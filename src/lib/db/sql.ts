import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Pool } from "pg";

/**
 * A tiny asynchronous SQL façade shared by the durable demo-job store and the
 * durable workflow-state store.
 *
 * Postgres' `Pool.query` already satisfies this shape. SQLite's `DatabaseSync`
 * is synchronous, so it is wrapped here to present the same promise-returning
 * interface — which lets both backends share one implementation of each store
 * instead of drifting into two dialects that behave differently under test.
 *
 * Parameters are always passed as an array and referenced positionally. SQLite
 * uses `?`; callers write `$1, $2, ...` and the wrapper rewrites them, so the
 * same statement text works on both engines.
 */
export interface Db {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number }>;

  /**
   * Run a migration body while holding a cross-instance lock.
   *
   * `CREATE TABLE IF NOT EXISTS` is not atomic against a *concurrent* identical
   * create: two instances starting at the same moment can both pass the
   * existence check and then collide on the catalog's unique index
   * (`duplicate key value violates unique constraint "pg_type_typname_nsp_index"`).
   * Postgres serialises the body with an advisory lock; SQLite is single-writer
   * and needs no lock, so it just runs the body.
   */
  lockMigration<T>(fn: () => Promise<T>): Promise<T>;
}

/** Advisory-lock key shared by every migrator ("AFTR"). */
export const MIGRATION_LOCK_KEY = 0x41465452;

/**
 * How long a migrator waits for the cross-instance advisory lock before giving
 * up and running its (idempotent) DDL without it.
 *
 * The lock exists only to keep two *simultaneous* cold starts from colliding on
 * the catalog. It must never be able to block a request. Production reaches
 * Postgres through Neon's transaction-mode pooler, where a session-level
 * advisory lock is not reliably bound to the server connection that holds it —
 * a lock can be left behind, and a later instance's blocking `pg_advisory_lock`
 * then waits forever, running the request to the platform's 300 s limit. The
 * acquisition below is therefore non-blocking (`pg_try_advisory_lock`) and
 * bounded; on timeout the DDL runs unlocked, which at worst re-creates an
 * already-existing table.
 */
export const MIGRATION_LOCK_TIMEOUT_MS = 5_000;
const MIGRATION_LOCK_RETRY_MS = 150;

/** The minimal client shape the migration lock needs. */
export interface LockClient {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/**
 * Run `fn` while holding the cross-instance migration lock, but never wait
 * longer than {@link MIGRATION_LOCK_TIMEOUT_MS} for it.
 *
 * The lock is acquired with the non-blocking `pg_try_advisory_lock` and retried
 * on a short interval, so a lock left behind by an earlier instance (or by the
 * pooler) degrades to "run the idempotent DDL unlocked" rather than a hang.
 */
export async function withMigrationLock<T>(
  client: LockClient,
  fn: () => Promise<T>,
  timeoutMs: number = MIGRATION_LOCK_TIMEOUT_MS,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let locked = false;
  while (Date.now() < deadline) {
    const res = await client.query(
      `SELECT pg_try_advisory_lock($1) AS locked`,
      [MIGRATION_LOCK_KEY],
    );
    if (res.rows[0]?.locked === true) {
      locked = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, MIGRATION_LOCK_RETRY_MS));
  }
  try {
    return await fn();
  } finally {
    if (locked) {
      // Best-effort: the DDL has already run, so a failed unlock is harmless.
      await client
        .query(`SELECT pg_advisory_unlock($1)`, [MIGRATION_LOCK_KEY])
        .catch(() => {});
    }
  }
}

/** True when a statement produces result rows rather than only a row count. */
function returnsRows(sql: string): boolean {
  const s = sql.trimStart().toLowerCase();
  return s.startsWith("select") || /\breturning\b/.test(s);
}

export class SqliteDb implements Db {
  private readonly db: DatabaseSync;
  private readonly ownsDb: boolean;

  /**
   * Accept either a file path or an existing `DatabaseSync`. Sharing an
   * existing connection matters for `:memory:`, where two connections to the
   * same path are actually two different databases.
   */
  constructor(target: string | DatabaseSync) {
    if (typeof target === "string") {
      if (target !== ":memory:") {
        mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
      }
      this.db = new DatabaseSync(target);
      this.db.exec("PRAGMA journal_mode = WAL;");
      this.db.exec("PRAGMA busy_timeout = 5000;");
      this.ownsDb = true;
    } else {
      this.db = target;
      this.ownsDb = false;
    }
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ rows: T[]; rowCount: number }> {
    // Rewrite positional `$n` placeholders to SQLite's `?`, expanding the
    // parameter list to match. Statements like `VALUES ($1, $3, $3)` reuse an
    // index, which `?` cannot express directly, so each occurrence is mapped
    // back to its parameter by index rather than relying on array order.
    const expanded: unknown[] = [];
    const translated = sql.replace(/\$(\d+)/g, (_m, n: string) => {
      expanded.push(params[Number(n) - 1]);
      return "?";
    });
    const stmt = this.db.prepare(translated);
    if (returnsRows(sql)) {
      const rows = stmt.all(...(expanded as never[])) as T[];
      return { rows, rowCount: rows.length };
    }
    const info = stmt.run(...(expanded as never[]));
    return { rows: [], rowCount: Number(info.changes) };
  }

  close(): void {
    if (this.ownsDb) this.db.close();
  }

  async lockMigration<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

/**
 * Postgres `Db` adapter over a shared `pg.Pool`.
 *
 * The pool is injected (rather than owned here) so the demo-job store, the
 * workflow-state store, and the existing audit store can all share one
 * connection pool instead of each opening its own.
 */
export class PgDb implements Db {
  constructor(private readonly pool: Pool) {}

  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ rows: T[]; rowCount: number }> {
    const res = await this.pool.query(sql, params as unknown[]);
    return { rows: res.rows as T[], rowCount: res.rowCount ?? res.rows.length };
  }

  async lockMigration<T>(fn: () => Promise<T>): Promise<T> {
    // The lock and the body share one client so the lock is held for the whole
    // migration. The acquisition is bounded (see `withMigrationLock`), because
    // through a transaction-mode pooler a blocking session lock can wait
    // forever — the request must never do that.
    const client = await this.pool.connect();
    try {
      return await withMigrationLock(client, fn);
    } finally {
      client.release();
    }
  }
}
