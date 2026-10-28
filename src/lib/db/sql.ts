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
    // The lock and the body must share one session: a session-level advisory
    // lock is released explicitly, so a dedicated client is checked out for the
    // whole migration rather than borrowing one per statement.
    const client = await this.pool.connect();
    try {
      await client.query(`SELECT pg_advisory_lock($1)`, [MIGRATION_LOCK_KEY]);
      return await fn();
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1)`, [MIGRATION_LOCK_KEY]);
      client.release();
    }
  }
}
