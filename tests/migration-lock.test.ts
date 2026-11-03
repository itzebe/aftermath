import { describe, expect, it } from "vitest";
import { MIGRATION_LOCK_KEY, withMigrationLock, type LockClient } from "@/lib/db/sql";

/**
 * The migration lock must never block a request indefinitely.
 *
 * Production reaches Postgres through Neon's transaction-mode pooler, where a
 * session-level advisory lock is not reliably bound to the server connection
 * that holds it. A lock left behind by an earlier instance made a later
 * instance's *blocking* `pg_advisory_lock` wait forever — the request ran to the
 * platform's 300 s limit and became an intermittent 504/hang.
 *
 * These tests pin the two properties that fix it: the acquisition is
 * non-blocking (`pg_try_advisory_lock`), and it is bounded — on timeout the body
 * still runs, because the DDL is idempotent.
 */

/** A client whose advisory lock is never obtainable (a lock left behind). */
function lockedOutClient() {
  const statements: string[] = [];
  const client: LockClient = {
    async query(sql: string) {
      statements.push(sql);
      if (sql.includes("pg_try_advisory_lock")) {
        return { rows: [{ locked: false }] };
      }
      return { rows: [] };
    },
  };
  return { client, statements };
}

describe("withMigrationLock", () => {
  it("acquires the lock without blocking, then releases it", async () => {
    const statements: string[] = [];
    let attempts = 0;
    const client: LockClient = {
      async query(sql: string) {
        statements.push(sql);
        if (sql.includes("pg_try_advisory_lock")) {
          attempts += 1;
          return { rows: [{ locked: true }] };
        }
        return { rows: [] };
      },
    };

    const result = await withMigrationLock(client, async () => "migrated");

    expect(result).toBe("migrated");
    expect(attempts).toBe(1);
    expect(statements.some((s) => s.includes("pg_advisory_lock("))).toBe(false);
    expect(statements.some((s) => s.includes("pg_advisory_unlock"))).toBe(true);
  });

  it("gives up and still runs the body when the lock is held elsewhere", async () => {
    const { client, statements } = lockedOutClient();
    let ran = false;

    const started = Date.now();
    const result = await withMigrationLock(
      client,
      async () => {
        ran = true;
        return "ddl-done";
      },
      300,
    );
    const elapsed = Date.now() - started;

    expect(result).toBe("ddl-done");
    expect(ran).toBe(true);
    // Bounded: it returns shortly after the timeout, not never.
    expect(elapsed).toBeLessThan(3_000);
    // It retried the non-blocking try rather than a single blocking attempt.
    expect(statements.filter((s) => s.includes("pg_try_advisory_lock")).length).toBeGreaterThan(1);
    // It never issued the blocking form, and never tried to unlock a lock it
    // did not hold.
    expect(statements.some((s) => s.includes("pg_advisory_lock("))).toBe(false);
    expect(statements.some((s) => s.includes("pg_advisory_unlock"))).toBe(false);
  });

  it("releases the lock even when the body throws", async () => {
    const statements: string[] = [];
    const client: LockClient = {
      async query(sql: string) {
        statements.push(sql);
        if (sql.includes("pg_try_advisory_lock")) {
          return { rows: [{ locked: true }] };
        }
        return { rows: [] };
      },
    };

    await expect(
      withMigrationLock(client, async () => {
        throw new Error("ddl failed");
      }),
    ).rejects.toThrow("ddl failed");
    expect(statements.some((s) => s.includes("pg_advisory_unlock"))).toBe(true);
  });

  it("passes the shared lock key so every migrator serialises on the same lock", async () => {
    const seen: unknown[][] = [];
    const client: LockClient = {
      async query(sql: string, params?: unknown[]) {
        if (sql.includes("pg_try_advisory_lock")) {
          seen.push(params ?? []);
          return { rows: [{ locked: true }] };
        }
        return { rows: [] };
      },
    };
    await withMigrationLock(client, async () => undefined);
    expect(seen[0]).toEqual([MIGRATION_LOCK_KEY]);
  });
});
