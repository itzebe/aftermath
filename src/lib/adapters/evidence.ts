import type { Domain, EvidenceAssessment, Incident } from "@/lib/schemas";

/**
 * A domain evidence adapter decides what actually happened to an attempted
 * action. It is the only component allowed to produce an EvidenceAssessment,
 * and it must be grounded in an authoritative source — never in an agent's
 * prose.
 */
export interface EvidenceAdapter {
  readonly domain: Domain;
  /** Human-readable name of the authoritative source. */
  readonly sourceName: string;
  verifyEvidence(incident: Incident): Promise<EvidenceAssessment>;
}
