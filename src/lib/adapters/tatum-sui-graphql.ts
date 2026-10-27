import { EvidenceAssessmentSchema } from "@/lib/schemas";
import { redact } from "@/lib/util/redact";
import { withRateLimitRetry, type RetryOptions } from "@/lib/adapters/tatum-retry";
import {
  TatumSuiTransportError,
  type FailureKind,
  type SuiTransactionLookupResult,
} from "@/lib/adapters/tatum-sui";

export interface TatumSuiGraphqlConfig {
  graphqlUrl: string;
  apiKey: string | null;
  timeoutMs: number;
  /** Overridable so tests exercise retry logic without real backoff delays. */
  retry?: RetryOptions;
}

interface GraphqlResponse<T> {
  data?: T | null;
  errors?: Array<{ message?: string; path?: unknown }>;
}

interface TransactionEffectsNode {
  digest?: string;
  status?: string | null;
  executionError?: { message?: string | null } | null;
  checkpoint?: { sequenceNumber?: number | string | null } | null;
  timestamp?: string | null;
}

/**
 * Read-only Sui transaction verification through Tatum's Sui Mainnet GraphQL
 * gateway (`https://sui-mainnet.gateway.tatum.io/graphql`).
 *
 * Why GraphQL and not JSON-RPC: the JSON-RPC interface that Tatum previously
 * documented at `https://sui-mainnet.gateway.tatum.io` is no longer served. The
 * live method listing at `/_methods` and `/llms.txt` reports the only interface
 * on that host as `sui-mainnet-graphql`, and a JSON-RPC `POST /` now returns
 * HTTP 404. GraphQL is therefore the supported HTTP interface for this gateway,
 * and it is used here as the fallback behind the gRPC verifier.
 *
 * The authoritative outcome is `TransactionEffects.status`, an enum of
 * `SUCCESS` or `FAILURE`; `executionError` carries the abort detail on failure.
 *
 * Contract of this adapter mirrors the gRPC and (former) JSON-RPC adapters:
 *   - A transport failure is UNKNOWN, never VERIFIED_FAILURE.
 *   - `status: "SUCCESS"` is VERIFIED_SUCCESS.
 *   - `status: "FAILURE"` is VERIFIED_FAILURE.
 *   - A null result is UNKNOWN (the node holds no such transaction).
 *   - A GraphQL error that names a parse failure is a caller error (UNKNOWN);
 *     any other error is a transport failure (UNKNOWN, transportOk: false).
 *   - No transaction is ever broadcast from here.
 */
export class TatumSuiGraphqlAdapter {
  readonly sourceName = "Tatum Sui Mainnet GraphQL";

  constructor(
    private readonly config: TatumSuiGraphqlConfig,
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
    if (!this.config.apiKey) {
      return {
        ok: false,
        detail:
          "TATUM_API_KEY is not configured; refusing to make an unauthenticated GraphQL request.",
      };
    }
    try {
      const data = await this.query<{ chainIdentifier: string }>(
        "query { chainIdentifier }",
      );
      return {
        ok: true,
        detail: "Tatum Sui Mainnet GraphQL reachable and authenticated.",
        chainIdentifier: data.chainIdentifier,
      };
    } catch (err) {
      return { ok: false, detail: redact((err as Error).message) };
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

    let data: { transactionEffects: TransactionEffectsNode | null };
    try {
      data = await this.query<{ transactionEffects: TransactionEffectsNode | null }>(
        `query($digest: String!) {
          transactionEffects(digest: $digest) {
            digest
            status
            executionError { message }
            checkpoint { sequenceNumber }
            timestamp
          }
        }`,
        { digest },
      );
    } catch (err) {
      return this.transportFailure(err, reference, observedAt);
    }

    const effects = data.transactionEffects;

    if (!effects) {
      return {
        transportOk: true,
        failureKind: "not_found",
        assessment: EvidenceAssessmentSchema.parse({
          status: "UNKNOWN",
          verified: false,
          evidenceType: "tatum_sui_graphql",
          evidenceReference: reference,
          observedAt,
          explanation:
            "The node holds no transaction for this digest. It may not exist, " +
            "or may not yet be indexed. Success is not established.",
          failureReason: "transaction not found or not yet indexed",
          raw: { endpoint: this.config.graphqlUrl, resultNull: true },
        }),
      };
    }

    const status = effects.status;
    const checkpoint = effects.checkpoint?.sequenceNumber ?? null;

    if (status === "SUCCESS") {
      return {
        transportOk: true,
        assessment: EvidenceAssessmentSchema.parse({
          status: "VERIFIED_SUCCESS",
          verified: true,
          evidenceType: "tatum_sui_graphql",
          evidenceReference: reference,
          observedAt,
          explanation:
            "Authoritative execution effects from the Sui GraphQL gateway " +
            "report success. A success claim is permitted.",
          raw: {
            endpoint: this.config.graphqlUrl,
            interface: "transactionEffects",
            digest: effects.digest ?? digest,
            effectsStatus: status,
            checkpoint,
            timestamp: effects.timestamp ?? null,
          },
        }),
      };
    }

    if (status === "FAILURE") {
      const errorMessage =
        effects.executionError?.message ?? "execution failure";
      return {
        transportOk: true,
        assessment: EvidenceAssessmentSchema.parse({
          status: "VERIFIED_FAILURE",
          verified: true,
          evidenceType: "tatum_sui_graphql",
          evidenceReference: reference,
          observedAt,
          explanation:
            "Authoritative execution effects from the Sui GraphQL gateway " +
            "report failure. The transaction did not succeed.",
          failureReason: redact(errorMessage),
          raw: {
            endpoint: this.config.graphqlUrl,
            interface: "transactionEffects",
            digest: effects.digest ?? digest,
            effectsStatus: status,
            error: redact(errorMessage),
            checkpoint,
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
        evidenceType: "tatum_sui_graphql",
        evidenceReference: reference,
        observedAt,
        explanation:
          "A transaction was returned but its execution status could not be " +
          "interpreted. Success is not established.",
        failureReason: `unrecognised effects.status: ${String(status)}`,
        raw: {
          endpoint: this.config.graphqlUrl,
          digest: effects.digest ?? digest,
          effectsStatus: status ?? null,
          checkpoint,
        },
      }),
    };
  }

  /**
   * Discover recent transaction digests from the live ledger via the GraphQL
   * `transactions` connection. Returns an empty list when the gateway is
   * unreachable; callers must report unavailability rather than invent digests.
   */
  async discoverRecentDigests(limit = 20): Promise<string[]> {
    if (!this.config.apiKey) return [];
    try {
      const data = await this.query<{
        transactions: { nodes: Array<{ digest?: string }> };
      }>(
        `query($first: Int!) {
          transactions(first: $first) { nodes { digest } }
        }`,
        { first: Math.min(limit, 50) },
      );
      return (data.transactions?.nodes ?? [])
        .map((n) => n.digest)
        .filter((d): d is string => typeof d === "string" && d.length > 0);
    } catch {
      return [];
    }
  }

  /** Low-level GraphQL call with timeout, auth header, and redacted errors. */
  private async query<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    if (!this.config.apiKey) {
      throw new TatumSuiTransportError(
        "TATUM_API_KEY is not configured; refusing to make an unauthenticated request.",
        "auth",
      );
    }
    // The gateway rate-limits bursts on a shared per-key budget, so a single
    // logical lookup retries a 429 a few times with backoff. A rate limit is a
    // "no answer yet", never a transaction outcome.
    return withRateLimitRetry(() => this.attempt<T>(query, variables), this.config.retry);
  }

  private async attempt<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const apiKey = this.config.apiKey;
    if (!apiKey) {
      throw new TatumSuiTransportError(
        "TATUM_API_KEY is not configured; refusing to make an unauthenticated request.",
        "auth",
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(this.config.graphqlUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
    } catch (err) {
      const e = err as Error & { name?: string };
      const kind = e.name === "AbortError" ? "timeout" : "network";
      throw new TatumSuiTransportError(
        `request to ${this.config.graphqlUrl} failed (${kind}): ${redact(e.message)}`,
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
        parseRetryAfter(response.headers.get("retry-after")),
      );
    }
    if (!response.ok) {
      throw new TatumSuiTransportError(
        `gateway returned HTTP ${response.status}.`,
        "http",
        response.status,
      );
    }

    let body: GraphqlResponse<T>;
    try {
      body = (await response.json()) as GraphqlResponse<T>;
    } catch {
      // The gateway answered with a 2xx but the body was not usable JSON. That
      // is a failure to obtain an answer, not a rejected input, so it is
      // classified as an http-level transport failure (transportOk: false).
      throw new TatumSuiTransportError(
        "gateway returned a response that was not valid JSON.",
        "http",
        response.status,
      );
    }

    if (body.errors && body.errors.length > 0) {
      const message = body.errors.map((e) => e.message ?? "unknown").join("; ");
      // A parse/validation error means the gateway answered and rejected the
      // input (e.g. a malformed digest). That is a caller error, not a
      // transport failure: the gateway was reachable and authenticated.
      const kind: FailureKind = /Failed to parse|Invalid Base58|Expected digest/i.test(
        message,
      )
        ? "malformed"
        : "http";
      throw new TatumSuiTransportError(
        `GraphQL error: ${redact(message)}`,
        kind,
        response.status,
      );
    }

    if (body.data === null || body.data === undefined) {
      throw new TatumSuiTransportError(
        "gateway returned no data and no error.",
        "malformed",
        response.status,
      );
    }

    return body.data;
  }

  private transportFailure(
    err: unknown,
    reference: string,
    observedAt: string,
  ): SuiTransactionLookupResult {
    const info = classifyGraphqlError(err);

    // A malformed digest is a caller error. The gateway answered by rejecting
    // the input; it is not evidence about any transaction.
    if (info.kind === "malformed") {
      return {
        transportOk: true,
        failureKind: "malformed",
        assessment: EvidenceAssessmentSchema.parse({
          status: "UNKNOWN",
          verified: false,
          evidenceType: "tatum_sui_graphql",
          evidenceReference: reference,
          observedAt,
          explanation:
            "The gateway rejected the digest as malformed. No transaction " +
            "outcome can be established from this request.",
          failureReason: redact(info.message),
          raw: { endpoint: this.config.graphqlUrl, httpStatus: info.httpStatus ?? null },
        }),
      };
    }

    // Everything else is a failure to complete the lookup: timeout, network,
    // auth, or a server-side error. This establishes neither success nor
    // failure, so it is UNKNOWN with transportOk=false so a fallback may run.
    return {
      transportOk: false,
      failureKind: info.kind,
      assessment: EvidenceAssessmentSchema.parse({
        status: "UNKNOWN",
        verified: false,
        evidenceType: "tatum_sui_graphql",
        evidenceReference: reference,
        observedAt,
        explanation:
          "The authoritative transaction lookup could not be completed. " +
          "This establishes neither success nor failure. Reporting success " +
          "is therefore not permitted.",
        failureReason: `lookup ${info.kind}: ${redact(info.message)}`,
        raw: {
          endpoint: this.config.graphqlUrl,
          transportKind: info.kind,
          httpStatus: info.httpStatus ?? null,
        },
      }),
    };
  }
}

interface ClassifiedGraphqlError {
  kind: FailureKind;
  message: string;
  httpStatus?: number;
}

export function classifyGraphqlError(err: unknown): ClassifiedGraphqlError {
  if (err instanceof TatumSuiTransportError) {
    return { kind: err.kind, message: err.message, httpStatus: err.httpStatus };
  }
  const e = err as { name?: string; message?: string };
  return {
    kind: e?.name === "AbortError" ? "timeout" : "network",
    message: e?.message ?? String(err),
  };
}

/**
 * Parse a `Retry-After` header into milliseconds. The gateway sends it as a
 * small number of seconds on a 429; a date form or a non-numeric value yields
 * undefined so the caller falls back to its own backoff.
 */
export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  if (Number.isFinite(date)) {
    const delta = date - Date.now();
    return delta > 0 ? delta : 0;
  }
  return undefined;
}
