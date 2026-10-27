const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // hex private keys (64 hex chars, optional 0x)
  [/\b(0x)?[0-9a-fA-F]{64}\b/g, "[redacted-hex-key]"],
  // suiprivkey bech32-ish tokens
  [/\bsuiprivkey1[0-9a-z]{20,}\b/gi, "[redacted-sui-key]"],
  // Tatum keys look like long alphanumeric strings with dashes
  [/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi, "[redacted-uuid]"],
  [/\b(?:t-[0-9a-f]{8,}|tatum[-_]?[a-z0-9]{16,})\b/gi, "[redacted-tatum-key]"],
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

/** Deep-redact an object, preserving structure for audit display. */
export function redactValue<T>(input: T): T {
  const json = JSON.stringify(input, replacer());
  return JSON.parse(json) as T;
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

/** Replace the middle of a secret with dots, for display of what IS set. */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return "(not set)";
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}…${value.slice(-4)} (${value.length} chars)`;
}
