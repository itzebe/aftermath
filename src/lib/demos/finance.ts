import { TatumSuiAdapter, type TatumSuiConfig } from "@/lib/adapters/tatum-sui";

/**
 * Finance demonstration.
 *
 * No transaction digest is ever hardcoded or fabricated. Digests are discovered
 * from the live ledger via Tatum's documented Sui JSON-RPC methods, and each
 * digest is then re-verified through `sui_getTransactionBlock` so the evidence
 * path is exercised end to end.
 */

export interface DiscoveredDigest {
  digest: string;
  /** How this digest was obtained. "chain" means discovered from live data. */
  origin: "chain" | "caller-supplied" | "synthetic";
  note?: string;
}

export interface FinanceEvidenceCase {
  scenarioId: string;
  label: string;
  /** True when the case does not reflect a real ledger entry. */
  simulated: boolean;
  digest: string | null;
  digestOrigin: DiscoveredDigest["origin"];
  status: string;
  verified: boolean;
  explanation: string;
  failureReason?: string;
  transportOk: boolean;
}

interface QueryTxBlocksResult {
  data?: Array<{ digest?: string }>;
  hasNextPage?: boolean;
  nextCursor?: string | null;
}

/**
 * Discover recent transaction digests from the live ledger.
 *
 * Uses `suix_queryTransactionBlocks` (documented Tatum Sui method). Returns an
 * empty list when the gateway cannot be reached or no key is configured; the
 * caller must then report the finance demonstration as unavailable rather than
 * substituting a made-up digest.
 */
export async function discoverRecentDigests(
  config: TatumSuiConfig,
  limit = 5,
): Promise<DiscoveredDigest[]> {
  const adapter = new TatumSuiAdapter(config);
  try {
    const result = await adapter.rpc<QueryTxBlocksResult>(
      "suix_queryTransactionBlocks",
      [
        {
          filter: { Checkpoint: null },
          options: { showInput: false, showEffects: true },
        },
        null,
        limit,
        true,
      ],
    );
    const digests = (result?.data ?? [])
      .map((d) => d.digest)
      .filter((d): d is string => typeof d === "string" && d.length > 0);
    return digests.map((digest) => ({ digest, origin: "chain" as const }));
  } catch {
    return [];
  }
}

/**
 * Run the finance evidence cases the brief requires: successful, unsuccessful,
 * pending, and unavailable-evidence.
 *
 * "Successful" and "unsuccessful" cases are produced by scanning recent
 * on-chain transactions and selecting ones whose *authoritative* effects report
 * success or failure — not by assuming what a digest contains.
 */
export async function runFinanceEvidenceCases(
  config: TatumSuiConfig,
  opts: { scanLimit?: number; callerDigest?: string } = {},
): Promise<{ cases: FinanceEvidenceCase[]; digestsFound: number }> {
  const adapter = new TatumSuiAdapter(config);
  const cases: FinanceEvidenceCase[] = [];

  // 1. Unavailable evidence: constructed without a key so the lookup cannot
  //    complete. Must be UNKNOWN, never a failure.
  const unconfigured = new TatumSuiAdapter({ ...config, apiKey: null });
  const unavailable = await unconfigured.verifyTransaction("unavailable-probe");
  cases.push({
    scenarioId: "finance-unavailable-evidence",
    label: "Authoritative lookup unavailable",
    simulated: true,
    digest: null,
    digestOrigin: "synthetic",
    status: unavailable.assessment.status,
    verified: unavailable.assessment.verified,
    explanation: unavailable.assessment.explanation,
    failureReason: unavailable.assessment.failureReason,
    transportOk: unavailable.transportOk,
  });

  // 2. A caller-supplied digest, if provided. This exercises the real lookup
  //    path for a digest the operator chooses.
  if (opts.callerDigest) {
    const { assessment, transportOk } = await adapter.verifyTransaction(
      opts.callerDigest,
    );
    cases.push({
      scenarioId: "finance-caller-digest",
      label: "Operator-supplied transaction digest",
      simulated: false,
      digest: opts.callerDigest,
      digestOrigin: "caller-supplied",
      status: assessment.status,
      verified: assessment.verified,
      explanation: assessment.explanation,
      failureReason: assessment.failureReason,
      transportOk,
    });
  }

  // 3. Discover real digests and classify them by their own effects.
  const discovered = await discoverRecentDigests(config, opts.scanLimit ?? 20);
  let successCase: FinanceEvidenceCase | null = null;
  let failureCase: FinanceEvidenceCase | null = null;
  let pendingCase: FinanceEvidenceCase | null = null;

  for (const candidate of discovered) {
    const { assessment, transportOk } = await adapter.verifyTransaction(
      candidate.digest,
    );
    if (assessment.status === "VERIFIED_SUCCESS" && !successCase) {
      successCase = {
        scenarioId: "finance-success",
        label: "Confirmed successful transaction (discovered on chain)",
        simulated: false,
        digest: candidate.digest,
        digestOrigin: "chain",
        status: assessment.status,
        verified: assessment.verified,
        explanation: assessment.explanation,
        failureReason: assessment.failureReason,
        transportOk,
      };
    }
    if (assessment.status === "VERIFIED_FAILURE" && !failureCase) {
      failureCase = {
        scenarioId: "finance-unsuccessful",
        label: "Confirmed unsuccessful transaction (discovered on chain)",
        simulated: false,
        digest: candidate.digest,
        digestOrigin: "chain",
        status: assessment.status,
        verified: assessment.verified,
        explanation: assessment.explanation,
        failureReason: assessment.failureReason,
        transportOk,
      };
    }
    if (assessment.status === "UNKNOWN" && transportOk && !pendingCase) {
      pendingCase = {
        scenarioId: "finance-pending",
        label: "Transaction not yet resolvable (recent or unindexed)",
        simulated: false,
        digest: candidate.digest,
        digestOrigin: "chain",
        status: assessment.status,
        verified: assessment.verified,
        explanation: assessment.explanation,
        failureReason: assessment.failureReason,
        transportOk,
      };
    }
    if (successCase && failureCase && pendingCase) break;
  }

  if (successCase) cases.push(successCase);
  if (failureCase) cases.push(failureCase);
  if (pendingCase) cases.push(pendingCase);

  return { cases, digestsFound: discovered.length };
}
