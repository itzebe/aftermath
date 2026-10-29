import { afterEach, describe, expect, it } from "vitest";
import {
  AI_DEFAULT_MAX_OUTPUT_TOKENS,
  GROQ_MAX_COMPLETION_TOKENS,
  loadConfig,
} from "@/lib/config";
import { runAiInvestigation } from "@/lib/engines/ai-investigation";
import { fakeClient, groundedResponse } from "./fixtures/model";

/**
 * The completion-token ceiling is the fix for a demonstrated reliability defect:
 * `gpt-oss-120b` is a reasoning model whose reasoning tokens share the
 * completion budget, so the old fixed value of 2,048 truncated the
 * schema-constrained JSON and the provider rejected the document. These tests
 * pin the default, the provider clamp, and the safe fallback for a bad value,
 * and prove the configured value reaches the wire.
 */

const ENV = "AFTERMATH_AI_MAX_OUTPUT_TOKENS";
const original = process.env[ENV];

afterEach(() => {
  if (original === undefined) delete process.env[ENV];
  else process.env[ENV] = original;
});

describe("AFTERMATH_AI_MAX_OUTPUT_TOKENS", () => {
  it("defaults to a value that leaves room for reasoning plus the answer", () => {
    delete process.env[ENV];
    expect(AI_DEFAULT_MAX_OUTPUT_TOKENS).toBe(8_192);
    expect(loadConfig().ai.maxOutputTokens).toBe(AI_DEFAULT_MAX_OUTPUT_TOKENS);
  });

  it("accepts an operator-supplied value", () => {
    process.env[ENV] = "16384";
    expect(loadConfig().ai.maxOutputTokens).toBe(16_384);
  });

  it("clamps above the provider maximum rather than sending it", () => {
    process.env[ENV] = "999999";
    expect(loadConfig().ai.maxOutputTokens).toBe(GROQ_MAX_COMPLETION_TOKENS);
  });

  it("falls back to the default for a non-positive or non-numeric value", () => {
    for (const bad of ["0", "-1", "abc", ""]) {
      process.env[ENV] = bad;
      expect(loadConfig().ai.maxOutputTokens).toBe(AI_DEFAULT_MAX_OUTPUT_TOKENS);
    }
  });
});

describe("runAiInvestigation threads the ceiling to the provider", () => {
  it("sends the caller's maxOutputTokens unchanged", async () => {
    const client = fakeClient(groundedResponse());
    await runAiInvestigation({
      client,
      text: "HTTP 500 Internal Server Error\nmax pool size: 50",
      maxOutputTokens: 12_345,
    });
    expect(client.calls[0].maxOutputTokens).toBe(12_345);
  });

  it("uses a safe non-truncating fallback when the caller omits it", async () => {
    const client = fakeClient(groundedResponse());
    await runAiInvestigation({
      client,
      text: "HTTP 500 Internal Server Error\nmax pool size: 50",
    });
    expect(client.calls[0].maxOutputTokens).toBeGreaterThanOrEqual(8_192);
  });
});
