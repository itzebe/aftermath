import type { MemoryAdapter } from "@/lib/adapters/memory";
import { MemWalMemoryAdapter } from "@/lib/adapters/memwal-memory";
import { SimulatedMemoryAdapter } from "@/lib/adapters/simulated-memory";
import { loadConfig, relayerNetwork, type AftermathConfig } from "@/lib/config";

export interface MemoryAdapterResolution {
  adapter: MemoryAdapter;
  /** Why this adapter was selected. Shown in the UI so the state is never hidden. */
  reason: string;
  /** True when the live adapter was requested but credentials were missing. */
  degraded: boolean;
}

let cached: MemoryAdapterResolution | null = null;

export function resolveMemoryAdapter(
  config: AftermathConfig = loadConfig(),
): MemoryAdapterResolution {
  if (cached) return cached;

  const { privateKey, accountId, forceSimulated, serverUrl } = config.memory;

  if (forceSimulated) {
    cached = {
      adapter: new SimulatedMemoryAdapter(config.memory.namespace),
      reason:
        "AFTERMATH_FORCE_MOCK_MEMORY=1 is set, so the simulated memory " +
        "backend is in use. Writes here are NOT stored on Walrus Mainnet and " +
        "do not count toward the required Mainnet total.",
      degraded: true,
    };
    return cached;
  }

  if (!privateKey || !accountId) {
    const missing = [
      !privateKey ? "MEMWAL_PRIVATE_KEY" : null,
      !accountId ? "MEMWAL_ACCOUNT_ID" : null,
    ]
      .filter(Boolean)
      .join(" and ");
    cached = {
      adapter: new SimulatedMemoryAdapter(config.memory.namespace),
      reason:
        `Walrus Memory credentials are not configured (${missing} missing). ` +
        "Running on the simulated memory backend. Writes here are NOT stored " +
        "on Walrus Mainnet and do not count toward the required Mainnet total.",
      degraded: true,
    };
    return cached;
  }

  const network = relayerNetwork(serverUrl);
  cached = {
    adapter: new MemWalMemoryAdapter(config),
    reason:
      `Live Walrus Memory adapter configured against the ${network} relayer ` +
      `(${serverUrl}), namespace "${config.memory.namespace}".`,
    degraded: false,
  };
  return cached;
}

/** Test seam: drop the cached adapter so config changes take effect. */
export function resetMemoryAdapterCache(): void {
  cached = null;
}
