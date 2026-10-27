import { loadConfig, type AftermathConfig } from "@/lib/config";
import { resolveMemoryAdapter, type MemoryAdapterResolution } from "@/lib/adapters/memory-factory";
import { TatumSuiAdapter } from "@/lib/adapters/tatum-sui";
import { FinanceEvidenceAdapter } from "@/lib/adapters/finance-evidence";
import { AftermathStore } from "@/lib/db/store";
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
  store: AftermathStore;
  memory: MemoryAdapterResolution;
  tatum: TatumSuiAdapter;
  financePipeline: IncidentPipeline;
  workflowStore: InMemoryWorkflowStateStore;
  workflowPipeline: IncidentPipeline;
}

declare global {
  var __aftermathRuntime: Runtime | undefined;
}

function build(): Runtime {
  const config = loadConfig();
  const store = new AftermathStore(config.dbPath);
  const memory = resolveMemoryAdapter(config);
  const tatum = new TatumSuiAdapter(config.tatum);
  const financeEvidence = new FinanceEvidenceAdapter(tatum);

  const workflowStore = new InMemoryWorkflowStateStore();
  const workflowEvidence = new WorkflowEvidenceAdapter({
    definition: DEPLOY_WORKFLOW,
    store: workflowStore,
  });

  return {
    config,
    store,
    memory,
    tatum,
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

export function resetRuntime(): void {
  globalThis.__aftermathRuntime?.store.close();
  globalThis.__aftermathRuntime = undefined;
}
