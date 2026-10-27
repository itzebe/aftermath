/**
 * Generate a Walrus Memory delegate keypair.
 *
 * This is the local half of the Walrus Memory account setup. It uses the
 * SDK's documented `generateDelegateKey()` helper and touches no network.
 *
 * The other half — creating the MemWalAccount and registering this key —
 * requires the account owner's Sui wallet, so it must be done by a human in
 * the Walrus Memory playground (https://memory.walrus.xyz). AFTERMATH never
 * asks for, receives, or stores an owner wallet key or seed phrase.
 *
 * Usage:
 *   npm run keygen
 *
 * Then, in the playground, create the account and add the public key below as
 * a delegate key. Copy the account object ID and the printed private key into
 * `.env.local` as MEMWAL_ACCOUNT_ID and MEMWAL_PRIVATE_KEY.
 */

import { generateDelegateKey } from "@mysten-incubation/memwal/account";

async function main(): Promise<void> {
  const delegate = await generateDelegateKey();

  console.log("Walrus Memory delegate keypair");
  console.log("──────────────────────────────");
  console.log(`sui address (derived) : ${delegate.suiAddress}`);
  console.log(`public key (hex)      : 0x${Buffer.from(delegate.publicKey).toString("hex")}`);
  console.log("");
  console.log("Private key — store in .env.local as MEMWAL_PRIVATE_KEY.");
  console.log("Do not commit it, paste it into a browser, or share it:");
  console.log("");
  console.log(delegate.privateKey);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Open https://memory.walrus.xyz and connect your Sui wallet.");
  console.log("  2. Create a MemWalAccount (this is an on-chain transaction).");
  console.log("  3. Add the public key above as a delegate key.");
  console.log("  4. Put the account object ID in .env.local as MEMWAL_ACCOUNT_ID.");
  console.log("  5. Run `npm run seed` to write and verify the ten Mainnet memories.");
}

main().catch((err) => {
  console.error("keygen failed:", err);
  process.exit(1);
});
