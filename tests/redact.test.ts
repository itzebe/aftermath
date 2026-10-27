import { describe, expect, it } from "vitest";
import { maskSecret, redact } from "@/lib/util/redact";

/**
 * Secret-exposure guards.
 *
 * These pin the property the product must never violate: no code path that
 * logs, persists, or returns configuration to a client may reveal a
 * credential. A regression here would leak a Mainnet delegate key.
 *
 * All fixtures are synthetic. A test must never carry a real credential.
 */

// A clearly fake 64-hex key. Never use a real delegate key as a fixture.
const FAKE_HEX_KEY = "deadbeef".repeat(8);

describe("maskSecret", () => {
  it("reveals nothing of a 64-hex private key", () => {
    const masked = maskSecret(FAKE_HEX_KEY);
    expect(masked).not.toContain(FAKE_HEX_KEY.slice(0, 4));
    expect(masked).not.toContain(FAKE_HEX_KEY.slice(-4));
    expect(masked).toBe("(64 chars, hidden)");
  });

  it("reports an unset value as not set", () => {
    expect(maskSecret(null)).toBe("(not set)");
    expect(maskSecret(undefined)).toBe("(not set)");
    expect(maskSecret("")).toBe("(not set)");
  });

  it("reports the length without echoing any part of the value", () => {
    expect(maskSecret("aftermath")).toBe("(9 chars, hidden)");
  });
});

describe("redact", () => {
  it("strips a bare 64-hex private key from a message", () => {
    expect(redact(`auth failed for key ${FAKE_HEX_KEY}`)).toBe(
      "auth failed for key [redacted-hex-key]",
    );
  });

  it("strips a suiprivkey-style bech32 key", () => {
    const msg = "using suiprivkey1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
    expect(redact(msg)).not.toContain("suiprivkey1qqqq");
  });
});

