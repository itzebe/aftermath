import { describe, expect, it } from "vitest";
import { GroqModelClient, GROQ_ENDPOINT } from "@/lib/adapters/groq-llm";
import { UnconfiguredModelClient } from "@/lib/adapters/llm";
import { resolveModelClient } from "@/lib/adapters/model-factory";
import type { AftermathConfig } from "@/lib/config";

/**
 * The Groq transport is tested at the network boundary with a stub fetch — the
 * only place a stand-in is justified, because the real call needs a credential
 * and the network. Everything above the boundary (status handling, timeout
 * classification, retry-after parsing) is the real adapter code.
 */

function baseConfig(overrides: Partial<AftermathConfig["ai"]> = {}): AftermathConfig {
  return {
    memory: {
      serverUrl: "https://relayer.memory.walrus.xyz",
      accountId: null,
      privateKey: null,
      namespace: "aftermath",
      forceSimulated: true,
    },
    tatum: {
      rpcUrl: "x",
      grpcUrl: "x",
      graphqlUrl: "x",
      apiKey: null,
      timeoutMs: 12000,
    },
    ai: {
      provider: "none",
      model: "openai/gpt-oss-120b",
      apiKey: null,
      timeoutMs: 20000,
      maxOutputTokens: 8192,
      ...overrides,
    },
    aiVerify: { token: null, maxRequests: 5, windowMs: 60000 },
    dbPath: ":memory:",
    harnessDir: "/tmp/h",
    databaseUrl: null,
  };
}

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

const request = {
  messages: [{ role: "user" as const, content: "hello" }],
  maxOutputTokens: 100,
  timeoutMs: 1000,
};

describe("GroqModelClient", () => {
  it("returns the completion text on success and sends the key as a bearer header", async () => {
    let seenAuth = "";
    const client = new GroqModelClient({
      apiKey: "test-key",
      model: "openai/gpt-oss-120b",
      fetchImpl: (async (_url: string, init: RequestInit) => {
        seenAuth = (init.headers as Record<string, string>).authorization;
        return jsonResponse({
          choices: [{ message: { content: "{\"ok\":true}" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        });
      }) as unknown as typeof fetch,
    });
    const result = await client.complete(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('{"ok":true}');
      expect(result.usage?.promptTokens).toBe(10);
    }
    expect(seenAuth).toBe("Bearer test-key");
  });

  it("sends a strict json_schema response_format when one is supplied", async () => {
    let body: Record<string, unknown> = {};
    const client = new GroqModelClient({
      apiKey: "k",
      model: "openai/gpt-oss-120b",
      fetchImpl: (async (_url: string, init: RequestInit) => {
        body = JSON.parse(init.body as string);
        return jsonResponse({ choices: [{ message: { content: "{}" } }] });
      }) as unknown as typeof fetch,
    });
    await client.complete({
      ...request,
      jsonSchema: { name: "x", schema: { type: "object" } },
    });
    const rf = body.response_format as { type: string; json_schema: { strict: boolean } };
    expect(rf.type).toBe("json_schema");
    expect(rf.json_schema.strict).toBe(true);
  });

  it("classifies a 429 as rate_limited and parses retry-after", async () => {
    const client = new GroqModelClient({
      apiKey: "k",
      model: "m",
      fetchImpl: (async () =>
        jsonResponse({ error: { message: "slow down" } }, { status: 429, headers: { "retry-after": "30" } })) as unknown as typeof fetch,
    });
    const result = await client.complete(request);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("rate_limited");
      expect(result.retryAfterMs).toBe(30_000);
    }
  });

  it("classifies a 500 as unavailable", async () => {
    const client = new GroqModelClient({
      apiKey: "k",
      model: "m",
      fetchImpl: (async () => jsonResponse({ error: {} }, { status: 500 })) as unknown as typeof fetch,
    });
    const result = await client.complete(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("unavailable");
  });

  it("classifies a network throw as unavailable", async () => {
    const client = new GroqModelClient({
      apiKey: "k",
      model: "m",
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    const result = await client.complete(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("unavailable");
  });

  it("classifies an abort as a timeout", async () => {
    const client = new GroqModelClient({
      apiKey: "k",
      model: "m",
      fetchImpl: (async () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        throw err;
      }) as unknown as typeof fetch,
    });
    const result = await client.complete(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("timeout");
  });

  it("classifies an empty completion as invalid_response", async () => {
    const client = new GroqModelClient({
      apiKey: "k",
      model: "m",
      fetchImpl: (async () => jsonResponse({ choices: [{ message: { content: "" } }] })) as unknown as typeof fetch,
    });
    const result = await client.complete(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("invalid_response");
  });

  it("refuses a length-truncated completion as invalid_response", async () => {
    // A reasoning model that exhausts its completion budget mid-answer returns
    // HTTP 200 with finish_reason "length" and partial JSON. It must not be
    // accepted as a usable result.
    const client = new GroqModelClient({
      apiKey: "k",
      model: "m",
      fetchImpl: (async () =>
        jsonResponse({
          choices: [{ message: { content: '{"interpretation":"partial' }, finish_reason: "length" }],
        })) as unknown as typeof fetch,
    });
    const result = await client.complete(request);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("invalid_response");
      expect(result.detail).toMatch(/token ceiling/i);
    }
  });

  it("targets the fixed Groq endpoint", () => {
    expect(GROQ_ENDPOINT).toBe("https://api.groq.com/openai/v1/chat/completions");
  });
});

describe("resolveModelClient", () => {
  it("returns the unconfigured client when no key is present", () => {
    const client = resolveModelClient(baseConfig());
    expect(client.isConfigured).toBe(false);
    expect(client).toBeInstanceOf(UnconfiguredModelClient);
  });

  it("returns a Groq client with the fixed model when a key is present", () => {
    const client = resolveModelClient(
      baseConfig({ provider: "groq", apiKey: "secret", model: "openai/gpt-oss-120b" }),
    );
    expect(client.isConfigured).toBe(true);
    expect(client.provider).toBe("groq");
    expect(client.model).toBe("openai/gpt-oss-120b");
  });
});
