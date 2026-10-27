import { EvidenceAssessmentSchema, type EvidenceAssessment } from "@/lib/schemas";
import { redact } from "@/lib/util/redact";

export interface TatumSuiConfig {
  rpcUrl: string;
  apiKey: string | null;
  timeoutMs: number;
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

/** Sui object returned by sui_getTransactionBlock (subset we rely on). */
interface SuiTransactionBlock {
  digest?: string;
  effects?: {
    status?: { status?: string; error?: string };
    executedEpoch?: string;
  };
  checkpoint?: string | null;
  timestampMs?: string | null;
  transaction?: unknown;
}

export class TatumSuiTransportError extends Error {
  constructor(
    message: string,
    readonly kind: "timeout" | "network" | "http" | "auth" | "malformed",
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "TatumSuiTransportError";
  }
}

export interface SuiTransactionLookupResult {
  assessment: EvidenceAssessment;
  /** True when the RPC round-trip itself succeeded and returned a transaction. */
  transportOk: boolean;
}

/**
 * Read-only Sui transaction verification through Tatum's documented Sui Mainnet
 * JSON-RPC gateway.
 *
 * Contract of this adapter:
 *   - A transport failure (timeout, network error, auth failure, bad JSON) is
 *     reported as UNKNOWN. It NEVER becomes VERIFIED_FAILURE.
 *   - A returned transaction whose effects report `success` is VERIFIED_SUCCESS.
 *   - A returned transaction whose effects report `failure` is VERIFIED_FAILURE.
 *   - A null/missing result is UNKNOWN (not indexed yet, or does not exist —
 *     both are "we could not establish success").
 *   - No transaction is ever broadcast from here.
 */
export class TatumSuiAdapter {
  constructor(
    private readonly config: TatumSuiConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get configured(): boolean {
    return Boolean(this.config.apiKey);
  }

  /** Health check: a cheap read that proves the gateway and key work. */
  async health(): Promise<{
    ok: boolean;
    detail: string;
    chainIdentifier?: string;
  }> {
    try {
      const result = await this.rpc<string>("sui_getChainIdentifier", []);
      return {
        ok: true,
        detail: "Tatum Sui Mainnet JSON-RPC reachable and authenticated.",
        chainIdentifier: result,
      };
    } catch (err) {
      const e = err as Error;
      return { ok: false, detail: redact(e.message) };
    }
  }

  async verifyTransaction(digest: string): Promise<SuiTransactionLookupResult> {
    const observedAt = new Date().toISOString();
    const reference = `sui:tx:${digest}`;

    let tx: SuiTransactionBlock | null;
    try {
      tx = await this.rpc<SuiTransactionBlock | null>("sui_getTransactionBlock", [
        digest,
        {
          showEffects: true,
          showInput: true,
          showEvents: true,
          showBalanceChanges: true,
        },
      ]);
    } catch (err) {
      const e = err as TatumSuiTransportError;
      return {
        transportOk: false,
        assessment: EvidenceAssessmentSchema.parse({
          status: "UNKNOWN",
          verified: false,
          evidenceType: "tatum_sui_json_rpc",
          evidenceReference: reference,
          observedAt,
          explanation:
            "The authoritative transaction lookup could not be completed. " +
            "This establishes neither success nor failure. Reporting success " +
            "is therefore not permitted.",
          failureReason: `lookup ${e.kind ?? "error"}: ${redact(e.message)}`,
          raw: {
            transportKind: e.kind ?? "unknown",
            httpStatus: e.httpStatus ?? null,
            endpoint: this.config.rpcUrl,
          },
        }),
      };
    }

    if (tx === null || tx === undefined) {
      return {
        transportOk: true,
        assessment: EvidenceAssessmentSchema.parse({
          status: "UNKNOWN",
          verified: false,
          evidenceType: "tatum_sui_json_rpc",
          evidenceReference: reference,
          observedAt,
          explanation:
            "The node returned no transaction for this digest. The digest may " +
            "not exist, or may not yet be indexed. Success is not established.",
          failureReason: "transaction not found or not yet indexed",
          raw: { endpoint: this.config.rpcUrl, resultNull: true },
        }),
      };
    }

    const effectsStatus = tx.effects?.status?.status;
    const executedEpoch = tx.effects?.executedEpoch;
    const checkpoint = tx.checkpoint ?? null;

    if (effectsStatus === "success") {
      return {
        transportOk: true,
        assessment: EvidenceAssessmentSchema.parse({
          status: "VERIFIED_SUCCESS",
          verified: true,
          evidenceType: "tatum_sui_json_rpc",
          evidenceReference: reference,
          observedAt,
          explanation:
            "Authoritative execution effects report success. A success claim " +
            "is permitted.",
          raw: {
            endpoint: this.config.rpcUrl,
            digest: tx.digest ?? digest,
            effectsStatus,
            executedEpoch,
            checkpoint,
            timestampMs: tx.timestampMs ?? null,
          },
        }),
      };
    }

    if (effectsStatus === "failure") {
      return {
        transportOk: true,
        assessment: EvidenceAssessmentSchema.parse({
          status: "VERIFIED_FAILURE",
          verified: true,
          evidenceType: "tatum_sui_json_rpc",
          evidenceReference: reference,
          observedAt,
          explanation:
            "Authoritative execution effects report failure. The transaction " +
            "did not succeed.",
          failureReason: tx.effects?.status?.error ?? "execution failure",
          raw: {
            endpoint: this.config.rpcUrl,
            digest: tx.digest ?? digest,
            effectsStatus,
            executedEpoch,
            checkpoint,
            error: tx.effects?.status?.error ?? null,
          },
        }),
      };
    }

    return {
      transportOk: true,
      assessment: EvidenceAssessmentSchema.parse({
        status: "UNKNOWN",
        verified: false,
        evidenceType: "tatum_sui_json_rpc",
        evidenceReference: reference,
        observedAt,
        explanation:
          "A transaction was returned but its execution status could not be " +
          "interpreted. Success is not established.",
        failureReason: `unrecognised effects.status: ${String(effectsStatus)}`,
        raw: {
          endpoint: this.config.rpcUrl,
          digest: tx.digest ?? digest,
          effectsStatus: effectsStatus ?? null,
          checkpoint,
        },
      }),
    };
  }

  /** Low-level JSON-RPC call with timeout, auth header, and redacted errors. */
  async rpc<T>(method: string, params: unknown[]): Promise<T> {
    if (!this.config.apiKey) {
      throw new TatumSuiTransportError(
        "TATUM_API_KEY is not configured; refusing to make an unauthenticated request.",
        "auth",
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(this.config.rpcUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.config.apiKey,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: controller.signal,
      });
    } catch (err) {
      const e = err as Error & { name?: string };
      const kind = e.name === "AbortError" ? "timeout" : "network";
      throw new TatumSuiTransportError(
        `request to ${this.config.rpcUrl} failed (${kind}): ${redact(e.message)}`,
        kind,
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 || response.status === 403) {
      throw new TatumSuiTransportError(
        `gateway rejected the API key (HTTP ${response.status}). This is a ` +
          "credential problem, not a transaction outcome.",
        "auth",
        response.status,
      );
    }
    if (response.status === 429) {
      throw new TatumSuiTransportError(
        "gateway rate limited the request (HTTP 429).",
        "http",
        response.status,
      );
    }
    if (!response.ok) {
      throw new TatumSuiTransportError(
        `gateway returned HTTP ${response.status}.`,
        "http",
        response.status,
      );
    }

    let body: JsonRpcResponse;
    try {
      body = (await response.json()) as JsonRpcResponse;
    } catch {
      throw new TatumSuiTransportError(
        "gateway returned a response that was not valid JSON.",
        "malformed",
        response.status,
      );
    }

    if (body.error) {
      // A JSON-RPC error is a lookup failure, not a transaction outcome.
      throw new TatumSuiTransportError(
        `JSON-RPC error ${body.error.code ?? ""}: ${redact(body.error.message ?? "unknown")}`,
        "malformed",
      );
    }

    return body.result as T;
  }
}
