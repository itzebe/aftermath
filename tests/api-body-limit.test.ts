import { describe, expect, it } from "vitest";
import { readBodyWithinLimit, readJsonWithinLimit } from "@/lib/api/body-limit";

const LIMIT = 1_024;

function post(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request("http://test/api/incidents/submit", {
    method: "POST",
    headers,
    body,
  });
}

describe("body size limits", () => {
  it("accepts a body within the limit", async () => {
    const result = await readBodyWithinLimit(post(JSON.stringify({ text: "hi" })), LIMIT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.text)).toEqual({ text: "hi" });
  });

  it("rejects an oversized body declared by Content-Length with 413", async () => {
    const big = JSON.stringify({ text: "x".repeat(5_000) });
    const result = await readBodyWithinLimit(post(big), LIMIT);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(413);
  });

  it("rejects an oversized body even when Content-Length is absent or understated", async () => {
    // A stream with no declared length must still be bounded while it is read.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(4_000)));
        controller.close();
      },
    });
    const request = new Request("http://test/api/incidents/submit", {
      method: "POST",
      body: stream,
      // @ts-expect-error duplex is required for a streaming request body in Node
      duplex: "half",
    });
    const result = await readBodyWithinLimit(request, LIMIT);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(413);
  });

  it("does not reject a non-numeric Content-Length outright", async () => {
    const result = await readBodyWithinLimit(
      post(JSON.stringify({ ok: true }), { "content-length": "not-a-number" }),
      LIMIT,
    );
    expect(result.ok).toBe(true);
  });

  it("returns 400 for malformed JSON, distinct from 413", async () => {
    const result = await readJsonWithinLimit(post("not json at all"), LIMIT);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(400);
  });

  it("parses valid JSON under the limit", async () => {
    const result = await readJsonWithinLimit(post(JSON.stringify({ a: 1 })), LIMIT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ a: 1 });
  });
});
