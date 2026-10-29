import { loadConfig } from "@/lib/config";
import { resolveModelClient } from "@/lib/adapters/model-factory";
import { runAiInvestigation } from "@/lib/engines/ai-investigation";
import { redactValue } from "@/lib/util/redact";
import type { AiAnalysis } from "@/lib/schemas";

/**
 * A read-only exercise of the configured model.
 *
 * This module deliberately imports *nothing* that can persist or transact: no
 * audit store, no runtime, no memory adapter, no submission pipeline. It reuses
 * exactly the production inference path — the same client resolution, the same
 * engine, the same grounding gate, the same timeout and redaction — and returns
 * only the validated analysis plus an explicit statement of whether a model ran.
 * A caller cannot make it write anything, because it holds no writer.
 */

export interface AiVerificationInference {
  /** Whether a provider key is present (nothing more). */
  configured: boolean;
  provider: string;
  model: string;
  /** The authoritative signal: true only when a model ran and output grounded. */
  ran: boolean;
  availability: string;
}

export interface AiVerificationResult {
  inference: AiVerificationInference;
  analysis: AiAnalysis;
}

export async function runAiVerification(input: {
  text: string;
  service?: string;
  expectedBehavior?: string;
  actualBehavior?: string;
}): Promise<AiVerificationResult> {
  const config = loadConfig();
  const client = resolveModelClient(config);
  const analysis = await runAiInvestigation({
    client,
    text: input.text,
    timeoutMs: config.ai.timeoutMs,
    maxOutputTokens: config.ai.maxOutputTokens,
    ...(input.service ? { service: input.service } : {}),
    ...(input.expectedBehavior ? { expectedBehavior: input.expectedBehavior } : {}),
    ...(input.actualBehavior ? { actualBehavior: input.actualBehavior } : {}),
  });

  return {
    inference: {
      configured: client.isConfigured,
      provider: analysis.provider,
      model: analysis.model,
      ran: analysis.ran,
      availability: analysis.availability,
    },
    // Defence in depth: nothing leaves this endpoint that could carry a
    // credential, even if a provider echoed one back inside its own text.
    analysis: redactValue(analysis),
  };
}
