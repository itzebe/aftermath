/**
 * Sui network identity.
 *
 * A Sui gateway reports a `chainIdentifier` that is unique per network, so the
 * identifier is the only way to prove *which* chain a lookup was answered from.
 * AFTERMATH's verifier is configured for Sui Mainnet; if the gateway it reaches
 * is on any other network — a testnet URL, a mis-set environment variable — the
 * execution statuses it returns are not about Mainnet, and a Mainnet verdict
 * built on them would be wrong. Health therefore checks the identifier and
 * fails closed when it is not the network the deployment claims.
 */

/** The chain identifier Sui Mainnet reports (`getChainIdentifier`). */
export const SUI_MAINNET_CHAIN_IDENTIFIER =
  "4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S";

/** True only when a reported chain identifier is Sui Mainnet's. */
export function isSuiMainnet(
  chainIdentifier: string | null | undefined,
): boolean {
  return chainIdentifier === SUI_MAINNET_CHAIN_IDENTIFIER;
}
