import { describe, expect, it } from "vitest";
import { maskSecret, redact, redactServed, redactSubmission } from "@/lib/util/redact";

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

  // Every credential class the brief enumerates must be stripped from a value
  // that could be persisted or served. Fixtures are synthetic.
  const CASES: Array<[string, string, string]> = [
    ["api key (sk-)", `key sk-${"a".repeat(32)}`, "sk-"],
    ["google api key", `key AIza${"b".repeat(35)}`, "AIza"],
    ["bearer token", "Authorization: Bearer abcDEF1234567890.token", "abcDEF1234567890"],
    ["github token (ghp_)", `token ghp_${"C".repeat(36)}`, "ghp_"],
    ["github token (github_pat_)", `token github_pat_${"d".repeat(30)}`, "github_pat_"],
    ["aws access key", "AKIAIOSFODNN7EXAMPLE", "AKIAIOSFODNN7EXAMPLE"],
    ["slack token", `xoxb-${"1".repeat(12)}-${"a".repeat(12)}`, "xoxb-"],
    ["private key material", "0x" + "e".repeat(64), "e".repeat(64)],
    ["password assignment", "password=hunter2secret", "hunter2secret"],
    ["password with spaces", 'pwd: "correct horse battery"', "correct horse battery"],
    ["database url", "postgres://admin:s3cr3tpw@db.host:5432/aftermath", "s3cr3tpw"],
    ["api_key assignment", 'api_key="abcd1234efgh5678"', "abcd1234efgh5678"],
    ["generic secret", "secret: supersecretvalue", "supersecretvalue"],
  ];

  for (const [label, input, mustNotContain] of CASES) {
    it(`strips ${label}`, () => {
      const out = redact(input);
      expect(out).not.toContain(mustNotContain);
      expect(out).toContain("[redacted-");
    });
  }

  it("strips a PEM private-key block whole", () => {
    const pem = [
      "-----BEGIN EC PRIVATE KEY-----",
      "MHcCAQEEIB" + "A".repeat(40),
      "-----END EC PRIVATE KEY-----",
    ].join("\n");
    const out = redact(`deploy failed with\n${pem}\nretrying`);
    expect(out).not.toContain("MHcCAQEEIB");
    expect(out).toContain("[redacted-private-key-block]");
  });

  it("preserves a shorter hex reference that cannot be a 32-byte key", () => {
    // A 40-hex value (an address, a truncated reference) is not key material.
    const ref = "0x" + "1".repeat(40);
    expect(redact(`address ${ref}`)).toContain(ref);
  });

  it("conservatively redacts a bare 64-hex value (key-or-hash is ambiguous)", () => {
    // A bare 64-hex string is indistinguishable from a 32-byte private key, so
    // it is redacted. The trade-off — a 64-hex EVM-style transaction hash is
    // also redacted — is deliberate and documented as a limitation.
    expect(redact(`tx 0x${"1".repeat(64)}`)).toBe("tx [redacted-hex-key]");
  });

  it("is idempotent: an already-redacted value is unchanged", () => {
    const once = redact("password=hunter2secret and key ghp_" + "C".repeat(36));
    expect(redact(once)).toBe(once);
  });

  it("does not corrupt ordinary incident prose", () => {
    const prose =
      "2026-03-01T10:00:00Z ERROR checkout-service POST /v1/charge returned " +
      "503 after retry (attempt 2/3); the agent reported success";
    expect(redact(prose)).toBe(prose);
  });
});

/**
 * The exact examples the adversarial review showed were *not* redacted before.
 * Each is a real gap that was closed; a regression here would re-open it.
 */
describe("redact — previously leaked forms (F1)", () => {
  const PASSWORD = "hunter2secret";
  const JWT =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
    "eyJzdWIiOiIxMjM0NTY3ODkwIn0." +
    "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
  const BASIC = "dXNlcjpwYXNzd29yZA==";

  it("redacts a bare password-shaped word with no key context", () => {
    expect(redact(PASSWORD)).toBe("[possible-secret]");
  });

  it("redacts `password hunter2secret` (space-separated, no `=`)", () => {
    const out = redact(`password ${PASSWORD}`);
    expect(out).not.toContain(PASSWORD);
    expect(out).toBe("password [redacted-secret]");
  });

  it("redacts `secret hunter2secret`", () => {
    const out = redact(`secret ${PASSWORD}`);
    expect(out).not.toContain(PASSWORD);
    expect(out).toBe("secret [redacted-secret]");
  });

  it("redacts `token hunter2secret`", () => {
    expect(redact(`token ${PASSWORD}`)).not.toContain(PASSWORD);
  });

  it("redacts the copula form `the password is hunter2secret`", () => {
    const out = redact(`the password is ${PASSWORD}`);
    expect(out).not.toContain(PASSWORD);
    expect(out).toBe("the password is [redacted-secret]");
  });

  it("redacts HTTP Basic credentials", () => {
    const out = redact(`Authorization: Basic ${BASIC}`);
    expect(out).not.toContain(BASIC);
    expect(out).toContain("[redacted-basic-auth]");
  });

  it("redacts a bare JWT", () => {
    const out = redact(`session ${JWT}`);
    expect(out).not.toContain(JWT);
    expect(out).toBe("session [redacted-jwt]");
  });

  it("leaves the prose `the password is required` readable", () => {
    // The copula form must not fire on a non-secret complement.
    const prose = "the password is required before the request proceeds";
    expect(redact(prose)).toBe(prose);
  });

  it("leaves `Basic authentication` readable (no credential-shaped payload)", () => {
    const prose = "Basic authentication is enabled on this endpoint";
    expect(redact(prose)).toBe(prose);
  });
});

/**
 * Evidence the product must preserve: identifiers and hashes are not secrets.
 * Over-redaction here would corrupt the record the investigation reasons over.
 */
describe("redact — evidence preserved (F1)", () => {
  it("keeps a labelled hash/digest intact", () => {
    const hash = "a".repeat(64);
    expect(redact(`sha256 hash ${hash}`)).toContain(hash);
    expect(redact(`tx hash 0x${"1".repeat(64)}`)).toContain("1".repeat(64));
  });

  it("keeps a UUID the surrounding text labels as an identifier", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(redact(`request id ${uuid}`)).toContain(uuid);
    expect(redact(`trace: ${uuid}`)).toContain(uuid);
  });

  it("keeps a Sui transaction digest (base58, 43-44 chars)", () => {
    // The digest is the reference Tatum looks up; redacting it would break
    // finance verification, so it is a deliberate exception.
    const digest = "5Kd3Nb9XoPqRsTuVwXyZ1a2b3c4d5e6f7g8h9iJkLmN";
    expect(redact(`digest ${digest}`)).toContain(digest);
  });

  it("keeps ordinary identifiers and slugs", () => {
    for (const value of [
      "aftermath-7tij",
      "checkout-service",
      "v1.2.3",
      "deadbeef",
      "0x1a2b3c4d5e6f",
    ]) {
      expect(redact(`the ${value} endpoint`)).toContain(value);
    }
  });

  it("still redacts a bare 64-hex value (key-or-hash is ambiguous)", () => {
    expect(redact(`tx 0x${"1".repeat(64)}`)).toBe("tx [redacted-hex-key]");
  });

  it("still redacts a bare UUID (it is also a provider-key shape)", () => {
    // The ambiguity is resolved conservatively and documented.
    expect(redact("550e8400-e29b-41d4-a716-446655440000")).toBe("[redacted-uuid]");
  });
});

describe("redactSubmission", () => {
  it("redacts every free-text field and preserves the rest", () => {
    const sub = {
      text: `error with ghp_${"C".repeat(36)} and password=hunter2`,
      expectedBehavior: "the charge succeeds",
      actualBehavior: "bearer abcDEF1234567890 leaked",
      service: "checkout-service",
    };
    const out = redactSubmission(sub);
    expect(out.text).not.toContain("ghp_");
    expect(out.text).not.toContain("hunter2");
    expect(out.actualBehavior).not.toContain("abcDEF1234567890");
    // Non-secret context survives.
    expect(out.expectedBehavior).toBe("the charge succeeds");
    expect(out.service).toBe("checkout-service");
  });

  it("leaves an already-redacted submission unchanged (idempotent on read)", () => {
    const redacted = redactSubmission({
      text: "key ghp_" + "C".repeat(36),
    });
    expect(redactSubmission(redacted)).toEqual(redacted);
  });

  it("redacts an idempotency key that carries a credential", () => {
    const sub = {
      text: "routine incident",
      idempotencyKey: `idem-${"A1b2".repeat(8)}`,
    };
    const out = redactSubmission(sub);
    expect(out.idempotencyKey).not.toContain("A1b2".repeat(8));
    expect(out.idempotencyKey).toContain("[possible-secret]");
    // A benign key is preserved so a caller's own idempotency still round-trips.
    const benign = redactSubmission({ text: "x", idempotencyKey: "retry-42" });
    expect(benign.idempotencyKey).toBe("retry-42");
  });
});

describe("redactServed — the read boundary for derived fields", () => {
  const SECRET = "hunter2secret";
  const BEARER = "Bearer abcdefghijklmnopqrstuvwxyz012345";

  it("redacts credential-shaped free text in nested derived fields", () => {
    const record = {
      recordId: "r-1",
      intendedOutcome: `password ${SECRET}`,
      investigation: {
        summary: `[checkout] the password is ${SECRET}`,
        categories: {
          confirmedFacts: [
            { kind: "expected_behavior", value: `password ${SECRET}`, source: `expected behavior (supplied): password ${SECRET}` },
            { kind: "actual_behavior", value: BEARER, source: `actual behavior (supplied): ${BEARER}` },
          ],
        },
      },
      memory: { incident: { text: `intended: password ${SECRET}` } },
    };
    const served = redactServed(record);
    const blob = JSON.stringify(served);
    expect(blob).not.toContain(SECRET);
    expect(blob).not.toContain("abcdefghijklmnopqrstuvwxyz012345");
    // The redaction is visible, not a silent deletion.
    expect(blob).toMatch(/\[redacted-secret\]|\[redacted-bearer-token\]/);
  });

  it("preserves identity, reference, timestamp, and enum fields", () => {
    const digest = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    const record = {
      recordId: "4519d613-810b-a832-5aa0-716dacfb150f",
      incidentId: "4519d613-810b-a832-5aa0-716dacfb150f",
      createdAt: "2026-03-01T10:00:00Z",
      domain: "finance",
      actionType: "verify_reported_transaction_outcome",
      investigation: {
        authoritativeLookup: {
          evidenceReference: `incident:submission:4519d613-810b-a832-5aa0-716dacfb150f`,
        },
      },
      proposedRule: { supportingIncidentIds: ["4519d613-810b-a832-5aa0-716dacfb150f"] },
      decision: { evidenceReferences: [digest] },
      learnedSafeguards: [{ evidence: [digest] }],
    };
    const served = redactServed(record);
    expect(served.recordId).toBe(record.recordId);
    expect(served.incidentId).toBe(record.incidentId);
    expect(served.createdAt).toBe(record.createdAt);
    expect(served.domain).toBe("finance");
    expect(served.investigation.authoritativeLookup.evidenceReference).toBe(
      record.investigation.authoritativeLookup.evidenceReference,
    );
    expect(served.proposedRule.supportingIncidentIds[0]).toBe(record.recordId);
    // A labelled transaction digest is evidence and survives.
    expect(served.decision.evidenceReferences[0]).toBe(digest);
    expect(served.learnedSafeguards[0].evidence[0]).toBe(digest);
  });

  it("is idempotent and safe on non-string scalars", () => {
    const once = redactServed({ n: 1, ok: true, nil: null, s: `password ${SECRET}` });
    expect(redactServed(once)).toEqual(once);
    expect(once.n).toBe(1);
    expect(once.ok).toBe(true);
    expect(once.nil).toBeNull();
  });

  it("defaults an unknown key to redacted (fail safe)", () => {
    const served = redactServed({ someFutureField: `token ${SECRET}` });
    expect(served.someFutureField).not.toContain(SECRET);
  });
});

