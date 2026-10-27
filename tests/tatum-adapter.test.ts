import { describe, expect, it, vi } from "vitest";
import { TatumSuiAdapter } from "@/lib/adapters/tatum-sui";
import { FinanceEvidenceAdapter } from "@/lib/adapters/finance-evidence";
import { IncidentSchema } from "@/lib/schemas";

const CONFIG = {
  rpcUrl: "https://sui-mainnet.gateway.tatum.io",
  apiKey: "test-key",
  timeoutMs: 1000,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function rpcResult(result: unknown): Response {
  return jsonResponse({ jsonrpc: "2.0", id: 1, result });
}

const SUCCESS_TX = {
  digest: "DIGEST_SUCCESS",
  effects: { status: { status: "success" }, executedEpoch: "10" },
  checkpoint: "100",
  timestampMs: "1700000000000",
};

const FAILURE_TX = {
  digest: "DIGEST_FAIL",
  effects: { status: { status: "failure", error: "InsufficientGas" }, executedEpoch: "10" },
  checkpoint: "101",
  timestampMs: "1700000001000",
};

describe("TatumSuiAdapter — success and failure are evidence-backed", () => {
  it("reports VERIFIED_SUCCESS for a transaction whose effects succeeded", async () => {
    const fetchImpl = vi.fn(async () => rpcResult(SUCCESS_TX)) as unknown as typeof fetch;
    const adapter = new TatumSuiAdapter(CONFIG, fetchImpl);
    const { assessment, transportOk } = await adapter.verifyTransaction("DIGEST_SUCCESS");
    expect(transportOk).toBe(true);
    expect(assessment.status).toBe("VERIFIED_SUCCESS");
    expect(assessment.verified).toBe(true);
  });

  it("reports VERIFIED_FAILURE for a transaction whose effects failed", async () => {
    const fetchImpl = vi.fn(async () => rpcResult(FAILURE_TX)) as unknown as typeof fetch;
    const adapter = new TatumSuiAdapter(CONFIG, fetchImpl);
    const { assessment } = await adapter.verifyTransaction("DIGEST_FAIL");
    expect(assessment.status).toBe("VERIFIED_FAILURE");
    expect(assessment.verified).toBe(true);
    expect(assessment.failureReason).toBe("InsufficientGas");
  });

  it("reports UNKNOWN when the transaction is not found", async () => {
    const fetchImpl = vi.fn(async () => rpcResult(null)) as unknown as typeof fetch;
    const adapter = new TatumSuiAdapter(CONFIG, fetchImpl);
    const { assessment, transportOk } = await adapter.verifyTransaction("MISSING");
    expect(transportOk).toBe(true);
    expect(assessment.status).toBe("UNKNOWN");
    expect(assessment.verified).toBe(false);
  });

  it("reports UNKNOWN for an unrecognised effects status", async () => {
    const fetchImpl = vi.fn(async () =>
      rpcResult({ digest: "X", effects: { status: { status: "mystery" } } }),
    ) as unknown as typeof fetch;
    const adapter = new TatumSuiAdapter(CONFIG, fetchImpl);
    const { assessment } = await adapter.verifyTransaction("X");
    expect(assessment.status).toBe("UNKNOWN");
  });
});

describe("TatumSuiAdapter — transport failures never become transaction failures", () => {
  const cases: Array<[string, () => Response | Promise<never>]> = [
    ["network error", () => Promise.reject(new Error("ECONNREFUSED")) as never],
    ["http 500", () => jsonResponse({ message: "boom" }, 500)],
    ["http 429", () => jsonResponse({ message: "rate limited" }, 429)],
    ["http 401", () => jsonResponse({ message: "unauthorized" }, 401)],
    ["http 403", () => jsonResponse({ message: "forbidden" }, 403)],
    ["malformed body", () => new Response("not json", { status: 200 })],
    ["json-rpc error", () => jsonResponse({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "bad params" } })],
  ];

  for (const [name, make] of cases) {
    it(`yields UNKNOWN (never VERIFIED_FAILURE) on ${name}`, async () => {
      const fetchImpl = vi.fn(async () => make()) as unknown as typeof fetch;
      const adapter = new TatumSuiAdapter(CONFIG, fetchImpl);
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
    const adapter = new TatumSuiAdapter({ ...CONFIG, apiKey: null }, fetchImpl);
    const { assessment, transportOk } = await adapter.verifyTransaction("DIGEST");
    expect(transportOk).toBe(false);
    expect(assessment.status).toBe("UNKNOWN");
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
    const adapter = new TatumSuiAdapter({ ...CONFIG, timeoutMs: 20 }, fetchImpl);
    const { assessment, transportOk } = await adapter.verifyTransaction("DIGEST");
    expect(transportOk).toBe(false);
    expect(assessment.status).toBe("UNKNOWN");
  });
});

describe("TatumSuiAdapter — credential hygiene", () => {
  it("sends the key as an x-api-key header", async () => {
    const fetchImpl = vi.fn(async () => rpcResult(SUCCESS_TX));
    const adapter = new TatumSuiAdapter(CONFIG, fetchImpl as unknown as typeof fetch);
    await adapter.verifyTransaction("DIGEST_SUCCESS");
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
    const adapter = new TatumSuiAdapter({ ...CONFIG, apiKey: secret }, fetchImpl);
    const { assessment } = await adapter.verifyTransaction("DIGEST");
    expect(assessment.failureReason ?? "").not.toContain(secret);
    expect(assessment.failureReason ?? "").toContain("redacted");
  });
});

describe("FinanceEvidenceAdapter", () => {
  function incidentWith(refs: Array<{ kind: string; ref: string }>) {
    return IncidentSchema.parse({
      domain: "finance",
      actionType: "report_sui_transaction_success",
      executionId: "e1",
      intendedOutcome: "confirm success",
      claimedOutcome: { claim: "succeeded", assertedStatus: "success" },
      evidenceReferences: refs,
      relevantContext: {},
      provenance: "simulated",
      incidentId: "i1",
      createdAt: new Date().toISOString(),
      currentStatus: "open",
    });
  }

  it("returns UNKNOWN when no digest is supplied", async () => {
    const adapter = new FinanceEvidenceAdapter(new TatumSuiAdapter(CONFIG));
    const a = await adapter.verifyEvidence(incidentWith([]));
    expect(a.status).toBe("UNKNOWN");
  });

  it("returns UNKNOWN when the key is absent", async () => {
    const adapter = new FinanceEvidenceAdapter(new TatumSuiAdapter({ ...CONFIG, apiKey: null }));
    const a = await adapter.verifyEvidence(
      incidentWith([{ kind: "sui_tx_digest", ref: "DIGEST" }]),
    );
    expect(a.status).toBe("UNKNOWN");
    expect(a.failureReason).toContain("not configured");
  });

  it("does not treat a client-supplied success claim as evidence", async () => {
    const fetchImpl = vi.fn(async () => rpcResult(null)) as unknown as typeof fetch;
    const adapter = new FinanceEvidenceAdapter(new TatumSuiAdapter(CONFIG, fetchImpl));
    const a = await adapter.verifyEvidence(
      incidentWith([{ kind: "sui_tx_digest", ref: "MISSING" }]),
    );
    // The incident asserted success; the evidence says UNKNOWN. UNKNOWN wins.
    expect(a.status).toBe("UNKNOWN");
    expect(a.verified).toBe(false);
  });
});
