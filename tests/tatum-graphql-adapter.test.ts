import { describe, expect, it, vi } from "vitest";
import {
  TatumSuiGraphqlAdapter,
  classifyGraphqlError,
} from "@/lib/adapters/tatum-sui-graphql";
import { TatumSuiTransportError } from "@/lib/adapters/tatum-sui";

const CONFIG = {
  graphqlUrl: "https://sui-mainnet.gateway.tatum.io/graphql",
  apiKey: "test-key",
  timeoutMs: 1000,
  // Keep retry logic on but with no real delay, so the 429 test is fast and
  // still exercises the retry path.
  retry: { sleep: async () => {} },
};

function graphqlResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function effects(status: "SUCCESS" | "FAILURE", over: Record<string, unknown> = {}) {
  return graphqlResponse({
    data: {
      transactionEffects: {
        digest: "DIGEST",
        status,
        executionError:
          status === "FAILURE"
            ? { message: "MoveAbort in 2nd command, abort code: 101" }
            : null,
        checkpoint: { sequenceNumber: 100 },
        timestamp: "2026-01-23T22:30:07.386Z",
        ...over,
      },
    },
  });
}

describe("TatumSuiGraphqlAdapter — success and failure are evidence-backed", () => {
  it("reports VERIFIED_SUCCESS for a transaction whose effects succeeded", async () => {
    const fetchImpl = vi.fn(async () => effects("SUCCESS")) as unknown as typeof fetch;
    const adapter = new TatumSuiGraphqlAdapter(CONFIG, fetchImpl);
    const { assessment, transportOk } = await adapter.verifyTransaction("DIGEST");
    expect(transportOk).toBe(true);
    expect(assessment.status).toBe("VERIFIED_SUCCESS");
    expect(assessment.verified).toBe(true);
    expect(assessment.evidenceType).toBe("tatum_sui_graphql");
  });

  it("reports VERIFIED_FAILURE for a transaction whose effects failed", async () => {
    const fetchImpl = vi.fn(async () => effects("FAILURE")) as unknown as typeof fetch;
    const adapter = new TatumSuiGraphqlAdapter(CONFIG, fetchImpl);
    const { assessment, transportOk } = await adapter.verifyTransaction("DIGEST");
    expect(transportOk).toBe(true);
    expect(assessment.status).toBe("VERIFIED_FAILURE");
    expect(assessment.verified).toBe(true);
    expect(assessment.failureReason).toContain("MoveAbort");
  });

  it("reports UNKNOWN when the node holds no such transaction", async () => {
    const fetchImpl = vi.fn(async () =>
      graphqlResponse({ data: { transactionEffects: null } }),
    ) as unknown as typeof fetch;
    const adapter = new TatumSuiGraphqlAdapter(CONFIG, fetchImpl);
    const { assessment, transportOk, failureKind } =
      await adapter.verifyTransaction("MISSING");
    expect(transportOk).toBe(true);
    expect(failureKind).toBe("not_found");
    expect(assessment.status).toBe("UNKNOWN");
    expect(assessment.verified).toBe(false);
  });

  it("reports UNKNOWN for an unrecognised effects status", async () => {
    const fetchImpl = vi.fn(async () =>
      graphqlResponse({
        data: { transactionEffects: { digest: "X", status: "MYSTERY" } },
      }),
    ) as unknown as typeof fetch;
    const adapter = new TatumSuiGraphqlAdapter(CONFIG, fetchImpl);
    const { assessment } = await adapter.verifyTransaction("X");
    expect(assessment.status).toBe("UNKNOWN");
    expect(assessment.verified).toBe(false);
  });

  it("treats a digest the gateway rejects as a caller error, not a tx failure", async () => {
    const fetchImpl = vi.fn(async () =>
      graphqlResponse({
        data: null,
        errors: [{ message: 'Failed to parse "String": Invalid Base58: nope' }],
      }),
    ) as unknown as typeof fetch;
    const adapter = new TatumSuiGraphqlAdapter(CONFIG, fetchImpl);
    const { assessment, transportOk, failureKind } =
      await adapter.verifyTransaction("nope");
    expect(transportOk).toBe(true);
    expect(failureKind).toBe("malformed");
    expect(assessment.status).toBe("UNKNOWN");
    expect(assessment.status).not.toBe("VERIFIED_FAILURE");
  });
});

describe("TatumSuiGraphqlAdapter — transport failures never become transaction failures", () => {
  const cases: Array<[string, () => Response | Promise<never>]> = [
    ["network error", () => Promise.reject(new Error("ECONNREFUSED")) as never],
    ["http 500", () => graphqlResponse({ message: "boom" }, 500)],
    ["http 429", () => graphqlResponse({ message: "rate limited" }, 429)],
    ["http 401", () => graphqlResponse({ message: "unauthorized" }, 401)],
    ["http 403", () => graphqlResponse({ message: "forbidden" }, 403)],
    ["malformed body", () => new Response("not json", { status: 200 })],
    [
      "graphql server error",
      () => graphqlResponse({ data: null, errors: [{ message: "internal" }] }),
    ],
  ];

  for (const [name, make] of cases) {
    it(`yields UNKNOWN (never VERIFIED_FAILURE) on ${name}`, async () => {
      const fetchImpl = vi.fn(async () => make()) as unknown as typeof fetch;
      const adapter = new TatumSuiGraphqlAdapter(CONFIG, fetchImpl);
      const { assessment, transportOk } = await adapter.verifyTransaction("DIGEST");
      expect(transportOk).toBe(false);
      expect(assessment.status).toBe("UNKNOWN");
      expect(assessment.verified).toBe(false);
      expect(assessment.status).not.toBe("VERIFIED_FAILURE");
      expect(assessment.status).not.toBe("VERIFIED_SUCCESS");
    });
  }

  it("refuses to make an unauthenticated request when no key is configured", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const adapter = new TatumSuiGraphqlAdapter({ ...CONFIG, apiKey: null }, fetchImpl);
    await expect(adapter.verifyTransaction("DIGEST")).rejects.toThrow(
      /TATUM_API_KEY/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("aborts on timeout and reports UNKNOWN", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    ) as unknown as typeof fetch;
    const adapter = new TatumSuiGraphqlAdapter(
      { ...CONFIG, timeoutMs: 20 },
      fetchImpl,
    );
    const { assessment, transportOk } = await adapter.verifyTransaction("DIGEST");
    expect(transportOk).toBe(false);
    expect(assessment.status).toBe("UNKNOWN");
  });
});

describe("TatumSuiGraphqlAdapter — health and discovery", () => {
  it("reports health with the chain identifier", async () => {
    const fetchImpl = vi.fn(async () =>
      graphqlResponse({ data: { chainIdentifier: "4btiui" } }),
    ) as unknown as typeof fetch;
    const adapter = new TatumSuiGraphqlAdapter(CONFIG, fetchImpl);
    const health = await adapter.health();
    expect(health.ok).toBe(true);
    expect(health.chainIdentifier).toBe("4btiui");
  });

  it("reports health as failed without a key, without making a request", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const adapter = new TatumSuiGraphqlAdapter({ ...CONFIG, apiKey: null }, fetchImpl);
    const health = await adapter.health();
    expect(health.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("discovers recent digests from the transactions connection", async () => {
    const fetchImpl = vi.fn(async () =>
      graphqlResponse({
        data: {
          transactions: {
            nodes: [{ digest: "A" }, { digest: "B" }, { digest: undefined }],
          },
        },
      }),
    ) as unknown as typeof fetch;
    const adapter = new TatumSuiGraphqlAdapter(CONFIG, fetchImpl);
    expect(await adapter.discoverRecentDigests(5)).toEqual(["A", "B"]);
  });

  it("returns no digests (never invented ones) when discovery fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const adapter = new TatumSuiGraphqlAdapter(CONFIG, fetchImpl);
    expect(await adapter.discoverRecentDigests(5)).toEqual([]);
  });

  it("returns no digests when no key is configured", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const adapter = new TatumSuiGraphqlAdapter({ ...CONFIG, apiKey: null }, fetchImpl);
    expect(await adapter.discoverRecentDigests(5)).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("TatumSuiGraphqlAdapter — credential hygiene", () => {
  it("sends the key as an x-api-key header", async () => {
    const fetchImpl = vi.fn(async () => effects("SUCCESS"));
    const adapter = new TatumSuiGraphqlAdapter(
      CONFIG,
      fetchImpl as unknown as typeof fetch,
    );
    await adapter.verifyTransaction("DIGEST");
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((call[1].headers as Record<string, string>)["x-api-key"]).toBe(
      "test-key",
    );
  });

  it("redacts the key from an error message surfaced to the caller", async () => {
    const secret = "t-1234567890abcdef1234567890abcdef";
    const fetchImpl = vi.fn(async () => {
      throw new Error(`failed calling with key ${secret}`);
    }) as unknown as typeof fetch;
    const adapter = new TatumSuiGraphqlAdapter(
      { ...CONFIG, apiKey: secret },
      fetchImpl,
    );
    const { assessment } = await adapter.verifyTransaction("DIGEST");
    expect(assessment.failureReason ?? "").not.toContain(secret);
    expect(assessment.failureReason ?? "").toContain("redacted");
  });
});

describe("classifyGraphqlError", () => {
  it("passes through a TatumSuiTransportError's kind and status", () => {
    const info = classifyGraphqlError(
      new TatumSuiTransportError("nope", "auth", 401),
    );
    expect(info.kind).toBe("auth");
    expect(info.httpStatus).toBe(401);
  });

  it("classifies an AbortError as a timeout", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(classifyGraphqlError(err).kind).toBe("timeout");
  });

  it("classifies any other error as a network failure", () => {
    expect(classifyGraphqlError(new Error("boom")).kind).toBe("network");
  });
});
