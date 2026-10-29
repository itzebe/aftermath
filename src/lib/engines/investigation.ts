/**
 * Deterministic, rule-based investigation of a submitted incident.
 *
 * This module is the honest core of the user-facing pipeline. It parses the
 * raw material with regular expressions and pure string operations — it never
 * executes, evaluates, or interpolates the submitted text into a command, a
 * query, or a template that runs. A stack trace is read as text, not run.
 *
 * There is no language model in this path. That is a deliberate, disclosed
 * choice: the product's claim is evidence-grounded investigation, not
 * autonomous reasoning, and inventing a model here would make the output
 * unauditable. `extractionMethod` is therefore always "rule-based".
 *
 * The output separates what the material *shows* (observed), what a connected
 * authoritative source *confirms*, what is merely *hypothesised*, what is still
 * *unknown*, and what check would resolve the difference. A hypothesis is never
 * promoted to a fact by this module.
 */

import {
  InvestigationSchema,
  type Diagnosis,
  type EvidenceAssessment,
  type ExtractedFact,
  type FailurePattern,
  type IncidentInputDraft,
  type Investigation,
} from "@/lib/schemas";
import { redact } from "@/lib/util/redact";

/** Cap how many of each fact kind we keep, so a huge paste stays readable. */
const MAX_FACTS_PER_KIND = 6;

/** A Sui transaction digest is base58 and 43-44 characters long. */
const SUI_DIGEST = /\b[1-9A-HJ-NP-Za-km-z]{43,44}\b/g;
const HEX_TX = /\b0x[0-9a-fA-F]{40,64}\b/g;

const HTTP_STATUS_WORDED =
  /\b([45]\d{2})\s+(?:Bad Request|Unauthorized|Forbidden|Not Found|Conflict|Too Many Requests|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout|Request Timeout)\b/gi;
const HTTP_STATUS_LABELLED =
  /\b(?:status(?:\s*code)?|http(?:\s*status)?|response\s+code)\s*[:=]?\s*([45]\d{2})\b/gi;

/**
 * Error codes are extracted only from shapes that are unambiguously codes.
 *
 * The earlier rule (`E[A-Z]{3,}` and any `WORD_WORD`) matched ordinary English
 * words in upper case — "ERROR", "EXPECTED", "ENVIRONMENT" — because they look
 * like errno constants and underscore codes. The rule below inverts that: a
 * token must carry a code-shaped marker (an explicit prefix such as `ERR_` or
 * `ORA-`, a `SQLSTATE`, a letter-plus-digits form like `E5031`, an underscored
 * form that also contains a digit, or a value from the finite set of real errno
 * constants). A bare capitalised word is never a code.
 */
const ERROR_CODE_TOKEN =
  /\b(ERR_[A-Z0-9_]{2,}|ORA-\d{3,5}|E\d{3,}|(?=[A-Z0-9_-]*\d)[A-Z][A-Z0-9]*(?:[_-][A-Z0-9]+)+|E[A-Z]{3,})\b/g;
/** A SQLSTATE is labelled and exactly five alphanumerics, e.g. `SQLSTATE: 23505`. */
const SQLSTATE = /\bSQLSTATE\s*[:=]?\s*([0-9A-Z]{5})\b/gi;
/** A code written into an explicitly labelled field, e.g. `error_code: PG503`. */
const ERROR_CODE_LABELLED =
  /\b(?:error[_\s-]?code|errno|exception[_\s-]?code|fault[_\s-]?code)\s*[:=]\s*([A-Za-z][A-Za-z0-9_-]{1,40})\b/gi;
/**
 * Real POSIX/Node errno constants. Only these capitalised `E…` tokens are
 * codes; every other capitalised word is ordinary text.
 */
const KNOWN_ERRNO = new Set([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EADDRINUSE",
  "EADDRNOTAVAIL", "EAI_AGAIN", "EPIPE", "EBADF", "EACCES", "EPERM", "EEXIST",
  "ENOENT", "ENOSPC", "EIO", "EINTR", "EAGAIN", "EBUSY", "EDEADLK", "EFAULT",
  "EINVAL", "EMFILE", "ENFILE", "ENOMEM", "ENOSYS", "ENOTDIR", "ENOTEMPTY",
  "ENOTSUP", "EOVERFLOW", "ERANGE", "EROFS", "ESPIPE", "ESRCH", "ETXTBSY",
  "EXDEV", "EHOSTUNREACH", "ENETUNREACH", "EHOSTDOWN", "ENETDOWN",
  "ECONNABORTED", "EISDIR", "ENODEV", "ENXIO", "ELOOP", "ENAMETOOLONG",
  "EMSGSIZE",
]);

/**
 * Whether a value is shaped like an error code rather than a prose word.
 * Used for both the unlabelled and the labelled extraction paths, so a generic
 * label can never be promoted to a code simply by being written after one.
 */
function isCodeShaped(value: string): boolean {
  if (KNOWN_ERRNO.has(value)) return true;
  if (/^ERR_[A-Z0-9_]+$/.test(value)) return true;
  if (/^ORA-\d{3,5}$/.test(value)) return true;
  if (/^E\d{3,}$/.test(value)) return true;
  // Underscored/hyphenated code with at least one digit, e.g. HTTP_500, S3_403.
  if (/^[A-Z][A-Z0-9]*(?:[_-][A-Z0-9]+)+$/.test(value) && /\d/.test(value)) return true;
  // Letters then digits, e.g. PG503.
  if (/^[A-Za-z]+[_-]?\d+$/.test(value)) return true;
  return false;
}

/**
 * A database connection-pool failure, stated in the material.
 *
 * Matched as a whole phrase so a heading that merely contains the word "pool"
 * is not treated as a signal.
 */
const DB_POOL_EXHAUSTED =
  /\b(?:connection\s+pool\s+(?:is\s+|was\s+|has\s+been\s+)?(?:exhausted|saturated|depleted|full)|pool\s+exhaust(?:ed|ion)|connection\s+pool\s+exhaust(?:ed|ion)|no\s+connections?\s+available)\b/i;
/** A labelled pool measurement, e.g. "Active connections: 50", "max pool size: 50". */
const POOL_MEASUREMENT =
  /\b(active|idle|in[- ]?use|open|max(?:imum)?|total|waiting|pending)\s+(?:connections?|pool\s+size|pool)\s*[:=]\s*(\d+)\b/gi;
/** A pool utilisation figure, e.g. "Database pool utilization reached 100%". */
const POOL_UTILIZATION =
  /\b([A-Za-z][A-Za-z0-9 _-]{0,40}?)\s+utilization\s+(?:reached|is|was|at|of)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(%|percent)?(?=\s|$|[.,;)])/gi;
/** A named quantity that exceeded a threshold, e.g. "Request duration exceeded threshold: 10042ms". */
const THRESHOLD_EXCEEDED =
  /\b([A-Za-z][A-Za-z0-9 _-]{1,40}?)\s+exceeded\s+(?:the\s+)?(?:threshold|budget|limit)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|seconds|%|percent)?(?=\s|$|[.,;)])/gi;
/** An operation that timed out after a stated duration, preserving the duration. */
const TIMEOUT_AFTER =
  /\b([A-Za-z][A-Za-z0-9 _-]{1,40}?)\s+timed\s+out\s+after\s+(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|seconds)\b/gi;
/** An explicit failure signal such as a failed health or readiness check. */
const FAILURE_SIGNAL =
  /\b((?:health|readiness|liveness)\s+(?:check|probe)\s+failed|connection\s+unavailable|service\s+unavailable|database\s+unavailable)\b[^\n]*/i;

const EXCEPTION_TYPE =
  /\b([A-Z][A-Za-z0-9]*(?:Error|Exception|Fault|Panic|Timeout|Refused|Denied|Unavailable))\b/g;
const ISO_TIMESTAMP =
  /\b(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\b/g;
const STACK_FRAME = /\bat\s+([\w.$<>[\]]+)\s*\(([^)]+)\)/g;
const FILE_PATH =
  /\b((?:[\w.-]+\/)+[\w.-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|rb|sql|json|yaml|yml))\b/g;
const COMPONENT =
  /\b([a-z][a-z0-9]*(?:[-_][a-z0-9]+)*[-_](?:service|api|worker|gateway|queue|scheduler|db|database|cache|proxy|job))\b/gi;
const TIMEOUT = /\b(timeout|timed out|deadline exceeded|context deadline|ETIMEDOUT|ETIMEOUT)\b/i;
const RATE_LIMIT =
  /\b(rate limit|too many requests|429|throttl\w*|quota exceeded|slow down)\b/i;
const RETRY = /\b(retry|retried|retrying|attempt\s+\d|reconnect\w*)\b/i;
const SUCCESS_CLAIM =
  /\b(success(?:ful|fully)?|succeeded|completed successfully|returned\s+(?:ok|200)|status\s*[:=]\s*(?:ok|success)|reported\s+success)\b/i;
/**
 * Language that explicitly attributes a success claim to a person or agent,
 * e.g. "the agent reported success". This wins over a generic failure marker,
 * because the interesting incident is precisely the one where success was
 * claimed in the same breath as a failure.
 */
const EXPLICIT_SUCCESS_CLAIM =
  /\b(reported|claimed|asserted|marked|recorded|logged|assumed|treated|declared)\s+(?:it\s+|this\s+|the\s+\w+\s+)?(?:as\s+)?(?:a\s+)?(?:success|successful|succeeded|ok|200|complete|completed)\b/i;
const FAILURE_MARKER =
  /\b(fail(?:ed|ure|s)?|error|exception|panic|crash(?:ed)?|denied|refused|unavailable|abort(?:ed)?|not\s+found|invalid|rejected)\b/i;

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

function collect(
  text: string,
  pattern: RegExp,
  kind: string,
  map: (m: RegExpExecArray) => { value: string; source: string } | null,
): ExtractedFact[] {
  const out: ExtractedFact[] = [];
  // Ensure the global flag: some source patterns are declared without it so
  // that a plain `.test()` on them stays stateless. Without `g`, `exec` would
  // never advance and this loop would run forever.
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const mapped = map(m);
    if (mapped) out.push({ kind, value: mapped.value, source: mapped.source });
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

/** Keep at most MAX_FACTS_PER_KIND of each kind, de-duplicating by kind+value. */
function cap(facts: ExtractedFact[]): ExtractedFact[] {
  const seen = new Set<string>();
  const perKind = new Map<string, number>();
  const out: ExtractedFact[] = [];
  for (const f of facts) {
    const key = `${f.kind}:${f.value.toLowerCase()}`;
    if (seen.has(key)) continue;
    const count = perKind.get(f.kind) ?? 0;
    if (count >= MAX_FACTS_PER_KIND) continue;
    seen.add(key);
    perKind.set(f.kind, count + 1);
    out.push(f);
  }
  return out;
}

/**
 * Extract error codes, from both code-shaped tokens and explicitly labelled
 * fields, rejecting anything that is not code-shaped. A generic label such as
 * "ENVIRONMENT" or "ERROR" is never returned: it is neither a known errno nor
 * code-shaped, and it does not appear after an error-code field name.
 */
function extractErrorCodeFacts(text: string): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  for (const f of collect(text, ERROR_CODE_TOKEN, "error_code", (m) => ({
    value: m[1],
    source: m[0],
  }))) {
    if (isCodeShaped(f.value)) facts.push(f);
  }
  facts.push(
    ...collect(text, SQLSTATE, "error_code", (m) => ({
      value: m[1],
      source: m[0],
    })),
  );
  for (const f of collect(text, ERROR_CODE_LABELLED, "error_code", (m) => ({
    value: m[1],
    source: m[0],
  }))) {
    if (isCodeShaped(f.value)) facts.push(f);
  }
  return facts;
}

/** Quantitative / structural evidence beyond codes: pool, thresholds, timeouts. */
function extractMeasurementFacts(text: string): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  facts.push(
    ...collect(text, POOL_MEASUREMENT, "pool_metric", (m) => ({
      value: `${m[1].toLowerCase().replace(/\s+/g, " ")} connections = ${m[2]}`,
      source: m[0],
    })),
  );
  facts.push(
    ...collect(text, POOL_UTILIZATION, "pool_metric", (m) => ({
      value: `${m[1].trim().toLowerCase()} utilization = ${m[2]}${m[3] === "percent" ? "%" : m[3]}`,
      source: m[0],
    })),
  );
  facts.push(
    ...collect(text, THRESHOLD_EXCEEDED, "measurement", (m) => ({
      value: `${m[1].trim().toLowerCase()} exceeded threshold = ${m[2]}${m[3] ?? ""}`,
      source: m[0],
    })),
  );
  facts.push(
    ...collect(text, TIMEOUT_AFTER, "measurement", (m) => ({
      value: `${m[1].trim().toLowerCase()} timed out after ${m[2]}${m[3]}`,
      source: m[0],
    })),
  );
  facts.push(
    ...collect(text, FAILURE_SIGNAL, "failure_signal", (m) => ({
      value: m[1].trim(),
      source: m[0],
    })),
  );
  return facts;
}

/** Signals the parse found, reused to shape hypotheses and next checks. */
export interface SubmissionSignals {
  digests: string[];
  httpStatuses: string[];
  errorCodes: string[];
  exceptions: string[];
  timestamps: string[];
  components: string[];
  filePaths: string[];
  hasTimeout: boolean;
  hasRateLimit: boolean;
  hasRetry: boolean;
  /** The material states a database connection-pool failure. */
  hasDbPoolExhaustion: boolean;
  /** The material states an explicit failure signal (failed health check, etc.). */
  hasFailureSignal: boolean;
  claimsSuccess: boolean;
  reportsFailure: boolean;
}

export function extractSignals(text: string): SubmissionSignals {
  const digests = uniq([
    ...collect(text, SUI_DIGEST, "digest", (m) => ({ value: m[1], source: m[0] })).map(
      (f) => f.value,
    ),
    ...collect(text, HEX_TX, "digest", (m) => ({ value: m[1], source: m[0] })).map(
      (f) => f.value,
    ),
  ]);

  const httpStatuses = uniq([
    ...collect(text, HTTP_STATUS_WORDED, "http_status", (m) => ({
      value: m[1],
      source: m[0],
    })).map((f) => f.value),
    ...collect(text, HTTP_STATUS_LABELLED, "http_status", (m) => ({
      value: m[1],
      source: m[0],
    })).map((f) => f.value),
  ]);

  const errorCodes = uniq(extractErrorCodeFacts(text).map((f) => f.value));

  const exceptions = uniq(
    collect(text, EXCEPTION_TYPE, "exception", (m) => ({
      value: m[1],
      source: m[0],
    })).map((f) => f.value),
  );

  const timestamps = uniq(
    collect(text, ISO_TIMESTAMP, "timestamp", (m) => ({
      value: m[1],
      source: m[0],
    })).map((f) => f.value),
  );

  const components = uniq(
    collect(text, COMPONENT, "component", (m) => ({
      value: m[1],
      source: m[0],
    })).map((f) => f.value),
  );

  const filePaths = uniq(
    collect(text, FILE_PATH, "file", (m) => ({
      value: m[1],
      source: m[0],
    })).map((f) => f.value),
  );

  return {
    digests,
    httpStatuses,
    errorCodes,
    exceptions,
    timestamps,
    components,
    filePaths,
    hasTimeout: TIMEOUT.test(text),
    hasRateLimit: RATE_LIMIT.test(text),
    hasRetry: RETRY.test(text),
    hasDbPoolExhaustion: DB_POOL_EXHAUSTED.test(text),
    hasFailureSignal: FAILURE_SIGNAL.test(text),
    // An explicit attribution ("the agent reported success") is decisive: it
    // names a completion claim directly, even alongside failure language.
    claimsSuccess:
      EXPLICIT_SUCCESS_CLAIM.test(text) ||
      (SUCCESS_CLAIM.test(text) && !FAILURE_MARKER.test(text)),
    reportsFailure: FAILURE_MARKER.test(text),
  };
}

/** The reason a domain was inferred, stated for the reader. */
export interface DomainInference {
  domain: "finance" | "incident";
  reason: string;
}

/**
 * Decide which evidence adapter can actually be consulted.
 *
 * A Sui digest is the only signal here that names a source AFTERMATH can really
 * query (Tatum, read-only). Absent one, the submission stays in the `incident`
 * domain, whose adapter reports that no authoritative source is connected —
 * which is the truthful answer.
 */
export function inferDomain(
  signals: SubmissionSignals,
  service?: string,
): DomainInference {
  if (signals.digests.length > 0) {
    return {
      domain: "finance",
      reason:
        `The material contains a transaction-like digest (${signals.digests[0]}), ` +
        "which can be looked up against the Sui ledger through Tatum (read-only).",
    };
  }
  return {
    domain: "incident",
    reason: service
      ? `No authoritative source is named in the material (service: ${service}), ` +
        "so it is investigated as a generic incident with no connected system to consult."
      : "No authoritative source is named in the material, so it is investigated " +
        "as a generic incident with no connected system to consult.",
  };
}

/** Build the observed-evidence facts from the parse, each with its span. */
export function buildObservedEvidence(
  text: string,
  signals: SubmissionSignals,
): ExtractedFact[] {
  const facts: ExtractedFact[] = [
    ...cap(
      collect(text, HTTP_STATUS_WORDED, "http_status", (m) => ({
        value: `HTTP ${m[1]}`,
        source: m[0],
      })),
    ),
    ...cap(
      collect(text, HTTP_STATUS_LABELLED, "http_status", (m) => ({
        value: `HTTP ${m[1]}`,
        source: m[0],
      })),
    ),
    ...cap(extractErrorCodeFacts(text)),
    ...cap(extractMeasurementFacts(text)),
    ...cap(
      collect(text, EXCEPTION_TYPE, "exception", (m) => ({
        value: m[1],
        source: m[0],
      })),
    ),
    ...cap(
      collect(text, ISO_TIMESTAMP, "timestamp", (m) => ({
        value: m[1],
        source: m[0],
      })),
    ),
    ...cap(
      collect(text, STACK_FRAME, "stack_frame", (m) => ({
        value: `${m[1]} (${m[2]})`,
        source: m[0],
      })),
    ),
    ...cap(
      collect(text, COMPONENT, "component", (m) => ({
        value: m[1],
        source: m[0],
      })),
    ),
    ...cap(
      collect(text, FILE_PATH, "file", (m) => ({
        value: m[1],
        source: m[0],
      })),
    ),
  ];

  if (signals.hasDbPoolExhaustion) {
    const span = DB_POOL_EXHAUSTED.exec(text);
    facts.push({
      kind: "signal",
      value: "the material reports database connection pool exhaustion",
      source: span?.[0] ?? "connection pool exhausted",
    });
  }
  if (signals.hasTimeout) {
    const span = TIMEOUT.exec(text);
    facts.push({
      kind: "signal",
      value: "the material reports a timeout or exceeded deadline",
      source: span?.[0] ?? "timeout",
    });
  }
  if (signals.hasRateLimit) {
    const span = RATE_LIMIT.exec(text);
    facts.push({
      kind: "signal",
      value: "the material reports a rate limit or throttling",
      source: span?.[0] ?? "rate limit",
    });
  }
  if (signals.hasRetry) {
    const span = RETRY.exec(text);
    facts.push({
      kind: "signal",
      value: "the material indicates a retry or repeat attempt",
      source: span?.[0] ?? "retry",
    });
  }

  // Drop the noisiest near-duplicates (an exception type is also an error-code
  // candidate), keeping the first, most specific occurrence of each value.
  const seen = new Set<string>();
  return facts
    .filter((f) => {
      const key = f.value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 40);
}

/** Facts established by the input itself or a connected-system response. */
export function buildConfirmedFacts(input: {
  service?: string;
  expectedBehavior?: string;
  actualBehavior?: string;
  authoritativeLookup?: {
    attempted: boolean;
    verified: boolean;
    detail: string;
    evidenceReference: string;
    status: string;
  };
}): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  if (input.service) {
    facts.push({
      kind: "service",
      value: input.service,
      source: `service (supplied): ${input.service}`,
    });
  }
  if (input.expectedBehavior) {
    facts.push({
      kind: "expected_behavior",
      value: input.expectedBehavior,
      source: `expected behavior (supplied): ${input.expectedBehavior}`,
    });
  }
  if (input.actualBehavior) {
    facts.push({
      kind: "actual_behavior",
      value: input.actualBehavior,
      source: `actual behavior (supplied): ${input.actualBehavior}`,
    });
  }
  if (input.authoritativeLookup?.attempted && input.authoritativeLookup.verified) {
    facts.push({
      kind: "authoritative_lookup",
      value: `${input.authoritativeLookup.status} via ${input.authoritativeLookup.evidenceReference}`,
      source: input.authoritativeLookup.detail,
    });
  }
  return facts;
}

/** Hypotheses consistent with the signals. Each is explicitly unverified. */
export function buildHypotheses(signals: SubmissionSignals): string[] {
  const h: string[] = [];
  if (signals.hasDbPoolExhaustion) {
    h.push(
      "Database connections may not be released promptly after use, so the pool drains over time. The material does not show acquisition/release pairing, so this is a hypothesis, not a finding.",
    );
    h.push(
      "Concurrent request volume may exceed the pool's configured capacity, so requests queue for a connection. Whether concurrency was the cause is not established by the logs alone.",
    );
    h.push(
      "Slow or blocked database operations may hold connections for too long, keeping the pool saturated even at steady concurrency. Query latency during the incident is not in the material.",
    );
  }
  if (signals.hasRateLimit) {
    h.push(
      "A dependency applied a rate limit, so the request was throttled rather than genuinely refused.",
    );
  }
  if (signals.hasTimeout && !signals.hasDbPoolExhaustion) {
    h.push(
      "The operation exceeded a deadline before completing, so its true outcome is not yet known.",
    );
  }
  if (signals.hasFailureSignal) {
    h.push(
      "A health or readiness check failed, which indicates the dependency was not serving when the check ran; the check itself does not establish why.",
    );
  }
  if (signals.httpStatuses.some((s) => s.startsWith("5")) && !signals.hasDbPoolExhaustion) {
    h.push(
      "An upstream dependency returned a server error, which is a transport condition and not a verdict on the operation.",
    );
  }
  if (signals.httpStatuses.some((s) => s.startsWith("4"))) {
    h.push(
      "The request was rejected as invalid or unauthorised, which points at a request or credential defect rather than an outage.",
    );
  }
  if (signals.exceptions.length > 0) {
    h.push(
      `The raised ${signals.exceptions[0]} indicates a fault in the code path named by the stack, not necessarily in the reported outcome.`,
    );
  }
  if (signals.errorCodes.length > 0) {
    h.push(
      `The error code ${signals.errorCodes[0]} may identify a specific, documented failure mode that should be looked up in the dependency's own reference.`,
    );
  }
  if (signals.hasRetry) {
    h.push(
      "The operation was retried, so a partial write may already have landed and a blind retry could duplicate it.",
    );
  }
  if (h.length === 0) {
    h.push(
      "The material is not specific enough to propose a mechanism; the first step is to obtain the missing evidence named below.",
    );
  }
  return h;
}

/** Questions the material does not answer. */
export function buildUnknowns(
  signals: SubmissionSignals,
  hasExpected: boolean,
  hasActual: boolean,
): string[] {
  const u: string[] = [];
  if (signals.hasDbPoolExhaustion) {
    u.push(
      "Connection acquisition and release metrics: whether every acquired connection is released, and how many acquisitions are waiting.",
    );
    u.push(
      "Connection hold-time distribution: how long each connection is held, to distinguish a leak from slow queries.",
    );
    u.push(
      "Database query latency during the incident window, which would show whether connections are held by slow operations.",
    );
    u.push(
      "Request concurrency and the pool configuration (max size, acquire timeout), to test whether capacity was sufficient for the offered load.",
    );
    u.push(
      "Whether the saturation recurs under a controlled load, which is what would establish a repeatable cause.",
    );
  }
  if (signals.hasFailureSignal && !signals.hasDbPoolExhaustion) {
    u.push(
      "Why the health or readiness check failed: what the check exercises and what it observed at that moment.",
    );
  }
  if (signals.httpStatuses.some((s) => s.startsWith("5")) && !signals.hasDbPoolExhaustion) {
    u.push(
      "Which upstream component produced the server error, and whether the operation itself completed despite it.",
    );
  }
  if (!hasExpected) {
    u.push("What the correct outcome was expected to be.");
  }
  if (!hasActual) {
    u.push("What the operation actually did, as opposed to what was reported.");
  }
  if (signals.timestamps.length === 0) {
    u.push("When the incident occurred.");
  }
  if (signals.components.length === 0) {
    u.push("Which component or service is responsible.");
  }
  if (signals.digests.length === 0) {
    u.push(
      "Whether any authoritative, machine-checkable record of the operation exists (a transaction digest, a request id, a run id).",
    );
  }
  u.push(
    "Whether the same failure has occurred before, which would make it a recurrence rather than a first occurrence.",
  );
  return u;
}

/** Concrete checks that would distinguish the hypotheses. */
export function buildNextChecks(
  signals: SubmissionSignals,
  domain: string,
): string[] {
  const c: string[] = [];
  if (domain === "finance") {
    c.push(
      "Confirm the transaction digest against the Sui ledger (AFTERMATH performs this read-only lookup through Tatum).",
    );
  }
  if (signals.hasDbPoolExhaustion) {
    c.push(
      "Instrument connection acquisition, usage, and release, then replay the incident window to see whether connections are held past their work.",
    );
    c.push(
      "Alert on sustained pool saturation and on rising connection-acquisition latency, so the next occurrence is detected before requests time out.",
    );
    c.push(
      "Run a controlled concurrency test at documented load to determine whether the configured pool capacity is sufficient, and investigate a connection leak if instrumentation shows connections are not released.",
    );
  }
  if (signals.hasRateLimit) {
    c.push(
      "Re-issue the request after the dependency's stated retry interval and record whether it then succeeds; a rate limit must not be recorded as a failure.",
    );
  }
  if (signals.hasTimeout && !signals.hasDbPoolExhaustion) {
    c.push(
      "Re-run with a longer deadline, or fetch the operation's status by its id, before concluding anything about the outcome.",
    );
  }
  if (signals.errorCodes.length > 0) {
    c.push(
      `Look up ${signals.errorCodes[0]} in the dependency's documentation and record the exact condition it denotes.`,
    );
  }
  if (signals.exceptions.length > 0) {
    c.push(
      `Reproduce the failing path and capture the full stack for ${signals.exceptions[0]} together with the inputs that triggered it.`,
    );
  }
  c.push(
    "Capture the operation's own authoritative record (exit code, HTTP response, transaction status) so the next report is grounded in evidence rather than narration.",
  );
  return c;
}

/**
 * Map the extracted signals onto the shared failure-pattern vocabulary and
 * produce a diagnosis. The diagnosis is a hypothesis with a confidence, exactly
 * as in the controlled-scenario engine — never a verdict.
 */
export function diagnoseSubmission(input: {
  domain: "finance" | "incident";
  actionType: string;
  signals: SubmissionSignals;
  evidenceStatus: EvidenceAssessment["status"];
  authoritativeVerified: boolean;
  hasExpected: boolean;
  hasActual: boolean;
}): Diagnosis {
  const { signals, evidenceStatus } = input;
  const observedFacts = [
    `domain=${input.domain}`,
    `actionType=${input.actionType}`,
    `evidenceStatus=${evidenceStatus}`,
    "extraction=rule-based",
  ];
  if (signals.httpStatuses.length) {
    observedFacts.push(`httpStatus=${signals.httpStatuses.join(",")}`);
  }
  if (signals.errorCodes.length) {
    observedFacts.push(`errorCodes=${signals.errorCodes.join(",")}`);
  }
  if (signals.exceptions.length) {
    observedFacts.push(`exceptions=${signals.exceptions.join(",")}`);
  }
  if (signals.hasDbPoolExhaustion) observedFacts.push("dbPoolExhaustion=true");
  if (signals.hasTimeout) observedFacts.push("timeout=true");
  if (signals.hasRateLimit) observedFacts.push("rateLimited=true");
  if (signals.hasRetry) observedFacts.push("retried=true");

  const build = (
    pattern: FailurePattern,
    hypothesis: string,
    confidence: number,
    actionable: boolean,
    action: "BLOCK" | "REQUIRE_VERIFICATION",
    requiredEvidence = "an authoritative record of the operation's outcome",
  ): Diagnosis => {
    const base = {
      pattern,
      observedFacts,
      hypothesis,
      confidence,
      actionable,
    };
    if (!actionable) return InvestigationSchema.shape.diagnosis.parse(base);
    return InvestigationSchema.shape.diagnosis.parse({
      ...base,
      ruleSketch: {
        statement: hypothesis,
        applicability: `${input.domain}:${input.actionType}`,
        requiredEvidence,
        action:
          action === "BLOCK"
            ? "Allow a success claim only when the evidence is VERIFIED_SUCCESS; otherwise refuse it."
            : "Require authoritative verification before the outcome is accepted.",
      },
    });
  };

  // An authoritative source, when one was actually consulted, outranks the
  // material: it is the only thing that can establish the operation's outcome.
  if (evidenceStatus === "VERIFIED_SUCCESS") {
    return build(
      "incorrect_execution_state_assumption",
      "An authoritative source confirms the operation succeeded, so the reported " +
        "failure is not supported by evidence. No safeguard is warranted.",
      0.1,
      false,
      "REQUIRE_VERIFICATION",
    );
  }

  if (evidenceStatus === "VERIFIED_FAILURE") {
    return build(
      "missing_prerequisite",
      "An authoritative source confirms the operation failed. The most likely " +
        "cause is an unmet prerequisite, but the material does not yet name it.",
      0.75,
      true,
      "REQUIRE_VERIFICATION",
    );
  }

  // The agent's own completion claim, with nothing authoritative behind it.
  if (signals.claimsSuccess) {
    return build(
      "unsupported_completion_claim",
      "The material contains a success claim with no authoritative record behind " +
        "it, so the claim cannot stand.",
      0.85,
      true,
      "BLOCK",
    );
  }

  // A concrete mechanism named in the material outranks a generic transport
  // symptom. Connection-pool exhaustion is the strongest such signal: the
  // material states the mechanism, the measurements, and the failure, so a
  // timeout in the same text is a *symptom* of it, not a separate unknown. This
  // branch therefore precedes the timeout/rate-limit branch on purpose.
  if (signals.hasDbPoolExhaustion) {
    return build(
      "connection_pool_exhaustion",
      "The material reports the database connection pool as exhausted, with " +
        "connections held against a full pool and acquisitions timing out. The " +
        "mechanism is reported in the material; whether it was caused by " +
        "connections not being released, by excessive concurrency, or by slow " +
        "queries is not established by the logs alone and remains a hypothesis.",
      0.7,
      true,
      "REQUIRE_VERIFICATION",
      "connection acquisition/release instrumentation, pool-utilisation and " +
        "acquisition-latency measurements, and the pool configuration",
    );
  }

  // A rate limit, on its own, is missing evidence, never a verdict. This is the
  // single most important classification the product makes.
  if (signals.hasRateLimit) {
    return build(
      "evidence_unavailable",
      "The dependency did not answer because it applied a rate limit, so the " +
        "operation's true outcome is unknown. Recording this as a failure would " +
        "convert missing evidence into a verdict, which is exactly the mistake to avoid.",
      0.9,
      true,
      "REQUIRE_VERIFICATION",
    );
  }

  // A timeout with no stronger mechanism in the material is likewise missing
  // evidence: the operation may or may not have completed.
  if (signals.hasTimeout) {
    return build(
      "evidence_unavailable",
      "The operation timed out before a result was recorded, so its true outcome " +
        "is unknown. Recording this as a failure would convert missing evidence " +
        "into a verdict, which is exactly the mistake to avoid.",
      0.85,
      true,
      "REQUIRE_VERIFICATION",
    );
  }

  if (signals.hasRetry) {
    return build(
      "repeated_failed_operation",
      "The operation was retried after failing. Without an authoritative record " +
        "of each attempt, a partial write may already exist and a further retry " +
        "could duplicate it.",
      0.7,
      true,
      "BLOCK",
    );
  }

  if (signals.exceptions.length > 0 || signals.errorCodes.length > 0) {
    return build(
      "inadequate_verification",
      "A concrete fault was raised, but no authoritative record establishes the " +
        "operation's outcome, so the report cannot be turned into a verdict yet.",
      0.6,
      true,
      "REQUIRE_VERIFICATION",
    );
  }

  // A server-side HTTP status with no more specific mechanism named: the
  // upstream returned an error, which is a real dependency failure, but the
  // operation's own outcome still has to be established.
  if (signals.httpStatuses.some((s) => s.startsWith("5"))) {
    return build(
      "upstream_dependency_failure",
      "An upstream dependency returned a server error. That is a real failure of " +
        "the dependency, but it does not by itself establish whether this " +
        "operation completed, so its outcome still has to be verified.",
      0.55,
      true,
      "REQUIRE_VERIFICATION",
    );
  }

  return build(
    "evidence_unavailable",
    "No authoritative evidence was available, which establishes neither success " +
      "nor failure. The next step is to obtain that evidence.",
    0.5,
    false,
    "REQUIRE_VERIFICATION",
  );
}

/** A short, human restatement of the incident. */
export function summarise(
  text: string,
  signals: SubmissionSignals,
  service?: string,
): string {
  const firstLine =
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? text.trim();
  const clipped = firstLine.length > 200 ? `${firstLine.slice(0, 197)}…` : firstLine;
  const parts: string[] = [];
  if (service) parts.push(service);
  if (signals.httpStatuses.length) parts.push(`HTTP ${signals.httpStatuses[0]}`);
  if (signals.exceptions.length) parts.push(signals.exceptions[0]);
  else if (signals.errorCodes.length) parts.push(signals.errorCodes[0]);
  const prefix = parts.length ? `[${parts.join(" · ")}] ` : "";
  return `${prefix}${clipped}`;
}

/** Choose an action type string from the material's signals. */
export function inferActionType(signals: SubmissionSignals, domain: string): string {
  if (domain === "finance") return "verify_reported_transaction_outcome";
  if (signals.claimsSuccess) return "validate_reported_success";
  if (signals.hasRetry) return "repeat_failed_operation";
  return "investigate_reported_failure";
}

/**
 * The full rule-based investigation, before any authoritative lookup is added.
 * The lookup result is folded in by the caller so the adapter boundary stays
 * explicit and testable.
 */
export function investigateSubmission(input: {
  submission: {
    text: string;
    expectedBehavior?: string;
    actualBehavior?: string;
    service?: string;
  };
  authoritativeLookup: {
    attempted: boolean;
    verified: boolean;
    status: EvidenceAssessment["status"];
    detail: string;
    evidenceReference: string;
    source: string;
  };
}): Investigation {
  const { submission } = input;
  // Redact anything credential-shaped before it is stored, displayed, or sent
  // to memory. A pasted log frequently contains a token by accident.
  const text = redact(submission.text);
  const signals = extractSignals(text);

  const inference = inferDomain(signals, submission.service);
  const actionType = inferActionType(signals, inference.domain);

  const hasExpected = Boolean(submission.expectedBehavior);
  const hasActual = Boolean(submission.actualBehavior);

  const diagnosis = diagnoseSubmission({
    domain: inference.domain,
    actionType,
    signals,
    evidenceStatus: input.authoritativeLookup.status,
    authoritativeVerified: input.authoritativeLookup.verified,
    hasExpected,
    hasActual,
  });

  return InvestigationSchema.parse({
    extractionMethod: "rule-based",
    domain: inference.domain,
    domainReason: inference.reason,
    actionType,
    summary: summarise(text, signals, submission.service),
    categories: {
      observedEvidence: buildObservedEvidence(text, signals),
      confirmedFacts: buildConfirmedFacts({
        ...(submission.service ? { service: submission.service } : {}),
        ...(submission.expectedBehavior
          ? { expectedBehavior: submission.expectedBehavior }
          : {}),
        ...(submission.actualBehavior
          ? { actualBehavior: submission.actualBehavior }
          : {}),
        authoritativeLookup: input.authoritativeLookup,
      }),
      hypotheses: buildHypotheses(signals),
      unknowns: buildUnknowns(signals, hasExpected, hasActual),
      nextChecks: buildNextChecks(signals, inference.domain),
    },
    authoritativeLookup: {
      attempted: input.authoritativeLookup.attempted,
      source: input.authoritativeLookup.source,
      verified: input.authoritativeLookup.verified,
      status: input.authoritativeLookup.status,
      detail: input.authoritativeLookup.detail,
      evidenceReference: input.authoritativeLookup.evidenceReference,
    },
    diagnosis,
  });
}

/** Build the Incident record the shared pipeline primitives operate on. */
export function submissionToIncidentInput(input: {
  investigation: Investigation;
  executionId: string;
  intendedOutcome: string;
  signals: SubmissionSignals;
}): IncidentInputDraft {
  const { investigation, signals } = input;
  const evidenceReferences =
    investigation.domain === "finance" && signals.digests.length > 0
      ? [{ kind: "sui_tx_digest", ref: signals.digests[0] }]
      : [];
  return {
    domain: investigation.domain,
    actionType: investigation.actionType,
    executionId: input.executionId,
    intendedOutcome: input.intendedOutcome,
    ...(signals.claimsSuccess
      ? {
          claimedOutcome: {
            claim: "The material asserts the operation succeeded.",
            assertedStatus: "success" as const,
          },
        }
      : {}),
    evidenceReferences,
    relevantContext: { source: "user_submission" },
    provenance: "live",
  };
}
