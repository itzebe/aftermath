import { SuiGrpcClient } from "@mysten/sui/grpc";
import { GrpcTransport } from "@protobuf-ts/grpc-transport";
import { ChannelCredentials } from "@grpc/grpc-js";
import { EvidenceAssessmentSchema } from "@/lib/schemas";
import { redact } from "@/lib/util/redact";
import { withRateLimitRetry, type RetryOptions } from "@/lib/adapters/tatum-retry";
import {
  TatumSuiTransportError,
  type FailureKind,
  type SuiTransactionLookupResult,
} from "@/lib/adapters/tatum-sui";

export interface TatumSuiGrpcConfig {
  grpcUrl: string;
  apiKey: string | null;
  timeoutMs: number;
  /** Overridable so tests exercise retry logic without real backoff delays. */
  retry?: RetryOptions;
}

/**
 * The subset of the official @mysten/sui gRPC client this adapter uses.
 *
 * Declared narrowly for the same reason the memory adapter declares its client:
 * the real client needs credentials and a live gateway, so tests stand in at the
 * network boundary. Everything above that boundary — the classification of a
 * result into success/failure/unknown, the transport-vs-outcome distinction — is
 * the real adapter code under test.
 */
export interface SuiGrpcClientLike {
  getTransaction(input: {
    digest: string;
    include: { effects: boolean };
  }): Promise<GrpcTransactionOutcome>;
  listTransactions(input: {
    limit: number;
    order: "ascending" | "descending";
    include: { effects: boolean };
  }): Promise<GrpcTransactionPage>;
  ledgerService: {
    getServiceInfo(input: Record<string, never>): Promise<{
      response: { chainId?: string; chain?: string };
    }>;
  };
  /** Present on the real client; releases the underlying gRPC channel. */
  close?(): void;
}

export interface GrpcTransactionOutcome {
  $kind: "Transaction" | "FailedTransaction";
  Transaction?: GrpcTransaction;
  FailedTransaction?: GrpcTransaction;
}

export interface GrpcTransaction {
  digest: string;
  status: { success: boolean; error: unknown };
  checkpoint: string | null;
  timestampMs: number | null;
}

export interface GrpcTransactionPage {
  transactions: GrpcTransactionOutcome[];
  hasNextPage: boolean;
  endCursor?: string | null;
}

/** Minimal shape of the official client's options, for the default factory. */
export interface SuiGrpcTransportOptions {
  grpcUrl: string;
  apiKey: string;
  timeoutMs: number;
}

/**
 * Read-only Sui transaction verification through Tatum's Sui Mainnet gRPC
 * gateway (`sui-mainnet-grpc.gateway.tatum.io`).
 *
 * Why gRPC and not JSON-RPC: Sui Foundation has disabled JSON-RPC on Mainnet
 * full nodes and documents gRPC as the replacement interface. Tatum's own Sui
 * documentation carries a JSON-RPC-to-gRPC migration guide with the same
 * message. gRPC is therefore the supported interface for full-node reads, and
 * this adapter is the primary verifier.
 *
 * The transport is the official `@mysten/sui/grpc` client over the
 * `@protobuf-ts/grpc-transport` native gRPC channel, which already speaks the
 * `sui.rpc.v2` protos. No proto files are vendored or generated here. Native
 * gRPC is required rather than gRPC-Web because Tatum's gateway answers with
 * `content-type: application/grpc`, which the gRPC-Web transport rejects.
 *
 * Contract of this adapter mirrors the JSON-RPC adapter exactly:
 *   - A transport failure is UNKNOWN, never VERIFIED_FAILURE.
 *   - `$kind: "Transaction"` with `status.success === true` is VERIFIED_SUCCESS.
 *   - `$kind: "FailedTransaction"` with `status.success === false` is
 *     VERIFIED_FAILURE.
 *   - A digest the node does not have is UNKNOWN (absence of evidence).
 *   - No transaction is ever broadcast from here.
 */
export class TatumSuiGrpcAdapter {
  readonly sourceName = "Tatum Sui Mainnet gRPC";
  private cachedClient: SuiGrpcClientLike | undefined;

  constructor(
    private readonly config: TatumSuiGrpcConfig,
    /**
     * Injectable for tests; defaults to the official gRPC-web client. Tests
     * stand in at this network boundary — everything above it (classifying a
     * result into success/failure/unknown, the transport-vs-outcome
     * distinction) is the real adapter code under test.
     */
    private readonly clientFactory: (
      opts: SuiGrpcTransportOptions,
    ) => SuiGrpcClientLike = defaultClient,
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
    if (!this.config.apiKey) {
      return {
        ok: false,
        detail:
          "TATUM_API_KEY is not configured; refusing to make an unauthenticated gRPC request.",
      };
    }
    try {
      const client = this.client();
      const info = await withRateLimitRetry(
        () => client.ledgerService.getServiceInfo({}),
        this.config.retry,
      );
      return {
        ok: true,
        detail: `Tatum Sui Mainnet gRPC reachable and authenticated (chain ${info.response.chain ?? "?"}).`,
        chainIdentifier: info.response.chainId,
      };
    } catch (err) {
      return { ok: false, detail: redact(classifyError(err).message) };
    }
  }

  async verifyTransaction(digest: string): Promise<SuiTransactionLookupResult> {
    const observedAt = new Date().toISOString();
    const reference = `sui:tx:${digest}`;

    if (!this.config.apiKey) {
      throw new TatumSuiTransportError(
        "TATUM_API_KEY is not configured; refusing to make an unauthenticated request.",
        "auth",
      );
    }

    let outcome: GrpcTransactionOutcome;
    try {
      outcome = await withRateLimitRetry(
        () =>
          this.client().getTransaction({
            digest,
            include: { effects: true },
          }),
        this.config.retry,
      );
    } catch (err) {
      return this.transportFailure(err, reference, observedAt);
    }

    const tx = outcome.Transaction ?? outcome.FailedTransaction;

    if (!tx) {
      return {
        transportOk: true,
        failureKind: "malformed",
        assessment: EvidenceAssessmentSchema.parse({
          status: "UNKNOWN",
          verified: false,
          evidenceType: "tatum_sui_grpc",
          evidenceReference: reference,
          observedAt,
          explanation:
            "The gateway returned a response that carried no transaction. " +
            "Success is not established.",
          failureReason: "response contained neither Transaction nor FailedTransaction",
          raw: { endpoint: this.config.grpcUrl, kind: outcome.$kind ?? null },
        }),
      };
    }

    // An authoritative answer arrived. The gRPC transport distinguishes an
    // executed transaction from a failed one by the `$kind` discriminator, and
    // `status.success` is the authoritative execution outcome.
    const success = tx.status?.success;
    const checkpoint = tx.checkpoint ?? null;
    const timestampMs = tx.timestampMs ?? null;

    if (success === true) {
      return {
        transportOk: true,
        assessment: EvidenceAssessmentSchema.parse({
          status: "VERIFIED_SUCCESS",
          verified: true,
          evidenceType: "tatum_sui_grpc",
          evidenceReference: reference,
          observedAt,
          explanation:
            "Authoritative execution status from the Sui gRPC gateway reports " +
            "success. A success claim is permitted.",
          raw: {
            endpoint: this.config.grpcUrl,
            interface: "sui.rpc.v2.LedgerService/GetTransaction",
            digest: tx.digest ?? digest,
            effectsStatus: "success",
            checkpoint,
            timestampMs,
          },
        }),
      };
    }

    if (success === false) {
      return {
        transportOk: true,
        assessment: EvidenceAssessmentSchema.parse({
          status: "VERIFIED_FAILURE",
          verified: true,
          evidenceType: "tatum_sui_grpc",
          evidenceReference: reference,
          observedAt,
          explanation:
            "Authoritative execution status from the Sui gRPC gateway reports " +
            "failure. The transaction did not succeed.",
          failureReason: describeError(tx.status?.error),
          raw: {
            endpoint: this.config.grpcUrl,
            interface: "sui.rpc.v2.LedgerService/GetTransaction",
            digest: tx.digest ?? digest,
            effectsStatus: "failure",
            error: redact(describeError(tx.status?.error)),
            checkpoint,
            timestampMs,
          },
        }),
      };
    }

    return {
      transportOk: true,
      failureKind: "malformed",
      assessment: EvidenceAssessmentSchema.parse({
        status: "UNKNOWN",
        verified: false,
        evidenceType: "tatum_sui_grpc",
        evidenceReference: reference,
        observedAt,
        explanation:
          "A transaction was returned but its execution status could not be " +
          "interpreted. Success is not established.",
        failureReason: `unrecognised execution status: ${String(success)}`,
        raw: {
          endpoint: this.config.grpcUrl,
          digest: tx.digest ?? digest,
          effectsStatus: success ?? null,
          checkpoint,
        },
      }),
    };
  }

  /**
   * Discover recent transaction digests from the live ledger via the gRPC
   * `ListTransactions` stream. Returns an empty list when the gateway is
   * unreachable; callers must report unavailability rather than invent digests.
   */
  async discoverRecentDigests(limit = 20): Promise<string[]> {
    if (!this.config.apiKey) return [];
    try {
      const page = await withRateLimitRetry(
        () =>
          this.client().listTransactions({
            limit: Math.min(limit, 50),
            order: "descending",
            include: { effects: false },
          }),
        this.config.retry,
      );
      return page.transactions
        .map((t) => (t.Transaction ?? t.FailedTransaction)?.digest)
        .filter((d): d is string => typeof d === "string" && d.length > 0);
    } catch {
      return [];
    }
  }

  private client(): SuiGrpcClientLike {
    // One channel per adapter. A native gRPC channel owns a TCP connection and
    // a keepalive timer; creating one per call would leak both, and would keep
    // short-lived scripts alive. The memoised client is released by `close()`.
    this.cachedClient ??= this.clientFactory({
      grpcUrl: this.config.grpcUrl,
      apiKey: this.config.apiKey ?? "",
      timeoutMs: this.config.timeoutMs,
    });
    return this.cachedClient;
  }

  /**
   * Release the underlying gRPC channel. Long-lived servers never need this,
   * but scripts and tests must call it or the process will not exit.
   */
  close(): void {
    this.cachedClient?.close?.();
    this.cachedClient = undefined;
  }

  private transportFailure(
    err: unknown,
    reference: string,
    observedAt: string,
  ): SuiTransactionLookupResult {
    const info = classifyError(err);

    // A digest the node does not hold is an authoritative absence, not a
    // transport failure: the gateway answered, and the answer is "no such
    // transaction". That is UNKNOWN (absence of evidence), never a failure.
    if (info.kind === "not_found") {
      return {
        transportOk: true,
        failureKind: "not_found",
        assessment: EvidenceAssessmentSchema.parse({
          status: "UNKNOWN",
          verified: false,
          evidenceType: "tatum_sui_grpc",
          evidenceReference: reference,
          observedAt,
          explanation:
            "The node holds no transaction for this digest. It may not exist, " +
            "or may have been pruned. Success is not established.",
          failureReason: redact(info.message),
          raw: { endpoint: this.config.grpcUrl, grpcCode: info.grpcCode ?? null },
        }),
      };
    }

    // A malformed digest is a caller error. The gateway answered by rejecting
    // the input; it is not evidence about any transaction.
    if (info.kind === "malformed") {
      return {
        transportOk: true,
        failureKind: "malformed",
        assessment: EvidenceAssessmentSchema.parse({
          status: "UNKNOWN",
          verified: false,
          evidenceType: "tatum_sui_grpc",
          evidenceReference: reference,
          observedAt,
          explanation:
            "The gateway rejected the digest as malformed. No transaction " +
            "outcome can be established from this request.",
          failureReason: redact(info.message),
          raw: { endpoint: this.config.grpcUrl, grpcCode: info.grpcCode ?? null },
        }),
      };
    }

    // Everything else is a failure to complete the lookup: timeout, network,
    // auth, or a server-side error. This establishes neither success nor
    // failure, so it is UNKNOWN with transportOk=false so a fallback interface
    // may be tried.
    return {
      transportOk: false,
      failureKind: info.kind,
      assessment: EvidenceAssessmentSchema.parse({
        status: "UNKNOWN",
        verified: false,
        evidenceType: "tatum_sui_grpc",
        evidenceReference: reference,
        observedAt,
        explanation:
          "The authoritative transaction lookup could not be completed. " +
          "This establishes neither success nor failure. Reporting success " +
          "is therefore not permitted.",
        failureReason: `lookup ${info.kind}: ${redact(info.message)}`,
        raw: {
          endpoint: this.config.grpcUrl,
          transportKind: info.kind,
          grpcCode: info.grpcCode ?? null,
        },
      }),
    };
  }
}

/**
 * The default client: official `@mysten/sui/grpc` over *native* gRPC with the
 * API key as request metadata.
 *
 * Tatum's Sui gRPC gateway speaks native gRPC over HTTP/2 and answers every
 * call with `content-type: application/grpc`. The gRPC-Web transport shipped
 * with `@mysten/sui/grpc` accepts only the `application/grpc-web*` content
 * types and throws "unexpected response content type: application/grpc" on the
 * first call, so it cannot be used here. `@protobuf-ts/grpc-transport` (over
 * `@grpc/grpc-js`) is the same client library family with a real HTTP/2 gRPC
 * channel, and the `SuiGrpcClient` accepts it directly.
 *
 * `host` must be host:port — the scheme is supplied by the channel credentials,
 * not the URL.
 */
function defaultClient(opts: SuiGrpcTransportOptions): SuiGrpcClientLike {
  const transport = new GrpcTransport({
    host: toGrpcHost(opts.grpcUrl),
    channelCredentials: ChannelCredentials.createSsl(),
    meta: { "x-api-key": opts.apiKey },
    timeout: opts.timeoutMs,
  });
  return new SuiGrpcClient({
    network: "mainnet",
    transport,
  }) as unknown as SuiGrpcClientLike;
}

/** Strip the scheme and any path from a gRPC URL, yielding `host:port`. */
export function toGrpcHost(grpcUrl: string): string {
  const withoutScheme = grpcUrl.replace(/^https?:\/\//i, "");
  const host = withoutScheme.split("/")[0];
  return host.includes(":") ? host : `${host}:443`;
}

interface ClassifiedError {
  kind: FailureKind;
  message: string;
  grpcCode?: string;
}

/**
 * Map a thrown error onto a failure kind.
 *
 * The official client surfaces a missing transaction as a plain `Error` whose
 * `reason` is `"notFound"` and whose `cause` is the underlying gRPC error, so
 * both the direct gRPC status code and the client's wrapper are inspected. Only
 * the codes that change the *meaning* of a result are distinguished; everything
 * else is a transport failure.
 */
export function classifyError(err: unknown): ClassifiedError {
  const e = err as {
    code?: unknown;
    name?: string;
    message?: string;
    reason?: string;
    cause?: { code?: unknown };
  };
  const message = e?.message ?? String(err);

  // The client wraps "transaction not found" rather than throwing the gRPC
  // status directly. That is an authoritative absence, not a transport failure.
  if (e?.reason === "notFound") {
    return { kind: "not_found", message, grpcCode: "NOT_FOUND" };
  }

  const code =
    typeof e?.code === "string"
      ? e.code
      : typeof e?.cause?.code === "string"
        ? e.cause.code
        : undefined;

  switch (code) {
    case "NOT_FOUND":
      return { kind: "not_found", message, grpcCode: code };
    case "INVALID_ARGUMENT":
      return { kind: "malformed", message, grpcCode: code };
    case "UNAUTHENTICATED":
    case "PERMISSION_DENIED":
      return { kind: "auth", message, grpcCode: code };
    case "DEADLINE_EXCEEDED":
      return { kind: "timeout", message, grpcCode: code };
    case "UNAVAILABLE":
      return { kind: "network", message, grpcCode: code };
    case "RESOURCE_EXHAUSTED":
      return { kind: "http", message, grpcCode: code };
    default:
      if (e?.name === "AbortError") return { kind: "timeout", message };
      return { kind: "network", message, grpcCode: code };
  }
}

/** Render an ExecutionError as a single readable line, without leaking secrets. */
function describeError(error: unknown): string {
  if (!error) return "execution failure";
  if (typeof error === "string") return error;
  const e = error as { message?: string; $kind?: string };
  if (typeof e.message === "string" && e.message.length > 0) return e.message;
  if (typeof e.$kind === "string") return e.$kind;
  return "execution failure";
}
