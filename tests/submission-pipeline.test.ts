import { afterEach, describe, expect, it } from "vitest";
import { makeInMemoryStore } from "@/lib/db/store-factory";
import { SimulatedMemoryAdapter } from "@/lib/adapters/simulated-memory";
import { IncidentEvidenceAdapter } from "@/lib/adapters/incident-evidence";
import type { EvidenceAdapter } from "@/lib/adapters/evidence";
import {
  runSubmissionPipeline,
  submissionId,
} from "@/lib/engines/submission-pipeline";
import type { AuditStore } from "@/lib/db/audit-store";

const stores: AuditStore[] = [];
afterEach(async () => {
  await Promise.all(stores.map((s) => s.close()));
  stores.length = 0;
});

function deps() {
  const store = makeInMemoryStore();
  stores.push(store);
  return {
    store,
    memory: new SimulatedMemoryAdapter("aftermath-test"),
    resolveEvidence: (domain: "finance" | "incident"): EvidenceAdapter =>
      domain === "finance"
        ? // A stand-in finance adapter would need Tatum; the pipeline test uses
          // the honest no-source adapter for both domains.
          new IncidentEvidenceAdapter()
        : new IncidentEvidenceAdapter(),
  };
}

const INCIDENT = `2026-03-01T10:00:00Z ERROR checkout-service
POST /v1/charge returned 503 Service Unavailable after retry (attempt 2/3)
the agent reported success`;

describe("submission pipeline", () => {
  it("produces a Safeguard Record that validates against its schema", async () => {
    const d = deps();
    const record = await runSubmissionPipeline({ text: INCIDENT }, d);
    expect(record.recordId).toBe(submissionId({ text: INCIDENT }));
    expect(record.investigation.extractionMethod).toBe("rule-based");
    expect(record.investigation.domain).toBe("incident");
    expect(record.submission.text).toBe(INCIDENT);
  });

  it("is idempotent: the same content yields the same record id", async () => {
    const d = deps();
    const a = await runSubmissionPipeline({ text: INCIDENT }, d);
    const b = await runSubmissionPipeline({ text: INCIDENT }, d);
    expect(a.recordId).toBe(b.recordId);
    // And a retry upserts rather than appending a duplicate row.
    expect(await d.store.countSafeguardRecords()).toBe(1);
  });

  it("honours a caller-supplied idempotency key", async () => {
    const d = deps();
    const a = await runSubmissionPipeline(
      { text: "first material", idempotencyKey: "k-1" },
      d,
    );
    const b = await runSubmissionPipeline(
      { text: "totally different material", idempotencyKey: "k-1" },
      d,
    );
    expect(a.recordId).toBe(b.recordId);
  });

  it("never claims a safeguard is verified from a single submission", async () => {
    const d = deps();
    const record = await runSubmissionPipeline({ text: INCIDENT }, d);
    // The rule was genuinely tested against the decision engine...
    expect(record.verification.testExecuted).toBe(true);
    expect(record.verification.state).toBe("test_executed");
    // ...but a single incident can never demonstrate that a repeat was prevented.
    expect(record.verification.state).not.toBe("verified");
  });

  it("persists a submitted rule as proposed, never active", async () => {
    const d = deps();
    const record = await runSubmissionPipeline({ text: INCIDENT }, d);
    expect(record.proposedRule).not.toBeNull();
    expect(record.proposedRule?.validationStatus).toBe("proposed");
    expect(record.activatedRule).toBeNull();
    // The rule is stored, but it must not be enforcing anything yet.
    expect(await d.store.listActiveRules()).toHaveLength(0);
  });

  it("labels the record simulated when the memory backend is simulated", async () => {
    const d = deps();
    const record = await runSubmissionPipeline({ text: INCIDENT }, d);
    expect(record.memory.isLive).toBe(false);
    expect(record.memory.backend).toBe("simulated");
    expect(record.provenance).toBe("simulated");
  });

  it("does not recall anything for a first occurrence", async () => {
    const d = deps();
    const record = await runSubmissionPipeline({ text: INCIDENT }, d);
    expect(record.recalledMemories).toHaveLength(0);
  });

  it("classifies a rate-limited submission as missing evidence, not failure", async () => {
    const d = deps();
    const record = await runSubmissionPipeline(
      { text: "2026-03-01T10:00:00Z ERROR api returned 429 Too Many Requests" },
      d,
    );
    expect(record.investigation.diagnosis.pattern).toBe("evidence_unavailable");
    // A missing answer must not become a decision that the action failed.
    expect(record.decision.decision).not.toBe("ALLOW");
  });

  it("stores the record so it can be listed and fetched by id", async () => {
    const d = deps();
    const record = await runSubmissionPipeline({ text: INCIDENT }, d);
    const listed = await d.store.listSafeguardRecords();
    expect(listed.map((r) => r.recordId)).toContain(record.recordId);
    const fetched = await d.store.getSafeguardRecord(record.recordId);
    expect(fetched?.recordId).toBe(record.recordId);
  });

  it("counts records in the aggregate counts", async () => {
    const d = deps();
    await runSubmissionPipeline({ text: INCIDENT }, d);
    const counts = await d.store.counts();
    expect(counts.records).toBe(1);
  });
});
