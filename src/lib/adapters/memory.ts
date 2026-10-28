import type {
  CorrectiveLessonRecord,
  Incident,
  Provenance,
} from "@/lib/schemas";

/** Where a memory backend actually writes. Surfaced verbatim in the UI. */
export type MemoryBackendId =
  | "memwal-mainnet"
  | "memwal-staging"
  | "memwal-unknown"
  | "simulated";

/** Lifecycle of a single memory write, as required by the brief. */
export type MemoryWriteState =
  | "requested"
  | "processing"
  | "completed"
  | "failed";

export interface MemoryWriteReceipt {
  /** Local identifier for this write attempt (stable across polling). */
  writeId: string;
  /** What was written: incident summary or corrective lesson. */
  kind: "incident" | "lesson";
  /** The relayer job id, when one was returned. */
  jobId: string | null;
  state: MemoryWriteState;
  /** Walrus blob id, only populated once the write actually completes. */
  blobId?: string;
  owner?: string;
  namespace?: string;
  error?: string;
  /** True only after a recall query returned this record back. */
  recallVerified: boolean;
  recallMatches?: number;
  backend: MemoryBackendId;
  provenance: Provenance;
  requestedAt: string;
  completedAt?: string;
  /** The exact text submitted, kept for auditability. */
  text: string;
}

export interface RecalledLesson {
  blobId: string;
  text: string;
  distance: number;
  createdAt?: string;
  /** Parsed lesson record, when the text is a valid corrective_lesson JSON. */
  record?: CorrectiveLessonRecord;
  provenance: Provenance;
}

export interface BackendHealth {
  ok: boolean;
  detail: string;
  /** Relayer-reported version fields, when available. */
  relayerVersion?: string;
  apiVersion?: string;
  writeReady?: boolean;
}

/**
 * The single, honest statement of where the memory backend stands.
 *
 * The distinction that matters most is between the transport reaching the
 * relayer (`MAINNET_CONNECTED`) and the delegate credentials actually being
 * accepted (`MAINNET_AUTH_CONFIRMED`). An unauthenticated `/health` probe can
 * succeed while every signed call is refused with 401, so a reachable relayer
 * must never be presented as a working one.
 */
export type MemoryBackendState =
  | "SIMULATED_BACKEND"
  | "MAINNET_CONNECTED"
  | "MAINNET_AUTH_CONFIRMED"
  | "MAINNET_WRITE_CONFIRMED"
  | "MAINNET_RECALL_CONFIRMED"
  | "MAINNET_AUTH_FAILED"
  | "MAINNET_UNAVAILABLE";

export interface MemoryStatus {
  /** The label shown in the UI. Never optimistic: it reflects the last probe. */
  state: MemoryBackendState;
  /** Transport to the relayer succeeded. Does NOT imply authentication. */
  reachable: boolean;
  /** An authenticated (signed) call succeeded. This is the real "connected". */
  authenticated: boolean;
  /** The relayer explicitly refused the credentials (HTTP 401). */
  authFailed: boolean;
  /** The relayer could not verify credentials because it was unavailable. */
  authUpstreamUnavailable: boolean;
  /** Machine-readable server code, when the relayer supplied one. */
  serverCode?: string;
  /**
   * Number of memories the relayer reports in the configured namespace.
   *
   * This is authoritative on-chain state, read from the same signed
   * `listNamespaces` call that proves authentication. It is deliberately
   * separate from the local write ledger: the ledger only knows about writes
   * *this instance* attempted, while this count reflects every memory already
   * in the namespace — including writes made by earlier runs or other
   * processes. On a fresh deployment the ledger starts empty, so this is the
   * honest way to show that the namespace really holds memories.
   */
  namespaceMemoryCount?: number;
  detail: string;
}

export interface WriteOptions {
  /**
   * Called as soon as the relayer accepts a write (a job id exists), before the
   * job is awaited to completion.
   *
   * This exists so a durable caller can persist the job id early. If the
   * process then dies before the write settles, a later request can reconcile
   * the *existing* job by its id instead of re-issuing the write.
   */
  onAccepted?: (receipt: MemoryWriteReceipt) => void | Promise<void>;
}

export interface RecallOptions {
  limit?: number;
  namespace?: string;
  /** `recent` asks the relayer to order by write time rather than similarity. */
  sort?: "relevance" | "recent";
  maxDistance?: number;
}

/**
 * Server-side adapter for the persistent lesson store.
 *
 * Two implementations exist: a real Walrus Memory (MemWal) adapter and an
 * explicitly-labelled simulated adapter used for tests and for environments
 * with no credentials. Callers must never present simulated state as real.
 */
export interface MemoryAdapter {
  readonly backend: MemoryBackendId;
  readonly provenance: Provenance;
  /** True when this adapter talks to a real relayer. */
  readonly isLive: boolean;

  initialize(): Promise<BackendHealth>;
  validateMemoryAvailability(): Promise<BackendHealth>;

  /**
   * Full status, including whether the credentials are actually accepted.
   *
   * `validateMemoryAvailability()` only proves the relayer answers; this proves
   * the delegate key is valid by making one authenticated (signed) call. The UI
   * must use this, not the health probe, to decide whether to claim Mainnet
   * operation.
   */
  status(): Promise<MemoryStatus>;

  rememberIncident(incident: Incident, options?: WriteOptions): Promise<MemoryWriteReceipt>;
  rememberLesson(lesson: CorrectiveLessonRecord, options?: WriteOptions): Promise<MemoryWriteReceipt>;

  /** Poll a previously accepted write until it completes or fails. */
  waitForWriteCompletion(jobId: string): Promise<MemoryWriteReceipt>;

  /**
   * Reconcile a write that was accepted but never observed to complete — for
   * example when the process died between the relayer accepting the job and the
   * receipt being persisted.
   *
   * The caller supplies the durable identifiers it stored (job id and the
   * original receipt). The adapter resolves the *existing* job rather than
   * issuing a new write, so a crash can never produce a duplicate Mainnet
   * memory. When the job cannot be resolved it returns a failed receipt whose
   * `error` explains why — it never fabricates success.
   */
  reconcileWrite?(
    jobId: string,
    prior: MemoryWriteReceipt,
  ): Promise<MemoryWriteReceipt>;

  recallRelevantLessons(
    query: string,
    options?: RecallOptions,
  ): Promise<RecalledLesson[]>;

  /** Confirm a completed write is retrievable by recall. */
  verifyRecall(receipt: MemoryWriteReceipt): Promise<MemoryWriteReceipt>;

  /**
   * Clear the backend's contents, if clearing is meaningful for it.
   *
   * Only the simulated backend implements this. Real Walrus Memory is durable
   * and append-only from the application's point of view: there is no way to
   * un-write a Mainnet blob, so the live adapter deliberately leaves this
   * undefined. A scenario run clears simulated state to stay reproducible and
   * never touches Mainnet memory.
   */
  reset?(): Promise<void>;
}

/**
 * Canonical text form of a lesson. Walrus Memory stores text; the structured
 * record is embedded as JSON so it round-trips through recall unchanged.
 */
export function lessonToMemoryText(lesson: CorrectiveLessonRecord): string {
  // `created_at` is excluded from the serialized body on purpose. The text is
  // the content hashed for the write's idempotency key, so a retry of the same
  // lesson after a crash must be byte-identical. A wall-clock timestamp would
  // make the retry "different content" for the same key, which the relayer
  // rejects with 409 instead of deduplicating.
  const { created_at: _ignored, ...stable } = lesson;
  return [
    `corrective_lesson:${lesson.domain}:${lesson.failure_pattern}`,
    lesson.corrective_rule,
    JSON.stringify(stable),
  ].join("\n");
}

export function incidentToMemoryText(incident: Incident): string {
  const evidence = incident.evidenceReferences
    .map((e) => `${e.kind}:${e.ref}`)
    .join(", ");
  return [
    `incident:${incident.domain}:${incident.actionType}`,
    `intended: ${incident.intendedOutcome}`,
    `claimed: ${incident.claimedOutcome?.claim ?? "(none)"}`,
    `evidence: ${evidence || "(none)"}`,
    JSON.stringify({
      type: "incident_record",
      incident_id: incident.incidentId,
      domain: incident.domain,
      action_type: incident.actionType,
      execution_id: incident.executionId,
      intended_outcome: incident.intendedOutcome,
      claimed_outcome: incident.claimedOutcome?.claim ?? null,
      evidence_references: incident.evidenceReferences,
      status: incident.currentStatus,
      provenance: incident.provenance,
    }),
  ].join("\n");
}

/** Extract an embedded corrective lesson from recalled memory text. */
export function parseLessonFromMemoryText(
  text: string,
): CorrectiveLessonRecord | undefined {
  const start = text.indexOf("{");
  if (start === -1) return undefined;
  const candidates = [text.slice(start)];
  const lastBrace = text.lastIndexOf("}");
  if (lastBrace > start) candidates.push(text.slice(start, lastBrace + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && parsed.type === "corrective_lesson") {
        return parsed as CorrectiveLessonRecord;
      }
    } catch {
      // try the next candidate slice
    }
  }
  return undefined;
}
