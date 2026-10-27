import { MemWal } from "@mysten-incubation/memwal";
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
import { relayerNetwork, type AftermathConfig } from "@/lib/config";
import { redact } from "@/lib/util/redact";

/**
 * The subset of the MemWal client this adapter uses. Declaring it here keeps
 * the adapter honest about which SDK methods it depends on, and lets tests
 * supply a stand-in at the network boundary (the only place a fake is
 * justified, since the real client requires credentials and a live relayer).
 */
export interface MemWalClientLike {
  health(): Promise<{ status: string; version?: string; relayerVersion?: string; apiVersion?: string; write_ready?: boolean }>;
  remember(
    text: string,
    options?: { idempotencyKey?: string },
  ): Promise<{ job_id: string; status: string }>;
  getRememberStatus(jobId: string): Promise<{
    job_id: string;
    status: "pending" | "running" | "uploaded" | "done" | "failed" | "not_found";
    blob_id?: string;
    owner?: string;
    namespace?: string;
    error?: string;
  }>;
  waitForRememberJob(jobId: string): Promise<{
    id: string;
    blob_id: string;
    owner: string;
    namespace: string;
  }>;
  recall(params: {
    query: string;
    limit?: number;
    namespace?: string;
    sort?: "relevance" | "recent";
    maxDistance?: number;
  }): Promise<{
    results: Array<{ blob_id: string; text: string; distance: number; created_at?: string }>;
  }>;
  destroy?(): void;
}

/**
 * Real Walrus Memory adapter backed by @mysten-incubation/memwal.
 *
 * The SDK returns after the relayer accepts a background job. A write is only
 * counted as complete once the job reaches `done` and returns a blob id, and
 * only counted as verified once a recall query returns the record.
 */
export class MemWalMemoryAdapter implements MemoryAdapter {
  readonly backend: MemoryBackendId;
  readonly provenance = "live" as const;
  readonly isLive = true;

  private client: MemWalClientLike | null = null;
  private initPromise: Promise<BackendHealth> | null = null;

  constructor(
    private readonly config: AftermathConfig,
    /** Test seam. Production callers omit this and use the real SDK. */
    private readonly clientFactory?: () => MemWalClientLike,
  ) {
    const network = relayerNetwork(config.memory.serverUrl);
    this.backend =
      network === "mainnet"
        ? "memwal-mainnet"
        : network === "staging"
          ? "memwal-staging"
          : "memwal-unknown";
  }

  private buildClient(): MemWalClientLike {
    if (this.clientFactory) return this.clientFactory();
    const { privateKey, accountId, serverUrl, namespace } = this.config.memory;
    if (!privateKey || !accountId) {
      throw new Error(
        "Walrus Memory credentials are incomplete: both MEMWAL_PRIVATE_KEY " +
          "and MEMWAL_ACCOUNT_ID are required for the live adapter.",
      );
    }
    return MemWal.create({
      key: privateKey,
      accountId,
      serverUrl,
      namespace,
    }) as unknown as MemWalClientLike;
  }

  initialize(): Promise<BackendHealth> {
    if (!this.initPromise) {
      this.initPromise = this.doInitialize();
    }
    return this.initPromise;
  }

  private async doInitialize(): Promise<BackendHealth> {
    try {
      this.client = this.buildClient();
      return await this.probeHealth();
    } catch (err) {
      const e = err as Error;
      return {
        ok: false,
        detail: `Walrus Memory initialization failed: ${redact(e.message)}`,
      };
    }
  }

  async validateMemoryAvailability(): Promise<BackendHealth> {
    // Lazily build so this method is safe to call on its own, not only after
    // initialize(). A caller should never have to know the order.
    if (!this.client) {
      try {
        this.client = this.buildClient();
      } catch (err) {
        return {
          ok: false,
          detail: `Walrus Memory client could not be built: ${redact((err as Error).message)}`,
        };
      }
    }
    return this.probeHealth();
  }

  private async probeHealth(): Promise<BackendHealth> {
    if (!this.client) {
      return { ok: false, detail: "Client not initialized." };
    }
    try {
      const health = await this.client.health();
      return {
        ok: health.status === "ok" || health.status === "healthy",
        detail: `Relayer responded with status "${health.status}".`,
        relayerVersion: health.relayerVersion ?? health.version,
        apiVersion: health.apiVersion,
        writeReady: health.write_ready,
      };
    } catch (err) {
      const e = err as Error;
      return { ok: false, detail: `Relayer health check failed: ${redact(e.message)}` };
    }
  }

  private async writeText(
    kind: "incident" | "lesson",
    text: string,
    idempotencyKey?: string,
  ): Promise<MemoryWriteReceipt> {
    const base: MemoryWriteReceipt = {
      writeId: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      jobId: null,
      state: "requested",
      recallVerified: false,
      backend: this.backend,
      provenance: this.provenance,
      requestedAt: new Date().toISOString(),
      text,
    };

    const health = await this.initialize();
    if (!health.ok || !this.client) {
      return {
        ...base,
        state: "failed",
        error: `memory backend unavailable: ${health.detail}`,
      };
    }

    let jobId: string | null = null;
    try {
      // `remember` returns as soon as the relayer accepts the job. Acceptance
      // is not completion: the job id is all we have at this point.
      const accepted = idempotencyKey
        ? await this.client.remember(text, { idempotencyKey })
        : await this.client.remember(text);
      jobId = accepted.job_id;
      const requested: MemoryWriteReceipt = { ...base, jobId };

      // One-shot status read so the ledger can show a genuine `processing`
      // state rather than assuming progress after acceptance.
      let state: MemoryWriteReceipt["state"] = "requested";
      try {
        const status = await this.client.getRememberStatus(jobId);
        if (status.status === "failed") {
          return {
            ...requested,
            state: "failed",
            error: status.error ?? "relayer reported the job as failed",
            completedAt: new Date().toISOString(),
          };
        }
        if (
          status.status === "running" ||
          status.status === "pending" ||
          status.status === "uploaded"
        ) {
          state = "processing";
        }
      } catch {
        // A status read that fails must not fail the write; the wait below is
        // the authority on the outcome.
      }
      const processing: MemoryWriteReceipt = { ...requested, state };

      const completed = await this.client.waitForRememberJob(jobId);
      const done: MemoryWriteReceipt = {
        ...processing,
        state: "completed",
        blobId: completed.blob_id,
        owner: completed.owner,
        namespace: completed.namespace,
        completedAt: new Date().toISOString(),
      };

      return await this.verifyRecall(done);
    } catch (err) {
      const e = err as Error;
      return {
        ...base,
        jobId,
        state: "failed",
        error: redact(e.message),
        completedAt: new Date().toISOString(),
      };
    }
  }

  rememberIncident(incident: Incident): Promise<MemoryWriteReceipt> {
    return this.writeText(
      "incident",
      incidentToMemoryText(incident),
      `incident:${incident.incidentId}`,
    );
  }

  rememberLesson(lesson: CorrectiveLessonRecord): Promise<MemoryWriteReceipt> {
    return this.writeText(
      "lesson",
      lessonToMemoryText(lesson),
      `lesson:${lesson.domain}:${lesson.failure_pattern}:${lesson.scope}:v${lesson.rule_version}`,
    );
  }

  async waitForWriteCompletion(jobId: string): Promise<MemoryWriteReceipt> {
    const base: MemoryWriteReceipt = {
      writeId: `poll-${jobId}`,
      kind: "lesson",
      jobId,
      state: "processing",
      recallVerified: false,
      backend: this.backend,
      provenance: this.provenance,
      requestedAt: new Date().toISOString(),
      text: "",
    };
    if (!this.client) {
      return { ...base, state: "failed", error: "Client not initialized." };
    }
    try {
      const result = await this.client.waitForRememberJob(jobId);
      const done: MemoryWriteReceipt = {
        ...base,
        state: "completed",
        blobId: result.blob_id,
        owner: result.owner,
        namespace: result.namespace,
        completedAt: new Date().toISOString(),
      };
      return await this.verifyRecall(done);
    } catch (err) {
      const e = err as Error;
      return { ...base, state: "failed", error: redact(e.message) };
    }
  }

  async recallRelevantLessons(
    query: string,
    options: RecallOptions = {},
  ): Promise<RecalledLesson[]> {
    const health = await this.initialize();
    if (!health.ok || !this.client) return [];

    const result = await this.client.recall({
      query,
      limit: options.limit ?? 10,
      namespace: options.namespace ?? this.config.memory.namespace,
      sort: options.sort ?? "relevance",
      ...(options.maxDistance !== undefined
        ? { maxDistance: options.maxDistance }
        : {}),
    });

    return result.results.map((r) => ({
      blobId: r.blob_id,
      text: r.text,
      distance: r.distance,
      createdAt: r.created_at,
      record: parseLessonFromMemoryText(r.text),
      provenance: this.provenance,
    }));
  }

  async verifyRecall(receipt: MemoryWriteReceipt): Promise<MemoryWriteReceipt> {
    if (receipt.state !== "completed" || !receipt.blobId) return receipt;
    try {
      const hits = await this.recallRelevantLessons(receipt.text.slice(0, 240), {
        limit: 20,
        sort: "recent",
      });
      const matches = hits.filter((h) => h.blobId === receipt.blobId).length;
      return {
        ...receipt,
        recallVerified: matches > 0,
        recallMatches: matches,
      };
    } catch (err) {
      const e = err as Error;
      return {
        ...receipt,
        recallVerified: false,
        error: `recall verification failed: ${redact(e.message)}`,
      };
    }
  }

  destroy(): void {
    this.client?.destroy?.();
    this.client = null;
    this.initPromise = null;
  }
}
