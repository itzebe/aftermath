import { describe, expect, it } from "vitest";
import { investigateSubmission } from "@/lib/engines/investigation";
import type { AiAnalysis } from "@/lib/schemas";

/**
 * The AI reading is model-supplied free text, so it is a second untrusted
 * channel into the persisted record — distinct from the submission, which the
 * write path already redacts. A model can echo a credential it saw in a span,
 * invent one, or reproduce one from a prompt, so the analysis must pass the same
 * boundary as the submission *before* it is copied into the investigation.
 *
 * These exercise the real `investigateSubmission` boundary with an injected
 * analysis, asserting the returned (and therefore persisted) investigation is
 * clean while the analysis's own structural fields survive.
 */

// Synthetic credential shapes only — never a real token.
const SECRETS = {
  openai: `sk-${"A".repeat(32)}`,
  github: `ghp_${"D".repeat(36)}`,
  jwt: `eyJ${"B".repeat(20)}.${"C".repeat(20)}.${"D".repeat(20)}`,
};

function maliciousAnalysis(): AiAnalysis {
  return {
    availability: "ran",
    ran: true,
    provider: "probe",
    model: "probe-model",
    interpretation: `the token ${SECRETS.openai} was logged`,
    observedFacts: [
      { kind: "note", value: `key ${SECRETS.github}`, source: "material" },
    ],
    measurements: [],
    hypotheses: [
      {
        mechanism: `expired credential ${SECRETS.jwt}`,
        supportingEvidence: [],
        contradictingEvidence: [],
      },
    ],
    missingEvidence: [`find ${SECRETS.openai}`],
    recommendedInvestigations: [`rotate ${SECRETS.github}`],
    candidateSafeguards: [
      {
        statement: "require a token check",
        rationale: `the key ${SECRETS.openai} leaked`,
        verificationRequirement: "check the header",
      },
    ],
    verificationRequirements: [`verify ${SECRETS.jwt}`],
    unknownOutcomes: [],
    rejectedClaims: [],
    injectionDetected: false,
  };
}

function lookup() {
  return {
    attempted: false,
    verified: false,
    status: "UNKNOWN" as const,
    detail: "none",
    evidenceReference: "none",
    source: "none",
  };
}

describe("model-supplied text is redacted at the investigation boundary", () => {
  it("keeps every credential shape out of the returned investigation", () => {
    const investigation = investigateSubmission({
      submission: { text: "2026-03-03T00:00:00Z ERROR svc returned 503" },
      authoritativeLookup: lookup(),
      aiAnalysis: maliciousAnalysis(),
    });

    const blob = JSON.stringify(investigation);
    expect(blob).not.toContain(SECRETS.openai);
    expect(blob).not.toContain(SECRETS.github);
    expect(blob).not.toContain(SECRETS.jwt);

    // The analysis is still present and its structural fields are intact, so the
    // record still shows that a model ran and what it contributed.
    expect(investigation.aiAnalysis).not.toBeNull();
    expect(investigation.aiAnalysis?.ran).toBe(true);
    expect(investigation.aiAnalysis?.provider).toBe("probe");
    expect(investigation.extractionMethod).toBe("model");
  });

  it("leaves a legitimate, non-secret reading intact", () => {
    const clean: AiAnalysis = {
      ...maliciousAnalysis(),
      interpretation: "The service returned 503 after two retries.",
      observedFacts: [
        { kind: "status_code", value: "503", source: "returned 503" },
      ],
      missingEvidence: ["the upstream status"],
      recommendedInvestigations: ["check the upstream health endpoint"],
      candidateSafeguards: [],
      verificationRequirements: ["record the upstream response"],
      hypotheses: [],
    };
    const investigation = investigateSubmission({
      submission: { text: "2026-03-03T00:00:00Z ERROR svc returned 503" },
      authoritativeLookup: lookup(),
      aiAnalysis: clean,
    });
    expect(investigation.aiAnalysis?.interpretation).toContain("503");
    expect(investigation.aiAnalysis?.missingEvidence).toEqual([
      "the upstream status",
    ]);
  });

  it("keeps a credential out of an identity/enum field the model controls", () => {
    // `observedFacts[].kind` and `.source` are preserved keys (identity/evidence
    // provenance), so they are served verbatim. A model that echoes a credential
    // into one of them must not smuggle it into the persisted record: the
    // unambiguous format rules still run against preserved-key values.
    const secret = `sk-${"E".repeat(32)}`;
    const analysis: AiAnalysis = {
      ...maliciousAnalysis(),
      interpretation: "clean",
      observedFacts: [
        { kind: secret, value: "x", source: `material: ${secret}` },
      ],
    };
    const investigation = investigateSubmission({
      submission: { text: "2026-03-03T00:00:00Z ERROR svc returned 503" },
      authoritativeLookup: lookup(),
      aiAnalysis: analysis,
    });
    expect(JSON.stringify(investigation)).not.toContain(secret);
  });
});
