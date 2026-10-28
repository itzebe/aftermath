import { describe, expect, it } from "vitest";
import { classifyTransient } from "@/lib/util/transient";

/**
 * The whole product rests on not converting missing evidence into a verdict.
 * A rate limit or a timeout means the dependency never answered, so it must be
 * treated as a transient condition worth retrying — not as a failed action.
 */
describe("classifyTransient", () => {
  it("treats a relayer rate limit as transient and reads its retry hint", () => {
    const err = new Error(
      'Walrus Memory server error (429): {"error":"Rate limit exceeded","layer":"account_sustained","limit":"1000 weighted-requests/hour","retry_after_seconds":300}',
    );
    const result = classifyTransient(err);
    expect(result.transient).toBe(true);
    expect(result.retryAfterMs).toBe(300_000);
  });

  it("treats a 5xx server error as transient", () => {
    expect(classifyTransient(new Error("relayer returned 503 Service Unavailable")).transient).toBe(
      true,
    );
    expect(classifyTransient(new Error("502 Bad Gateway")).transient).toBe(true);
  });

  it("treats a network timeout as transient", () => {
    expect(classifyTransient(new Error("fetch failed: ETIMEDOUT")).transient).toBe(true);
    expect(classifyTransient(new Error("The operation timed out")).transient).toBe(true);
    expect(classifyTransient(new Error("socket hang up")).transient).toBe(true);
  });

  it("does not treat a credential rejection as transient", () => {
    const result = classifyTransient(new Error("401 Unauthorized: AUTH_REJECTED"));
    expect(result.transient).toBe(false);
  });

  it("does not treat a domain error as transient", () => {
    expect(classifyTransient(new Error("transaction digest is not valid hex")).transient).toBe(
      false,
    );
    expect(classifyTransient(new Error("no step definition found for \"x\"")).transient).toBe(false);
  });

  it("caps an absurd retry hint so a caller cannot be told to wait forever", () => {
    const result = classifyTransient(
      new Error('429 rate limit exceeded, "retry_after_seconds":999999'),
    );
    expect(result.transient).toBe(true);
    expect(result.retryAfterMs).toBe(300_000);
  });

  it("applies a default wait when a rate limit gives no hint", () => {
    const result = classifyTransient(new Error("429 Too Many Requests"));
    expect(result.transient).toBe(true);
    expect(result.retryAfterMs).toBe(30_000);
  });
});
