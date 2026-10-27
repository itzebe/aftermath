import { EvidenceAssessmentSchema, type EvidenceAssessment, type Incident } from "@/lib/schemas";
import type { EvidenceAdapter } from "@/lib/adapters/evidence";
import type { SuiVerifier } from "@/lib/adapters/sui-verifier";

/**
 * Finance-domain evidence adapter.
 *
 * The authoritative source is Tatum's Sui Mainnet gateway. Sui Foundation has
 * disabled JSON-RPC on Mainnet full nodes and documents gRPC as the supported
 * replacement, so the verifier this adapter is given prefers gRPC and only
 * falls back to JSON-RPC when gRPC cannot answer at all.
 *
 * The adapter never accepts a client-supplied "success" as evidence, and a
 * failed lookup is reported as UNKNOWN rather than as a failed transaction.
 * The exact interface that produced an assessment is carried on the assessment
 * itself (`evidenceType`), never asserted by this adapter's prose.
 */
export class FinanceEvidenceAdapter implements EvidenceAdapter {
  readonly domain = "finance" as const;
  readonly sourceName: string;

  constructor(private readonly sui: SuiVerifier) {
    this.sourceName = sui.sourceName;
  }

  async verifyEvidence(incident: Incident): Promise<EvidenceAssessment> {
    const digest = extractDigest(incident);

    if (!digest) {
      return EvidenceAssessmentSchema.parse({
        status: "UNKNOWN",
        verified: false,
        evidenceType: "tatum_sui_unconfigured",
        evidenceReference: `finance:tx:${incident.executionId}`,
        observedAt: new Date().toISOString(),
        explanation:
          "No transaction digest was supplied, so the authoritative lookup " +
          "could not be performed.",
        failureReason: "missing sui_tx_digest evidence reference",
      });
    }

    if (!this.sui.configured) {
      return EvidenceAssessmentSchema.parse({
        status: "UNKNOWN",
        verified: false,
        evidenceType: "tatum_sui_unconfigured",
        evidenceReference: `sui:tx:${digest}`,
        observedAt: new Date().toISOString(),
        explanation:
          "TATUM_API_KEY is not configured, so no authoritative Sui lookup " +
          "could be made. This is an infrastructure gap, not a transaction outcome.",
        failureReason: "tatum api key not configured",
      });
    }

    const { assessment } = await this.sui.verifyTransaction(digest);
    return assessment;
  }
}

/** A Sui digest is a base58 string, typically 43-44 characters. */
export function extractDigest(incident: Incident): string | null {
  const byKind = incident.evidenceReferences.find(
    (e) => e.kind === "sui_tx_digest" || e.kind === "transaction_digest",
  );
  if (byKind) return byKind.ref;

  const fromContext = incident.relevantContext?.transactionDigest;
  if (typeof fromContext === "string" && fromContext.length > 0) {
    return fromContext;
  }
  return null;
}

export function isPlausibleSuiDigest(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{20,60}$/.test(value);
}
