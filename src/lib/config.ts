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
  /**
   * AI-assisted incident analysis. Optional and off by default: the
   * deterministic engine always runs, and this only adds a model reading when a
   * free provider is configured. There is deliberately no paid provider path —
   * `provider` accepts only `groq`, whose free tier serves the fixed model.
   */
  ai: {
    /** `groq` when configured; `none` when no key is present. */
    provider: "groq" | "none";
    /** The exact model id. Fixed per provider so no paid model can be selected. */
    model: string;
    apiKey: string | null;
    timeoutMs: number;
  };
  /**
   * Read-only AI verification endpoint.
   *
   * It exists to prove — against a live deployment — that the configured
   * provider actually runs and returns a grounded result, without submitting
   * an incident or writing anything anywhere. It is off unless a token is
   * configured, and it fails closed: with no token set the route refuses to
   * serve rather than becoming a public inference endpoint.
   */
  aiVerify: {
    token: string | null;
    maxRequests: number;
    windowMs: number;
  };
  dbPath: string;
  harnessDir: string;
  /**
   * Connection string for the durable audit index (PostgreSQL). When set, the
   * audit index is stored in a shared database instead of a per-instance
   * SQLite file, so records survive across serverless invocations and are
   * visible to every instance. Never exposed to the browser.
   */
  databaseUrl: string | null;
}

/** The Groq model used for AI-assisted analysis. Fixed: the free-tier model. */
export const GROQ_MODEL = "openai/gpt-oss-120b";

function optional(name: string): string | null {
  const value = process.env[name];
  if (!value || value.trim() === "") return null;
  return value.trim();
}

/** Parse a positive-integer env value, falling back when absent or invalid. */
function positiveInt(name: string, fallback: number): number {
  const raw = optional(name);
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
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
    ai: (() => {
      // Only Groq is recognised. A key for any other provider is ignored rather
      // than used, so the deployment cannot silently fall onto a paid model.
      const groqKey = optional("GROQ_API_KEY");
      const provider = groqKey ? "groq" : "none";
      return {
        provider,
        model: GROQ_MODEL,
        apiKey: groqKey,
        timeoutMs: positiveInt("AFTERMATH_AI_TIMEOUT_MS", 20_000),
      };
    })(),
    aiVerify: {
      token: optional("AFTERMATH_AI_VERIFY_TOKEN"),
      maxRequests: positiveInt("AFTERMATH_AI_VERIFY_MAX", 5),
      windowMs: positiveInt("AFTERMATH_AI_VERIFY_WINDOW_MS", 60_000),
    },
    dbPath: path.resolve(
      optional("AFTERMATH_DB_PATH") ??
        path.join(dataBaseDir, "aftermath.db"),
    ),
    harnessDir: path.resolve(
      optional("AFTERMATH_HARNESS_DIR") ??
        path.join(dataBaseDir, "harness"),
    ),
    // Accept the common Neon/Vercel aliases so the deployment does not
    // require a bespoke variable name. Any of these selects Postgres.
    databaseUrl:
      optional("DATABASE_URL") ??
      optional("POSTGRES_URL") ??
      optional("AFTERMATH_DATABASE_URL"),
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
