import { describe, expect, it } from "vitest";
import { assessAiVerify } from "../scripts/verify-ai-live";

/**
 * The live AI verifier must never report a pass for a run that did not happen.
 * These tests pin the honesty rule without any network access: only
 * `inference.ran === true` passes.
 */
describe("assessAiVerify", () => {
  it("passes only when a model actually ran", () => {
    const verdict = assessAiVerify(200, {
      inference: { ran: true, configured: true, availability: "ran" },
      analysis: { observedFacts: [{}], measurements: [{}], rejectedClaims: [] },
    });
    expect(verdict.ok).toBe(true);
  });

  it("fails when no key is configured", () => {
    const verdict = assessAiVerify(200, {
      inference: { ran: false, configured: false, availability: "not_configured" },
      analysis: { observedFacts: [] },
    });
    expect(verdict.ok).toBe(false);
  });

  it("fails on a non-200 (e.g. the fail-closed 503)", () => {
    const verdict = assessAiVerify(503, { error: "ai_verify_disabled" } as never);
    expect(verdict.ok).toBe(false);
    expect(verdict.lines[0]).toContain("503");
  });

  it("fails on a 401 for a bad token", () => {
    expect(assessAiVerify(401, null).ok).toBe(false);
  });
});
