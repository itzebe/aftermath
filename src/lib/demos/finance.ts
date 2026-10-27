import { TatumSuiGrpcAdapter } from "@/lib/adapters/tatum-sui-grpc";
import { TatumSuiGraphqlAdapter } from "@/lib/adapters/tatum-sui-graphql";
import {
  CompositeSuiVerifier,
  type SuiVerifier,
} from "@/lib/adapters/sui-verifier";
import type { AftermathConfig } from "@/lib/config";

/**
 * Finance demonstration.
 *
 * No transaction digest is ever hardcoded or fabricated. Digests are discovered
 * from the live ledger through the Tatum Sui gateway, and each digest is then
 * re-verified through an authoritative transaction lookup so the evidence path
 * is exercised end to end.
 *
 * The primary interface is gRPC, because Sui Foundation has disabled JSON-RPC
 * on Mainnet full nodes and documents gRPC as the replacement. The fallback is
 * GraphQL: Tatum's Sui gateway host that used to serve JSON-RPC now serves
 * GraphQL at `/graphql`, so GraphQL is the supported HTTP fallback when the
 * gRPC channel cannot answer.
 */

/**
 * Build the Sui verifier the finance path uses: gRPC first, GraphQL fallback.
 * Both are read-only; neither can broadcast a transaction.
 */
export function buildSuiVerifier(config: AftermathConfig["tatum"]): SuiVerifier {
  const grpc = new TatumSuiGrpcAdapter({
    grpcUrl: config.grpcUrl,
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs,
  });
  const graphql = new TatumSuiGraphqlAdapter({
    graphqlUrl: config.graphqlUrl,
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs,
  });
  return new CompositeSuiVerifier(grpc, graphql);
}

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

/**
 * Discover recent transaction digests from the live ledger.
 *
 * Delegates to the verifier, which uses the supported interface (gRPC). Returns
 * an empty list when the gateway cannot be reached or no key is configured; the
 * caller must then report the finance demonstration as unavailable rather than
 * substituting a made-up digest.
 */
export async function discoverRecentDigests(
  verifier: SuiVerifier,
  limit = 5,
): Promise<DiscoveredDigest[]> {
  const digests = await verifier.discoverRecentDigests(limit);
  return digests.map((digest) => ({ digest, origin: "chain" as const }));
}

/**
 * Run the finance evidence cases the brief requires: successful, unsuccessful,
 * pending, and unavailable-evidence.
 *
 * "Successful" and "unsuccessful" cases are produced by scanning recent
 * on-chain transactions and selecting ones whose *authoritative* status reports
 * success or failure — not by assuming what a digest contains.
 */
export async function runFinanceEvidenceCases(
  verifier: SuiVerifier,
  opts: { scanLimit?: number; callerDigest?: string } = {},
): Promise<{ cases: FinanceEvidenceCase[]; digestsFound: number }> {
  const cases: FinanceEvidenceCase[] = [];

  // 1. Unavailable evidence: the lookup cannot complete because no credential
  //    is present. Must be UNKNOWN, never a failure.
  const unconfigured = new CompositeSuiVerifier(
    new TatumSuiGrpcAdapter({
      grpcUrl: "https://sui-mainnet-grpc.gateway.tatum.io",
      apiKey: null,
      timeoutMs: 12000,
    }),
    new TatumSuiGraphqlAdapter({
      graphqlUrl: "https://sui-mainnet.gateway.tatum.io/graphql",
      apiKey: null,
      timeoutMs: 12000,
    }),
  );
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
    const { assessment, transportOk } = await verifier.verifyTransaction(
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
  const discovered = await discoverRecentDigests(verifier, opts.scanLimit ?? 20);
  let successCase: FinanceEvidenceCase | null = null;
  let failureCase: FinanceEvidenceCase | null = null;
  let pendingCase: FinanceEvidenceCase | null = null;

  for (const candidate of discovered) {
    const { assessment, transportOk } = await verifier.verifyTransaction(
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
