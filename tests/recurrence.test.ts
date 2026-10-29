import { describe, expect, it } from "vitest";
import { classifyRecurrence, dedupeRecalled } from "@/lib/engines/recurrence";
import type { CorrectiveLessonRecord } from "@/lib/schemas";

type LessonKey = Pick<
  CorrectiveLessonRecord,
  "domain" | "failure_pattern" | "incident_id" | "evidence_reference"
>;

const lesson = (over: Partial<LessonKey> = {}): LessonKey => ({
  domain: "incident",
  failure_pattern: "connection_pool_exhaustion",
  incident_id: "inc-prior-1",
  evidence_reference: "ref:prior",
  ...over,
});

/**
 * Regression: a semantically similar recalled record must not be labelled a
 * confirmed recurrence. Only the documented criteria — a parsed lesson, an
 * exact domain and pattern match, and a traceable evidence reference on the
 * current incident — establish recurrence. Similarity alone never does.
 */
describe("recurrence criteria", () => {
  it("never confirms recurrence for an unparsed memory", () => {
    const v = classifyRecurrence({
      domain: "incident",
      pattern: "connection_pool_exhaustion",
      hasAuthoritativeReference: true,
    });
    expect(v.relation).toBe("possible_similarity");
    expect(v.recurrenceEstablished).toBe(false);
  });

  it("does not confirm recurrence when only the pattern matches", () => {
    const v = classifyRecurrence({
      record: lesson({ domain: "finance" }),
      domain: "incident",
      pattern: "connection_pool_exhaustion",
      hasAuthoritativeReference: true,
    });
    expect(v.relation).toBe("possible_similarity");
    expect(v.recurrenceEstablished).toBe(false);
  });

  it("does not confirm recurrence when only the domain matches", () => {
    const v = classifyRecurrence({
      record: lesson({ failure_pattern: "evidence_unavailable" }),
      domain: "incident",
      pattern: "connection_pool_exhaustion",
      hasAuthoritativeReference: true,
    });
    expect(v.relation).toBe("possible_similarity");
    expect(v.recurrenceEstablished).toBe(false);
  });

  it("labels a same-domain same-pattern match without evidence as a candidate, not a recurrence", () => {
    const v = classifyRecurrence({
      record: lesson(),
      domain: "incident",
      pattern: "connection_pool_exhaustion",
      hasAuthoritativeReference: false,
    });
    expect(v.relation).toBe("candidate_pattern_match");
    expect(v.recurrenceEstablished).toBe(false);
    expect(v.basis).toMatch(/not established/i);
  });

  it("confirms recurrence only when every documented criterion holds", () => {
    const v = classifyRecurrence({
      record: lesson(),
      domain: "incident",
      pattern: "connection_pool_exhaustion",
      hasAuthoritativeReference: true,
    });
    expect(v.relation).toBe("confirmed_recurrence");
    expect(v.recurrenceEstablished).toBe(true);
    expect(v.basis).toMatch(/inc-prior-1/);
  });

  it("always explains what was compared", () => {
    for (const hasRef of [true, false]) {
      const v = classifyRecurrence({
        record: lesson(),
        domain: "incident",
        pattern: "connection_pool_exhaustion",
        hasAuthoritativeReference: hasRef,
      });
      expect(v.basis.length).toBeGreaterThan(0);
    }
  });
});

describe("recalled-record deduplication", () => {
  it("keeps one representative per incident+pattern", () => {
    const items = [
      { blobId: "b1", incidentId: "inc-1", patternKey: "p" },
      { blobId: "b2", incidentId: "inc-1", patternKey: "p" },
      { blobId: "b3", incidentId: "inc-2", patternKey: "p" },
    ];
    const out = dedupeRecalled(items);
    expect(out.map((i) => i.blobId)).toEqual(["b1", "b3"]);
  });

  it("never drops an unparsed record, falling back to its blob id", () => {
    const items = [
      { blobId: "b1" },
      { blobId: "b2" },
      { blobId: "b1" },
    ];
    const out = dedupeRecalled(items);
    expect(out.map((i) => i.blobId)).toEqual(["b1", "b2"]);
  });
});
