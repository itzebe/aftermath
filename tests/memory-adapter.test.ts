import { describe, expect, it } from "vitest";
import { SimulatedMemoryAdapter } from "@/lib/adapters/simulated-memory";
import {
  incidentToMemoryText,
  lessonToMemoryText,
  parseLessonFromMemoryText,
} from "@/lib/adapters/memory";
import { CorrectiveLessonRecordSchema, IncidentSchema } from "@/lib/schemas";

function lesson(overrides: Record<string, unknown> = {}) {
  return CorrectiveLessonRecordSchema.parse({
    type: "corrective_lesson",
    domain: "finance",
    failure_pattern: "unsupported_completion_claim",
    observation: "claimed success without evidence",
    verified_evidence: "lookup returned UNKNOWN",
    corrective_rule: "Require authoritative verification before reporting success.",
    scope: "sui_transaction_status",
    validation_status: "validated",
    rule_version: 1,
    incident_id: "inc-1",
    evidence_reference: "sui:tx:abc",
    created_at: new Date().toISOString(),
    provenance: "simulated",
    ...overrides,
  });
}

describe("memory text format", () => {
  it("round-trips a lesson through the memory text form", () => {
    const l = lesson();
    const text = lessonToMemoryText(l);
    const parsed = parseLessonFromMemoryText(text);
    expect(parsed).toEqual(l);
  });

  it("returns undefined for non-lesson text", () => {
    expect(parseLessonFromMemoryText("just some prose")).toBeUndefined();
  });

  it("returns undefined for JSON that is not a corrective lesson", () => {
    expect(parseLessonFromMemoryText('{"type":"something_else"}')).toBeUndefined();
  });

  it("never records the lesson as proof of the event", () => {
    const l = lesson();
    const parsed = parseLessonFromMemoryText(lessonToMemoryText(l))!;
    // The record carries a pointer to the evidence; it is not the evidence.
    expect(parsed.evidence_reference).toBe("sui:tx:abc");
    expect(Object.keys(parsed)).not.toContain("verified");
  });

  it("includes incident evidence references in the incident text", () => {
    const incident = IncidentSchema.parse({
      domain: "coding",
      actionType: "report_bug_fixed",
      executionId: "e1",
      intendedOutcome: "fix bug",
      evidenceReferences: [{ kind: "test_run", ref: "calc.test.js" }],
      relevantContext: {},
      provenance: "simulated",
      incidentId: "i1",
      createdAt: new Date().toISOString(),
      currentStatus: "open",
    });
    const text = incidentToMemoryText(incident);
    expect(text).toContain("test_run:calc.test.js");
    expect(text).toContain('"type":"incident_record"');
  });
});

describe("SimulatedMemoryAdapter", () => {
  it("is explicitly labelled as simulated", () => {
    const adapter = new SimulatedMemoryAdapter();
    expect(adapter.isLive).toBe(false);
    expect(adapter.provenance).toBe("simulated");
    expect(adapter.backend).toBe("simulated");
  });

  it("completes a lesson write and returns a blob id", async () => {
    const adapter = new SimulatedMemoryAdapter();
    const receipt = await adapter.rememberLesson(lesson());
    expect(receipt.state).toBe("completed");
    expect(receipt.blobId).toBeTruthy();
    expect(receipt.provenance).toBe("simulated");
  });

  it("confirms the write is retrievable by recall", async () => {
    const adapter = new SimulatedMemoryAdapter();
    const receipt = await adapter.rememberLesson(lesson());
    expect(receipt.recallVerified).toBe(true);
  });

  it("recalls a stored lesson with a parsed record", async () => {
    const adapter = new SimulatedMemoryAdapter();
    await adapter.rememberLesson(lesson());
    const hits = await adapter.recallRelevantLessons(
      "Require authoritative verification before reporting success",
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].record?.type).toBe("corrective_lesson");
    expect(hits[0].provenance).toBe("simulated");
  });

  it("never returns an empty blob id for a completed write", async () => {
    const adapter = new SimulatedMemoryAdapter();
    const receipt = await adapter.rememberIncident(
      IncidentSchema.parse({
        domain: "workflow",
        actionType: "publish_artifact",
        executionId: "e",
        intendedOutcome: "publish",
        evidenceReferences: [],
        relevantContext: {},
        provenance: "simulated",
        incidentId: "i",
        createdAt: new Date().toISOString(),
        currentStatus: "open",
      }),
    );
    expect(receipt.state).toBe("completed");
    expect(receipt.blobId).not.toBe("");
  });
});
