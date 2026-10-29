/**
 * Resolve the model client from configuration.
 *
 * Exactly one provider is recognised — Groq, on its free tier — and the model
 * id is fixed in `config.ts`. There is no code path that can select a paid
 * model, and no fallback to a different provider, so a deployment cannot incur
 * a charge by surprise. When no key is present the honest unconfigured client
 * is returned, which reports `not_configured` instead of answering.
 */

import { loadConfig, type AftermathConfig } from "@/lib/config";
import {
  UnconfiguredModelClient,
  type ModelClient,
} from "@/lib/adapters/llm";
import { GroqModelClient } from "@/lib/adapters/groq-llm";

export function resolveModelClient(config: AftermathConfig = loadConfig()): ModelClient {
  if (config.ai.provider === "groq" && config.ai.apiKey) {
    return new GroqModelClient({ apiKey: config.ai.apiKey, model: config.ai.model });
  }
  return new UnconfiguredModelClient("none", config.ai.model);
}

/**
 * A short-lived, in-process cache of AI analyses keyed by the submission's
 * deterministic content hash.
 *
 * The submission id is already content-addressed, so a duplicate submission is
 * idempotent at the storage layer. This cache additionally avoids spending a
 * second inference call (and a slice of the free quota) on material that was
 * just analysed. It is bounded and best-effort: a miss simply re-runs the
 * analysis, so correctness never depends on it.
 */
export class AiAnalysisCache<T> {
  private readonly store = new Map<string, { value: T; at: number }>();
  constructor(
    private readonly maxEntries = 64,
    private readonly ttlMs = 10 * 60_000,
  ) {}

  get(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > this.ttlMs) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh recency for a simple LRU-ish eviction.
    this.store.delete(key);
    this.store.set(key, hit);
    return hit.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, at: Date.now() });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }
}
