/**
 * Test-only shim for `node:sqlite`.
 *
 * Vite 5 does not know `node:sqlite` is a Node builtin, so importing it
 * directly fails during transform. This shim is what the vitest alias points
 * at; the `createRequire` call is evaluated by Node at runtime, where the real
 * builtin exists. Production code imports `node:sqlite` directly.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sqlite = require("node:sqlite") as typeof import("node:sqlite");

export const DatabaseSync = sqlite.DatabaseSync;
export default sqlite;
