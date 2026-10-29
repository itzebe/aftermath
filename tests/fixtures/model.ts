/**
 * A fake model client for tests.
 *
 * Every routine test uses a fake: the real provider needs a credential and the
 * network, and the suite must never spend free-tier quota or touch anything
 * live. The fake is a faithful stand-in for the boundary only — it returns
 * exactly the text a real client would, so the engine's parsing, grounding, and
 * fallback logic are the real code under test.
 */

import type { LlmRequest, LlmResult, ModelClient } from "@/lib/adapters/llm";

/** Build a client that always returns `text` (or a canned failure). */
export function fakeClient(
  response: string | LlmResult,
  meta: { provider?: string; model?: string } = {},
): ModelClient & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    provider: meta.provider ?? "groq",
    model: meta.model ?? "openai/gpt-oss-120b",
    isConfigured: true,
    calls,
    async complete(request: LlmRequest): Promise<LlmResult> {
      calls.push(request);
      if (typeof response === "string") return { ok: true, text: response };
      return response;
    },
  };
}

/** Build a client that throws, to prove a throwing transport is contained. */
export function throwingClient(): ModelClient {
  return {
    provider: "groq",
    model: "openai/gpt-oss-120b",
    isConfigured: true,
    async complete(): Promise<LlmResult> {
      throw new Error("socket hang up");
    },
  };
}

/** A well-formed analysis response with grounded facts, as JSON text. */
export function groundedResponse(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    interpretation:
      "The pool is saturated: all 50 connections are in use and acquisitions time out.",
    observedFacts: [
      { kind: "http_status", value: "HTTP 500", source: "HTTP 500 Internal Server Error" },
    ],
    measurements: [
      { label: "active connections", value: "50", unit: "", source: "Active connections: 50" },
      { label: "acquisition timeout", value: "5000", unit: "ms", source: "Database connection acquisition timed out after 5000ms" },
    ],
    hypotheses: [
      {
        mechanism: "connections not released promptly",
        supportingEvidence: ["idle connections: 0 while active connections: 50"],
        contradictingEvidence: [],
        confidence: 0.5,
      },
    ],
    missingEvidence: ["connection hold-time distribution"],
    recommendedInvestigations: ["instrument acquisition and release"],
    candidateSafeguards: [
      {
        statement: "Alert on sustained pool saturation.",
        rationale: "Saturation preceded the timeouts.",
        verificationRequirement: "a controlled load test shows the alert fires before timeouts",
      },
    ],
    verificationRequirements: ["replay the incident window under controlled load"],
    unknownOutcomes: ["the outcome of the POST /v1/charge that timed out is unknown"],
    ...overrides,
  });
}
