import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson } from "@/lib/util/api-get";

/**
 * The public read routes are rate-limited, and a refusal arrives as a JSON
 * error object rather than the payload a page expects. Parsing that as the
 * payload is what produced a blank client-side-exception page in production
 * whenever the limiter engaged, so these cases pin the refusal contract.
 */
describe("fetchJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const stubFetch = (response: Response) =>
    vi.stubGlobal("fetch", vi.fn(async () => response));

  it("returns the parsed body for an ok response", async () => {
    stubFetch(
      new Response(JSON.stringify({ incidents: [], rules: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(fetchJson<{ incidents: unknown[] }>("/api/incidents")).resolves.toEqual({
      incidents: [],
      rules: [],
    });
  });

  it("throws the route's own error and a retry hint on 429", async () => {
    stubFetch(
      new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(fetchJson("/api/incidents")).rejects.toThrow(
      "rate_limited. Please wait a moment and reload.",
    );
  });

  it("throws a status-based message when the error body is not JSON", async () => {
    stubFetch(new Response("<html>gateway</html>", { status: 502 }));
    await expect(fetchJson("/api/incidents")).rejects.toThrow(
      "Request failed (502)",
    );
  });

  it("does not resolve an error body as if it were the payload", async () => {
    // The regression: `{ error }` has no `incidents`, so a caller that parsed
    // it as the payload dereferenced undefined.
    stubFetch(
      new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(fetchJson("/api/incidents")).rejects.toBeInstanceOf(Error);
  });
});
