import { describe, expect, it } from "vitest";
import { MemWal } from "@mysten-incubation/memwal";
import { MemWalMemoryAdapter } from "@/lib/adapters/memwal-memory";
import { TatumSuiAdapter } from "@/lib/adapters/tatum-sui";
import { loadConfig } from "@/lib/config";

/**
 * Opt-in live smoke tests.
 *
 * These talk to the real Mainnet relayer and the real Tatum gateway, so they
 * are skipped by default and only run with AFTERMATH_LIVE_SMOKE=1. They exist
 * to prove the production code path reaches the real services, which is the
 * claim that a mocked test cannot support.
 *
 *   AFTERMATH_LIVE_SMOKE=1 npx vitest run tests/live-smoke.test.ts
 */

const live = process.env.AFTERMATH_LIVE_SMOKE === "1";
const maybe = live ? describe : describe.skip;

maybe("live smoke: Walrus Memory relayer", () => {
  it("reaches the Mainnet relayer and reports its version", async () => {
    const client = MemWal.create({
      // Syntactically valid but unregistered. `health` is unauthenticated.
      key: "0".repeat(64),
      accountId: "0x0",
      serverUrl: "https://relayer.memory.walrus.xyz",
      namespace: "aftermath-smoke",
    });
    try {
      const health = await client.health();
      expect(health.status).toBe("ok");
      expect(health.relayerVersion).toBeTruthy();
      expect(health.apiVersion).toBeTruthy();
    } finally {
      client.destroy();
    }
  }, 30_000);

  it("labels the Mainnet relayer as memwal-mainnet", async () => {
    const config = loadConfig();
    const adapter = new MemWalMemoryAdapter({
      ...config,
      memory: {
        ...config.memory,
        serverUrl: "https://relayer.memory.walrus.xyz",
        privateKey: "0".repeat(64),
        accountId: "0x0",
      },
    });
    const health = await adapter.validateMemoryAvailability();
    expect(health.ok).toBe(true);
    expect(adapter.backend).toBe("memwal-mainnet");
    expect(adapter.isLive).toBe(true);
    adapter.destroy();
  }, 30_000);

  it("refuses a write with unregistered credentials instead of faking success", async () => {
    const config = loadConfig();
    const adapter = new MemWalMemoryAdapter({
      ...config,
      memory: {
        ...config.memory,
        privateKey: "0".repeat(64),
        accountId: "0x0",
        namespace: "aftermath-smoke",
      },
    });
    const receipt = await adapter.rememberIncident({
      domain: "finance",
      actionType: "report_sui_transaction_success",
      executionId: "smoke",
      intendedOutcome: "smoke test",
      evidenceReferences: [],
      relevantContext: {},
      provenance: "simulated",
      incidentId: "smoke-incident",
      createdAt: new Date().toISOString(),
      currentStatus: "open",
    });
    expect(receipt.state).toBe("failed");
    expect(receipt.blobId).toBeUndefined();
    expect(receipt.recallVerified).toBe(false);
    adapter.destroy();
  }, 60_000);
});

maybe("live smoke: Tatum Sui gateway", () => {
  it("classifies a missing API key as a credential problem, not a tx outcome", async () => {
    const adapter = new TatumSuiAdapter({
      rpcUrl: "https://sui-mainnet.gateway.tatum.io",
      apiKey: null,
      timeoutMs: 15_000,
    });
    const health = await adapter.health();
    expect(health.ok).toBe(false);
    expect(health.detail).toBeTruthy();
  }, 30_000);

  it("maps a rejected API key to UNKNOWN, never to a failed transaction", async () => {
    const adapter = new TatumSuiAdapter({
      rpcUrl: "https://sui-mainnet.gateway.tatum.io",
      apiKey: "definitely-not-a-valid-key",
      timeoutMs: 15_000,
    });
    const result = await adapter.verifyTransaction("0x".padEnd(66, "0"));
    // The lookup could not be completed, so the outcome is UNKNOWN. The point
    // of the assertion is that it is not VERIFIED_FAILURE.
    expect(result.assessment.status).toBe("UNKNOWN");
    expect(result.assessment.status).not.toBe("VERIFIED_FAILURE");
    expect(result.transportOk).toBe(false);
  }, 30_000);
});
