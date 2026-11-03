import { runtime } from "@/lib/runtime";
import { loadConfig, relayerNetwork } from "@/lib/config";
import { maskSecret, redactServed, redactSubmission } from "@/lib/util/redact";
import { runAllScenarios, type DemoRunResult } from "@/lib/demos/runner";
import { runDemoBatch, type BatchResult } from "@/lib/demos/resumable-runner";
import { evaluate, type EvaluationMetrics, type ScenarioOutcome } from "@/lib/engines/evaluation";
import { runSubmissionPipeline, submissionId } from "@/lib/engines/submission-pipeline";
import { evaluatePublicSubmitAvailability } from "@/lib/api/public-submit-guard";
import { buildLearningLoop, type LearningLoop } from "@/lib/engines/learning-loop";
import { runAiInvestigation } from "@/lib/engines/ai-investigation";
import { resolveModelClient, AiAnalysisCache } from "@/lib/adapters/model-factory";
import { TtlCache } from "@/lib/api/cache";
import type { BackendHealth, MemoryStatus } from "@/lib/adapters/memory";
import type { AiAnalysis } from "@/lib/schemas";
import type {
  IncidentInputDraft,
  IncidentSubmission,
  SafeguardRecord,
} from "@/lib/schemas";

export interface ConfigurationStatus {
  memory: {
    backend: string;
    isLive: boolean;
    reason: string;
    relayerUrl: string;
    network: "mainnet" | "staging" | "unknown";
    namespace: string;
    accountId: string;
    privateKey: string;
  };
  tatum: {
    grpcUrl: string;
    rpcUrl: string;
    interface: string;
    apiKey: string;
    configured: boolean;
  };
  /**
   * AI-assisted analysis availability. `configured` reflects whether a free
   * provider key is present; it says nothing about whether a model actually ran
   * for any given record — that is recorded per-record in `aiAnalysis.ran`.
   */
  ai: {
    provider: string;
    model: string;
    configured: boolean;
    apiKey: string;
    /** Fixed statement of the cost posture, so the UI can state it plainly. */
    costNote: string;
  };
  persistence: {
    backend: "sqlite" | "postgres";
    /** True only when records are shared across instances. */
    durable: boolean;
    detail: string;
  };
  /**
   * Whether an anonymous visitor may submit an incident, and why.
   *
   * This mirrors the server-side decision in `api/public-submit-guard` exactly,
   * so the UI can present the public submission form when it is genuinely
   * available and the honest reason when it is not. It exposes no secret — only
   * the boolean and the human-readable reason.
   */
  publicSubmission: {
    available: boolean;
    reason: string;
  };
}

export function configurationStatus(): ConfigurationStatus {
  const rt = runtime();
  const config = loadConfig();
  return {
    memory: {
      backend: rt.memory.adapter.backend,
      isLive: rt.memory.adapter.isLive,
      reason: rt.memory.reason,
      relayerUrl: config.memory.serverUrl,
      network: relayerNetwork(config.memory.serverUrl),
      namespace: config.memory.namespace,
      accountId: maskSecret(config.memory.accountId),
      privateKey: maskSecret(config.memory.privateKey),
    },
    tatum: {
      grpcUrl: config.tatum.grpcUrl,
      rpcUrl: config.tatum.rpcUrl,
      interface: rt.suiVerifier.sourceName,
      apiKey: maskSecret(config.tatum.apiKey),
      configured: Boolean(config.tatum.apiKey),
    },
    ai: {
      provider: config.ai.provider,
      model: config.ai.model,
      configured: config.ai.provider !== "none" && Boolean(config.ai.apiKey),
      apiKey: maskSecret(config.ai.apiKey),
      costNote:
        "Free tier only. Groq serves openai/gpt-oss-120b at no charge; no paid " +
        "provider or model is reachable from this application.",
    },
    persistence: {
      backend: rt.store.backend,
      durable: rt.store.durable,
      detail: rt.store.detail,
    },
    publicSubmission: (() => {
      const availability = evaluatePublicSubmitAvailability(config);
      return { available: availability.available, reason: availability.reason };
    })(),
  };
}

export interface StoreCounts {
  incidents: number;
  verifiedFailures: number;
  activeRules: number;
  unresolved: number;
  completedLiveWrites: number;
  recallVerifiedWrites: number;
  simulatedWrites: number;
  totalWrites: number;
  records: number;
}

export interface OverviewPayload {
  counts: StoreCounts;
  configuration: ConfigurationStatus;
  tatumHealth: Awaited<ReturnType<ReturnType<typeof runtime>["suiVerifier"]["health"]>>;
  memoryHealth: Awaited<ReturnType<ReturnType<typeof runtime>["memory"]["adapter"]["validateMemoryAvailability"]>>;
  memoryStatus: Awaited<ReturnType<ReturnType<typeof runtime>["memory"]["adapter"]["status"]>>;
  mainnetRequirement: {
    required: number;
    completedLive: number;
    recallVerified: number;
    remaining: number;
    satisfied: boolean;
  };
  evaluation: EvaluationMetrics | null;
  lastRunAt: string | null;
}

/**
 * How long a successful overview is reused. The overview makes three external
 * calls (Tatum, the Walrus relayer) and several aggregate queries, so a short
 * cache turns a homepage refresh loop into one set of calls per window instead
 * of one per visitor. Ten seconds is short enough that a state change is
 * visible almost immediately, and the UI always re-reads on the next window.
 */
const OVERVIEW_TTL_MS = 10_000;

/**
 * The ceiling for each live status probe in the overview.
 *
 * The homepage awaits the overview, so an unbounded probe turns a slow upstream
 * into a slow page. Six seconds is well above a healthy relayer or Tatum round
 * trip (both answer in well under a second) and well below a page-load budget,
 * so it only fires when an upstream is genuinely stalled — and when it does, the
 * overview still renders with that probe reported as unavailable.
 *
 * Configurable so a test can bound it tightly instead of waiting the full budget.
 */
const DEFAULT_PROBE_BUDGET_MS = 6_000;

function probeBudgetMs(): number {
  const raw = Number(process.env.AFTERMATH_PROBE_BUDGET_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PROBE_BUDGET_MS;
}

/**
 * Resolve `probe` within `budgetMs`, or resolve to `fallback`.
 *
 * Used for the optional live status probes: a probe that overruns its budget (or
 * rejects) must not hold up the page or fail the whole payload, because none of
 * these probes is required to render it. The fallback states the honest reason,
 * so a degraded status is never presented as a healthy one.
 */
async function probeWithin<T>(
  probe: Promise<T>,
  budgetMs: number,
  fallback: () => T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback()), budgetMs);
  });
  try {
    return await Promise.race([probe.catch(() => fallback()), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

let overviewCache: { at: number; payload: OverviewPayload } | null = null;
/**
 * The in-flight overview build, if any.
 *
 * A simultaneous burst of first requests (a cold instance serving the homepage,
 * the memory page, and a retry together) must not each start their own build:
 * that fans out into one set of Walrus/Tatum probes and one batch of aggregate
 * queries *per request*, which is what pushes a cold serverless instance past
 * the platform timeout. Concurrent misses share this one promise, exactly as
 * {@link TtlCache} does for the other read views.
 */
let overviewInflight: Promise<OverviewPayload> | null = null;

/** Drop the cached overview. Exported for tests and after a reset. */
export function resetOverviewCache(): void {
  overviewCache = null;
  overviewInflight = null;
}

async function buildOverview(): Promise<OverviewPayload> {
  const rt = runtime();
  const counts = await rt.store.counts();
  // The three live probes reach the Walrus relayer and Tatum. Each is already
  // configured with its own transport timeout, but a stalled upstream can still
  // leave the whole request waiting far longer than a page load may. They are
  // bounded here as well, and — because none of them is required to render the
  // page — a probe that does not answer within its budget resolves to an honest
  // "unavailable" state rather than failing the whole overview. The page then
  // shows real counts with a degraded status, instead of hanging or erroring.
  const [tatumHealth, memoryHealth, memoryStatus] = await Promise.all([
    probeWithin(rt.suiVerifier.health(), probeBudgetMs(), () => ({
      ok: false,
      detail: "The Tatum Sui interface did not answer within the probe budget.",
    })),
    probeWithin(rt.memory.adapter.validateMemoryAvailability(), probeBudgetMs(), () => ({
      ok: false,
      detail: "The Walrus Memory relayer did not answer within the probe budget.",
    })),
    probeWithin(rt.memory.adapter.status(), probeBudgetMs(), () => ({
      state: "MAINNET_UNAVAILABLE" as const,
      reachable: false,
      authenticated: false,
      authFailed: false,
      authUpstreamUnavailable: true,
      detail: "The Walrus Memory relayer did not answer within the probe budget.",
    })),
  ]);

  const lastRun = (await rt.store.listScenarioRuns(1))[0];

  let evaluation: EvaluationMetrics | null = null;
  if (lastRun) {
    const payload = lastRun.payload as DemoRunResult;
    evaluation = evaluate(payload.scenarios.map((s) => s.outcome));
  }

  const required = 10;
  const completedLive = counts.completedLiveWrites;

  return {
    counts,
    configuration: configurationStatus(),
    tatumHealth,
    memoryHealth,
    memoryStatus,
    mainnetRequirement: {
      required,
      completedLive,
      recallVerified: counts.recallVerifiedWrites,
      remaining: Math.max(0, required - completedLive),
      satisfied: completedLive >= required,
    },
    evaluation,
    lastRunAt: lastRun?.ranAt ?? null,
  };
}

/**
 * The overview payload, memoised for {@link OVERVIEW_TTL_MS}.
 *
 * Only a *successful* build is cached. A failure clears the cache and rethrows,
 * so a dependency going down is never masked by a stale success — the caller
 * still sees the error and the next request retries immediately.
 *
 * Concurrent misses are single-flighted: a burst of first requests shares one
 * build rather than starting one each.
 */
export async function getOverview(): Promise<OverviewPayload> {
  const now = Date.now();
  if (overviewCache && now - overviewCache.at < OVERVIEW_TTL_MS) {
    return overviewCache.payload;
  }
  if (overviewInflight) {
    return overviewInflight;
  }
  const load = buildOverview();
  overviewInflight = load;
  try {
    const payload = await load;
    overviewCache = { at: Date.now(), payload };
    return payload;
  } catch (err) {
    overviewCache = null;
    throw err;
  } finally {
    overviewInflight = null;
  }
}

export async function runScenarios(): Promise<DemoRunResult> {
  const rt = runtime();
  // A scenario run is a controlled demonstration, so it starts from a known
  // state. Without this, incidents, rules, and simulated memories accumulate
  // across runs and the same button produces different numbers each time.
  // Live Mainnet write records are preserved: they are irreversible on-chain
  // artefacts and the ledger must keep counting them.
  await rt.store.resetSimulated();
  await rt.memory.adapter.reset?.();
  const result = await runAllScenarios({
    config: loadConfig(),
    store: rt.store,
    memory: rt.memory.adapter,
    workflowStore: rt.workflowStore,
  });
  await rt.store.saveScenarioRun(`run-${Date.now()}`, result.ranAt, result);
  return result;
}

/**
 * Run one bounded batch of the resumable demonstration.
 *
 * This is the production entry point. A single serverless invocation cannot
 * complete every scenario inside the host's time limit, so the plan is advanced
 * in bounded slices and progress is persisted after each scenario. The caller
 * repeats until `continuationRequired` is false.
 */
export async function runScenarioBatch(options: {
  restart?: boolean;
  budgetMs?: number;
} = {}): Promise<BatchResult> {
  const rt = runtime();
  const result = await runDemoBatch({
    stores: rt.durable,
    config: loadConfig(),
    memory: rt.memory.adapter,
    restart: options.restart,
    budgetMs: options.budgetMs,
  });
  // Persist a run snapshot only when the job has actually reached a terminal
  // state, so the evaluation panel never shows a partial run as if it were
  // the finished demonstration. The snapshot is the *whole* job's reports,
  // loaded from the durable store, not just this request's slice.
  if (result.done || (!result.continuationRequired && result.progress.failed > 0)) {
    const rows = await rt.durable.jobs.listScenarios(result.jobId);
    const scenarios = rows
      .filter((r) => !r.internal && r.report)
      .map((r) => r.report!) as DemoRunResult["scenarios"];
    const ranAt = new Date().toISOString();
    await rt.store.saveScenarioRun(`run-${Date.now()}`, ranAt, {
      ranAt,
      scenarios,
      memoryBackend: rt.memory.adapter.backend,
      memoryDegraded: !rt.memory.adapter.isLive,
      memoryReason: rt.memory.adapter.isLive
        ? "Live Walrus Memory backend."
        : "Simulated memory backend (credentials not configured).",
    });
  }
  return result;
}

/** Progress of the current (or latest) resumable demonstration, for the UI. */
export async function getDemoProgress(): Promise<{
  jobId: string;
  status: string;
  total: number;
  completed: number;
  failed: number;
  remaining: number;
  scenarios: Array<{
    stepId: string;
    title: string;
    domain: string;
    simulated: boolean;
    state: string;
    attempts: number;
    decision?: string;
    evidenceStatus?: string;
    error?: string | null;
  }>;
} | null> {
  const rt = runtime();
  await rt.durable.migrate();
  const job = await rt.durable.jobs.latestJob();
  if (!job) return null;
  const rows = await rt.durable.jobs.listScenarios(job.jobId);
  const visible = rows.filter((r) => !r.internal);
  return {
    jobId: job.jobId,
    status: job.status,
    total: visible.length,
    completed: visible.filter((r) => r.state === "completed").length,
    failed: visible.filter((r) => r.state === "failed").length,
    remaining: visible.filter((r) => r.state === "pending" || r.state === "executing").length,
    scenarios: visible.map((r) => ({
      stepId: r.stepId,
      title: r.title,
      domain: r.domain,
      simulated: r.simulated,
      state: r.state,
      attempts: r.attempts,
      decision: r.report?.decision,
      evidenceStatus: r.report?.evidenceStatus,
      error: r.lastError,
    })),
  };
}

export async function getIncidents(limit = 200) {
  // Public read: the stored Incident carries `intendedOutcome`, which is derived
  // from the untrusted `expectedBehavior`. Redact in depth at the boundary so a
  // credential pasted into the submission cannot be served from here.
  const incidents = await runtime().store.listIncidents(limit);
  return redactServed(incidents);
}

export async function getRules() {
  // Public read. Rules carry only derived, structured text, but redacting the
  // boundary uniformly means a rule statement echoing submission prose cannot
  // leak a credential either.
  return redactServed(await runtime().store.listRules());
}

export async function getMemoryWrites(limit = 200) {
  // Public read. A receipt's `text` is the exact payload sent to the memory
  // backend; redact it here so the ledger cannot echo a credential.
  return redactServed(await runtime().store.listMemoryWrites(limit));
}

/**
 * How long live Walrus availability/status results are reused.
 *
 * These are live upstream calls. A 10-second window means the memory page (and
 * the overview) make at most one set of calls per window per instance rather
 * than one per visitor, while a status change is still visible almost
 * immediately. The maximum expected staleness is therefore ~10s on the
 * availability and status fields. Only a *successful* call is cached: if the
 * adapter throws, nothing is stored, so an upstream outage is reported rather
 * than masked.
 */
const MEMORY_STATUS_TTL_MS = 10_000;

/**
 * The live memory backend health, cached for {@link MEMORY_STATUS_TTL_MS}.
 *
 * The returned objects are the adapter's own honest values — a degraded or
 * unauthenticated status is cached as-is, never rewritten to a fabricated
 * healthy one.
 */
export async function getMemoryStatus(): Promise<{
  health: BackendHealth;
  status: MemoryStatus;
  cached: boolean;
}> {
  const rt = runtime();
  const { value, cached } = await readCache.getOrLoad(
    "memory-status",
    MEMORY_STATUS_TTL_MS,
    async () => {
      const [health, status] = await Promise.all([
        rt.memory.adapter.validateMemoryAvailability(),
        rt.memory.adapter.status(),
      ]);
      return { health, status };
    },
  );
  return { ...value, cached };
}

export async function getEvaluation(): Promise<EvaluationMetrics | null> {
  const rt = runtime();
  const lastRun = (await rt.store.listScenarioRuns(1))[0];
  if (!lastRun) return null;
  const payload = lastRun.payload as DemoRunResult;
  return evaluate(payload.scenarios.map((s) => s.outcome));
}

export async function getScenarioOutcomes(): Promise<ScenarioOutcome[]> {
  const rt = runtime();
  const lastRun = (await rt.store.listScenarioRuns(1))[0];
  if (!lastRun) return [];
  const payload = lastRun.payload as DemoRunResult;
  return payload.scenarios.map((s) => s.outcome);
}

export async function getLastRun(): Promise<DemoRunResult | null> {
  const lastRun = (await runtime().store.listScenarioRuns(1))[0];
  return lastRun ? (lastRun.payload as DemoRunResult) : null;
}

export async function resetAll(): Promise<void> {
  await runtime().store.reset();
  // The overview and the cached read views aggregate the tables just cleared;
  // drop the caches so the next read reflects the reset immediately rather than
  // after the TTL.
  resetOverviewCache();
  resetReadCaches();
}

/* ------------------------------------------------------------------ *
 * User-submitted incident workflow
 * ------------------------------------------------------------------ */

/**
 * In-process cache of AI readings, keyed by submission content id. Bounded and
 * best-effort: it avoids a second inference call on a duplicate submission but
 * a miss simply re-runs the analysis.
 */
const aiCache = new AiAnalysisCache<AiAnalysis>(64, 10 * 60_000);

/**
 * Investigate a submitted incident end to end and persist the Safeguard Record.
 *
 * The submission is validated by the route before it reaches here. Nothing in
 * this path executes the submitted material; it is parsed, assessed, matched
 * against memory, and turned into a safeguard recommendation. When a free model
 * is configured, an additive AI reading is attached — it can enrich the record
 * but can never change the evidence status, diagnosis, decision, or
 * verification, all of which the deterministic engine owns.
 */
export async function submitIncident(
  submission: IncidentSubmission,
): Promise<SafeguardRecord> {
  const rt = runtime();
  // Ensure the durable tables exist before the first write, so a fresh
  // deployment does not fail on the very first submission.
  await rt.durable.migrate();
  const config = loadConfig();
  const recordId = submissionId(submission);
  const record = await runSubmissionPipeline(submission, {
    resolveEvidence: (domain) => rt.resolveSubmissionEvidence(domain),
    memory: rt.memory.adapter,
    store: rt.store,
    analyze: async (s) => {
      // A duplicate submission within the cache window reuses its reading,
      // spending no additional free-tier quota.
      const cached = aiCache.get(recordId);
      if (cached) return cached;
      const analysis = await runAiInvestigation({
        client: resolveModelClient(config),
        text: s.text,
        timeoutMs: config.ai.timeoutMs,
        maxOutputTokens: config.ai.maxOutputTokens,
        ...(s.service ? { service: s.service } : {}),
        ...(s.expectedBehavior ? { expectedBehavior: s.expectedBehavior } : {}),
        ...(s.actualBehavior ? { actualBehavior: s.actualBehavior } : {}),
      });
      // Only cache a reading that actually ran; a transient failure should be
      // retried on the next submission, not pinned for ten minutes.
      if (analysis.ran) aiCache.set(recordId, analysis);
      return analysis;
    },
  });
  // A new record changes the learning history and every derived view; drop the
  // cached read views so the next read reflects it immediately rather than
  // after the TTL.
  readCache.clear();
  return record;
}

export async function getSafeguardRecords(limit = 100): Promise<SafeguardRecord[]> {
  const records = await runtime().store.listSafeguardRecords(limit);
  return records.map(withRedactedRecord);
}

export async function getSafeguardRecord(
  recordId: string,
): Promise<SafeguardRecord | null> {
  const record = await runtime().store.getSafeguardRecord(recordId);
  return record ? withRedactedRecord(record) : null;
}

/**
 * Redact a record at the read boundary, in depth.
 *
 * The submission field is redacted on its own terms (it holds the raw pasted
 * material). The rest of the record is deep-redacted with {@link redactServed},
 * which strips credential-shaped strings from every free-text value while
 * leaving identity, reference, timestamp, and enum fields intact. That protects
 * the *derived* copies of the untrusted fields — `intendedOutcome`,
 * `investigation.categories.confirmedFacts` (value and source), `summarise`,
 * and the memory-write payload text — which a record written before this
 * boundary existed may still hold raw.
 *
 * A record's own ids, evidence references, and transaction digests survive,
 * because redaction is key-aware and those keys are on the preserve list.
 */
export function redactRecordForServing(record: SafeguardRecord): SafeguardRecord {
  return withRedactedRecord(record);
}

function withRedactedRecord(record: SafeguardRecord): SafeguardRecord {
  const { submission, ...rest } = record;
  return {
    ...(redactServed(rest) as Omit<SafeguardRecord, "submission">),
    submission: redactSubmission(submission),
  };
}

export async function countSafeguardRecords(): Promise<number> {
  return runtime().store.countSafeguardRecords();
}

/**
 * How long the learning-loop view model is reused.
 *
 * Building it loads up to {@link LEARNING_LOOP_RECORD_LIMIT} records and derives
 * every view, so a short cache turns a page refresh loop into one rebuild per
 * window. Fifteen seconds keeps a freshly-learned safeguard visible almost
 * immediately while bounding the work an anonymous caller can trigger.
 */
const LEARNING_LOOP_TTL_MS = 15_000;
const LEARNING_LOOP_RECORD_LIMIT = 500;

const readCache = new TtlCache();

/** Drop every cached read view. Exported for tests and after a reset. */
export function resetReadCaches(): void {
  readCache.clear();
}

/**
 * The learning-loop view model, derived from the durable Safeguard Records.
 *
 * Read-only and anonymous: it exposes the learning history, the retrieval
 * trail, the visible behaviour changes, the learning impact, and the provenance
 * of every claim — all computed from records the engine actually produced.
 *
 * Cached for {@link LEARNING_LOOP_TTL_MS}. Only a successful build is cached; a
 * store failure propagates so the route reports it instead of serving a stale
 * success.
 */
export async function getLearningLoop(): Promise<LearningLoop> {
  const rt = runtime();
  const { value } = await readCache.getOrLoad(
    "learning-loop",
    LEARNING_LOOP_TTL_MS,
    async () =>
      buildLearningLoop(
        // The view model surfaces `investigation.summary` and safeguard text on
        // a public route, so the records it reads pass through the same read
        // boundary. Metrics are computed from structured fields, which the
        // boundary preserves, so the counts are unchanged.
        (await rt.store.listSafeguardRecords(LEARNING_LOOP_RECORD_LIMIT)).map(
          withRedactedRecord,
        ),
      ),
  );
  return value;
}

export type { IncidentInputDraft };
