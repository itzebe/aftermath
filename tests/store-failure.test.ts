import { describe, expect, it } from "vitest";
import { PostgresAuditStore } from "@/lib/db/postgres-audit-store";
import { resolveAuditStore } from "@/lib/db/store-factory";
import { loadConfig } from "@/lib/config";

/**
 * Failure behaviour of the durable store.
 *
 * The requirement is explicit: a storage failure must never be reported as a
 * successful persistence, and a configured durable database must never be
 * silently replaced by in-memory or temp-file storage. These tests pin that.
 */
describe("durable store failure handling", () => {
  it("throws on an unreachable database instead of reporting success", async () => {
    const store = new PostgresAuditStore(
      "postgres://nobody:nobody@127.0.0.1:1/none?connect_timeout=1",
    );
    await expect(store.saveScenarioRun("x", "now", {})).rejects.toBeTruthy();
    await store.close().catch(() => {});
  });

  it("never silently falls back when a durable database is configured", async () => {
    const config = {
      ...loadConfig(),
      databaseUrl: "postgres://nobody:nobody@127.0.0.1:1/none?connect_timeout=1",
    };
    const store = resolveAuditStore(config);
    // The factory must return the Postgres store, not a SQLite fallback.
    expect(store.backend).toBe("postgres");
    expect(store.durable).toBe(true);
    await store.close().catch(() => {});
  });

  it("uses SQLite when no database URL is configured", async () => {
    const os = await import("node:os");
    const path = await import("node:path");
    const store = resolveAuditStore({
      ...loadConfig(),
      databaseUrl: null,
      dbPath: path.join(os.tmpdir(), `aftermath-test-${Date.now()}.db`),
    });
    expect(store.backend).toBe("sqlite");
    await store.close();
  });
});
