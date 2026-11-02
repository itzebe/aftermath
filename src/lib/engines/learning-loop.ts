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
  /** True when this record is a labelled test fixture, not a production incident. */
  fixture: boolean;
}

export interface MemoryRetrievalEntry {
  recordId: string;
  incidentId: string;
  createdAt: string;
  memoryId: string;
  /** The exact version evaluated, so a version is never ambiguous. */
  version?: number;
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
  /** True when this record is a labelled test fixture, not a production incident. */
  fixture: boolean;
}

export interface BehaviourChangeEntry {
  recordId: string;
  incidentId: string;
  createdAt: string;
  summary: string;
  changed: boolean;
  /** True only when the change is attributable to the safeguard-memory mechanism. */
  attributableToMemory: boolean;
  beforeDecision: string;
  afterDecision: string;
  addedRequiredChecks: string[];
  changedByRule?: string;
  changedByMemoryId?: string;
  changedByMemoryVersion?: number;
  explanation: string;
  /** True when this record is a labelled test fixture, not a production incident. */
  fixture: boolean;
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
  /** The exact version this entry describes. */
  version: number;
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
  /** Lifecycle: a superseded version is retained for provenance but not enforced. */
  status: string;
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
 * A record is a test fixture when its submission carries the fixture marker the
 * demonstration scripts set. The marker is the explicit, human-visible signal;
 * a record's *provenance* (`live` vs `simulated`) is a separate honesty axis —
 * whether a memory was really persisted — and is surfaced per entry, so a
 * credential-less run is still counted and labelled rather than hidden. Fixtures
 * are counted separately and excluded from every headline production figure.
 */
function isFixture(record: SafeguardRecord): boolean {
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

  // memoryId -> the incident each memory was first learned from, across every
  // record. A memory recalled in a later record traces back through this even
  // when the application predates the carried origin field.
  const originOf = new Map<string, string>();
  const knownIncidentIds = new Set<string>();
  for (const record of records) {
    knownIncidentIds.add(record.incidentId);
    for (const m of record.learnedSafeguards ?? []) {
      if (!originOf.has(m.memoryId)) originOf.set(m.memoryId, m.originIncidentId);
    }
  }

  for (const record of ordered) {
    const safeguard = record.learnedSafeguards?.[0] ?? null;
    const applications = record.safeguardApplications ?? [];
    const fixture = isFixture(record);

    for (const app of applications) {
      const appKey = app.version !== undefined ? `${app.memoryId}@v${app.version}` : app.memoryId;
      push(retrievedIn, appKey, record.recordId);
      if (app.applicable && app.changedBehaviour) {
        push(influencedIn, appKey, record.recordId);
      }
      // The application carries the origin incident it was recalled from, so a
      // memory learned in an earlier record stays traceable. Fall back to a
      // safeguard learned in this same record, then to a known incident id the
      // memory's identity names directly (legacy corrective lessons).
      const originalIncidentId =
        app.originalIncidentId ??
        originOf.get(app.memoryId) ??
        record.learnedSafeguards?.find(
          (m) => m.memoryId === app.memoryId && m.version === app.version,
        )?.originIncidentId ??
        (knownIncidentIds.has(app.memoryId) ? app.memoryId : "");

      retrieval.push({
        recordId: record.recordId,
        incidentId: record.incidentId,
        createdAt: record.createdAt,
        memoryId: app.memoryId,
        ...(app.version !== undefined ? { version: app.version } : {}),
        blobId: app.blobId,
        originalIncidentId,
        relation: app.relation,
        relevance: app.relevance,
        applicable: app.applicable,
        applicabilityBasis: app.applicabilityBasis,
        ...(app.contributedRule ? { contributedRule: app.contributedRule } : {}),
        changedBehaviour: app.changedBehaviour,
        authoritative: app.authoritative,
        provenance: app.provenance,
        fixture,
      });
    }

    if (record.behaviourChange) {
      behaviourChanges.push({
        recordId: record.recordId,
        incidentId: record.incidentId,
        createdAt: record.createdAt,
        summary: record.investigation.summary,
        changed: record.behaviourChange.changed,
        attributableToMemory:
          record.behaviourChange.attributableToMemory ?? record.behaviourChange.changed,
        beforeDecision: record.behaviourChange.beforeDecision,
        afterDecision: record.behaviourChange.afterDecision,
        addedRequiredChecks: record.behaviourChange.addedRequiredChecks,
        ...(record.behaviourChange.changedByRule
          ? { changedByRule: record.behaviourChange.changedByRule }
          : {}),
        ...(record.behaviourChange.changedByMemoryId
          ? { changedByMemoryId: record.behaviourChange.changedByMemoryId }
          : {}),
        ...(record.behaviourChange.changedByMemoryVersion
          ? { changedByMemoryVersion: record.behaviourChange.changedByMemoryVersion }
          : {}),
        explanation: record.behaviourChange.explanation,
        fixture,
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
      influencedInvestigationIds: safeguard
        ? influencedIn.get(`${safeguard.memoryId}@v${safeguard.version}`) ?? []
        : [],
      provenance: record.provenance,
      fixture,
    });
  }

  // Learning impact, computed only from actual records. Safeguards are grouped
  // by their *versioned* identity, so a correction is counted as a distinct
  // safeguard while a re-derivation of the same version is not.
  const byMemoryId = new Map<
    string,
    { memory: SafeguardMemory; recordIds: string[]; persisted: boolean; recallVerified: boolean }
  >();
  for (const record of ordered) {
    for (const memory of record.learnedSafeguards ?? []) {
      const key = `${memory.memoryId}@v${memory.version}`;
      const entry = byMemoryId.get(key);
      if (entry) {
        entry.recordIds.push(record.recordId);
        entry.persisted = entry.persisted || memory.walrus.persisted;
        entry.recallVerified = entry.recallVerified || memory.walrus.recallVerified;
        // Prefer the memory instance that carries the blob id, for provenance.
        if (memory.walrus.blobId && !entry.memory.walrus.blobId) entry.memory = memory;
      } else {
        byMemoryId.set(key, {
          memory,
          recordIds: [record.recordId],
          persisted: memory.walrus.persisted,
          recallVerified: memory.walrus.recallVerified,
        });
      }
    }
  }
  const allSafeguards = [...byMemoryId.values()];

  const influencedRecords = new Set<string>();
  for (const apps of influencedIn.values()) for (const r of apps) influencedRecords.add(r);

  const strengthened = behaviourChanges.filter(
    (b) => b.changed && b.attributableToMemory && b.addedRequiredChecks.length > 0,
  );

  // A demonstrated repeat prevention requires a memory learned from an earlier
  // record to have changed a *later* investigation's *decision* — not merely
  // added verification checks. Adding checks strengthens an investigation; only
  // a decision the engine would otherwise have reached differently counts as
  // preventing a recurrence. A single investigation changing its own decision is
  // not a prevention claim either.
  const learnedAt = new Map<string, string>();
  for (const s of allSafeguards) {
    const key = `${s.memory.memoryId}@v${s.memory.version}`;
    for (const recordId of s.recordIds) {
      const record = ordered.find((r) => r.recordId === recordId);
      if (!record) continue;
      const prev = learnedAt.get(key);
      if (!prev || record.createdAt < prev) learnedAt.set(key, record.createdAt);
    }
  }
  const demonstratedPreventions = behaviourChanges.filter((b) => {
    if (!b.changed || !b.attributableToMemory || !b.changedByMemoryId) return false;
    if (b.beforeDecision === b.afterDecision) return false;
    const key =
      b.changedByMemoryVersion !== undefined
        ? `${b.changedByMemoryId}@v${b.changedByMemoryVersion}`
        : b.changedByMemoryId;
    const learned = learnedAt.get(key);
    return Boolean(learned && learned < b.createdAt);
  });

  const fixtureRecords = ordered.filter(isFixture);
  const fixtureRecordIds = new Set(fixtureRecords.map((r) => r.recordId));
  const fixtureSafeguards = allSafeguards.filter((s) =>
    s.recordIds.some((id) => fixtureRecordIds.has(id)),
  );

  // The headline figures are production evidence, so a fixture record is
  // excluded from every one of them. Fixtures stay visible in the history,
  // retrieval and behaviour-change views (each entry carries its own
  // provenance), and are counted in `fixtures` below, but they never inflate a
  // production metric. Without this, a labelled fixture would silently raise the
  // counters the page presents as production evidence.
  const isProductionRecord = (recordId: string) => !fixtureRecordIds.has(recordId);
  const productionSafeguards = allSafeguards.filter((s) =>
    s.recordIds.some(isProductionRecord),
  );
  const productionRetrieval = retrieval.filter((r) => isProductionRecord(r.recordId));
  const productionInfluenced = [...influencedRecords].filter(isProductionRecord);
  const productionStrengthened = strengthened.filter((b) =>
    isProductionRecord(b.recordId),
  );
  const productionPreventions = demonstratedPreventions.filter((b) =>
    isProductionRecord(b.recordId),
  );

  const impact: LearningImpact = {
    totalVerifiedSafeguards: productionSafeguards.filter(
      (s) => s.memory.authoritative,
    ).length,
    safeguardsPersisted: productionSafeguards.filter((s) => s.persisted).length,
    safeguardsRecallVerified: productionSafeguards.filter((s) => s.recallVerified).length,
    memoriesRecalled: productionRetrieval.length,
    memoriesApplied: productionRetrieval.filter((r) => r.applicable).length,
    investigationsInfluenced: productionInfluenced.length,
    verificationRequirementsStrengthened: productionStrengthened.length,
    demonstratedRepeatPreventions: productionPreventions.length,
    provenance: {
      verifiedSafeguards: productionSafeguards
        .filter((s) => s.memory.authoritative)
        .flatMap((s) => s.recordIds.filter(isProductionRecord)),
      persisted: productionSafeguards
        .filter((s) => s.persisted)
        .flatMap((s) => s.recordIds.filter(isProductionRecord)),
      recalled: [...new Set(productionRetrieval.map((r) => r.recordId))],
      applied: [
        ...new Set(
          productionRetrieval.filter((r) => r.applicable).map((r) => r.recordId),
        ),
      ],
      influenced: productionInfluenced,
    },
    fixtures: { records: fixtureRecords.length, safeguards: fixtureSafeguards.length },
  };

  // Provenance: one entry per distinct safeguard memory, linking it to its
  // origin incident, its Walrus reference, and every later investigation it
  // touched.
  const provenance: LearningProvenanceEntry[] = allSafeguards.map(({ memory }) => {
    const key = `${memory.memoryId}@v${memory.version}`;
    return {
      memoryId: memory.memoryId,
      version: memory.version,
      originIncidentId: memory.originIncidentId,
      ...(memory.walrus.blobId ? { blobId: memory.walrus.blobId } : {}),
      backend: memory.walrus.backend,
      persisted: memory.walrus.persisted,
      recallVerified: memory.walrus.recallVerified,
      retrievedIn: retrievedIn.get(key) ?? [],
      influenced: influencedIn.get(key) ?? [],
      domain: memory.domain,
      failureCategory: memory.failureCategory,
      status: memory.status,
      provenance: memory.provenance,
    };
  });

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
