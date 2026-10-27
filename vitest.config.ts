import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

/**
 * Vite 5's builtin list predates `node:sqlite`, so it treats the specifier as a
 * package to bundle and fails. Alias it to a shim that loads the real builtin
 * through `createRequire` at runtime. Production code is unaffected.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "node:sqlite": fileURLToPath(
        new URL("./tests/shims/node-sqlite.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environmentMatchGlobs: [["tests/**/*.dom.test.tsx", "jsdom"]],
    globals: true,
    testTimeout: 30000,
  },
});
