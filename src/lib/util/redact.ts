/**
 * Credential redaction for any value that may be logged, persisted, or returned.
 *
 * The goal is narrow and honest: strip the credential shapes a pasted log or
 * incident report realistically contains, *without* destroying the evidence the
 * product exists to reason about. Two families of rule cooperate:
 *
 *   1. Format rules — a value that has a recognisable secret shape (a provider
 *      key, a JWT, a `Basic` credential, a PEM block) is removed outright.
 *   2. Context and entropy rules — a value is removed when a nearby label says
 *      it is a secret, or when it is a long high-entropy token that no ordinary
 *      identifier looks like. An uncertain match is marked `[possible-secret]`
 *      rather than silently kept or silently destroyed.
 *
 * Identifiers are deliberately spared. A UUID, a hex hash, a slug, or a
 * version string is evidence, not a secret, and a rule that redacted them all
 * would corrupt the record. Where an identifier *is* ambiguous — a bare UUID is
 * also the shape of some provider keys — the conservative choice is made and
 * the trade-off is documented rather than hidden.
 *
 * This is not perfect detection and does not claim to be. A short, low-entropy
 * secret pasted with no label and no distinguishing format is indistinguishable
 * from ordinary prose. The boundary is documented in the README and pinned by
 * tests.
 */

/**
 * `String.prototype.replace` passes the match, then every capture group, then
 * the offset and the whole string. The replacement functions below read those
 * positional arguments, so the parameter type is `any[]` to match the DOM
 * signature rather than `unknown[]`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SecretReplacement = string | ((substring: string, ...args: any[]) => string);

/**
 * Labels that mark the following value as a hash/digest — i.e. evidence to keep.
 * Only an explicit label counts; a bare `tx` or `0x` does not, because a bare
 * 64-hex string is indistinguishable from a 32-byte private key.
 */
const HASH_CONTEXT = /\b(?:hash|digest|checksum|merkle|sha(?:-?\d+)?|commit|block)\b[\s:=#-]*$/i;

/** Labels that mark the following UUID as an identifier — i.e. evidence to keep. */
const ID_CONTEXT =
  /\b(?:id|uuid|guid|request|req|trace|correlation|session|span|nonce)\b[\s:=#-]*$/i;

/** The word a token must combine with a digit to read as a password. */
const SECRET_WORD = /(?:secret|pass(?:word|wd|phrase|code)|credential|apikey|api[_-]?key)/i;

/** A whole token that is nothing but hex (with optional separators): a hash. */
const PURE_HEX = /^[0-9a-fA-F]+$/;

const UUID_SHAPE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * A Sui transaction digest (base58, 43-44 chars). It is the single most valuable
 * piece of finance evidence — the reference Tatum looks up — so it is never
 * entropy-redacted. It is a deliberate exception: a 43-44 char base58 secret is
 * theoretically possible, but destroying the digest would break verification of
 * every finance case, which is a far worse outcome.
 */
const SUI_DIGEST_SHAPE = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

/**
 * The three rules whose match is *ambiguous*: they fire on a shape that a piece
 * of legitimate evidence also has, so they are safe only on untrusted free text
 * and must not run against an identity/reference/enum value.
 *
 *   - a bare 64-hex value is a 32-byte key *or* a hash/digest;
 *   - a bare UUID is an identifier *or* some providers' key shape;
 *   - an unlabelled high-entropy token is a secret *or* an opaque identifier.
 *
 * Named here so {@link applyDefinitiveSecretPatterns} can skip them by identity
 * while {@link applySecretPatterns} still applies the full ordered set.
 */
const HEX_KEY_PATTERN = /\b(0x)?[0-9a-fA-F]{64}\b/g;
const BARE_UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const UNLABELLED_TOKEN_PATTERN = /[A-Za-z0-9+/=_-]{6,}/g;
const AMBIGUOUS_SECRET_PATTERNS = new Set<RegExp>([
  HEX_KEY_PATTERN,
  BARE_UUID_PATTERN,
  UNLABELLED_TOKEN_PATTERN,
]);

/**
 * The credential shapes stripped from any value that may be logged, persisted,
 * or returned. Order matters: the more specific a pattern runs first, so a value
 * is never partially consumed by a broader rule.
 */
const SECRET_PATTERNS: Array<[RegExp, SecretReplacement]> = [
  // PEM private-key blocks, before the generic rules touch the base64 body.
  [
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    "[redacted-private-key-block]",
  ],
  // 64-hex values (optional 0x). A 32-byte private key is exactly this shape, so
  // a bare value is conservatively removed — but one the surrounding text labels
  // as a hash or digest is evidence and is kept.
  [
    HEX_KEY_PATTERN,
    (match: string, _prefix: string | undefined, offset: number, whole: string) =>
      HASH_CONTEXT.test(precedingContext(whole, offset)) ? match : "[redacted-hex-key]",
  ],
  // suiprivkey bech32-ish tokens.
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
  // UUIDs are also the shape of some provider keys, so a bare one is removed —
  // but a UUID the surrounding text labels as an id/trace/request is an
  // identifier and is kept.
  [
    BARE_UUID_PATTERN,
    (match: string, offset: number, whole: string) =>
      ID_CONTEXT.test(precedingContext(whole, offset)) ? match : "[redacted-uuid]",
  ],
  [/\b(?:t-[0-9a-f]{8,}|tatum[-_]?[a-z0-9]{16,})\b/gi, "[redacted-tatum-key]"],
  // JSON Web Tokens: three base64url segments, the first a base64 `{"alg":…}`.
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}\b/g, "[redacted-jwt]"],
  // Bearer credentials: keep the scheme, strip the token.
  [/\b(Bearer\s+)(?!\[redacted|\[possible)[^\s"']{6,}/gi, "$1[redacted-bearer-token]"],
  // HTTP Basic credentials: `Basic <base64>`. Base64 can look like an ordinary
  // word ("Basic authentication"), so the label alone is not enough — the value
  // must also read as a credential (padding, a digit, upper case, or `+`/`/`).
  [
    /\b(Basic\s+)([A-Za-z0-9+/]{8,}={0,2})/gi,
    (match: string, scheme: string, value: string) =>
      looksBase64Credential(value) ? `${scheme}[redacted-basic-auth]` : match,
  ],
  // Connection strings (postgres://user:password@host/db) — a pg driver error
  // can embed the DSN, so strip the whole credential-bearing URL.
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'@/]+:[^\s"'@/]+@[^\s"']+/gi, "[redacted-url]"],
  // `password = …`, `api_key: "…"`, `token=…`, and the loose forms
  // `password hunter2secret` / `the password is …`. A value after an explicit
  // `:`/`=` is always removed; a value after a copula or bare space is removed
  // only when it actually looks secret-like, so prose such as "the password is
  // required" is left readable. The key word is kept so the log line still reads.
  [
    /\b(pass(?:word|wd|phrase|code)|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|credential)\b(\s*[:=]\s*|\s+(?:is|was|are)\s+|\s+)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|(?!\[redacted|\[possible)[^\s,;&"']+)/gi,
    (match: string, keyword: string, separator: string, value: string) => {
      const explicit = /[:=]/.test(separator);
      if (explicit || looksSecretLike(value)) {
        return `${keyword}${separator}[redacted-secret]`;
      }
      return match;
    },
  ],
  // Unlabelled secret-shaped tokens: a long high-entropy value, or a short
  // password-like token that mixes a secret word with a digit. Marked
  // `[possible-secret]` because the match is a heuristic, not a certainty.
  // Identifiers (UUIDs, hex hashes, hyphenated slugs, version strings) are
  // excluded so evidence survives.
  [
    UNLABELLED_TOKEN_PATTERN,
    (match: string) => (looksLikeSecretToken(match) ? "[possible-secret]" : match),
  ],
];

/** The text immediately before a match, used to read a value's label. */
function precedingContext(whole: string, offset: number, window = 32): string {
  return whole.slice(Math.max(0, offset - window), offset);
}

/**
 * Whether a value following a secret label reads as an actual secret rather than
 * ordinary prose. A quoted value, a value containing a digit, a mixed-case value,
 * or a long value qualifies; a short lowercase word does not.
 */
function looksSecretLike(value: string): boolean {
  if (/^["']/.test(value)) return true;
  const bare = value.replace(/^["']|["']$/g, "");
  if (bare.length === 0) return false;
  if (/\d/.test(bare)) return true;
  if (/[a-z]/.test(bare) && /[A-Z]/.test(bare)) return true;
  return bare.length >= 12;
}

/**
 * Whether a `Basic <value>` payload reads as a base64 credential rather than an
 * ordinary word. Padding, an upper-case letter, a digit, or a `+`/`/` qualifies;
 * a bare lower-case word such as `authentication` does not.
 */
function looksBase64Credential(value: string): boolean {
  return /=/.test(value) || /[A-Z0-9+/]/.test(value);
}

/**
 * Whether an unlabelled token is secret-shaped. A UUID, a hex hash, or a
 * hyphenated identifier is not; a token that mixes a secret word with a digit,
 * or a long token mixing cases and digits, is.
 */
function looksLikeSecretToken(token: string): boolean {
  if (UUID_SHAPE.test(token)) return false;
  if (PURE_HEX.test(token.replace(/[-_]/g, ""))) return false;
  // A Sui digest is finance evidence, not a secret (see SUI_DIGEST_SHAPE).
  if (SUI_DIGEST_SHAPE.test(token)) return false;
  if (/\d/.test(token) && SECRET_WORD.test(token)) return true;
  if (token.length < 24) return false;
  const classes =
    (/[a-z]/.test(token) ? 1 : 0) +
    (/[A-Z]/.test(token) ? 1 : 0) +
    (/\d/.test(token) ? 1 : 0);
  // A long token must mix case *and* digits to be treated as secret-shaped.
  // A long lowercase slug (an identifier, a service name) is left intact, and a
  // long CamelCase identifier without digits is left intact too — so ordinary
  // evidence survives. The uncertain cases that do match are marked
  // `[possible-secret]` rather than silently removed.
  return classes >= 3;
}

/** Apply every credential pattern to a single string. */
function applySecretPatterns(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement as string);
  }
  return out;
}

/**
 * Apply only the *unambiguous* credential patterns — every rule whose match is a
 * credential by its own format (a provider key, a JWT, a `Basic`/Bearer value, a
 * PEM block, a connection string, a labelled assignment), skipping the three
 * ambiguous ones (see {@link AMBIGUOUS_SECRET_PATTERNS}).
 *
 * This runs on identity/reference/enum values, which are preserved verbatim for
 * provenance. Those values are *not* trusted to be free of credentials: a
 * submission's own digest is matched back out of the material and written into
 * `evidenceReferences[].ref`, so a `password=` pasted next to it would otherwise
 * be persisted and served. A value that merely *has* a digest or hash shape is
 * left intact, because the ambiguous rules are skipped; a value that contains a
 * credential by format is stripped.
 */
function applyDefinitiveSecretPatterns(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    if (AMBIGUOUS_SECRET_PATTERNS.has(pattern)) continue;
    out = out.replace(pattern, replacement as string);
  }
  return out;
}

/**
 * Remove anything that could be a credential from a value before it is logged,
 * persisted, or returned to a client.
 */
export function redact(input: unknown): string {
  let text =
    typeof input === "string" ? input : JSON.stringify(input, replacer(), 2);
  if (text === undefined) text = String(input);
  return applySecretPatterns(text);
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
  /**
   * A caller-supplied idempotency key. It is opaque and could carry a secret,
   * so it is redacted in the stored and served form. The raw value is used only
   * transiently, before this point, to derive the record id.
   */
  idempotencyKey?: string;
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
    ...(submission.idempotencyKey !== undefined
      ? { idempotencyKey: redact(submission.idempotencyKey) }
      : {}),
  };
}

/**
 * Keys whose string values are identity, reference, timestamp, or enum fields —
 * structural provenance that must survive a read-boundary redaction intact.
 *
 * Every other string is treated as untrusted free text and redacted. The default
 * is deliberately to redact: a field added later is protected unless it is
 * explicitly listed here, so a new free-text field cannot silently leak.
 */
const PRESERVED_KEYS = new Set<string>([
  // Identity.
  "recordId", "incidentId", "executionId", "memoryId", "baseMemoryId",
  "originIncidentId", "blobId", "writeId", "jobId", "owner", "ruleId",
  "changedByMemoryId", "supersedes", "id", "uuid", "guid",
  "retrievedMemoryIds", "applicableMemoryIds", "applicableRuleIds",
  "supportingIncidentIds", "missingPreconditions",
  // References (a digest/hash reference is evidence, not a secret).
  "evidenceReference", "evidenceReferences", "ref", "evidence", "kind",
  "evidenceType", "evidenceStatus",
  // Enum / structural fields.
  "domain", "actionType", "status", "state", "decision", "severity", "action",
  "type", "pattern", "failureCategory", "failurePattern", "extractionMethod",
  "validationStatus", "availability", "provider", "model", "backend",
  "provenance", "role", "step", "outcome", "assertedStatus", "policyVersion",
  "relation", "scope", "version", "beforeDecision", "afterDecision",
  // Timestamps.
  "createdAt", "updatedAt", "observedAt", "requestedAt", "completedAt",
  "decidedAt", "generatedAt", "ranAt", "reviewAfter",
]);

/** Redact a served value, preserving identity/reference/enum keys. */
function redactServedValue(value: unknown, key: string | null): unknown {
  if (typeof value === "string") {
    // A preserved key keeps its identity/reference/enum value — but a credential
    // embedded in it is still stripped. The value is not trusted merely because
    // its key is on the preserve list: a digest is copied back out of the raw
    // material, so a secret pasted beside it would otherwise ride along.
    if (key !== null && PRESERVED_KEYS.has(key)) {
      return applyDefinitiveSecretPatterns(value);
    }
    return redact(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactServedValue(item, key));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactServedValue(v, k);
    }
    return out;
  }
  return value;
}

/**
 * Redact every free-text string in a value about to be served to a client,
 * keeping identity, reference, timestamp, and enum fields intact.
 *
 * This is the read boundary for records that may have been written *before* the
 * write-path redaction existed — or that carry a derived copy of an untrusted
 * field. It is key-aware rather than a blanket {@link redactValue} precisely so
 * a record's own ids, evidence references, and transaction digests survive: a
 * whole-value redaction would rewrite those and destroy the provenance the
 * product exists to show. Unknown keys default to redacted (fail safe).
 */
export function redactServed<T>(input: T): T {
  return redactServedValue(input, null) as T;
}

function replacer() {
  const seen = new WeakSet();
  return function (_key: string, value: unknown) {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value as object)) return "[circular]";
      seen.add(value as object);
    }
    if (typeof value === "string") {
      return applySecretPatterns(value);
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
