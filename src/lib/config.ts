/**
 * Server-side configuration. Never import this module from a client component:
 * it reads secrets from the process environment.
 */

import path from "node:path";

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

export function loadConfig(): AftermathConfig {
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
      apiKey: optional("TATUM_API_KEY"),
      timeoutMs: Number(optional("TATUM_TIMEOUT_MS") ?? "12000"),
    },
    dbPath: path.resolve(
      optional("AFTERMATH_DB_PATH") ?? "./data/aftermath.db",
    ),
    harnessDir: path.resolve(
      optional("AFTERMATH_HARNESS_DIR") ?? "./data/harness",
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
