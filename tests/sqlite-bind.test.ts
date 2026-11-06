import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SqliteDb } from "@/lib/db/sql";

/**
 * Boolean parameter binding.
 *
 * `node:sqlite` refuses a raw `boolean` on the Node 22 line ("Provided value
 * cannot be bound to SQLite parameter"), while Node 24 coerces it to 0/1. The
 * project allows Node >=22.13.0, so a query that binds a boolean directly works
 * on one supported runtime and throws on another — which is exactly how the
 * whole SQLite-backed suite passed locally (Node 24) and failed in CI (Node 22).
 *
 * These tests bind booleans through the real adapter, so the normalisation is
 * proven rather than assumed, and assert the 0/1 the read paths expect.
 */

const dirs: string[] = [];
async function tempDb(): Promise<SqliteDb> {
  const dir = await mkdtemp(path.join(tmpdir(), "aftermath-sqlbind-"));
  dirs.push(dir);
  return new SqliteDb(path.join(dir, "bind.db"));
}
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

describe("SqliteDb boolean binding", () => {
  it("binds booleans without throwing and stores them as 0/1", async () => {
    const db = await tempDb();
    await db.query(`CREATE TABLE flags (id INTEGER PRIMARY KEY, on_flag INTEGER, off_flag INTEGER)`);

    // A raw `boolean` here is what threw under Node 22.
    await expect(
      db.query(`INSERT INTO flags (id, on_flag, off_flag) VALUES ($1, $2, $3)`, [1, true, false]),
    ).resolves.toBeDefined();

    const { rows } = await db.query<{ on_flag: number; off_flag: number }>(
      `SELECT on_flag, off_flag FROM flags WHERE id = $1`,
      [1],
    );
    expect(rows[0]!.on_flag).toBe(1);
    expect(rows[0]!.off_flag).toBe(0);
    db.close();
  });

  it("keeps the read convention working: true or 1 both mean set", async () => {
    const db = await tempDb();
    await db.query(`CREATE TABLE t (id INTEGER PRIMARY KEY, flag INTEGER)`);
    await db.query(`INSERT INTO t (id, flag) VALUES ($1, $2)`, [1, true]);
    const { rows } = await db.query<{ flag: unknown }>(`SELECT flag FROM t WHERE id = $1`, [1]);
    // This is the predicate every parse function uses.
    expect(rows[0]!.flag === true || rows[0]!.flag === 1).toBe(true);
    db.close();
  });

  it("leaves non-boolean parameters unchanged", async () => {
    const db = await tempDb();
    await db.query(`CREATE TABLE t (id INTEGER PRIMARY KEY, s TEXT, n INTEGER, nul TEXT)`);
    await db.query(`INSERT INTO t (id, s, n, nul) VALUES ($1, $2, $3, $4)`, [1, "x", 7, null]);
    const { rows } = await db.query<{ s: string; n: number; nul: string | null }>(
      `SELECT s, n, nul FROM t WHERE id = $1`,
      [1],
    );
    expect(rows[0]).toEqual({ s: "x", n: 7, nul: null });
    db.close();
  });
});
