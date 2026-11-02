/**
 * Playwright global setup: prepare the isolated E2E database.
 *
 * The browser suite exercises the operator surfaces (the scenario run, the
 * incident explorer, the evaluation metrics) against a running instance. Those
 * surfaces read state that a *signed-in operator* produces by running the
 * controlled scenarios; the suite deliberately does not drive the operator
 * sign-in flow, and it must not reach Walrus Mainnet.
 *
 * Without this step the E2E instance starts empty, so the operator surfaces
 * render their honest empty states ("No scenario run recorded yet") and the
 * tests that assert the populated views fail — not because the product is
 * broken, but because the environment was never seeded.
 *
 * This seeds the same SQLite file the E2E server uses, by running the *real*
 * scenario plan against the *simulated* memory backend. It writes only to the
 * isolated test database (`AFTERMATH_DB_PATH`); it never touches production,
 * never uses a live credential, and never performs a Mainnet write.
 *
 * The seeding runs in the Playwright process, which does not inherit the web
 * server's `webServer.env`, so the environment is set here explicitly and
 * matched to `playwright.config.ts`.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";

/** The isolated E2E database path, shared with `playwright.config.ts`. */
export const E2E_DB_PATH = "./data/e2e-aftermath.db";

export default function globalSetup(): void {
  const cwd = path.resolve(__dirname, "..");
  // Run the seeding through the project's own tsx, so the `@/` path alias and
  // the app's config loader are the ones the application uses.
  execFileSync(
    path.join(cwd, "node_modules", ".bin", "tsx"),
    [path.join(cwd, "e2e", "seed-e2e.ts")],
    {
      cwd,
      stdio: "inherit",
      env: {
        ...process.env,
        // A simulated backend: no credentials, no Mainnet write.
        AFTERMATH_FORCE_MOCK_MEMORY: "1",
        AFTERMATH_DB_PATH: E2E_DB_PATH,
        // Never let an ambient value point the seed at a real database.
        DATABASE_URL: "",
        POSTGRES_URL: "",
        AFTERMATH_DATABASE_URL: "",
      },
    },
  );
}
