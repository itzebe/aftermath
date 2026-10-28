/**
 * Server-side configuration. Never import this module from a client component:
 * it reads secrets from the process environment.
 */

import path from "node:path";
import os from "node:os";
import { accessSync, constants, existsSync, mkdirSync, readFileSync } from "node:fs";
import { loadEnvConfig, processEnv } from "@next/env";

/**
 * Next.js loads `.env*` for the web app automatically, but standalone scripts
 * run through `tsx` do not. Loading once here (idempotent) keeps the seed and
 * verification scripts reading the same `.env.local` the app does, without
 * duplicating the credentials into a second file. `@next/env` is already a
 * Next.js dependency, so no new package is introduced.
 */
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

// `@next/env` deliberately excludes `.env.local` when NODE_ENV === "test" (the
// value Vitest forces), so the opt-in live tests would never see the real
// credentials. Load that one file explicitly only when the live smoke suite is
// requested — never during ordinary unit runs, which must stay hermetic and
// must not reach the network.
if (process.env.NODE_ENV === "test" && process.env.AFTERMATH_LIVE_SMOKE) {
  const envLocal = path.resolve(process.cwd(), ".env.local");
  if (existsSync(envLocal)) {
    processEnv(
      [{ path: ".env.local", contents: readFileSync(envLocal, "utf8"), env: {} }],
      process.cwd(),
      console,
      false,
    );
  }
}

export interface AftermathConfig {
  memory: {
    serverUrl: string;
    accountId: string | null;
    privateKey: string | null;
    namespace: string;
    forceSimulated: boolean;
  };
  tatum: {
    rpcUrl: string;
    grpcUrl: string;
    graphqlUrl: string;
    apiKey: string | null;
    timeoutMs: number;
  };
  dbPath: string;
  harnessDir: string;
}

function optional(name: string): string | null {
  const value = process.env[name];
  if (!value || value.trim() === "") return null;
  return value.trim();
}

/** True when `dir` exists (or can be created) and accepts writes. */
function ensureWritableDir(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pick a base directory for the SQLite index and harness scratch space.
 *
 * Serverless hosts (Vercel included) mount the deployment bundle read-only and
 * expose only the OS temp directory for writes, so a project-relative `./data`
 * fails there with `EACCES` on the very first request. The store is an audit
 * *index*, never the authority — authoritative evidence lives at Tatum and the
 * persistent lesson store lives in Walrus Memory Mainnet — so a temp-backed
 * database is the correct behaviour on such a host rather than an error. Local
 * development keeps its durable `./data` file because that directory is
 * writable.
 *
 * Exported with injectable roots so the read-only-host behaviour is testable.
 */
export function resolveDataBaseDir(
  projectDir: string = process.cwd(),
  tmpDir: string = os.tmpdir(),
): string {
  const projectData = path.resolve(projectDir, "data");
  if (ensureWritableDir(projectData)) return projectData;
  const tempDir = path.join(tmpDir, "aftermath");
  ensureWritableDir(tempDir);
  return tempDir;
}

export function loadConfig(): AftermathConfig {
  const dataBaseDir = resolveDataBaseDir();
  return {
    memory: {
      serverUrl:
        optional("MEMWAL_SERVER_URL") ?? "https://relayer.memory.walrus.xyz",
      accountId: optional("MEMWAL_ACCOUNT_ID"),
      privateKey: optional("MEMWAL_PRIVATE_KEY") ?? optional("MEMWAL_KEY"),
      namespace: optional("MEMWAL_NAMESPACE") ?? "aftermath",
      forceSimulated: optional("AFTERMATH_FORCE_MOCK_MEMORY") === "1",
    },
    tatum: {
      rpcUrl:
        optional("TATUM_SUI_RPC_URL") ??
        "https://sui-mainnet.gateway.tatum.io",
      grpcUrl:
        optional("TATUM_SUI_GRPC_URL") ??
        "https://sui-mainnet-grpc.gateway.tatum.io",
      // The JSON-RPC interface at `rpcUrl` is no longer served by Tatum's
      // gateway; the same host now exposes GraphQL at `/graphql`.
      graphqlUrl:
        optional("TATUM_SUI_GRAPHQL_URL") ??
        "https://sui-mainnet.gateway.tatum.io/graphql",
      apiKey: optional("TATUM_API_KEY"),
      timeoutMs: Number(optional("TATUM_TIMEOUT_MS") ?? "12000"),
    },
    dbPath: path.resolve(
      optional("AFTERMATH_DB_PATH") ??
        path.join(dataBaseDir, "aftermath.db"),
    ),
    harnessDir: path.resolve(
      optional("AFTERMATH_HARNESS_DIR") ??
        path.join(dataBaseDir, "harness"),
    ),
  };
}

/**
 * Which relayer a URL points at. Used to prove that production writes go to
 * the Mainnet relayer and not the staging one.
 */
export function relayerNetwork(
  serverUrl: string,
): "mainnet" | "staging" | "unknown" {
  if (serverUrl.includes("relayer-staging.memory.walrus.xyz")) return "staging";
  if (serverUrl.includes("relayer.memory.walrus.xyz")) return "mainnet";
  return "unknown";
}
