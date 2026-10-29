import { describe, expect, it } from "vitest";
import {
  diagnoseSubmission,
  extractSignals,
  inferDomain,
  investigateSubmission,
  type SubmissionSignals,
} from "@/lib/engines/investigation";
import type { IncidentSubmission } from "@/lib/schemas";
import {
  POOL_EXHAUSTION_INCIDENT,
  REAL_ERROR_CODE_INCIDENT,
} from "./fixtures/incidents";

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
    hasDbPoolExhaustion: false,
    hasFailureSignal: false,
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

/**
 * Regression: ordinary words must not be extracted as error codes.
 *
 * The material below writes its field labels in upper case ("ENVIRONMENT",
 * "EXPECTED", "ERROR"), which the earlier `E[A-Z]{3,}` / `WORD_WORD` rule
 * misread as error codes. These tests pin the corrected behaviour: a bare
 * capitalised word is never a code, while a genuine, code-shaped value is.
 */
describe("regression: error-code extraction", () => {
  it("does not treat ordinary upper-case field labels as error codes", () => {
    const s = extractSignals(POOL_EXHAUSTION_INCIDENT);
    expect(s.errorCodes).not.toContain("ENVIRONMENT");
    expect(s.errorCodes).not.toContain("EXPECTED");
    expect(s.errorCodes).not.toContain("ERROR");
    expect(s.errorCodes).not.toContain("ACTUAL");
    expect(s.errorCodes).not.toContain("SEVERITY");
    expect(s.errorCodes).toHaveLength(0);
  });

  it("still extracts a genuine, code-shaped error code", () => {
    const s = extractSignals(REAL_ERROR_CODE_INCIDENT);
    expect(s.errorCodes).toContain("E5031");
  });

  it("extracts codes from explicit prefixes and labelled fields", () => {
    const s = extractSignals(
      "failed with ERR_STREAM_PREMATURE_CLOSE and SQLSTATE: 23505 and error_code: PG503",
    );
    expect(s.errorCodes).toContain("ERR_STREAM_PREMATURE_CLOSE");
    expect(s.errorCodes).toContain("23505");
    expect(s.errorCodes).toContain("PG503");
  });

  it("does not promote a prose word merely because a code field precedes it", () => {
    const s = extractSignals("error_code: not-available");
    expect(s.errorCodes).toHaveLength(0);
  });
});

/**
 * Regression: a named mechanism must drive the diagnosis.
 *
 * A connection-pool incident contains a timeout, but the timeout is a symptom
 * of the reported mechanism, not a reason to classify the incident as an
 * unknown operation outcome. These tests pin the corrected precedence and the
 * incident-specific evidence, hypotheses, unknowns, and checks.
 */
describe("regression: connection-pool incidents are reasoned from their evidence", () => {
  const inv = investigate(POOL_EXHAUSTION_INCIDENT, { service: "payment-api" });

  it("classifies the mechanism, not the generic unknown", () => {
    expect(inv.diagnosis.pattern).toBe("connection_pool_exhaustion");
    expect(inv.diagnosis.pattern).not.toBe("evidence_unavailable");
    expect(inv.diagnosis.actionable).toBe(true);
  });

  it("states the mechanism in the hypothesis rather than only the timeout", () => {
    expect(inv.diagnosis.hypothesis).toMatch(/pool/i);
    expect(inv.diagnosis.observedFacts).toContain("dbPoolExhaustion=true");
  });

  it("records the pool measurements as observed evidence, with spans", () => {
    const values = inv.categories.observedEvidence.map((f) => f.value);
    expect(values).toContain("active connections = 50");
    expect(values).toContain("idle connections = 0");
    expect(values).toContain("max connections = 50");
    expect(values.some((v) => v.includes("utilization = 100%"))).toBe(true);
    expect(values.some((v) => v.includes("timed out after 5000ms"))).toBe(true);
  });

  it("asks pool-specific unknowns and proposes pool-specific checks", () => {
    expect(inv.categories.unknowns.join(" ")).toMatch(/connection/i);
    expect(inv.categories.unknowns.join(" ")).toMatch(/latency|hold/i);
    expect(inv.categories.nextChecks.join(" ")).toMatch(/acquisition|pool/i);
  });

  it("does not assert an authoritative outcome from the material alone", () => {
    expect(inv.authoritativeLookup.verified).toBe(false);
    // A confirmed fact may exist for supplied input (the service name), but no
    // fact may assert the operation's *outcome* without an authoritative source.
    const outcomeFacts = inv.categories.confirmedFacts.filter((f) =>
      /outcome|success|fail|complet/i.test(`${f.kind} ${f.value}`),
    );
    expect(outcomeFacts).toHaveLength(0);
  });
});
