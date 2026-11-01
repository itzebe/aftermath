/**
 * The credential shapes stripped from any value that may be logged, persisted,
 * or returned. Order matters: the more specific a pattern, the earlier it runs,
 * so a value is never partially consumed by a broader rule.
 *
 * These cover the formats a pasted log or incident report realistically
 * contains. They are deliberately *format-based* rather than entropy-based: a
 * generic "looks random" rule would corrupt legitimate evidence (a tx hash, a
 * base64 payload, a long identifier), which the product must preserve.
 */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // PEM private-key blocks, before the generic rules touch the base64 body.
  [
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    "[redacted-private-key-block]",
  ],
  // hex private keys (64 hex chars, optional 0x)
  [/\b(0x)?[0-9a-fA-F]{64}\b/g, "[redacted-hex-key]"],
  // suiprivkey bech32-ish tokens
  [/\bsuiprivkey1[0-9a-z]{20,}\b/gi, "[redacted-sui-key]"],
  // GitHub tokens: the fine-grained `github_pat_` form and the `ghp_` family.
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[redacted-github-token]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[redacted-github-token]"],
  // AWS access-key id.
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "[redacted-aws-key]"],
  // Slack tokens.
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[redacted-slack-token]"],
  // OpenAI- and Google-style API keys.
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[redacted-api-key]"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, "[redacted-api-key]"],
  // Tatum keys look like long alphanumeric strings with dashes
  [/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi, "[redacted-uuid]"],
  [/\b(?:t-[0-9a-f]{8,}|tatum[-_]?[a-z0-9]{16,})\b/gi, "[redacted-tatum-key]"],
  // Bearer credentials: keep the scheme, strip the token. Guarded so a value a
  // previous rule already replaced is not wrapped a second time.
  [/\b(Bearer\s+)(?!\[redacted)[^\s"']{6,}/gi, "$1[redacted-bearer-token]"],
  // Connection strings (postgres://user:password@host/db) — a pg driver error
  // can embed the DSN, so strip the whole credential-bearing URL.
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'@/]+:[^\s"'@/]+@[^\s"']+/gi, "[redacted-url]"],
  // `password = ...`, `api_key: "..."`, `token=...`. The key word is kept so the
  // surrounding log line still reads; only the value is stripped. Guarded so an
  // already-redacted placeholder is left alone.
  [
    /\b(pass(?:word|wd|phrase)|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\b(\s*[:=]\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|(?!\[redacted)[^\s,;&]+)/gi,
    "$1$2[redacted-secret]",
  ],
];

/**
 * Remove anything that could be a credential from a value before it is logged,
 * persisted, or returned to a client.
 */
export function redact(input: unknown): string {
  let text =
    typeof input === "string" ? input : JSON.stringify(input, replacer(), 2);
  if (text === undefined) text = String(input);
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

/**
 * Deep-redact an object, preserving structure for audit display.
 *
 * Note: this rewrites *every* string, including identifier-shaped ones, so it
 * must not be applied to a whole record — a `SafeguardRecord`'s own ids are
 * UUID-shaped and would be destroyed. Use {@link redactSubmission} for the
 * untrusted submission field.
 */
export function redactValue<T>(input: T): T {
  const json = JSON.stringify(input, replacer());
  return JSON.parse(json) as T;
}

/** The credential-bearing fields of a submitted incident. */
export interface RedactableSubmission {
  text: string;
  expectedBehavior?: string;
  actualBehavior?: string;
  service?: string;
}

/**
 * Redact the credential-shaped strings from a submission's free-text fields,
 * leaving every other field (and all non-secret content) intact.
 *
 * This is the boundary applied both before a record is *persisted* and before
 * it is *returned*, so a credential pasted into an incident never reaches
 * durable storage and never leaves the process — and a record written before
 * this rule existed cannot expose one through a public endpoint either.
 *
 * It is idempotent: a value that already carries a `[redacted-…]` placeholder
 * is left unchanged, so applying it on read to an already-redacted record is a
 * no-op. It is not a claim that raw bytes were *deleted* from storage a record
 * was written to before the rule existed — only that they are never served.
 */
export function redactSubmission<T extends RedactableSubmission>(submission: T): T {
  return {
    ...submission,
    text: redact(submission.text),
    ...(submission.expectedBehavior !== undefined
      ? { expectedBehavior: redact(submission.expectedBehavior) }
      : {}),
    ...(submission.actualBehavior !== undefined
      ? { actualBehavior: redact(submission.actualBehavior) }
      : {}),
    ...(submission.service !== undefined ? { service: redact(submission.service) } : {}),
  };
}

function replacer() {
  const seen = new WeakSet();
  return function (_key: string, value: unknown) {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value as object)) return "[circular]";
      seen.add(value as object);
    }
    if (typeof value === "string") {
      let out = value;
      for (const [pattern, replacement] of SECRET_PATTERNS) {
        out = out.replace(pattern, replacement);
      }
      return out;
    }
    return value;
  };
}

/**
 * Describe a configured value without revealing any of it.
 *
 * Callers pass credentials here (a delegate private key, an account id, an API
 * key). Even a short prefix or suffix narrows an attacker's search space, so
 * only the length is reported. An unset value is reported as such.
 */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return "(not set)";
  return `(${value.length} chars, hidden)`;
}
