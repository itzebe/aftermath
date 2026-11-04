/**
 * Example incident material offered by the submission form.
 *
 * The Sui examples are *reproductions of real recorded investigations*: each
 * carries the exact material, service, and expected behaviour of a record that
 * already exists on Mainnet. A submission is idempotent on that content, so
 * choosing a sample and investigating returns the existing record rather than
 * writing a new one — a judge can replay a real on-chain verification without
 * spending a new write.
 *
 * The three Sui examples are the same claim ("the transaction completed
 * successfully") over three real Sui Mainnet digests. Only the digest differs,
 * and therefore only Tatum's answer differs, so the three outcomes show that
 * the verdict follows the ledger rather than the agent's claim.
 *
 * The incident example names no authoritative source, so the record honestly
 * reports that its outcome could not be established from any connected source.
 *
 * Nothing here fabricates a result: every digest is a genuine Mainnet
 * transaction, and a judge can replace it with any Sui Mainnet digest.
 */

export interface SubmissionSample {
  label: string;
  text: string;
  /** Context fields, applied with the material so the sample reproduces a record. */
  service?: string;
  expectedBehavior?: string;
}

export const SUI_TRANSACTION_SAMPLE = `2026-11-03T09:00:00Z INFO settlement-agent: Sui transaction A9iiTMAxi5BY2uwxu4HnuonfF6A4hhGbaCK8HfTFK26x reported completed successfully. Verify the on-chain outcome before the result is accepted.`;

export const SUI_SUCCESS_SAMPLE = `On 2026-11-03 the settlement agent reported that Sui transaction GHAuBeydSov1zyT6sUKS2cFxWtNWkeamtKANsHwZJHve completed successfully. Confirm the on-chain outcome before accepting the result.`;

export const SUI_UNKNOWN_SAMPLE = `The settlement agent reported that Sui transaction 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM completed successfully. Confirm the on-chain outcome.`;

export const INCIDENT_SAMPLE = `2026-03-01T10:00:00Z ERROR checkout-service
POST /v1/charge returned 503 Service Unavailable
retrying (attempt 2/3)...
2026-03-01T10:00:07Z WARN checkout-service charge status: unknown
2026-03-01T10:00:08Z INFO agent "the charge completed successfully"`;

export const SUBMISSION_SAMPLES: SubmissionSample[] = [
  {
    label: "Sui transaction: succeeded",
    text: SUI_SUCCESS_SAMPLE,
    service: "settlement-agent",
    expectedBehavior: "Confirm the Sui transaction succeeded",
  },
  {
    label: "Sui transaction: failed",
    text: SUI_TRANSACTION_SAMPLE,
    service: "settlement-agent",
    expectedBehavior: "Settlement transaction executes successfully",
  },
  {
    label: "Sui transaction: unknown",
    text: SUI_UNKNOWN_SAMPLE,
    service: "settlement-agent",
  },
  { label: "Use a sample incident", text: INCIDENT_SAMPLE },
];
