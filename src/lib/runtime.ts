import { loadConfig, type AftermathConfig } from "@/lib/config";
import { resolveMemoryAdapter, type MemoryAdapterResolution } from "@/lib/adapters/memory-factory";
import { buildSuiVerifier } from "@/lib/demos/finance";
import type { SuiVerifier } from "@/lib/adapters/sui-verifier";
import { FinanceEvidenceAdapter } from "@/lib/adapters/finance-evidence";
import type { AuditStore } from "@/lib/db/audit-store";
import { resolveAuditStore } from "@/lib/db/store-factory";
import { IncidentPipeline } from "@/lib/engines/pipeline";
import { InMemoryWorkflowStateStore } from "@/lib/adapters/workflow-state";
import { WorkflowEvidenceAdapter } from "@/lib/adapters/workflow-evidence";
import { DEPLOY_WORKFLOW } from "@/lib/demos/workflow";

/**
 * Server-side singletons. Every secret lives here and is never sent to the
 * browser. The UI learns about configuration only through redacted summaries.
 */
export interface Runtime {
  config: AftermathConfig;
  store: AuditStore;
  memory: MemoryAdapterResolution;
  suiVerifier: SuiVerifier;
  financePipeline: IncidentPipeline;
  workflowStore: InMemoryWorkflowStateStore;
  workflowPipeline: IncidentPipeline;
}

declare global {
  var __aftermathRuntime: Runtime | undefined;
}

function build(): Runtime {
  const config = loadConfig();
  const store = resolveAuditStore(config);
  const memory = resolveMemoryAdapter(config);
  const suiVerifier = buildSuiVerifier(config.tatum);
  const financeEvidence = new FinanceEvidenceAdapter(suiVerifier);

  const workflowStore = new InMemoryWorkflowStateStore();
  const workflowEvidence = new WorkflowEvidenceAdapter({
    definition: DEPLOY_WORKFLOW,
    store: workflowStore,
  });

  return {
    config,
    store,
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
