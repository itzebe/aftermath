import { describe, expect, it } from "vitest";
import { MemWal } from "@mysten-incubation/memwal";
import { MemWalMemoryAdapter } from "@/lib/adapters/memwal-memory";
import { TatumSuiAdapter } from "@/lib/adapters/tatum-sui";
import { TatumSuiGrpcAdapter } from "@/lib/adapters/tatum-sui-grpc";
import { TatumSuiGraphqlAdapter } from "@/lib/adapters/tatum-sui-graphql";
import { loadConfig } from "@/lib/config";
import { SafeguardMemoryRecordSchema } from "@/lib/schemas";
import { buildSuiVerifier, runFinanceEvidenceCases } from "@/lib/demos/finance";
import { SUI_MAINNET_CHAIN_IDENTIFIER } from "@/lib/adapters/sui-network";

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

maybe("live smoke: Tatum Sui gRPC gateway (primary interface)", () => {
  it("refuses an unauthenticated gRPC call instead of guessing", async () => {
    const adapter = new TatumSuiGrpcAdapter({
      grpcUrl: "https://sui-mainnet-grpc.gateway.tatum.io",
      apiKey: null,
      timeoutMs: 15_000,
    });
    await expect(adapter.verifyTransaction("DIGEST")).rejects.toThrow(/TATUM_API_KEY/);
  }, 30_000);

  it("maps a rejected API key to UNKNOWN, never to a failed transaction", async () => {
    const adapter = new TatumSuiGrpcAdapter({
      grpcUrl: "https://sui-mainnet-grpc.gateway.tatum.io",
      apiKey: "definitely-not-a-valid-key",
      timeoutMs: 15_000,
    });
    const result = await adapter.verifyTransaction(
      "91LGR7dJZnfx8PHnAK7qrSQDH8fpcmamGJfomfC8vVuM",
    );
    expect(result.assessment.status).toBe("UNKNOWN");
    expect(result.assessment.status).not.toBe("VERIFIED_FAILURE");
    expect(result.transportOk).toBe(false);
  }, 30_000);
});

// Positive live tests: these require a real TATUM_API_KEY and are skipped when
// it is absent, so a keyless CI run still passes.
const hasTatumKey = Boolean(loadConfig().tatum.apiKey);

maybe("live smoke: Tatum Sui gRPC gateway (authenticated reads)", () => {
  it.runIf(hasTatumKey)(
    "authenticates and returns real Mainnet ledger data",
    async () => {
      const config = loadConfig();
      const adapter = new TatumSuiGrpcAdapter(config.tatum);
      const health = await adapter.health();
      expect(health.ok).toBe(true);
      // The gateway must be on Sui Mainnet, not merely reachable.
      expect(health.chainIdentifier).toBe(SUI_MAINNET_CHAIN_IDENTIFIER);

      const digests = await adapter.discoverRecentDigests(5);
      expect(digests.length).toBeGreaterThan(0);

      const result = await adapter.verifyTransaction(digests[0]);
      expect(result.transportOk).toBe(true);
      expect(["VERIFIED_SUCCESS", "VERIFIED_FAILURE"]).toContain(
        result.assessment.status,
      );
      expect(result.assessment.verified).toBe(true);
      adapter.close();
    },
    60_000,
  );
});

maybe("live smoke: Tatum Sui GraphQL gateway (authenticated reads)", () => {
  it.runIf(hasTatumKey)(
    "authenticates and returns real Mainnet ledger data",
    async () => {
      const config = loadConfig();
      const adapter = new TatumSuiGraphqlAdapter(config.tatum);
      const health = await adapter.health();
      expect(health.ok).toBe(true);
      expect(health.chainIdentifier).toBe(SUI_MAINNET_CHAIN_IDENTIFIER);

      const digests = await adapter.discoverRecentDigests(5);
      expect(digests.length).toBeGreaterThan(0);

      const result = await adapter.verifyTransaction(digests[0]);
      expect(result.transportOk).toBe(true);
      expect(["VERIFIED_SUCCESS", "VERIFIED_FAILURE"]).toContain(
        result.assessment.status,
      );
      expect(result.assessment.verified).toBe(true);
    },
    60_000,
  );

  it("maps a rejected API key to UNKNOWN, never to a failed transaction", async () => {
    const adapter = new TatumSuiGraphqlAdapter({
      graphqlUrl: "https://sui-mainnet.gateway.tatum.io/graphql",
      apiKey: "definitely-not-a-valid-key",
      timeoutMs: 15_000,
    });
    const result = await adapter.verifyTransaction(
      "91LGR7dJZnfx8PHnAK7qrSQDH8fpcmamGJfomfC8vVuM",
    );
    expect(result.assessment.status).toBe("UNKNOWN");
    expect(result.assessment.status).not.toBe("VERIFIED_FAILURE");
    expect(result.transportOk).toBe(false);
  }, 30_000);
});

maybe("live smoke: finance evidence cases over the real ledger", () => {
  it.runIf(hasTatumKey)(
    "produces successful and unsuccessful cases from genuine chain data",
    async () => {
      const config = loadConfig();
      const verifier = buildSuiVerifier(config.tatum);
      const { cases, digestsFound } = await runFinanceEvidenceCases(verifier, {
        scanLimit: 10,
      });
      expect(digestsFound).toBeGreaterThan(0);
      for (const c of cases) {
        if (!c.simulated) {
          expect(c.digestOrigin).toBe("chain");
          expect(c.digest).toBeTruthy();
        }
      }
      const unavailable = cases.find(
        (c) => c.scenarioId === "finance-unavailable-evidence",
      );
      expect(unavailable?.simulated).toBe(true);
      expect(unavailable?.status).toBe("UNKNOWN");
      verifier.close?.();
    },
    90_000,
  );
});

/**
 * The safeguard memory write path against the real relayer. This is the one
 * claim a mocked boundary cannot support: that a learned safeguard is durably
 * written to Walrus Memory Mainnet under a real blob id and recalled back as a
 * structured record. It runs only with live credentials, and it fails loudly —
 * a safeguard that is not persisted must not be reported as persisted.
 */
const hasWalrusCreds = (() => {
  const m = loadConfig().memory;
  return Boolean(m.privateKey && m.accountId && !m.forceSimulated);
})();

maybe("live smoke: safeguard memory on Walrus Mainnet", () => {
  it.runIf(hasWalrusCreds)(
    "persists a learned safeguard and recalls it as a structured record",
    async () => {
      const config = loadConfig();
      const adapter = new MemWalMemoryAdapter({
        ...config,
        memory: { ...config.memory, namespace: "aftermath-smoke" },
      });
      const record = SafeguardMemoryRecordSchema.parse({
        type: "safeguard_memory",
        memory_id: "safeguard-smoke-unsupported_completion_claim",
        version: 1,
        origin_incident_id: "smoke-incident",
        domain: "incident",
        action_type: "validate_reported_success",
        failure_category: "unsupported_completion_claim",
        verified_failure:
          "A success claim was made with no authoritative verification record.",
        evidence: ["incident:smoke-incident", "smoke:evidence"],
        corrective_rule:
          "Require authoritative transaction verification before accepting a success claim.",
        applies_when: [
          "domain=incident",
          "actionType=validate_reported_success",
          "failureCategory=unsupported_completion_claim",
        ],
        required_checks: ["Capture the authoritative record of the outcome."],
        action: "BLOCK",
        severity: "high",
        confidence: 0.8,
        limitations: ["Smoke-scoped."],
        authoritative: true,
        support_basis: "Grounded in an observed fact.",
        status: "active",
        created_at: new Date().toISOString(),
        provenance: "simulated",
      });
      try {
        const receipt = await adapter.rememberSafeguard(record);
        // A failed write must never be dressed up as a persisted safeguard.
        expect(receipt.state).toBe("completed");
        expect(receipt.blobId).toBeTruthy();

        const hits = await adapter.recallRelevantLessons(record.corrective_rule, {
          limit: 5,
        });
        const recalled = hits.find(
          (h) => h.safeguardMemory?.memory_id === record.memory_id,
        );
        expect(recalled).toBeDefined();
        expect(recalled!.safeguardMemory!.authoritative).toBe(true);
        expect(recalled!.safeguardMemory!.corrective_rule).toBe(record.corrective_rule);
      } finally {
        adapter.destroy();
      }
    },
    90_000,
  );
});
