import { EvidenceAssessmentSchema, type EvidenceAssessment, type Incident } from "@/lib/schemas";
import type { EvidenceAdapter } from "@/lib/adapters/evidence";
import type { TatumSuiAdapter } from "@/lib/adapters/tatum-sui";

/**
 * Finance-domain evidence adapter.
 *
 * The authoritative source is Tatum's Sui Mainnet JSON-RPC gateway. The adapter
 * never accepts a client-supplied "success" as evidence, and a failed lookup is
 * reported as UNKNOWN rather than as a failed transaction.
 */
export class FinanceEvidenceAdapter implements EvidenceAdapter {
  readonly domain = "finance" as const;
  readonly sourceName = "Tatum Sui Mainnet JSON-RPC (sui_getTransactionBlock)";

  constructor(private readonly tatum: TatumSuiAdapter) {}

  async verifyEvidence(incident: Incident): Promise<EvidenceAssessment> {
    const digest = extractDigest(incident);

    if (!digest) {
      return EvidenceAssessmentSchema.parse({
        status: "UNKNOWN",
        verified: false,
        evidenceType: "tatum_sui_json_rpc",
        evidenceReference: `finance:tx:${incident.executionId}`,
        observedAt: new Date().toISOString(),
        explanation:
          "No transaction digest was supplied, so the authoritative lookup " +
          "could not be performed.",
        failureReason: "missing sui_tx_digest evidence reference",
      });
    }

    if (!this.tatum.configured) {
      return EvidenceAssessmentSchema.parse({
        status: "UNKNOWN",
        verified: false,
        evidenceType: "tatum_sui_json_rpc",
        evidenceReference: `sui:tx:${digest}`,
        observedAt: new Date().toISOString(),
        explanation:
          "TATUM_API_KEY is not configured, so no authoritative Sui lookup " +
          "could be made. This is an infrastructure gap, not a transaction outcome.",
        failureReason: "tatum api key not configured",
      });
    }

    const { assessment } = await this.tatum.verifyTransaction(digest);
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
