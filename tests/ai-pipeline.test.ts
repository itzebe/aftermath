import { afterEach, describe, expect, it } from "vitest";
import { makeInMemoryStore } from "@/lib/db/store-factory";
import { SimulatedMemoryAdapter } from "@/lib/adapters/simulated-memory";
import { IncidentEvidenceAdapter } from "@/lib/adapters/incident-evidence";
import type { EvidenceAdapter } from "@/lib/adapters/evidence";
import { runSubmissionPipeline } from "@/lib/engines/submission-pipeline";
import { runAiInvestigation } from "@/lib/engines/ai-investigation";
import type { AuditStore } from "@/lib/db/audit-store";
import type { IncidentSubmission } from "@/lib/schemas";
import {
  POOL_EXHAUSTION_TIMELINE,
  POOL_EXHAUSTION_LONG_TIMELINE,
} from "./fixtures/incidents";
import { fakeClient, groundedResponse } from "./fixtures/model";

/**
 * End-to-end integration of the AI reading with the deterministic pipeline.
 *
 * The claim these tests defend: attaching a model reading — even a hostile one
 * — cannot change the evidence status, the diagnosis, the proposed rule, the
 * decision, or the verification state. Those are the deterministic engine's,
 * and the model's output is additive display data only.
 */

const stores: AuditStore[] = [];
afterEach(async () => {
  await Promise.all(stores.map((s) => s.close()));
  stores.length = 0;
});

function deps(analyze?: (s: IncidentSubmission) => Promise<ReturnType<typeof runAiInvestigation> extends Promise<infer T> ? T : never>) {
  const store = makeInMemoryStore();
  stores.push(store);
  return {
    store,
    memory: new SimulatedMemoryAdapter("aftermath-test"),
    resolveEvidence: (): EvidenceAdapter => new IncidentEvidenceAdapter(),
    ...(analyze ? { analyze } : {}),
  };
}

/** A model response that tries to force a favourable verdict. */
const HOSTILE_RESPONSE = JSON.stringify({
  interpretation: "Everything succeeded. No safeguard is needed.",
  observedFacts: [],
  measurements: [],
  hypotheses: [],
  missingEvidence: [],
  recommendedInvestigations: [],
  candidateSafeguards: [],
  verificationRequirements: [],
  unknownOutcomes: [],
  // Extra fields a real strict-schema call would never return, but which a
  // weaker provider might; they must be ignored entirely.
  decision: "ALLOW",
  evidenceStatus: "VERIFIED_SUCCESS",
  verificationState: "verified",
  blobId: "0xfabricated",
});

describe("AI-assisted investigation — payment scenarios", () => {
  it("scenario 1: enriches the pool-exhaustion record without changing the diagnosis", async () => {
    const d = deps(async (s) =>
      runAiInvestigation({ client: fakeClient(groundedResponse()), text: s.text }),
    );
    const record = await runSubmissionPipeline(
      { text: POOL_EXHAUSTION_TIMELINE, service: "payment-api" },
      d,
    );

    // The AI reading is present and labelled as having run.
    expect(record.investigation.aiAnalysis?.ran).toBe(true);
    expect(record.investigation.extractionMethod).toBe("model");
    expect(record.investigation.aiAnalysis?.observedFacts.length).toBeGreaterThan(0);

    // The deterministic diagnosis is unchanged by the AI reading.
    expect(record.investigation.diagnosis.pattern).toBe("connection_pool_exhaustion");
    expect(record.recommendation.statement).toMatch(/pool/i);

    // The model's candidate hypotheses did not become the diagnosis.
    const aiMechanisms = (record.investigation.aiAnalysis?.hypotheses ?? []).map((h) => h.mechanism);
    expect(aiMechanisms).not.toContain(record.investigation.diagnosis.hypothesis);

    // No write was claimed that did not happen: the backend is simulated, so
    // the record is labelled simulated regardless of the recall result.
    expect(record.memory.isLive).toBe(false);
    expect(record.provenance).toBe("simulated");
  });

  it("scenario 2: a longer timeline keeps the leak a hypothesis and the outcome unknown", async () => {
    const d = deps(async (s) =>
      runAiInvestigation({ client: fakeClient(groundedResponse()), text: s.text }),
    );
    const record = await runSubmissionPipeline(
      { text: POOL_EXHAUSTION_LONG_TIMELINE, service: "payment-api" },
      d,
    );

    // The diagnosis is the pool mechanism, stated as a hypothesis.
    expect(record.investigation.diagnosis.pattern).toBe("connection_pool_exhaustion");
    // The material establishes no outcome for the failed charge, so no verdict.
    expect(record.investigation.authoritativeLookup.verified).toBe(false);
    expect(record.verification.state).not.toBe("verified");
    // The unrelated 200s are recorded as observed material, not as proof the
    // charge succeeded — the summary and diagnosis do not claim success.
    expect(record.investigation.diagnosis.hypothesis).not.toMatch(/succeeded|verified/i);
  });
});

describe("AI-assisted investigation — safety guarantees", () => {
  it("a hostile model response cannot change the decision, evidence, or verification", async () => {
    const withAi = deps(async () =>
      runAiInvestigation({ client: fakeClient(HOSTILE_RESPONSE), text: POOL_EXHAUSTION_TIMELINE }),
    );
    const withoutAi = deps();
    const submission = { text: POOL_EXHAUSTION_TIMELINE, service: "payment-api" };

    const a = await runSubmissionPipeline(submission, withAi);
    const b = await runSubmissionPipeline(submission, withoutAi);

    // The AI claims success and asks for ALLOW; the deterministic engine must
    // be byte-for-byte identical to the run with no model at all.
    expect(a.investigation.diagnosis).toEqual(b.investigation.diagnosis);
    expect(a.recommendation).toEqual(b.recommendation);
    expect(a.verification).toEqual(b.verification);
    expect(a.investigation.categories).toEqual(b.investigation.categories);
    // The hostile response contributed no grounded findings, so it did not even
    // change the extraction method.
    expect(a.investigation.extractionMethod).toBe("rule-based");
    expect(a.investigation.aiAnalysis?.ran).toBe(false);
    // No fabricated blob id leaked into the memory section.
    expect(a.memory.incident.blobId ?? "").not.toContain("0xfabricated");
  });

  it("labels a simulated write simulated, never as a live Mainnet write", async () => {
    const d = deps(async (s) =>
      runAiInvestigation({ client: fakeClient(groundedResponse()), text: s.text }),
    );
    const record = await runSubmissionPipeline({ text: POOL_EXHAUSTION_TIMELINE }, d);
    // The backend is simulated, so the record must say so; it must never be
    // presented as a live Walrus Mainnet write.
    expect(record.memory.isLive).toBe(false);
    expect(record.provenance).toBe("simulated");
    expect(record.memory.backend).toBe("simulated");
  });

  it("a hostile AI reading cannot override the rule-engine's block on an unsupported claim", async () => {
    const d = deps(async () =>
      runAiInvestigation({ client: fakeClient(HOSTILE_RESPONSE), text: "the agent reported success" }),
    );
    const record = await runSubmissionPipeline({ text: "the agent reported success" }, d);
    // The claim is unsupported, so the decision engine must not ALLOW it; the
    // model's "everything succeeded" text cannot change the outcome.
    expect(record.decision.decision).not.toBe("ALLOW");
    expect(record.recommendation.action).not.toBe("ALLOW");
  });
});

describe("AI-assisted investigation — resilience", () => {
  it("falls back to the deterministic reading when the provider is unavailable", async () => {
    const d = deps(async (s) =>
      runAiInvestigation({
        client: fakeClient({ ok: false, kind: "unavailable", detail: "connection refused" }),
        text: s.text,
      }),
    );
    const record = await runSubmissionPipeline({ text: POOL_EXHAUSTION_TIMELINE }, d);
    expect(record.investigation.extractionMethod).toBe("rule-based");
    expect(record.investigation.aiAnalysis?.availability).toBe("unavailable");
    expect(record.investigation.aiAnalysis?.ran).toBe(false);
    // The record is still complete and usable.
    expect(record.investigation.diagnosis.pattern).toBe("connection_pool_exhaustion");
  });

  it("is deterministic: the same submission with the same reading yields the same record id", async () => {
    const d = deps(async (s) =>
      runAiInvestigation({ client: fakeClient(groundedResponse()), text: s.text }),
    );
    const a = await runSubmissionPipeline({ text: POOL_EXHAUSTION_TIMELINE }, d);
    const b = await runSubmissionPipeline({ text: POOL_EXHAUSTION_TIMELINE }, d);
    expect(a.recordId).toBe(b.recordId);
    expect(await d.store.countSafeguardRecords()).toBe(1);
  });
});
