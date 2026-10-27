import type { SuiTransactionLookupResult } from "@/lib/adapters/tatum-sui";

/**
 * A read-only Sui transaction verifier. Both the gRPC and JSON-RPC adapters
 * satisfy this interface, which lets the rest of the application depend on the
 * capability rather than on a particular wire protocol.
 */
export interface SuiVerifier {
  /** True when a credential is present, so a lookup can actually be attempted. */
  readonly configured: boolean;
  /** Human-readable name of the interface, for honest UI labelling. */
  readonly sourceName: string;
  health(): Promise<{ ok: boolean; detail: string; chainIdentifier?: string }>;
  verifyTransaction(digest: string): Promise<SuiTransactionLookupResult>;
  /**
   * Discover recent transaction digests from the live ledger. Returns an empty
   * list when the interface is unavailable; callers must report unavailability
   * rather than invent a digest.
   */
  discoverRecentDigests(limit?: number): Promise<string[]>;
  /**
   * Release any long-lived transport (a native gRPC channel owns a TCP
   * connection and keepalive timer). Optional: server code never calls it,
   * but scripts and tests must, or the process will not exit.
   */
  close?(): void;
}

/**
 * Prefers one interface and falls back to another only when the preferred one
 * could not complete the lookup at all.
 *
 * The fallback is deliberately narrow. `transportOk: false` means the request
 * never produced an answer (timeout, network error, auth failure, server error).
 * A definitive answer — success, failure, or "the node holds no such
 * transaction" — always carries `transportOk: true` and is returned immediately,
 * so a digest is never queried twice when the first interface already answered.
 *
 * The interface that produced the assessment is recorded in the assessment's
 * `evidenceType` (`tatum_sui_grpc` or `tatum_sui_json_rpc`), so the UI and the
 * audit trail never claim gRPC evidence that actually came from JSON-RPC.
 */
export class CompositeSuiVerifier implements SuiVerifier {
  readonly sourceName: string;

  constructor(
    private readonly primary: SuiVerifier,
    private readonly fallback: SuiVerifier,
  ) {
    // Always name the intended primary first, regardless of whether a
    // credential is present, so the UI reflects the architecture rather than
    // only what happens to be usable right now.
    this.sourceName = `${primary.sourceName} (primary; fallback: ${fallback.sourceName})`;
  }

  get configured(): boolean {
    return this.primary.configured || this.fallback.configured;
  }

  async health(): Promise<{ ok: boolean; detail: string; chainIdentifier?: string }> {
    if (this.primary.configured) {
      const primary = await this.primary.health();
      if (primary.ok) return primary;
      if (!this.fallback.configured) return primary;
      const fallback = await this.fallback.health();
      return fallback.ok
        ? { ok: true, detail: `${this.primary.sourceName} unavailable; ${fallback.detail}` }
        : primary;
    }
    if (this.fallback.configured) return this.fallback.health();
    return {
      ok: false,
      detail: "TATUM_API_KEY is not configured; no Sui lookup interface is available.",
    };
  }

  async verifyTransaction(digest: string): Promise<SuiTransactionLookupResult> {
    if (this.primary.configured) {
      const primary = await this.primary.verifyTransaction(digest);
      if (primary.transportOk) return primary;

      // The preferred interface could not answer. Fall back only if the
      // fallback is usable; otherwise surface the primary's UNKNOWN as-is.
      if (this.fallback.configured) {
        const fallback = await this.fallback.verifyTransaction(digest);
        if (fallback.transportOk) return fallback;
      }
      return primary;
    }

    if (this.fallback.configured) {
      return this.fallback.verifyTransaction(digest);
    }

    // Neither interface is configured. Report UNKNOWN without a request, since
    // an unauthenticated call would fail anyway and the reason is clearer here.
    return {
      transportOk: false,
      failureKind: "auth",
      assessment: {
        status: "UNKNOWN",
        verified: false,
        evidenceType: "tatum_sui_unconfigured",
        evidenceReference: `sui:tx:${digest}`,
        observedAt: new Date().toISOString(),
        explanation:
          "TATUM_API_KEY is not configured, so no authoritative Sui lookup " +
          "could be made. This is an infrastructure gap, not a transaction outcome.",
        failureReason: "tatum api key not configured",
      },
    };
  }

  async discoverRecentDigests(limit = 20): Promise<string[]> {
    if (this.primary.configured) {
      const digests = await this.primary.discoverRecentDigests(limit);
      if (digests.length > 0) return digests;
    }
    if (this.fallback.configured) return this.fallback.discoverRecentDigests(limit);
    return [];
  }

  close(): void {
    this.primary.close?.();
    this.fallback.close?.();
  }
}
