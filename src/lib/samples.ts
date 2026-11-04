/**
 * Example incident material offered by the submission form.
 *
 * Two examples are offered because AFTERMATH has two evidence paths and the
 * difference between them is the point of the product:
 *
 *  - The Sui transaction example names a real Sui Mainnet digest. AFTERMATH
 *    verifies it read-only through Tatum (gRPC primary, GraphQL fallback) and
 *    folds the authoritative on-chain result into the record, so this example
 *    exercises the on-chain evidence path end to end.
 *  - The incident example names no authoritative source, so the record honestly
 *    reports that its outcome could not be established from any connected
 *    source.
 *
 * Both are labelled as examples, and neither fabricates a result: the digest is
 * a genuine Mainnet transaction, and a judge can replace it with any Sui
 * Mainnet transaction digest to try their own.
 */

export const SUI_TRANSACTION_SAMPLE = `2026-11-03T09:00:00Z INFO settlement-agent
Sui transaction A9iiTMAxi5BY2uwxu4HnuonfF6A4hhGbaCK8HfTFK26x reported completed successfully.
Confirm the on-chain outcome before the result is accepted.`;

/**
 * The same claim — "the transaction completed successfully" — over three real
 * Sui Mainnet digests. Only the digest differs, and therefore only Tatum's
 * answer differs, so the three outcomes demonstrate that the verdict follows
 * the ledger rather than the agent's claim.
 */
export const SUI_SUCCESS_SAMPLE = `2026-11-03T09:00:00Z INFO settlement-agent
Sui transaction GHAuBeydSov1zyT6sUKS2cFxWtNWkeamtKANsHwZJHve reported completed successfully.
Confirm the on-chain outcome before the result is accepted.`;

export const SUI_UNKNOWN_SAMPLE = `2026-11-03T09:00:00Z INFO settlement-agent
Sui transaction 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM reported completed successfully.
Confirm the on-chain outcome before the result is accepted.`;

export const INCIDENT_SAMPLE = `2026-03-01T10:00:00Z ERROR checkout-service
POST /v1/charge returned 503 Service Unavailable
retrying (attempt 2/3)...
2026-03-01T10:00:07Z WARN checkout-service charge status: unknown
2026-03-01T10:00:08Z INFO agent "the charge completed successfully"`;

export const SUBMISSION_SAMPLES: { label: string; text: string }[] = [
  { label: "Sui transaction: succeeded", text: SUI_SUCCESS_SAMPLE },
  { label: "Sui transaction: failed", text: SUI_TRANSACTION_SAMPLE },
  { label: "Sui transaction: unknown", text: SUI_UNKNOWN_SAMPLE },
  { label: "Use a sample incident", text: INCIDENT_SAMPLE },
];
