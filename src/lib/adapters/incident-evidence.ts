import {
  EvidenceAssessmentSchema,
  type EvidenceAssessment,
  type Incident,
} from "@/lib/schemas";
import type { EvidenceAdapter } from "@/lib/adapters/evidence";

/**
 * Evidence adapter for a user-submitted incident with no connected source.
 *
 * A submission is *material*, not proof. Unless the material names a source
 * AFTERMATH can actually consult (a Sui digest, which the finance adapter looks
 * up through Tatum), there is no authoritative system to ask, and the honest
 * assessment is UNKNOWN: the submission establishes neither success nor
 * failure. This adapter deliberately never returns VERIFIED_* — doing so from
 * unverified prose would be the exact failure the product exists to prevent.
 */
export class IncidentEvidenceAdapter implements EvidenceAdapter {
  readonly domain = "incident" as const;
  readonly sourceName = "user-submitted incident material (no connected source)";

  async verifyEvidence(incident: Incident): Promise<EvidenceAssessment> {
    const observedAt = new Date().toISOString();
    return EvidenceAssessmentSchema.parse({
      status: "UNKNOWN",
      verified: false,
      evidenceType: "submitted_material",
      evidenceReference: `incident:submission:${incident.executionId}`,
      observedAt,
      explanation:
        "The incident was reported by a person, and no authoritative system " +
        "was named that could confirm the operation's outcome. The material is " +
        "recorded as observed evidence; it does not establish success or failure.",
      failureReason: "no authoritative source connected for this submission",
      raw: { connectedSource: false },
    });
  }
}
