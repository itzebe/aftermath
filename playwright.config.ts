import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests run against a *simulated* memory backend so they never touch
 * Walrus Mainnet and never depend on credentials being present. The suite's
 * whole point is the honesty property — that simulated state is labelled as
 * simulated — so it must be run with a backend it knows is simulated.
 *
 * The server is started automatically unless E2E_BASE_URL is supplied, in
 * which case an already-running instance is used as-is.
 */
const PORT = 12001;
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Seed the isolated database with a real scenario run before the suite, so the
  // operator surfaces have the state they render. Only applies when this config
  // starts the server; an external instance (E2E_BASE_URL) is used as-is.
  globalSetup: process.env.E2E_BASE_URL ? undefined : "./e2e/global-setup.ts",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // Reset the isolated database before the server opens it. The seed is
        // not idempotent: its two matching submissions become duplicates against
        // a database that already holds them, so the learning view stops
        // rendering the retrieval and provenance links the SC 2.5.8 test needs.
        // This must run before the server starts (deleting the file under a
        // running server would leave it on the old inode).
        command: `node -e "for (const s of ['','-wal','-shm','-journal']) require('fs').rmSync('./data/e2e-aftermath.db'+s,{force:true})" && npx next start -p ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          AFTERMATH_FORCE_MOCK_MEMORY: "1",
          AFTERMATH_DB_PATH: "./data/e2e-aftermath.db",
          // Keep the server on the same isolated SQLite file the seed writes to.
          // Without this, an ambient DATABASE_URL (present on some dev machines
          // and in CI) would make the server read Postgres while the seed wrote
          // SQLite, so the seeded operator state would be invisible to the suite.
          // `global-setup.ts` blanks these for the seed; this matches it.
          DATABASE_URL: "",
          POSTGRES_URL: "",
          AFTERMATH_DATABASE_URL: "",
          AFTERMATH_TEST_DATABASE_URL: "",
          // A fixed, non-secret token for the local test server only. The
          // operator surfaces under test (incident submission, the scenario run)
          // are gated by this token, so the suite must be able to present it —
          // exactly as a real operator does, by signing in on /admin. It is not
          // a production credential and never leaves this isolated instance.
          AFTERMATH_ADMIN_TOKEN: "e2e-operator-token",
        },
      },
});
