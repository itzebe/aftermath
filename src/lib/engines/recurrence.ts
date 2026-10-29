/**
 * Recurrence criteria for recalled memory.
 *
 * Semantic similarity is a *retrieval* signal: it decides which prior records
 * are worth showing. It is not proof that the same failure happened again. The
 * vector distance the relayer returns is not a calibrated probability and must
 * never be treated as one, so this module never turns a distance into a
 * confidence figure.
 *
 * The criteria below are the *documented* conditions under which AFTERMATH is
 * willing to say "confirmed recurrence". They are deliberately strict, and they
 * are implemented here — in one place, covered by tests — rather than inferred
 * at each call site.
 *
 * ── Confirmed recurrence ───────────────────────────────────────────────────
 * A recalled record is a confirmed recurrence of the current incident only when
 * all of the following hold:
 *
 *   1. It parses as a structured corrective lesson (so its fields are real, not
 *      guessed from free text).
 *   2. Its `domain` equals the current incident's domain.
 *   3. Its `failure_pattern` equals the current diagnosis's pattern — an exact,
 *      structured classification match, not a fuzzy one.
 *   4. The current incident carries an authoritative evidence reference (a
 *      traceable, machine-checkable pointer), so the match is anchored to a
 *      real record on both sides rather than to prose alone.
 *
 * Anything weaker is a `candidate_pattern_match` (compatible classification,
 * not enough to claim a recurrence) or a `possible_similarity` (retrieved, but
 * not even a compatible pattern). The label is always accompanied by a
 * `matchBasis` string stating what was compared, so a reader can audit it.
 */

import type { CorrectiveLessonRecord } from "@/lib/schemas";

export interface RecurrenceInput {
  /** The structured lesson recalled, when the memory text parsed as one. */
  record?: Pick<
    CorrectiveLessonRecord,
    "domain" | "failure_pattern" | "incident_id" | "evidence_reference"
  >;
  /** The current incident's inferred domain. */
  domain: string;
  /** The current incident's diagnosed failure pattern. */
  pattern: string;
  /**
   * Whether the current incident carries an authoritative, machine-checkable
   * evidence reference (for example a Sui digest). This is what makes the
   * current side of the match traceable.
   */
  hasAuthoritativeReference: boolean;
}

export type RecurrenceRelation =
  | "retrieved"
  | "possible_similarity"
  | "candidate_pattern_match"
  | "confirmed_recurrence";

export interface RecurrenceVerdict {
  relation: RecurrenceRelation;
  recurrenceEstablished: boolean;
  /** Human statement of what was compared and why the label follows. */
  basis: string;
}

/** Apply the documented recurrence criteria and explain the result. */
export function classifyRecurrence(input: RecurrenceInput): RecurrenceVerdict {
  const { record, domain, pattern, hasAuthoritativeReference } = input;

  if (!record) {
    return {
      relation: "possible_similarity",
      recurrenceEstablished: false,
      basis:
        "The retrieved memory did not parse as a structured lesson, so only its " +
        "text similarity is known. Similarity alone establishes no recurrence.",
    };
  }

  const sameDomain = record.domain === domain;
  const samePattern = record.failure_pattern === pattern;

  if (!sameDomain || !samePattern) {
    return {
      relation: "possible_similarity",
      recurrenceEstablished: false,
      basis:
        `Compared domain (${record.domain ?? "unknown"} vs ${domain}) and failure ` +
        `pattern (${record.failure_pattern ?? "unknown"} vs ${pattern}); they do not ` +
        "both match, so this is a similarity, not a recurrence.",
    };
  }

  // Same domain and same structured pattern: a compatible classification.
  if (!hasAuthoritativeReference) {
    return {
      relation: "candidate_pattern_match",
      recurrenceEstablished: false,
      basis:
        `Domain and failure pattern (${pattern}) match, but the current incident ` +
        "carries no authoritative evidence reference, so the match rests on " +
        "similarity rather than on traceable evidence. Recurrence is not established.",
    };
  }

  return {
    relation: "confirmed_recurrence",
    recurrenceEstablished: true,
    basis:
      `Domain and failure pattern (${pattern}) match exactly, and the current ` +
      "incident carries an authoritative evidence reference, so the documented " +
      "recurrence criteria are satisfied. The prior record's incident id is " +
      `${record.incident_id ?? "unknown"}.`,
  };
}

/**
 * Deduplicate recalled records for display.
 *
 * The relayer can return several memories from the same incident (an incident
 * write and a lesson write), or the same underlying pattern more than once.
 * Deduplicating on the stable lesson identity — originating incident id plus
 * failure pattern — keeps one representative per incident+pattern without
 * deleting or altering anything: this is a *view* over what was returned, not a
 * change to stored memory.
 */
export function dedupeRecalled<
  T extends { incidentId?: string; patternKey?: string; blobId: string },
>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    // Fall back to the blob id when a stable identity is unavailable, so a
    // record is never dropped merely because its lesson did not parse.
    const key =
      item.incidentId && item.patternKey
        ? `${item.incidentId}::${item.patternKey}`
        : `blob::${item.blobId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
