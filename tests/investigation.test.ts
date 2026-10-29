import { describe, expect, it } from "vitest";
import {
  diagnoseSubmission,
  extractSignals,
  inferDomain,
  investigateSubmission,
  type SubmissionSignals,
} from "@/lib/engines/investigation";
import type { IncidentSubmission } from "@/lib/schemas";

const noLookup = {
  attempted: false,
  verified: false,
  status: "UNKNOWN" as const,
  detail: "No authoritative lookup was attempted.",
  evidenceReference: "none",
  source: "none",
};

function investigate(text: string, extra: Partial<IncidentSubmission> = {}) {
  return investigateSubmission({
    submission: { text, ...extra },
    authoritativeLookup: noLookup,
  });
}

describe("extractSignals", () => {
  it("extracts HTTP statuses, timestamps, components and error codes", () => {
    const s = extractSignals(
      "2026-03-01T10:00:00Z ERROR checkout-service POST /v1/charge " +
        "returned 503 Service Unavailable (code E5031)",
    );
    expect(s.httpStatuses).toContain("503");
    expect(s.timestamps).toContain("2026-03-01T10:00:00Z");
    expect(s.components).toContain("checkout-service");
    expect(s.errorCodes.length).toBeGreaterThan(0);
    expect(s.reportsFailure).toBe(true);
  });

  it("recognises an explicit success attribution as a completion claim", () => {
    // The failure language is present, but the material *also* attributes a
    // success claim to the agent. That attribution is decisive.
    const s = extractSignals(
      "the request failed with a 503, then the agent reported success",
    );
    expect(s.claimsSuccess).toBe(true);
  });

  it("does not treat failure-only material as a success claim", () => {
    const s = extractSignals("the job crashed with an unhandled exception");
    expect(s.claimsSuccess).toBe(false);
    expect(s.reportsFailure).toBe(true);
  });

  it("detects rate limits, timeouts and retries", () => {
    const s = extractSignals(
      "429 Too Many Requests; retrying (attempt 2/3); request timed out after 30s",
    );
    expect(s.hasRateLimit).toBe(true);
    expect(s.hasTimeout).toBe(true);
    expect(s.hasRetry).toBe(true);
  });
});

describe("inferDomain", () => {
  it("routes a submission with a Sui digest to the finance domain", () => {
    const text =
      "transaction digest: " +
      "4BJRYfnu29GPWdksz7EMUbiqx5CKSZgov3AHQXemt18F";
    const d = inferDomain(extractSignals(text));
    expect(d.domain).toBe("finance");
    expect(d.reason).toMatch(/Tatum/);
  });

  it("keeps an unrelated incident in the incident domain and says so", () => {
    const d = inferDomain(extractSignals("a service returned 500"), "checkout");
    expect(d.domain).toBe("incident");
    expect(d.reason).toMatch(/no connected system/i);
  });
});

describe("diagnoseSubmission", () => {
  const signals = (over: Partial<SubmissionSignals>): SubmissionSignals => ({
    digests: [],
    httpStatuses: [],
    errorCodes: [],
    exceptions: [],
    timestamps: [],
    components: [],
    filePaths: [],
    hasTimeout: false,
    hasRateLimit: false,
    hasRetry: false,
    claimsSuccess: false,
    reportsFailure: false,
    ...over,
  });

  it("classifies a rate limit as missing evidence, never as a failure", () => {
    const d = diagnoseSubmission({
      domain: "incident",
      actionType: "api-call",
      signals: signals({ hasRateLimit: true }),
      evidenceStatus: "UNKNOWN",
      authoritativeVerified: false,
      hasExpected: false,
      hasActual: false,
    });
    expect(d.pattern).toBe("evidence_unavailable");
    expect(d.actionable).toBe(true);
    expect(d.hypothesis).toMatch(/unknown/i);
  });

  it("classifies a success claim against unverified evidence as unsupported", () => {
    const d = diagnoseSubmission({
      domain: "incident",
      actionType: "deploy",
      signals: signals({ claimsSuccess: true }),
      evidenceStatus: "UNKNOWN",
      authoritativeVerified: false,
      hasExpected: false,
      hasActual: false,
    });
    expect(d.pattern).toBe("unsupported_completion_claim");
    expect(d.actionable).toBe(true);
  });
});

describe("investigateSubmission", () => {
  it("keeps observed and confirmed facts separate, with evidence spans", () => {
    const inv = investigate(
      "2026-03-01T10:00:00Z ERROR checkout-service returned 503",
    );
    expect(inv.extractionMethod).toBe("rule-based");
    expect(inv.domain).toBe("incident");
    expect(inv.categories.observedEvidence.length).toBeGreaterThan(0);
    // No connected source was consulted, so nothing may be marked confirmed.
    expect(inv.categories.confirmedFacts).toHaveLength(0);
    expect(inv.categories.unknowns.length).toBeGreaterThan(0);
    expect(inv.categories.nextChecks.length).toBeGreaterThan(0);
    for (const f of inv.categories.observedEvidence) {
      expect(f.source.length).toBeGreaterThan(0);
    }
  });

  it("records confirmed facts only when the authoritative lookup verified", () => {
    const inv = investigateSubmission({
      submission: { text: "charge returned 503" },
      authoritativeLookup: {
        attempted: true,
        verified: true,
        status: "VERIFIED_FAILURE",
        detail: "Tatum reports the transaction did not succeed.",
        evidenceReference: "tatum:digest:abc",
        source: "Tatum Sui Mainnet (read-only)",
      },
    });
    expect(inv.categories.confirmedFacts.length).toBeGreaterThan(0);
    expect(inv.authoritativeLookup.verified).toBe(true);
    expect(inv.authoritativeLookup.source).toMatch(/Tatum/);
  });

  it("never claims success from prose alone", () => {
    const inv = investigate("the agent said the deploy succeeded");
    // Even with a success claim, with no authoritative source the diagnosis
    // cannot assert the action succeeded.
    expect(inv.diagnosis.pattern).not.toBe("evidence_unavailable");
    expect(inv.authoritativeLookup.verified).toBe(false);
  });
});
