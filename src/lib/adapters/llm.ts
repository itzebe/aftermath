/**
 * The language-model boundary.
 *
 * AFTERMATH uses a model for one narrow job: reading unfamiliar material and
 * proposing candidate mechanisms, missing evidence, and investigations, each
 * tied to a span of the submission. The model is *additive*. It cannot set the
 * evidence status, the diagnosis, the decision, or the verification state —
 * those remain the deterministic engine's, and this interface deliberately
 * exposes nothing that could change them. It has no database, shell, wallet,
 * signing, or transaction capability: it receives text and returns text.
 *
 * A client is a thin, provider-agnostic transport. Providers are adapters
 * behind it so the engine never depends on a vendor's SDK, and so a test can
 * substitute a fake client without any network access.
 */

/** A message in the chat exchange. The submission is always the user message. */
export interface LlmMessage {
  role: "system" | "user";
  content: string;
}

/** A JSON Schema (draft subset) the response must conform to. */
export interface JsonSchemaSpec {
  name: string;
  /** A JSON Schema object. Providers with constrained decoding enforce it. */
  schema: Record<string, unknown>;
}

export interface LlmRequest {
  messages: LlmMessage[];
  /**
   * When set, the provider must return a JSON object conforming to this schema.
   * Providers that support constrained decoding guarantee conformance; others
   * are validated by the caller regardless.
   */
  jsonSchema?: JsonSchemaSpec;
  /** Hard ceiling on the response length. */
  maxOutputTokens: number;
  temperature?: number;
  /** Abort the request after this many milliseconds. */
  timeoutMs: number;
}

/**
 * Why a call did not produce a usable completion. Kept as a closed vocabulary
 * so the engine can map it to a truthful `AiAvailability` without guessing.
 */
export type LlmFailureKind =
  | "not_configured"
  | "unavailable"
  | "rate_limited"
  | "timeout"
  | "invalid_response";

export interface LlmSuccess {
  ok: true;
  /** The raw assistant text. The caller parses and validates it. */
  text: string;
  /** Token usage when the provider reports it; used for cost visibility. */
  usage?: { promptTokens?: number; completionTokens?: number };
}

export interface LlmFailure {
  ok: false;
  kind: LlmFailureKind;
  /** A short, non-sensitive explanation. Never contains credentials. */
  detail: string;
  /** How long to wait before retrying, when the provider said so. */
  retryAfterMs?: number;
}

export type LlmResult = LlmSuccess | LlmFailure;

/**
 * A configured model client. `isConfigured` is false for the honest
 * no-credential client, which returns `not_configured` rather than pretending
 * to answer.
 */
export interface ModelClient {
  readonly provider: string;
  readonly model: string;
  readonly isConfigured: boolean;
  complete(request: LlmRequest): Promise<LlmResult>;
}

/**
 * A client that is not configured. It never fabricates a completion: it reports
 * `not_configured`, so the engine falls back to the deterministic reading and
 * the record says plainly that no model ran.
 */
export class UnconfiguredModelClient implements ModelClient {
  readonly provider: string;
  readonly model: string;
  readonly isConfigured = false;

  constructor(provider = "none", model = "none") {
    this.provider = provider;
    this.model = model;
  }

  async complete(): Promise<LlmResult> {
    return {
      ok: false,
      kind: "not_configured",
      detail:
        "No language-model provider is configured, so AI-assisted analysis did not run.",
    };
  }
}
