/**
 * Test fixture: a tiny CLI over the real audit store.
 *
 * The cross-process durability test spawns this file twice, in two separate
 * Node processes, to prove that a record committed by one process is readable
 * by another that shares no memory and no temporary directory with it.
 *
 * Usage: tsx tests/fixtures/store-probe.ts <write|read|backend> <key>
 */
import { resolveAuditStore } from "../../src/lib/db/store-factory";
import { loadConfig } from "../../src/lib/config";

async function main(): Promise<void> {
  const [cmd, key] = process.argv.slice(2);
  const store = resolveAuditStore(loadConfig());
  try {
    if (cmd === "write") {
      await store.saveScenarioRun(key, new Date().toISOString(), { probe: key });
      process.stdout.write(
        JSON.stringify({ ok: true, backend: store.backend, durable: store.durable }),
      );
    } else if (cmd === "read") {
      const runs = await store.listScenarioRuns(500);
      process.stdout.write(
        JSON.stringify({
          ok: true,
          found: runs.some((r) => r.runId === key),
          backend: store.backend,
        }),
      );
    } else if (cmd === "backend") {
      process.stdout.write(
        JSON.stringify({ ok: true, backend: store.backend, durable: store.durable }),
      );
    } else {
      throw new Error(`unknown command: ${cmd}`);
    }
  } finally {
    await store.close();
  }
}

main().catch((err) => {
  process.stderr.write(String(err) + "\n");
  process.exit(1);
});
