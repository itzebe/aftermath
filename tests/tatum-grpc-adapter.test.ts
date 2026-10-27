import { describe, expect, it } from "vitest";
import {
  TatumSuiGrpcAdapter,
  classifyError,
  type GrpcTransactionOutcome,
  type SuiGrpcClientLike,
} from "@/lib/adapters/tatum-sui-grpc";
import {
  CompositeSuiVerifier,
  type SuiVerifier,
} from "@/lib/adapters/sui-verifier";
import type { SuiTransactionLookupResult } from "@/lib/adapters/tatum-sui";

const CONFIG = {
  grpcUrl: "https://sui-mainnet-grpc.gateway.tatum.io",
  apiKey: "test-key",
  timeoutMs: 1000,
};

/** Build a stub client. Only the three methods the adapter calls are provided. */
function stubClient(overrides: Partial<SuiGrpcClientLike>): SuiGrpcClientLike {
  return {
    getTransaction: async () => {
      throw new Error("not stubbed");
    },
    listTransactions: async () => ({ transactions: [], hasNextPage: false }),
    ledgerService: {
      getServiceInfo: async () => ({ response: { chainId: "4btiui", chain: "mainnet" } }),
    },
    ...overrides,
  } as SuiGrpcClientLike;
}

function grpcAdapter(client: SuiGrpcClientLike, apiKey: string | null = "test-key") {
  return new TatumSuiGrpcAdapter(
    { ...CONFIG, apiKey },
    () => client,
  );
}

function txOutcome(over: Partial<{
  kind: "Transaction" | "FailedTransaction";
  digest: string;
  success: boolean;
  error: unknown;
  checkpoint: string | null;
  timestampMs: number | null;
}>): GrpcTransactionOutcome {
  const kind = over.kind ?? "Transaction";
  const tx = {
    digest: over.digest ?? "DIGEST",
    status: { success: over.success ?? true, error: over.error ?? null },
    checkpoint: over.checkpoint ?? "100",
    timestampMs: over.timestampMs ?? 1700000000000,
  };
  return kind === "Transaction"
    ? { $kind: "Transaction", Transaction: tx }
    : { $kind: "FailedTransaction", FailedTransaction: tx };
}

describe("TatumSuiGrpcAdapter classification", () => {
  it("maps an executed transaction to VERIFIED_SUCCESS", async () => {
    const adapter = grpcAdapter(
      stubClient({ getTransaction: async () => txOutcome({ kind: "Transaction", success: true }) }),
    );
    const { assessment, transportOk } = await adapter.verifyTransaction("DIGEST");
    expect(transportOk).toBe(true);
    expect(assessment.status).toBe("VERIFIED_SUCCESS");
    expect(assessment.verified).toBe(true);
    expect(assessment.evidenceType).toBe("tatum_sui_grpc");
  });

  it("maps a FailedTransaction to VERIFIED_FAILURE and keeps the error", async () => {
    const adapter = grpcAdapter(
      stubClient({
        getTransaction: async () =>
          txOutcome({
            kind: "FailedTransaction",
            success: false,
            error: { message: "MoveAbort in 2nd command, abort code: 101" },
          }),
      }),
    );
    const { assessment, transportOk } = await adapter.verifyTransaction("DIGEST");
    expect(transportOk).toBe(true);
    expect(assessment.status).toBe("VERIFIED_FAILURE");
    expect(assessment.verified).toBe(true);
    expect(assessment.failureReason).toContain("MoveAbort");
  });

  it("never converts a transport failure into a transaction failure", async () => {
    const adapter = grpcAdapter(
      stubClient({
        getTransaction: async () => {
          const e = new Error("connection reset") as Error & { code?: string };
          e.code = "UNAVAILABLE";
          throw e;
        },
      }),
    );
    const { assessment, transportOk, failureKind } = await adapter.verifyTransaction("DIGEST");
    expect(transportOk).toBe(false);
    expect(failureKind).toBe("network");
    expect(assessment.status).toBe("UNKNOWN");
    expect(assessment.verified).toBe(false);
  });

  it("reports a digest the node does not hold as UNKNOWN, not failure", async () => {
    const adapter = grpcAdapter(
      stubClient({
        getTransaction: async () => {
          const e = new Error("Transaction X not found") as Error & { code?: string };
          e.code = "NOT_FOUND";
          throw e;
        },
      }),
    );
    const { assessment, transportOk, failureKind } = await adapter.verifyTransaction("DIGEST");
    expect(transportOk).toBe(true);
    expect(failureKind).toBe("not_found");
    expect(assessment.status).toBe("UNKNOWN");
    expect(assessment.status).not.toBe("VERIFIED_FAILURE");
  });

  it("recognises the client's wrapped not-found error shape", async () => {
    // The official client throws a plain Error with reason="notFound" and a
    // nested cause carrying the gRPC status, rather than the status directly.
    const adapter = grpcAdapter(
      stubClient({
        getTransaction: async () => {
          const e = new Error("Transaction X not found") as Error & {
            reason?: string;
            cause?: { code?: string };
          };
          e.reason = "notFound";
          e.cause = { code: "NOT_FOUND" };
          throw e;
        },
      }),
    );
    const { assessment, transportOk, failureKind } = await adapter.verifyTransaction("DIGEST");
    expect(transportOk).toBe(true);
    expect(failureKind).toBe("not_found");
    expect(assessment.status).toBe("UNKNOWN");
  });

  it("reports a malformed digest as UNKNOWN and does not claim an outcome", async () => {
    const adapter = grpcAdapter(
      stubClient({
        getTransaction: async () => {
          const e = new Error("invalid digest") as Error & { code?: string };
          e.code = "INVALID_ARGUMENT";
          throw e;
        },
      }),
    );
    const { assessment, transportOk, failureKind } = await adapter.verifyTransaction("nope");
    expect(transportOk).toBe(true);
    expect(failureKind).toBe("malformed");
    expect(assessment.status).toBe("UNKNOWN");
  });

  it("classifies an unauthenticated call as an auth failure", async () => {
    const adapter = grpcAdapter(
      stubClient({
        getTransaction: async () => {
          const e = new Error("no api key") as Error & { code?: string };
          e.code = "UNAUTHENTICATED";
          throw e;
        },
      }),
    );
    const { failureKind, assessment } = await adapter.verifyTransaction("DIGEST");
    expect(failureKind).toBe("auth");
    expect(assessment.status).toBe("UNKNOWN");
  });

  it("returns UNKNOWN when a response carries no transaction", async () => {
    const adapter = grpcAdapter(
      stubClient({ getTransaction: async () => ({ $kind: "Transaction" }) }),
    );
    const { assessment, transportOk } = await adapter.verifyTransaction("DIGEST");
    expect(transportOk).toBe(true);
    expect(assessment.status).toBe("UNKNOWN");
    expect(assessment.verified).toBe(false);
  });

  it("returns UNKNOWN when the execution status is uninterpretable", async () => {
    const adapter = grpcAdapter(
      stubClient({
        getTransaction: async () => {
          const tx = {
            digest: "D",
            status: { success: undefined as unknown as boolean, error: null },
            checkpoint: null,
            timestampMs: null,
          };
          return { $kind: "Transaction", Transaction: tx } as GrpcTransactionOutcome;
        },
      }),
    );
    const { assessment, transportOk } = await adapter.verifyTransaction("D");
    expect(transportOk).toBe(true);
    expect(assessment.status).toBe("UNKNOWN");
  });
});

describe("TatumSuiGrpcAdapter configuration guards", () => {
  it("refuses to make an unauthenticated request", async () => {
    const adapter = grpcAdapter(stubClient({}), null);
    await expect(adapter.verifyTransaction("D")).rejects.toThrow(/TATUM_API_KEY/);
  });

  it("reports an unconfigured health check without a request", async () => {
    const adapter = grpcAdapter(stubClient({}), null);
    const health = await adapter.health();
    expect(health.ok).toBe(false);
    expect(health.detail).toMatch(/TATUM_API_KEY/);
  });

  it("returns the chain identifier from a live service-info read", async () => {
    const adapter = grpcAdapter(stubClient({}));
    const health = await adapter.health();
    expect(health.ok).toBe(true);
    expect(health.chainIdentifier).toBe("4btiui");
  });

  it("does not leak the api key in a health failure detail", async () => {
    const adapter = grpcAdapter(
      stubClient({
        ledgerService: {
          getServiceInfo: async () => {
            throw new Error("rejected key t-0123456789abcdef0123456789abcdef");
          },
        },
      }),
    );
    const health = await adapter.health();
    expect(health.ok).toBe(false);
    expect(health.detail).not.toContain("t-0123456789abcdef0123456789abcdef");
  });
});

describe("TatumSuiGrpcAdapter discovery", () => {
  it("returns digests from the live ledger", async () => {
    const adapter = grpcAdapter(
      stubClient({
        listTransactions: async () => ({
          transactions: [
            { $kind: "Transaction", Transaction: { digest: "AAA" } },
            { $kind: "FailedTransaction", FailedTransaction: { digest: "BBB" } },
          ] as GrpcTransactionOutcome[],
          hasNextPage: true,
        }),
      }),
    );
    expect(await adapter.discoverRecentDigests()).toEqual(["AAA", "BBB"]);
  });

  it("returns an empty list when discovery fails, rather than inventing digests", async () => {
    const adapter = grpcAdapter(
      stubClient({
        listTransactions: async () => {
          throw new Error("gateway down");
        },
      }),
    );
    expect(await adapter.discoverRecentDigests()).toEqual([]);
  });

  it("returns an empty list when unconfigured", async () => {
    const adapter = grpcAdapter(stubClient({}), null);
    expect(await adapter.discoverRecentDigests()).toEqual([]);
  });
});

describe("classifyError", () => {
  it("maps gRPC status names onto failure kinds", () => {
    expect(classifyError({ code: "DEADLINE_EXCEEDED" }).kind).toBe("timeout");
    expect(classifyError({ code: "PERMISSION_DENIED" }).kind).toBe("auth");
    expect(classifyError({ code: "RESOURCE_EXHAUSTED" }).kind).toBe("http");
    expect(classifyError({ code: "NOT_FOUND" }).kind).toBe("not_found");
  });

  it("treats an AbortError as a timeout", () => {
    expect(classifyError({ name: "AbortError" }).kind).toBe("timeout");
  });

  it("defaults an unknown error to a network failure", () => {
    expect(classifyError(new Error("boom")).kind).toBe("network");
  });
});

// --- Composite verifier ---------------------------------------------------

function fakeVerifier(
  name: string,
  opts: {
    configured?: boolean;
    result?: SuiTransactionLookupResult;
    digests?: string[];
  } = {},
): SuiVerifier {
  const configured = opts.configured ?? true;
  return {
    sourceName: name,
    configured,
    health: async () => ({ ok: configured, detail: `${name} health` }),
    verifyTransaction: async () =>
      opts.result ?? {
        transportOk: true,
        assessment: {
          status: "VERIFIED_SUCCESS",
          verified: true,
          evidenceType: name,
          evidenceReference: "ref",
          observedAt: new Date().toISOString(),
          explanation: "ok",
        },
      },
    discoverRecentDigests: async () => opts.digests ?? [],
  };
}

describe("CompositeSuiVerifier", () => {
  it("returns the primary result when it answers", async () => {
    const primary = fakeVerifier("grpc");
    const fallback = fakeVerifier("jsonrpc");
    const composite = new CompositeSuiVerifier(primary, fallback);
    const { assessment } = await composite.verifyTransaction("D");
    expect(assessment.evidenceType).toBe("grpc");
  });

  it("falls back only when the primary could not complete the lookup", async () => {
    const primary = fakeVerifier("grpc", {
      result: {
        transportOk: false,
        failureKind: "network",
        assessment: {
          status: "UNKNOWN",
          verified: false,
          evidenceType: "grpc",
          evidenceReference: "ref",
          observedAt: new Date().toISOString(),
          explanation: "lookup could not be completed",
        },
      },
    });
    const fallback = fakeVerifier("jsonrpc");
    const composite = new CompositeSuiVerifier(primary, fallback);
    const { assessment } = await composite.verifyTransaction("D");
    expect(assessment.evidenceType).toBe("jsonrpc");
  });

  it("does NOT fall back when the primary returned a definitive answer", async () => {
    const primary = fakeVerifier("grpc", {
      result: {
        transportOk: true,
        assessment: {
          status: "VERIFIED_FAILURE",
          verified: true,
          evidenceType: "grpc",
          evidenceReference: "ref",
          observedAt: new Date().toISOString(),
          explanation: "failed",
        },
      },
    });
    const fallback = fakeVerifier("jsonrpc");
    const composite = new CompositeSuiVerifier(primary, fallback);
    const { assessment, transportOk } = await composite.verifyTransaction("D");
    expect(transportOk).toBe(true);
    expect(assessment.evidenceType).toBe("grpc");
    expect(assessment.status).toBe("VERIFIED_FAILURE");
  });

  it("does NOT fall back when the primary authoritatively reports not-found", async () => {
    const primary = fakeVerifier("grpc", {
      result: {
        transportOk: true,
        failureKind: "not_found",
        assessment: {
          status: "UNKNOWN",
          verified: false,
          evidenceType: "grpc",
          evidenceReference: "ref",
          observedAt: new Date().toISOString(),
          explanation: "no such transaction",
        },
      },
    });
    const fallback = fakeVerifier("jsonrpc", {
      result: {
        transportOk: true,
        assessment: {
          status: "VERIFIED_SUCCESS",
          verified: true,
          evidenceType: "jsonrpc",
          evidenceReference: "ref",
          observedAt: new Date().toISOString(),
          explanation: "ok",
        },
      },
    });
    const composite = new CompositeSuiVerifier(primary, fallback);
    const { assessment } = await composite.verifyTransaction("D");
    // The primary's authoritative "no such transaction" stands.
    expect(assessment.evidenceType).toBe("grpc");
    expect(assessment.status).toBe("UNKNOWN");
  });

  it("reports UNKNOWN without a request when neither interface is configured", async () => {
    const composite = new CompositeSuiVerifier(
      fakeVerifier("grpc", { configured: false }),
      fakeVerifier("jsonrpc", { configured: false }),
    );
    expect(composite.configured).toBe(false);
    const { assessment, transportOk } = await composite.verifyTransaction("D");
    expect(transportOk).toBe(false);
    expect(assessment.status).toBe("UNKNOWN");
    expect(assessment.evidenceType).toBe("tatum_sui_unconfigured");
  });

  it("uses the fallback directly when only the fallback is configured", async () => {
    const composite = new CompositeSuiVerifier(
      fakeVerifier("grpc", { configured: false }),
      fakeVerifier("jsonrpc"),
    );
    const { assessment } = await composite.verifyTransaction("D");
    expect(assessment.evidenceType).toBe("jsonrpc");
  });

  it("names both interfaces in sourceName when both are configured", () => {
    const composite = new CompositeSuiVerifier(fakeVerifier("grpc"), fakeVerifier("jsonrpc"));
    expect(composite.sourceName).toContain("grpc");
    expect(composite.sourceName).toContain("jsonrpc");
  });

  it("prefers the primary for discovery, falling back only on an empty result", async () => {
    const composite = new CompositeSuiVerifier(
      fakeVerifier("grpc", { digests: [] }),
      fakeVerifier("jsonrpc", { digests: ["J1"] }),
    );
    expect(await composite.discoverRecentDigests()).toEqual(["J1"]);
  });
});
