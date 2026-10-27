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
        command: `npx next start -p ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          AFTERMATH_FORCE_MOCK_MEMORY: "1",
          AFTERMATH_DB_PATH: "./data/e2e-aftermath.db",
        },
      },
});
