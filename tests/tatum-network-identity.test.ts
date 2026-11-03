import { describe, expect, it, vi } from "vitest";
import {
  SUI_MAINNET_CHAIN_IDENTIFIER,
  isSuiMainnet,
} from "@/lib/adapters/sui-network";
import {
  TatumSuiGrpcAdapter,
  type SuiGrpcClientLike,
} from "@/lib/adapters/tatum-sui-grpc";
import { TatumSuiGraphqlAdapter } from "@/lib/adapters/tatum-sui-graphql";

/**
 * A gateway can be reachable and authenticated and still be on the wrong
 * network. The chain identifier is the only proof of *which* chain answered, so
 * health must fail closed when it is not Sui Mainnet. Otherwise a misconfigured
 * URL (a testnet host, a bad environment variable) would report healthy while
 * verifying against a chain the deployment never claimed.
 */
describe("isSuiMainnet", () => {
  it("accepts only Sui Mainnet's chain identifier", () => {
    expect(isSuiMainnet(SUI_MAINNET_CHAIN_IDENTIFIER)).toBe(true);
  });

  it("rejects a testnet identifier, an empty value, and undefined", () => {
    expect(isSuiMainnet("4c78adac")).toBe(false);
    expect(isSuiMainnet("")).toBe(false);
    expect(isSuiMainnet(undefined)).toBe(false);
    expect(isSuiMainnet(null)).toBe(false);
  });
});

function grpcClientWithChain(chainId: string): SuiGrpcClientLike {
  return {
    getTransaction: async () => {
      throw new Error("not stubbed");
    },
    listTransactions: async () => ({ transactions: [], hasNextPage: false }),
    ledgerService: {
      getServiceInfo: async () => ({ response: { chainId, chain: "mainnet" } }),
    },
  } as SuiGrpcClientLike;
}

describe("TatumSuiGrpcAdapter — network identity", () => {
  it("reports healthy on the Mainnet identifier", async () => {
    const adapter = new TatumSuiGrpcAdapter(
      { grpcUrl: "https://sui-mainnet-grpc.gateway.tatum.io", apiKey: "k", timeoutMs: 1000 },
      () => grpcClientWithChain(SUI_MAINNET_CHAIN_IDENTIFIER),
    );
    const health = await adapter.health();
    expect(health.ok).toBe(true);
    expect(health.chainIdentifier).toBe(SUI_MAINNET_CHAIN_IDENTIFIER);
  });

  it("fails closed when the gateway is not on Sui Mainnet", async () => {
    const adapter = new TatumSuiGrpcAdapter(
      { grpcUrl: "https://sui-mainnet-grpc.gateway.tatum.io", apiKey: "k", timeoutMs: 1000 },
      () => grpcClientWithChain("4c78adac"),
    );
    const health = await adapter.health();
    expect(health.ok).toBe(false);
    expect(health.detail).toMatch(/not on Sui Mainnet/);
  });
});

describe("TatumSuiGraphqlAdapter — network identity", () => {
  const gql = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  it("reports healthy on the Mainnet identifier", async () => {
    const fetchImpl = vi.fn(async () =>
      gql({ data: { chainIdentifier: SUI_MAINNET_CHAIN_IDENTIFIER } }),
    ) as unknown as typeof fetch;
    const adapter = new TatumSuiGraphqlAdapter(
      { graphqlUrl: "https://sui-mainnet.gateway.tatum.io/graphql", apiKey: "k", timeoutMs: 1000 },
      fetchImpl,
    );
    const health = await adapter.health();
    expect(health.ok).toBe(true);
    expect(health.chainIdentifier).toBe(SUI_MAINNET_CHAIN_IDENTIFIER);
  });

  it("fails closed when the gateway is not on Sui Mainnet", async () => {
    const fetchImpl = vi.fn(async () =>
      gql({ data: { chainIdentifier: "4c78adac" } }),
    ) as unknown as typeof fetch;
    const adapter = new TatumSuiGraphqlAdapter(
      { graphqlUrl: "https://sui-mainnet.gateway.tatum.io/graphql", apiKey: "k", timeoutMs: 1000 },
      fetchImpl,
    );
    const health = await adapter.health();
    expect(health.ok).toBe(false);
    expect(health.detail).toMatch(/not on Sui Mainnet/);
  });
});
