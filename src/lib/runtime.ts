import { loadConfig, type AftermathConfig } from "@/lib/config";
import { resolveMemoryAdapter, type MemoryAdapterResolution } from "@/lib/adapters/memory-factory";
import { buildSuiVerifier } from "@/lib/demos/finance";
import type { SuiVerifier } from "@/lib/adapters/sui-verifier";
import { FinanceEvidenceAdapter } from "@/lib/adapters/finance-evidence";
import { IncidentEvidenceAdapter } from "@/lib/adapters/incident-evidence";
import type { EvidenceAdapter } from "@/lib/adapters/evidence";
import type { AuditStore } from "@/lib/db/audit-store";
import { resolveDurableStores, type DurableStores } from "@/lib/db/durable-stores";
import { IncidentPipeline } from "@/lib/engines/pipeline";
import type { WorkflowStateStore } from "@/lib/adapters/workflow-state";
import { WorkflowEvidenceAdapter } from "@/lib/adapters/workflow-evidence";
import { DEPLOY_WORKFLOW } from "@/lib/demos/workflow";

/**
 * Server-side singletons. Every secret lives here and is never sent to the
 * browser. The UI learns about configuration only through redacted summaries.
 */
export interface Runtime {
  config: AftermathConfig;
  store: AuditStore;
  /**
   * The durable demonstration stores (job tracker + workflow state), sharing
   * one connection with the audit store. Exposed so the resumable runner can
   * persist progress across requests.
   */
  durable: DurableStores;
  memory: MemoryAdapterResolution;
  suiVerifier: SuiVerifier;
  financePipeline: IncidentPipeline;
  workflowStore: WorkflowStateStore;
  workflowPipeline: IncidentPipeline;
  /**
   * Evidence adapter for a user submission, chosen by the inferred domain. The
   * finance adapter performs a real read-only Tatum lookup when a digest is
   * present; otherwise the incident adapter reports honestly that no source is
   * connected.
   */
  resolveSubmissionEvidence(domain: "finance" | "incident"): EvidenceAdapter;
}

declare global {
  var __aftermathRuntime: Runtime | undefined;
}

function build(): Runtime {
  const config = loadConfig();
  const durable = resolveDurableStores(config);
  const store = durable.audit;
  const memory = resolveMemoryAdapter(config);
  const suiVerifier = buildSuiVerifier(config.tatum);
  const financeEvidence = new FinanceEvidenceAdapter(suiVerifier);

  const workflowStore = durable.workflow;
  const workflowEvidence = new WorkflowEvidenceAdapter({
    definition: DEPLOY_WORKFLOW,
    store: workflowStore,
  });

  return {
    config,
    store,
    durable,
    memory,
    suiVerifier,
    financePipeline: new IncidentPipeline({
      evidence: financeEvidence,
      memory: memory.adapter,
      store,
    }),
    workflowStore,
    workflowPipeline: new IncidentPipeline({
      evidence: workflowEvidence,
      memory: memory.adapter,
      store,
    }),
    resolveSubmissionEvidence(domain: "finance" | "incident"): EvidenceAdapter {
      return domain === "finance"
        ? new FinanceEvidenceAdapter(suiVerifier)
        : new IncidentEvidenceAdapter();
    },
  };
}

export function runtime(): Runtime {
  if (!globalThis.__aftermathRuntime) {
    globalThis.__aftermathRuntime = build();
  }
  return globalThis.__aftermathRuntime;
}

export async function resetRuntime(): Promise<void> {
  await globalThis.__aftermathRuntime?.store.close();
  globalThis.__aftermathRuntime = undefined;
}
