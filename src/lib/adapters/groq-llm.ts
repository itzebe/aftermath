/**
 * Groq inference client.
 *
 * Groq's free tier serves `openai/gpt-oss-120b` (131,072-token context) with
 * Strict Structured Outputs — constrained decoding that guarantees the response
 * matches a supplied JSON Schema. That guarantee is why this provider was
 * chosen: an incident-analysis response is machine-read, so a schema-violating
 * answer is worse than no answer, and constrained decoding removes the class.
 *
 * This adapter uses the OpenAI-compatible REST endpoint over `fetch`. No SDK is
 * added, so there is no new dependency to audit and nothing that could silently
 * route to a paid tier: the only endpoint this file can reach is the one below,
 * and the model id is fixed by the caller (see `resolveModelClient`).
 *
 * The client never throws on a provider error. It returns a classified failure
 * so the engine can state honestly whether the model ran, and can distinguish a
 * rate limit or a timeout (retryable transport conditions) from a real refusal.
 */

import type {
  LlmRequest,
  LlmResult,
  ModelClient,
} from "@/lib/adapters/llm";

export const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

export interface GroqClientOptions {
  apiKey: string;
  model: string;
  /** Overridable only so a test can point at a local stub server. */
  endpoint?: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

interface GroqChatResponse {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; type?: string; code?: string };
}

export class GroqModelClient implements ModelClient {
  readonly provider = "groq";
  readonly model: string;
  readonly isConfigured = true;
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GroqClientOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.endpoint = options.endpoint ?? GROQ_ENDPOINT;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    // An AbortController turns a hung provider into a classified timeout rather
    // than a request that holds the serverless function open until it is killed.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);

    const body: Record<string, unknown> = {
      model: this.model,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      max_completion_tokens: request.maxOutputTokens,
      temperature: request.temperature ?? 0.1,
    };
    if (request.jsonSchema) {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: request.jsonSchema.name,
          // Strict mode: the model is constrained to the schema at the token
          // level, so the response is always valid JSON that matches it.
          strict: true,
          schema: request.jsonSchema.schema,
        },
      };
    }

    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          // The key is read from the server environment only; it is never
          // logged, echoed, or returned in any result.
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted =
        err instanceof Error && (err.name === "AbortError" || /abort/i.test(err.message));
      return aborted
        ? { ok: false, kind: "timeout", detail: `the provider did not answer within ${request.timeoutMs}ms` }
        : {
            ok: false,
            kind: "unavailable",
            detail: `the provider could not be reached (${safeMessage(err)})`,
          };
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 429) {
      const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
      return {
        ok: false,
        kind: "rate_limited",
        detail: "the provider rate-limited the request (free-tier limit reached)",
        ...(retryAfterMs ? { retryAfterMs } : {}),
      };
    }

    if (!res.ok) {
      // Read the body for a provider message, but never surface a credential.
      const text = await safeText(res);
      return {
        ok: false,
        kind: "unavailable",
        detail: `the provider returned HTTP ${res.status}${text ? `: ${truncate(text, 200)}` : ""}`,
      };
    }

    let parsed: GroqChatResponse;
    try {
      parsed = (await res.json()) as GroqChatResponse;
    } catch {
      return { ok: false, kind: "invalid_response", detail: "the provider response was not valid JSON" };
    }

    const choice = parsed.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      return {
        ok: false,
        kind: "invalid_response",
        detail: "the provider returned no completion content",
      };
    }

    // A `length` finish reason means the model hit the completion ceiling
    // mid-answer. For a JSON-schema request that always means a truncated,
    // unparseable document, so refuse it here rather than let the engine try to
    // salvage a partial object. This is the failure mode a too-small
    // `max_completion_tokens` produces with a reasoning model.
    if (choice?.finish_reason === "length") {
      return {
        ok: false,
        kind: "invalid_response",
        detail: "the provider stopped early: the completion hit its token ceiling before finishing",
      };
    }

    return {
      ok: true,
      text: content,
      usage: {
        ...(parsed.usage?.prompt_tokens !== undefined
          ? { promptTokens: parsed.usage.prompt_tokens }
          : {}),
        ...(parsed.usage?.completion_tokens !== undefined
          ? { completionTokens: parsed.usage.completion_tokens }
          : {}),
      },
    };
  }
}

/** Parse a `Retry-After` header (seconds) into milliseconds, clamped. */
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.min(seconds * 1000, 300_000);
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function safeMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  // Keep the transport reason short and free of anything that could be a secret.
  return truncate(message.replace(/\s+/g, " ").trim(), 160);
}
