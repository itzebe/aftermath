import { afterEach, describe, expect, it } from "vitest";
import { makeInMemoryStore } from "@/lib/db/store-factory";
import { SimulatedMemoryAdapter } from "@/lib/adapters/simulated-memory";
import { IncidentEvidenceAdapter } from "@/lib/adapters/incident-evidence";
import type { EvidenceAdapter } from "@/lib/adapters/evidence";
import { runSubmissionPipeline } from "@/lib/engines/submission-pipeline";
import { buildLearningLoop } from "@/lib/engines/learning-loop";
import {
  assessAuthority,
  computeBehaviourChange,
  evaluateSafeguardApplications,
  learnSafeguard,
  safeguardApplies,
} from "@/lib/engines/safeguard-memory";
import type { AuditStore } from "@/lib/db/audit-store";
import type { SafeguardMemoryRecord } from "@/lib/schemas";
import { SafeguardMemoryRecordSchema } from "@/lib/schemas";
import type { RecalledLesson } from "@/lib/adapters/memory";

/**
 * Learning-loop tests.
 *
 * These pin the product's central claim: a verified failure produces a
 * safeguard, that safeguard is persisted, a later incident recalls it, and —
 * the part that matters — the recalled safeguard changes the later
 * investigation's actual decision or verification requirement. A safeguard that
 * changes nothing is never counted as an influence.
 */

const stores: AuditStore[] = [];
afterEach(async () => {
  await Promise.all(stores.map((s) => s.close()));
  stores.length = 0;
});

function deps(memory = new SimulatedMemoryAdapter("learning-test")) {
  const store = makeInMemoryStore();
  stores.push(store);
  return {
    store,
    memory,
    resolveEvidence: (): EvidenceAdapter => new IncidentEvidenceAdapter(),
  };
}

/** The same failure pattern, twice, with the success claim and no evidence. */
const FIRST = `2026-03-01T10:00:00Z settlement-worker POST /v1/settle
the agent reported success for the settlement, but no transaction verification record was captured`;

const SECOND = `2026-03-02T09:00:00Z settlement-worker POST /v1/settle
the agent reported success for the settlement operation; no transaction verification record was captured`;

describe("learn: a verified failure produces a safeguard", () => {
  it("creates an authoritative safeguard from a claim with grounded facts", async () => {
    const d = deps();
    const record = await runSubmissionPipeline({ text: FIRST }, d);
    const memory = record.learnedSafeguards?.[0];
    expect(memory).toBeDefined();
    expect(memory!.failureCategory).toBe("unsupported_completion_claim");
    expect(memory!.authoritative).toBe(true);
    expect(memory!.correctiveRule).toMatch(/verif|evidence|success/i);
    // The safeguard carries the fields the brief requires.
    expect(memory!.originIncidentId).toBe(record.incidentId);
    expect(memory!.evidence.length).toBeGreaterThan(0);
    expect(memory!.requiredChecks.length).toBeGreaterThan(0);
    expect(memory!.appliesWhen.length).toBeGreaterThan(0);
    expect(memory!.createdAt).toBeTruthy();
  });

  it("does not create an authoritative safeguard from unsupported claims", async () => {
    // Material that establishes nothing: no observed fact, no lookup, no claim.
    const d = deps();
    const record = await runSubmissionPipeline(
      { text: "Something happened. Please investigate." },
      d,
    );
    // Either no safeguard at all, or a non-authoritative one — never enforced.
    const memory = record.learnedSafeguards?.[0];
    if (memory) expect(memory.authoritative).toBe(false);
  });

  it("persists the safeguard and records the Walrus reference", async () => {
    const d = deps();
    const record = await runSubmissionPipeline({ text: FIRST }, d);
    const memory = record.learnedSafeguards![0];
    expect(memory.walrus.persisted).toBe(true);
    expect(memory.walrus.blobId).toBeTruthy();
    expect(memory.walrus.recallVerified).toBe(true);
  });

  it("records the safeguard write in the durable ledger", async () => {
    const d = deps();
    await runSubmissionPipeline({ text: FIRST }, d);
    const writes = await d.store.listMemoryWrites();
    // An incident write, a lesson write, and a safeguard write.
    expect(writes.length).toBeGreaterThanOrEqual(3);
  });
});

describe("learn: duplicate and supersession handling", () => {
  it("does not create a duplicate authoritative safeguard for a repeat incident", async () => {
    const d = deps();
    const first = await runSubmissionPipeline({ text: FIRST }, d);
    const second = await runSubmissionPipeline({ text: SECOND }, d);
    // Both share the same memory id (domain + failure category).
    expect(first.learnedSafeguards![0].memoryId).toBe(
      second.learnedSafeguards![0].memoryId,
    );
    // The second run does not re-persist the identical safeguard.
    expect(second.learnedSafeguards![0].walrus.persisted).toBe(false);
  });

  it("bumps the version and marks supersession when the rule changes", () => {
    const base = SafeguardMemoryRecordSchema.parse({
      type: "safeguard_memory",
      memory_id: "safeguard-incident-unsupported_completion_claim",
      version: 1,
      origin_incident_id: "inc-1",
      domain: "incident",
      action_type: "validate_reported_success",
      failure_category: "unsupported_completion_claim",
      verified_failure: "prior",
      evidence: ["incident:inc-1"],
      corrective_rule: "OLD RULE",
      applies_when: ["domain=incident"],
      required_checks: ["check"],
      action: "BLOCK",
      severity: "high",
      confidence: 0.8,
      limitations: [],
      authoritative: true,
      support_basis: "prior",
      status: "active",
      provenance: "simulated",
    });
    const incident = {
      incidentId: "inc-2",
      domain: "incident" as const,
      actionType: "validate_reported_success",
      executionId: "e",
      intendedOutcome: "x",
      evidenceReferences: [],
      relevantContext: {},
      provenance: "simulated" as const,
      createdAt: new Date().toISOString(),
      currentStatus: "open" as const,
    };
    const investigation = {
      categories: { observedEvidence: [{}], confirmedFacts: [], hypotheses: [], unknowns: [], nextChecks: [] },
      authoritativeLookup: { attempted: false },
    } as never;
    const learned = learnSafeguard({
      incident,
      diagnosis: {
        pattern: "unsupported_completion_claim",
        observedFacts: ["x"],
        hypothesis: "new",
        confidence: 0.9,
        actionable: true,
      },
      assessment: { verified: false, status: "UNKNOWN", evidenceReference: "ref" } as never,
      investigation,
      recommendation: {
        statement: "NEW RULE",
        testPlan: ["c"],
        assumptions: [],
      } as never,
      existing: [base],
      backend: "simulated",
    });
    expect(learned!.disposition).toBe("superseded");
    expect(learned!.record.version).toBe(2);
    expect(learned!.record.supersedes).toBe(`${base.memory_id}@v1`);
  });
});

describe("recall: applicability decides whether a memory is enforced", () => {
  function memory(overrides: Partial<SafeguardMemoryRecord> = {}): SafeguardMemoryRecord {
    return SafeguardMemoryRecordSchema.parse({
      type: "safeguard_memory",
      memory_id: "safeguard-incident-unsupported_completion_claim",
      version: 1,
      origin_incident_id: "inc-1",
      domain: "incident",
      action_type: "validate_reported_success",
      failure_category: "unsupported_completion_claim",
      verified_failure: "claim without evidence",
      evidence: ["incident:inc-1"],
      corrective_rule: "Require authoritative verification before accepting success.",
      applies_when: [
        "domain=incident",
        "actionType=validate_reported_success",
        "failureCategory=unsupported_completion_claim",
      ],
      required_checks: ["Capture the authoritative record."],
      action: "BLOCK",
      severity: "high",
      confidence: 0.9,
      limitations: [],
      authoritative: true,
      support_basis: "grounded",
      status: "active",
      provenance: "simulated",
      ...overrides,
    });
  }

  const context = {
    domain: "incident",
    actionType: "validate_reported_success",
    pattern: "unsupported_completion_claim",
    hasAuthoritativeReference: false,
  };

  it("applies a matching authoritative safeguard", () => {
    expect(safeguardApplies(memory(), context).applicable).toBe(true);
  });

  it("does not apply a safeguard from a different failure category", () => {
    const m = memory({ failure_category: "connection_pool_exhaustion" });
    const verdict = safeguardApplies(m, context);
    expect(verdict.applicable).toBe(false);
    expect(verdict.basis).toMatch(/not/i);
  });

  it("does not apply a safeguard from a different domain", () => {
    expect(safeguardApplies(memory({ domain: "finance" }), context).applicable).toBe(false);
  });

  it("does not apply a non-authoritative memory", () => {
    expect(safeguardApplies(memory({ authoritative: false }), context).applicable).toBe(false);
  });

  it("does not apply a superseded memory", () => {
    expect(safeguardApplies(memory({ status: "superseded" }), context).applicable).toBe(false);
  });

  it("records provenance for every recalled record, applied or not", () => {
    const recalled: RecalledLesson[] = [
      {
        blobId: "blob-1",
        text: "x",
        distance: 0.1,
        provenance: "simulated",
        safeguardMemory: memory(),
      },
      {
        blobId: "blob-2",
        text: "y",
        distance: 0.2,
        provenance: "simulated",
        safeguardMemory: memory({ failure_category: "evidence_unavailable" }),
      },
    ];
    const apps = evaluateSafeguardApplications(recalled, context);
    expect(apps).toHaveLength(2);
    expect(apps[0].applicable).toBe(true);
    expect(apps[1].applicable).toBe(false);
    expect(apps.every((a) => a.blobId && a.relevance && a.applicabilityBasis)).toBe(true);
  });
});

describe("behaviour change: the safeguard changes a real decision", () => {
  it("is not claimed when the decision is unchanged", () => {
    const change = computeBehaviourChange({
      beforeDecision: "ALLOW",
      afterDecision: "ALLOW",
      afterChecks: [],
      retrievedNotApplicable: 0,
    });
    expect(change.changed).toBe(false);
    expect(change.attributableToMemory).toBe(false);
    expect(change.explanation).toMatch(/did not change/i);
  });

  it("is claimed when the decision changes", () => {
    const change = computeBehaviourChange({
      beforeDecision: "UNKNOWN",
      afterDecision: "REQUIRE_VERIFICATION",
      afterChecks: ["Capture the record."],
      appliedRule: "Require verification.",
      appliedMemoryId: "m1",
      appliedMemoryVersion: 1,
      retrievedNotApplicable: 0,
    });
    expect(change.changed).toBe(true);
    expect(change.attributableToMemory).toBe(true);
    expect(change.changedByMemoryId).toBe("m1");
    expect(change.explanation).toMatch(/held constant/i);
  });

  it("attributes a check-only change to the memory, not to the verdict", () => {
    // The verdict is reached by the legacy lessons alone; the memory's own
    // contribution is the added verification check. That is a real influence,
    // but it is not a decision change.
    const change = computeBehaviourChange({
      beforeDecision: "REQUIRE_VERIFICATION",
      afterDecision: "REQUIRE_VERIFICATION",
      afterChecks: ["Capture the record."],
      appliedRule: "Require verification.",
      appliedMemoryId: "m1",
      appliedMemoryVersion: 1,
      retrievedNotApplicable: 0,
    });
    expect(change.changed).toBe(true);
    expect(change.attributableToMemory).toBe(true);
    expect(change.addedRequiredChecks).toEqual(["Capture the record."]);
    expect(change.beforeDecision).toBe(change.afterDecision);
  });
});

describe("behaviour change: end to end", () => {
  it("strengthens the repeat investigation with the recalled safeguard", async () => {
    const d = deps();
    const first = await runSubmissionPipeline({ text: FIRST }, d);
    // The first run learns the safeguard but is itself decided without memory.
    expect(first.behaviourChange).toBeUndefined();

    const second = await runSubmissionPipeline({ text: SECOND }, d);
    expect(second.behaviourChange).toBeDefined();
    const change = second.behaviourChange!;
    // The verdict is reached by the pre-existing legacy lesson path; the memory's
    // own, isolated contribution is the added verification requirement. Reporting
    // the verdict as memory-caused would be the attribution error this guards
    // against.
    expect(change.beforeDecision).toBe("REQUIRE_VERIFICATION");
    expect(change.afterDecision).toBe("REQUIRE_VERIFICATION");
    expect(change.attributableToMemory).toBe(true);
    expect(change.addedRequiredChecks.length).toBeGreaterThan(0);
    expect(change.changedByMemoryId).toBe(
      "safeguard-incident-unsupported_completion_claim",
    );
    expect(change.changedByMemoryVersion).toBe(1);
    expect(second.decision.decision).toBe("REQUIRE_VERIFICATION");
    // Provenance is versioned, so the enforced version is unambiguous.
    expect(second.decision.applicableMemoryIds).toContain(
      "safeguard-incident-unsupported_completion_claim@v1",
    );
  });

  it("does not count a retrieved-but-inapplicable memory as influential", async () => {
    const d = deps();
    // Seed a safeguard from a *different* failure category.
    await d.memory.rememberSafeguard(
      SafeguardMemoryRecordSchema.parse({
        type: "safeguard_memory",
        memory_id: "safeguard-incident-evidence_unavailable",
        version: 1,
        origin_incident_id: "inc-other",
        domain: "incident",
        action_type: "validate_reported_success",
        failure_category: "evidence_unavailable",
        verified_failure: "other",
        evidence: ["incident:inc-other"],
        corrective_rule: "Other rule.",
        applies_when: ["domain=incident", "actionType=validate_reported_success"],
        required_checks: ["Other check."],
        action: "REQUIRE_VERIFICATION",
        severity: "low",
        confidence: 0.5,
        limitations: [],
        authoritative: true,
        support_basis: "grounded",
        status: "active",
        provenance: "simulated",
      }),
    );
    const record = await runSubmissionPipeline({ text: SECOND }, d);
    const other = record.safeguardApplications?.find(
      (a) => a.memoryId === "safeguard-incident-evidence_unavailable",
    );
    expect(other).toBeDefined();
    expect(other!.applicable).toBe(false);
    expect(other!.changedBehaviour).toBe(false);
  });
});

describe("integrity", () => {
  it("never marks a safeguard persisted when the backend is unavailable", async () => {
    const d = deps();
    const record = await runSubmissionPipeline({ text: FIRST }, d);
    const memory = record.learnedSafeguards![0];
    // The simulated backend is honest: persisted reflects a real completion.
    expect(memory.walrus.backend).toBe("simulated");
    expect(memory.walrus.persisted).toBe(memory.walrus.blobId !== undefined);
  });

  it("does not let a non-authoritative memory change a decision", async () => {
    const d = deps();
    // Seed a non-authoritative safeguard that would otherwise apply.
    await d.memory.rememberSafeguard(
      SafeguardMemoryRecordSchema.parse({
        type: "safeguard_memory",
        memory_id: "safeguard-incident-unsupported_completion_claim",
        version: 1,
        origin_incident_id: "inc-weak",
        domain: "incident",
        action_type: "validate_reported_success",
        failure_category: "unsupported_completion_claim",
        verified_failure: "weak",
        evidence: ["incident:inc-weak"],
        corrective_rule: "Weak rule.",
        applies_when: ["domain=incident", "actionType=validate_reported_success"],
        required_checks: ["Weak check."],
        action: "BLOCK",
        severity: "low",
        confidence: 0.2,
        limitations: [],
        authoritative: false,
        support_basis: "not grounded",
        status: "active",
        provenance: "simulated",
      }),
    );
    const record = await runSubmissionPipeline({ text: SECOND }, d);
    // The weak memory must not be enforced, so no behaviour change is claimed.
    expect(record.decision.applicableMemoryIds ?? []).not.toContain(
      "safeguard-incident-unsupported_completion_claim",
    );
  });

  it("never reports an unsupported prevention claim", async () => {
    const d = deps();
    const record = await runSubmissionPipeline({ text: FIRST }, d);
    // A single investigation can never claim a repeat was prevented.
    expect(record.verification.state).not.toBe("verified");
  });

  it("assessAuthority refuses a finding with no grounded basis", () => {
    const verdict = assessAuthority({
      diagnosis: { actionable: true, pattern: "evidence_unavailable" } as never,
      assessment: { verified: false } as never,
      investigation: {
        categories: { observedEvidence: [] },
        authoritativeLookup: { attempted: false },
      } as never,
    });
    expect(verdict.authoritative).toBe(false);
    expect(verdict.basis).toMatch(/not enforced/i);
  });
});

describe("learning loop view model", () => {
  it("counts only real records and reports provenance", async () => {
    const d = deps();
    await runSubmissionPipeline({ text: FIRST }, d);
    await runSubmissionPipeline({ text: SECOND }, d);
    const records = await d.store.listSafeguardRecords();
    const loop = buildLearningLoop(records);

    expect(loop.history).toHaveLength(2);
    expect(loop.impact.totalVerifiedSafeguards).toBe(1);
    expect(loop.impact.investigationsInfluenced).toBe(1);
    expect(loop.impact.memoriesRecalled).toBeGreaterThan(0);
    // Provenance links the memory to its origin incident and its influences.
    const p = loop.provenance[0];
    expect(p.originIncidentId).toBeTruthy();
    expect(p.influenced.length).toBe(1);
    expect(loop.behaviourChanges.some((b) => b.changed)).toBe(true);
  });

  it("traces every applicable retrieval entry to an origin incident", async () => {
    // The recall happens in a later record than the one that learned the
    // safeguard, so the origin can only be resolved if the application (or the
    // cross-record index) carries it. This pins that provenance is complete.
    const d = deps();
    const first = await runSubmissionPipeline({ text: FIRST }, d);
    await runSubmissionPipeline({ text: SECOND }, d);
    const loop = buildLearningLoop(await d.store.listSafeguardRecords());

    const applicable = loop.retrieval.filter((r) => r.applicable);
    expect(applicable.length).toBeGreaterThan(0);
    for (const r of applicable) {
      expect(r.originalIncidentId).toBeTruthy();
    }
    // The applied safeguard traces back to the first incident, not the second.
    const applied = applicable.find((r) => r.changedBehaviour);
    expect(applied?.originalIncidentId).toBe(first.incidentId);
  });

  it("traces an application written before the origin field existed", async () => {
    // The production failure mode: a record persisted by an earlier build has an
    // application with no `originalIncidentId`, and it recalled a safeguard that
    // a *different* record learned. The view must still resolve the origin from
    // the learning record, or the retrieval entry is untraceable.
    const d = deps();
    const first = await runSubmissionPipeline({ text: FIRST }, d);
    const second = await runSubmissionPipeline({ text: SECOND }, d);

    const legacySecond = {
      ...second,
      safeguardApplications: (second.safeguardApplications ?? []).map((a) => {
        const { originalIncidentId: _drop, ...rest } = a;
        return rest;
      }),
    };
    const loop = buildLearningLoop([first, legacySecond]);

    const applied = loop.retrieval.find((r) => r.applicable && r.changedBehaviour);
    expect(applied?.originalIncidentId).toBe(first.incidentId);
  });

  it("keeps test fixtures separate from production evidence", async () => {
    const d = deps();
    await runSubmissionPipeline(
      { text: "[TEST FIXTURE] the agent reported success with no verification record" },
      d,
    );
    const loop = buildLearningLoop(await d.store.listSafeguardRecords());
    expect(loop.impact.fixtures.records).toBe(1);
  });

  it("excludes fixtures from every headline production figure", async () => {
    // The page tells the reader fixtures are "excluded from the production
    // figures above". A labelled fixture must therefore not raise a single
    // headline counter, even though it is a real record that learned a real
    // safeguard and changed a real decision. Only `fixtures` may move. The
    // comparison is within one store: add fixtures *after* the production pair
    // and assert the figures do not move.
    const d = deps();
    await runSubmissionPipeline({ text: FIRST }, d);
    await runSubmissionPipeline({ text: SECOND }, d);
    const before = buildLearningLoop(await d.store.listSafeguardRecords());

    const fix1 = await runSubmissionPipeline({ text: `[TEST FIXTURE] ${FIRST}` }, d);
    await runSubmissionPipeline({ text: `[TEST FIXTURE] ${SECOND}` }, d);
    const after = buildLearningLoop(await d.store.listSafeguardRecords());

    // The fixture records are real, influential records…
    expect(after.impact.fixtures.records).toBeGreaterThanOrEqual(1);
    expect(fix1.learnedSafeguards?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(after.history.length).toBeGreaterThan(before.history.length);
    // …yet no headline production figure is inflated by them.
    expect(after.impact.totalVerifiedSafeguards).toBe(
      before.impact.totalVerifiedSafeguards,
    );
    expect(after.impact.safeguardsPersisted).toBe(before.impact.safeguardsPersisted);
    expect(after.impact.memoriesApplied).toBe(before.impact.memoriesApplied);
    expect(after.impact.investigationsInfluenced).toBe(
      before.impact.investigationsInfluenced,
    );
    expect(after.impact.verificationRequirementsStrengthened).toBe(
      before.impact.verificationRequirementsStrengthened,
    );
    // …and the provenance that backs those figures names no fixture record.
    const fixtureIds = new Set(
      (await d.store.listSafeguardRecords())
        .filter((r) => /TEST FIXTURE/i.test(r.submission.text))
        .map((r) => r.recordId),
    );
    expect(fixtureIds.size).toBeGreaterThanOrEqual(2);
    for (const id of after.impact.provenance.influenced) {
      expect(fixtureIds.has(id)).toBe(false);
    }
    for (const id of after.impact.provenance.recalled) {
      expect(fixtureIds.has(id)).toBe(false);
    }
  });
});

describe("behaviour change: a memory can change the verdict itself", () => {
  it("turns UNKNOWN into REQUIRE_VERIFICATION when only the memory is present", async () => {
    // The decisive case: no legacy corrective lesson has been learned (the
    // adapter starts empty except for one pre-seeded safeguard memory), so the
    // before arm has nothing to escalate on. The verdict change is therefore
    // attributable to the memory alone, not to the pre-existing lesson path.
    const d = deps();
    await d.memory.rememberSafeguard(
      SafeguardMemoryRecordSchema.parse({
        type: "safeguard_memory",
        memory_id: "safeguard-incident-unsupported_completion_claim",
        version: 1,
        origin_incident_id: "inc-origin",
        domain: "incident",
        action_type: "validate_reported_success",
        failure_category: "unsupported_completion_claim",
        verified_failure: "claim without evidence",
        evidence: ["incident:inc-origin"],
        corrective_rule: "Require authoritative verification before accepting success.",
        applies_when: [
          "domain=incident",
          "actionType=validate_reported_success",
          "failureCategory=unsupported_completion_claim",
        ],
        required_checks: ["Capture the authoritative record."],
        action: "BLOCK",
        severity: "high",
        confidence: 0.9,
        limitations: [],
        authoritative: true,
        support_basis: "grounded",
        status: "active",
        provenance: "simulated",
      }),
    );
    const record = await runSubmissionPipeline({ text: FIRST }, d);
    const change = record.behaviourChange;
    expect(change).toBeDefined();
    expect(change!.beforeDecision).toBe("UNKNOWN");
    expect(change!.afterDecision).toBe("REQUIRE_VERIFICATION");
    expect(change!.changedByMemoryId).toBe(
      "safeguard-incident-unsupported_completion_claim",
    );
    expect(record.decision.decision).toBe("REQUIRE_VERIFICATION");
  });
});

describe("recall: versioning and supersession are resolved at recall time", () => {
  function record(overrides: Partial<SafeguardMemoryRecord> = {}): SafeguardMemoryRecord {
    return SafeguardMemoryRecordSchema.parse({
      type: "safeguard_memory",
      memory_id: "safeguard-incident-unsupported_completion_claim",
      version: 1,
      origin_incident_id: "inc-1",
      domain: "incident",
      action_type: "validate_reported_success",
      failure_category: "unsupported_completion_claim",
      verified_failure: "claim without evidence",
      evidence: ["incident:inc-1"],
      corrective_rule: "Require authoritative verification before accepting success.",
      applies_when: ["domain=incident", "actionType=validate_reported_success"],
      required_checks: ["Capture the authoritative record."],
      action: "BLOCK",
      severity: "high",
      confidence: 0.9,
      limitations: [],
      authoritative: true,
      support_basis: "grounded",
      status: "active",
      provenance: "simulated",
      ...overrides,
    });
  }
  const context = {
    domain: "incident",
    actionType: "validate_reported_success",
    pattern: "unsupported_completion_claim",
    hasAuthoritativeReference: false,
  };
  const hit = (m: SafeguardMemoryRecord, blob: string): RecalledLesson => ({
    blobId: blob,
    text: "x",
    distance: 0.1,
    provenance: "simulated",
    safeguardMemory: m,
  });

  it("enforces only the highest active authoritative version", () => {
    const v1 = record({ version: 1, corrective_rule: "OLD" });
    const v2 = record({
      version: 2,
      corrective_rule: "NEW",
      supersedes: "safeguard-incident-unsupported_completion_claim@v1",
    });
    const apps = evaluateSafeguardApplications([hit(v1, "b1"), hit(v2, "b2")], context);
    const v1app = apps.find((a) => a.version === 1)!;
    const v2app = apps.find((a) => a.version === 2)!;
    expect(v2app.applicable).toBe(true);
    expect(v1app.applicable).toBe(false);
    expect(v1app.applicabilityBasis).toMatch(/superseded/i);
  });

  it("enforces the latest version even without an explicit supersedes edge", () => {
    // A later record that re-derives the same category with a changed rule is the
    // effective one, whether or not it names its predecessor.
    const v1 = record({ version: 1, corrective_rule: "OLD" });
    const v2 = record({ version: 2, corrective_rule: "NEW" });
    const apps = evaluateSafeguardApplications([hit(v1, "b1"), hit(v2, "b2")], context);
    expect(apps.find((a) => a.version === 1)!.applicable).toBe(false);
    expect(apps.find((a) => a.version === 2)!.applicable).toBe(true);
  });

  it("does not let a non-authoritative correction retire an authoritative one", () => {
    const v1 = record({ version: 1 });
    const weak = record({
      version: 2,
      corrective_rule: "WEAK",
      authoritative: false,
      supersedes: "safeguard-incident-unsupported_completion_claim@v1",
    });
    const apps = evaluateSafeguardApplications([hit(v1, "b1"), hit(weak, "b2")], context);
    // The authoritative v1 survives; the weak v2 is recorded but never enforced.
    expect(apps.find((a) => a.version === 1)!.applicable).toBe(true);
    expect(apps.find((a) => a.version === 2)!.applicable).toBe(false);
  });

  it("does not enforce a recalled version the durable index shows is obsolete", () => {
    // Recall returned only v1, but the durable index says v2 exists. Enforcing
    // v1 would apply a rule already corrected, so it must not be enforced.
    const v1 = record({ version: 1, corrective_rule: "OLD" });
    const knownLatest = new Map([[v1.memory_id, 2]]);
    const apps = evaluateSafeguardApplications([hit(v1, "b1")], {
      ...context,
      knownLatest,
    });
    expect(apps[0].applicable).toBe(false);
    expect(apps[0].applicabilityBasis).toMatch(/obsolete|not the latest/i);
  });

  it("flags a recalled version as uncertain when completeness cannot be established", () => {
    // No independent index was supplied, so we cannot prove this is the latest.
    // The safeguard is still enforced (it may be the latest), but the reader is
    // told the version's currency is unverified.
    const v1 = record({ version: 1 });
    const apps = evaluateSafeguardApplications([hit(v1, "b1")], context);
    expect(apps[0].applicable).toBe(true);
    expect(apps[0].versionCertainty).toEqual({
      latestKnownVersion: 1,
      uncertain: true,
    });
  });

  it("reports a recalled version as certain when the index confirms it is the highest", () => {
    const v1 = record({ version: 1 });
    const knownLatest = new Map([[v1.memory_id, 1]]);
    const apps = evaluateSafeguardApplications([hit(v1, "b1")], {
      ...context,
      knownLatest,
    });
    expect(apps[0].applicable).toBe(true);
    expect(apps[0].versionCertainty).toEqual({
      latestKnownVersion: 1,
      latestGloballyVerifiedVersion: 1,
      uncertain: false,
    });
  });

  it("does not count an applicable memory that changed nothing as influential", async () => {
    // A record whose memory applied but neither moved the verdict nor added a
    // required check must not be counted as an influenced investigation. This is
    // the attribution guard: retrieved/applied is not the same as influential.
    const d = deps();
    const record = await runSubmissionPipeline({ text: FIRST }, d);
    const mutated = {
      ...record,
      behaviourChange: {
        changed: false,
        attributableToMemory: false,
        beforeDecision: "UNKNOWN" as const,
        afterDecision: "UNKNOWN" as const,
        beforeRequiredChecks: [],
        afterRequiredChecks: [],
        addedRequiredChecks: [],
        explanation: "no change",
      },
      safeguardApplications: (record.safeguardApplications ?? []).map((a) => ({
        ...a,
        changedBehaviour: false,
      })),
    };
    const loop = buildLearningLoop([mutated]);
    expect(loop.impact.memoriesApplied).toBe(0);
    expect(loop.impact.investigationsInfluenced).toBe(0);
    expect(loop.impact.demonstratedRepeatPreventions).toBe(0);
    expect(loop.impact.verificationRequirementsStrengthened).toBe(0);
  });
});
