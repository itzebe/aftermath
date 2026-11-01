/**
 * The Learning Loop view model.
 *
 * This module turns the durable Safeguard Records into the five views the
 * product needs to make its learning loop legible: the learning history, the
 * memory-retrieval trail, the visible behaviour change, the measurable learning
 * impact, and the provenance of every claim.
 *
 * Everything here is derived from records the engine actually produced. A
 * Safeguard Memory is listed only when a record carries it; a "recalled" memory
 * is counted only when a recall genuinely returned it; an "influenced"
 * investigation is counted only when the engine recorded a real behaviour
 * change. Nothing is estimated, and test-fixture data is kept visibly separate
 * from production evidence.
 */

import type {
  SafeguardApplication,
  SafeguardMemory,
  SafeguardRecord,
} from "@/lib/schemas";

export interface LearningHistoryEntry {
  recordId: string;
  incidentId: string;
  createdAt: string;
  domain: string;
  failureCategory: string;
  summary: string;
  /** The safeguard learned from this incident, when one was produced. */
  safeguard: {
    memoryId: string;
    version: number;
    correctiveRule: string;
    authoritative: boolean;
    /** Honest Walrus persistence state. */
    persisted: boolean;
    recallVerified: boolean;
    blobId?: string;
    backend: string;
  } | null;
  /** Subsequent investigations this safeguard's memory influenced. */
  influencedInvestigationIds: string[];
  provenance: "live" | "simulated";
}

export interface MemoryRetrievalEntry {
  recordId: string;
  incidentId: string;
  createdAt: string;
  memoryId: string;
  blobId: string;
  originalIncidentId: string;
  relation: string;
  relevance: string;
  applicable: boolean;
  applicabilityBasis: string;
  contributedRule?: string;
  changedBehaviour: boolean;
  authoritative: boolean;
  provenance: "live" | "simulated";
}

export interface BehaviourChangeEntry {
  recordId: string;
  incidentId: string;
  createdAt: string;
  summary: string;
  changed: boolean;
  beforeDecision: string;
  afterDecision: string;
  addedRequiredChecks: string[];
  changedByRule?: string;
  changedByMemoryId?: string;
  explanation: string;
}

export interface LearningImpact {
  totalVerifiedSafeguards: number;
  safeguardsPersisted: number;
  safeguardsRecallVerified: number;
  memoriesRecalled: number;
  memoriesApplied: number;
  investigationsInfluenced: number;
  verificationRequirementsStrengthened: number;
  demonstratedRepeatPreventions: number;
  /** Records that contributed to each figure, for traceability. */
  provenance: {
    verifiedSafeguards: string[];
    persisted: string[];
    recalled: string[];
    applied: string[];
    influenced: string[];
  };
  /** Counts of test-fixture records kept visibly separate from production. */
  fixtures: { records: number; safeguards: number };
}

export interface LearningProvenanceEntry {
  memoryId: string;
  originIncidentId: string;
  blobId?: string;
  backend: string;
  persisted: boolean;
  recallVerified: boolean;
  /** Records where this memory was retrieved. */
  retrievedIn: string[];
  /** Records where this memory was applied and changed the behaviour. */
  influenced: string[];
  domain: string;
  failureCategory: string;
  provenance: "live" | "simulated";
}

export interface LearningLoop {
  history: LearningHistoryEntry[];
  retrieval: MemoryRetrievalEntry[];
  behaviourChanges: BehaviourChangeEntry[];
  impact: LearningImpact;
  provenance: LearningProvenanceEntry[];
  /** When this view model was computed. */
  generatedAt: string;
}

/**
 * A record is treated as a test fixture when it is explicitly simulated, or
 * when its submission carries the fixture marker the demonstration scripts set.
 * Fixtures are counted separately and never presented as production evidence.
 */
function isFixture(record: SafeguardRecord): boolean {
  if (record.provenance === "simulated") return true;
  return /TEST FIXTURE/i.test(record.submission.text);
}

/** Build the complete learning-loop view model from durable records. */
export function buildLearningLoop(records: SafeguardRecord[]): LearningLoop {
  // Newest first for display, but the analysis runs over all records.
  const ordered = [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const history: LearningHistoryEntry[] = [];
  const retrieval: MemoryRetrievalEntry[] = [];
  const behaviourChanges: BehaviourChangeEntry[] = [];

  // memoryId -> the records in which it was retrieved / applied-and-changed.
  const retrievedIn = new Map<string, string[]>();
  const influencedIn = new Map<string, string[]>();

  for (const record of ordered) {
    const safeguard = record.learnedSafeguards?.[0] ?? null;
    const applications = record.safeguardApplications ?? [];

    for (const app of applications) {
      push(retrievedIn, app.memoryId, record.recordId);
      if (app.applicable && app.changedBehaviour) {
        push(influencedIn, app.memoryId, record.recordId);
      }
      retrieval.push({
        recordId: record.recordId,
        incidentId: record.incidentId,
        createdAt: record.createdAt,
        memoryId: app.memoryId,
        blobId: app.blobId,
        originalIncidentId:
          record.learnedSafeguards?.find((m) => m.memoryId === app.memoryId)
            ?.originIncidentId ?? "",
        relation: app.relation,
        relevance: app.relevance,
        applicable: app.applicable,
        applicabilityBasis: app.applicabilityBasis,
        ...(app.contributedRule ? { contributedRule: app.contributedRule } : {}),
        changedBehaviour: app.changedBehaviour,
        authoritative: app.authoritative,
        provenance: app.provenance,
      });
    }

    if (record.behaviourChange) {
      behaviourChanges.push({
        recordId: record.recordId,
        incidentId: record.incidentId,
        createdAt: record.createdAt,
        summary: record.investigation.summary,
        changed: record.behaviourChange.changed,
        beforeDecision: record.behaviourChange.beforeDecision,
        afterDecision: record.behaviourChange.afterDecision,
        addedRequiredChecks: record.behaviourChange.addedRequiredChecks,
        ...(record.behaviourChange.changedByRule
          ? { changedByRule: record.behaviourChange.changedByRule }
          : {}),
        ...(record.behaviourChange.changedByMemoryId
          ? { changedByMemoryId: record.behaviourChange.changedByMemoryId }
          : {}),
        explanation: record.behaviourChange.explanation,
      });
    }

    history.push({
      recordId: record.recordId,
      incidentId: record.incidentId,
      createdAt: record.createdAt,
      domain: record.investigation.domain,
      failureCategory: record.investigation.diagnosis.pattern,
      summary: record.investigation.summary,
      safeguard: safeguard
        ? {
            memoryId: safeguard.memoryId,
            version: safeguard.version,
            correctiveRule: safeguard.correctiveRule,
            authoritative: safeguard.authoritative,
            persisted: safeguard.walrus.persisted,
            recallVerified: safeguard.walrus.recallVerified,
            ...(safeguard.walrus.blobId ? { blobId: safeguard.walrus.blobId } : {}),
            backend: safeguard.walrus.backend,
          }
        : null,
      influencedInvestigationIds: influencedIn.get(safeguard?.memoryId ?? "") ?? [],
      provenance: record.provenance,
    });
  }

  // Learning impact, computed only from actual records. Safeguards are grouped
  // by memory id, so re-deriving the same safeguard in a later incident does not
  // inflate the count of distinct safeguards.
  const byMemoryId = new Map<
    string,
    { memory: SafeguardMemory; recordIds: string[]; persisted: boolean; recallVerified: boolean }
  >();
  for (const record of ordered) {
    for (const memory of record.learnedSafeguards ?? []) {
      const entry = byMemoryId.get(memory.memoryId);
      if (entry) {
        entry.recordIds.push(record.recordId);
        entry.persisted = entry.persisted || memory.walrus.persisted;
        entry.recallVerified = entry.recallVerified || memory.walrus.recallVerified;
        // Prefer the memory instance that carries the blob id, for provenance.
        if (memory.walrus.blobId && !entry.memory.walrus.blobId) entry.memory = memory;
      } else {
        byMemoryId.set(memory.memoryId, {
          memory,
          recordIds: [record.recordId],
          persisted: memory.walrus.persisted,
          recallVerified: memory.walrus.recallVerified,
        });
      }
    }
  }
  const allSafeguards = [...byMemoryId.values()];
  const verifiedSafeguards = allSafeguards.filter((s) => s.memory.authoritative);
  const persisted = allSafeguards.filter((s) => s.persisted);
  const recallVerified = allSafeguards.filter((s) => s.recallVerified);

  const influencedRecords = new Set<string>();
  for (const apps of influencedIn.values()) for (const r of apps) influencedRecords.add(r);

  const strengthened = behaviourChanges.filter(
    (b) => b.changed && b.addedRequiredChecks.length > 0,
  );

  // A demonstrated repeat prevention requires a memory learned from an earlier
  // record to have changed a *later* investigation's decision. A single
  // investigation changing its own decision is not a prevention claim.
  const learnedAt = new Map<string, string>();
  for (const s of allSafeguards) {
    for (const recordId of s.recordIds) {
      const record = ordered.find((r) => r.recordId === recordId);
      if (!record) continue;
      const prev = learnedAt.get(s.memory.memoryId);
      if (!prev || record.createdAt < prev) learnedAt.set(s.memory.memoryId, record.createdAt);
    }
  }
  const demonstratedPreventions = behaviourChanges.filter((b) => {
    if (!b.changed || !b.changedByMemoryId) return false;
    const learned = learnedAt.get(b.changedByMemoryId);
    return Boolean(learned && learned < b.createdAt);
  });

  const fixtureRecords = ordered.filter(isFixture);
  const fixtureSafeguards = allSafeguards.filter((s) =>
    ordered.some((r) => isFixture(r) && s.recordIds.includes(r.recordId)),
  );

  const impact: LearningImpact = {
    totalVerifiedSafeguards: verifiedSafeguards.length,
    safeguardsPersisted: persisted.length,
    safeguardsRecallVerified: recallVerified.length,
    memoriesRecalled: retrieval.length,
    memoriesApplied: retrieval.filter((r) => r.applicable).length,
    investigationsInfluenced: influencedRecords.size,
    verificationRequirementsStrengthened: strengthened.length,
    demonstratedRepeatPreventions: demonstratedPreventions.length,
    provenance: {
      verifiedSafeguards: verifiedSafeguards.flatMap((s) => s.recordIds),
      persisted: persisted.flatMap((s) => s.recordIds),
      recalled: [...new Set(retrieval.map((r) => r.recordId))],
      applied: [...new Set(retrieval.filter((r) => r.applicable).map((r) => r.recordId))],
      influenced: [...influencedRecords],
    },
    fixtures: { records: fixtureRecords.length, safeguards: fixtureSafeguards.length },
  };

  // Provenance: one entry per distinct safeguard memory, linking it to its
  // origin incident, its Walrus reference, and every later investigation it
  // touched.
  const provenance: LearningProvenanceEntry[] = allSafeguards.map(({ memory }) => ({
    memoryId: memory.memoryId,
    originIncidentId: memory.originIncidentId,
    ...(memory.walrus.blobId ? { blobId: memory.walrus.blobId } : {}),
    backend: memory.walrus.backend,
    persisted: memory.walrus.persisted,
    recallVerified: memory.walrus.recallVerified,
    retrievedIn: retrievedIn.get(memory.memoryId) ?? [],
    influenced: influencedIn.get(memory.memoryId) ?? [],
    domain: memory.domain,
    failureCategory: memory.failureCategory,
    provenance: memory.provenance,
  }));

  return {
    history,
    retrieval,
    behaviourChanges,
    impact,
    provenance,
    generatedAt: new Date().toISOString(),
  };
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export type { SafeguardApplication };
