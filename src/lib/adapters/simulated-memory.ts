import { MemWalMock } from "@mysten-incubation/memwal";
import type { CorrectiveLessonRecord, Incident } from "@/lib/schemas";
import {
  incidentToMemoryText,
  lessonToMemoryText,
  parseLessonFromMemoryText,
  type BackendHealth,
  type MemoryAdapter,
  type MemoryBackendId,
  type MemoryWriteReceipt,
  type RecallOptions,
  type RecalledLesson,
} from "@/lib/adapters/memory";

/**
 * Simulated memory backend, used only when no Walrus Memory credentials are
 * configured or when a test needs determinism.
 *
 * It is built on the official SDK's in-process mock (MemWalMock), not a
 * hand-rolled fake, but it still never touches a network. Every receipt it
 * produces is stamped `provenance: "simulated"` and the UI labels it as such.
 * Simulated writes are excluded from the Mainnet memory count.
 */
export class SimulatedMemoryAdapter implements MemoryAdapter {
  readonly backend: MemoryBackendId = "simulated";
  readonly provenance = "simulated" as const;
  readonly isLive = false;

  private client: MemWalMock;
  private sequence = 0;

  constructor(private readonly namespace = "aftermath") {
    this.client = MemWalMock.create({ namespace, owner: "simulated-owner" });
  }

  async initialize(): Promise<BackendHealth> {
    return {
      ok: true,
      detail:
        "Simulated in-process memory backend (no Walrus Memory network calls).",
    };
  }

  async validateMemoryAvailability(): Promise<BackendHealth> {
    return this.initialize();
  }

  private async writeText(
    kind: "incident" | "lesson",
    text: string,
  ): Promise<MemoryWriteReceipt> {
    this.sequence += 1;
    const writeId = `sim-${kind}-${this.sequence}`;
    try {
      const result = await this.client.rememberAndWait(text);
      const receipt: MemoryWriteReceipt = {
        writeId,
        kind,
        jobId: result.id,
        state: "completed",
        blobId: result.blob_id,
        owner: result.owner,
        namespace: result.namespace,
        recallVerified: false,
        backend: this.backend,
        provenance: this.provenance,
        requestedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        text,
      };
      return this.verifyRecall(receipt);
    } catch (err) {
      return {
        writeId,
        kind,
        jobId: null,
        state: "failed",
        error: (err as Error).message,
        recallVerified: false,
        backend: this.backend,
        provenance: this.provenance,
        requestedAt: new Date().toISOString(),
        text,
      };
    }
  }

  rememberIncident(incident: Incident): Promise<MemoryWriteReceipt> {
    return this.writeText("incident", incidentToMemoryText(incident));
  }

  rememberLesson(lesson: CorrectiveLessonRecord): Promise<MemoryWriteReceipt> {
    return this.writeText("lesson", lessonToMemoryText(lesson));
  }

  async waitForWriteCompletion(jobId: string): Promise<MemoryWriteReceipt> {
    const result = await this.client.waitForRememberJob(jobId);
    return {
      writeId: `sim-poll-${jobId}`,
      kind: "lesson",
      jobId,
      state: "completed",
      blobId: result.blob_id,
      owner: result.owner,
      namespace: result.namespace,
      recallVerified: false,
      backend: this.backend,
      provenance: this.provenance,
      requestedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      text: "",
    };
  }

  async recallRelevantLessons(
    query: string,
    options: RecallOptions = {},
  ): Promise<RecalledLesson[]> {
    const result = await this.client.recall({
      query,
      limit: options.limit ?? 10,
      namespace: options.namespace ?? this.namespace,
      sort: options.sort ?? "relevance",
      ...(options.maxDistance !== undefined
        ? { maxDistance: options.maxDistance }
        : {}),
    });
    return result.results.map((r) => ({
      blobId: r.blob_id,
      text: r.text,
      distance: r.distance,
      record: parseLessonFromMemoryText(r.text),
      provenance: this.provenance,
    }));
  }

  async verifyRecall(receipt: MemoryWriteReceipt): Promise<MemoryWriteReceipt> {
    if (receipt.state !== "completed" || !receipt.blobId) return receipt;
    const hits = await this.recallRelevantLessons(receipt.text.slice(0, 240), {
      limit: 20,
    });
    const matches = hits.filter((h) => h.blobId === receipt.blobId).length;
    return { ...receipt, recallVerified: matches > 0, recallMatches: matches };
  }
}
