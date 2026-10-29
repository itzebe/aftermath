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
import { POOL_EXHAUSTION_INCIDENT } from "./fixtures/incidents";

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

/**
 * Regression, end to end: a connection-pool incident is reasoned from its own
 * evidence and produces a pool-specific safeguard, not the generic
 * "unknown outcome" recommendation.
 */
describe("submission pipeline — connection-pool incident", () => {
  it("classifies and safeguards the reported mechanism", async () => {
    const d = deps();
    const record = await runSubmissionPipeline(
      { text: POOL_EXHAUSTION_INCIDENT, service: "payment-api" },
      d,
    );
    expect(record.investigation.diagnosis.pattern).toBe("connection_pool_exhaustion");
    // The safeguard names the pool mechanism, not the generic fallback.
    expect(record.recommendation.statement).toMatch(/pool/i);
    expect(record.recommendation.successCriteria).toMatch(/utilization|utilisation|threshold/i);
    expect(record.recommendation.testPlan.join(" ")).toMatch(/pool|acquisition/i);
  });

  it("does not record a verdict from material that establishes no outcome", async () => {
    const d = deps();
    const record = await runSubmissionPipeline(
      { text: POOL_EXHAUSTION_INCIDENT },
      d,
    );
    // No authoritative source answered, so the outcome is not established and
    // no success claim may be allowed to stand.
    expect(record.decision.decision).not.toBe("ALLOW");
    expect(record.verification.state).not.toBe("verified");
  });

  it("does not confirm a recurrence from a merely similar first occurrence", async () => {
    const d = deps();
    const record = await runSubmissionPipeline(
      { text: POOL_EXHAUSTION_INCIDENT },
      d,
    );
    for (const m of record.recalledMemories) {
      expect(m.relation).not.toBe("confirmed_recurrence");
      expect(m.recurrenceEstablished).toBe(false);
      expect(m.matchBasis).toBeTruthy();
    }
  });

  it("labels a seeded, same-pattern prior record as a candidate match, not a recurrence", async () => {
    const d = deps();
    // Seed a prior lesson that shares the domain and pattern. An incident-domain
    // submission carries no authoritative evidence reference, so the documented
    // recurrence criteria are NOT met and the record must not be labelled a
    // confirmed recurrence.
    await d.memory.rememberLesson({
      type: "corrective_lesson",
      domain: "incident",
      failure_pattern: "connection_pool_exhaustion",
      observation: "pool exhausted under load",
      verified_evidence: "prior incident, no authoritative record",
      corrective_rule: "Instrument connection acquisition and release.",
      scope: "incident:investigate_reported_failure",
      validation_status: "proposed",
      rule_version: 1,
      incident_id: "inc-prior",
      evidence_reference: "none",
      created_at: new Date().toISOString(),
      provenance: "simulated",
    });

    const record = await runSubmissionPipeline(
      { text: POOL_EXHAUSTION_INCIDENT, service: "payment-api" },
      d,
    );
    expect(record.recalledMemories.length).toBeGreaterThan(0);
    const poolMatch = record.recalledMemories.find(
      (m) => m.failurePattern === "connection_pool_exhaustion",
    );
    expect(poolMatch).toBeDefined();
    expect(poolMatch!.relation).toBe("candidate_pattern_match");
    expect(poolMatch!.recurrenceEstablished).toBe(false);
    expect(poolMatch!.matchBasis).toMatch(/not established/i);
    // A simulated recall must not be presented as a live Mainnet recall.
    expect(poolMatch!.provenance).toBe("simulated");
  });
});
