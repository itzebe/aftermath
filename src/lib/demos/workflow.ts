import { InMemoryWorkflowStateStore } from "@/lib/adapters/workflow-state";
import { WorkflowEvidenceAdapter, type WorkflowDefinition } from "@/lib/adapters/workflow-evidence";

/**
 * Workflow demonstration.
 *
 * A controlled workflow with an explicit prerequisite. The operation requires a
 * validation step to have completed. The first attempt skips it and fails; the
 * prerequisite is recorded in the persisted state store. The second attempt is
 * gated on that state, so the same failure cannot recur silently.
 */

export const DEPLOY_WORKFLOW: WorkflowDefinition = {
  workflowId: "publish-artifact",
  operation: "publish_artifact_to_registry",
  requiredPrerequisites: [
    {
      id: "schema_validation",
      description:
        "The artifact must pass schema validation before it is published.",
    },
  ],
};

export function makeWorkflowAdapter(
  store: InMemoryWorkflowStateStore,
): WorkflowEvidenceAdapter {
  return new WorkflowEvidenceAdapter({
    definition: DEPLOY_WORKFLOW,
    store,
  });
}

export function makeWorkflowStore(): InMemoryWorkflowStateStore {
  return new InMemoryWorkflowStateStore();
}
