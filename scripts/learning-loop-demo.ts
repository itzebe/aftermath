/**
 * The learning-loop demonstration.
 *
 * This script exercises the complete cycle against the real investigation
 * pipeline and a real memory adapter:
 *
 *   1. A first incident asserts a transaction succeeded with no authoritative
 *      verification evidence. The engine investigates it, identifies the
 *      missing verification, and learns a safeguard requiring authoritative
 *      verification before a success claim may stand.
 *   2. The safeguard is persisted to the memory backend (Walrus Memory Mainnet
 *      when credentials are configured).
 *   3. A second incident carries the same failure pattern. The engine recalls
 *      the persisted safeguard, establishes that it applies, and the decision
 *      engine now *requires verification* where it previously concluded UNKNOWN.
 *   4. The script prints the original failure, its evidence, the learned
 *      safeguard, the persistence reference, the retrieved memory, why it
 *      applies, the changed verification requirement, and the new outcome.
 *
 * The two submissions are clearly labelled TEST FIXTURES: they are synthetic
 * material used to demonstrate the mechanism, not real production incidents.
 * The script never fabricates a transaction hash, a balance, or a Mainnet
 * confirmation, and it reports the memory backend's true state.
 *
 * Usage:
 *   npm run learning:demo
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "@/lib/config";
import { resolveAuditStore } from "@/lib/db/store-factory";
import { resolveMemoryAdapter } from "@/lib/adapters/memory-factory";
import { IncidentEvidenceAdapter } from "@/lib/adapters/incident-evidence";
import { runSubmissionPipeline } from "@/lib/engines/submission-pipeline";
import type { IncidentSubmission, SafeguardRecord } from "@/lib/schemas";

const FIRST_INCIDENT = `[TEST FIXTURE] 2026-03-01T10:00:00Z settlement-worker POST /v1/settle
The agent reported success for transaction settlement, but no transaction
verification record was captured for the settlement operation.`;

const SECOND_INCIDENT = `[TEST FIXTURE] 2026-03-02T09:15:00Z settlement-worker POST /v1/settle
The agent reported success for the settlement operation, but no transaction
verification record was captured and no authoritative receipt was retrieved.`;

function rule(title: string): void {
  process.stdout.write(`\n${"─".repeat(72)}\n${title}\n${"─".repeat(72)}\n`);
}

function reportRecord(record: SafeguardRecord, label: string): void {
  const { investigation, decision } = record;
  rule(label);
  process.stdout.write(`incident id      : ${record.incidentId}\n`);
  process.stdout.write(`domain / action  : ${investigation.domain} / ${investigation.actionType}\n`);
  process.stdout.write(`failure category : ${investigation.diagnosis.pattern}\n`);
  process.stdout.write(`evidence status  : ${investigation.authoritativeLookup.status}\n`);
  process.stdout.write(`decision         : ${decision.decision}\n`);
  process.stdout.write(`reason           : ${decision.reason}\n`);
  process.stdout.write(
    `applicable rules : ${decision.applicableRuleIds.length ? decision.applicableRuleIds.join(", ") : "(none)"}\n`,
  );
  process.stdout.write(
    `applied memories : ${(decision.applicableMemoryIds ?? []).length ? decision.applicableMemoryIds!.join(", ") : "(none)"}\n`,
  );

  const learned = record.learnedSafeguards?.[0];
  if (learned) {
    process.stdout.write(`\nlearned safeguard: ${learned.memoryId}@v${learned.version}\n`);
    process.stdout.write(`  authoritative  : ${learned.authoritative}\n`);
    process.stdout.write(`  rule           : ${learned.correctiveRule}\n`);
    process.stdout.write(`  basis          : ${learned.supportBasis}\n`);
    process.stdout.write(`  walrus backend : ${learned.walrus.backend}\n`);
    process.stdout.write(`  walrus blob    : ${learned.walrus.blobId ?? "(not persisted)"}\n`);
    process.stdout.write(`  persisted      : ${learned.walrus.persisted}\n`);
    process.stdout.write(`  recall verified: ${learned.walrus.recallVerified}\n`);
  } else {
    process.stdout.write("\nlearned safeguard: none\n");
  }

  if (record.safeguardApplications?.length) {
    process.stdout.write("\nrecall evaluation:\n");
    for (const a of record.safeguardApplications) {
      process.stdout.write(`  - ${a.memoryId} [${a.relation}] applied=${a.applicable}\n`);
      process.stdout.write(`      why     : ${a.relevance}\n`);
      process.stdout.write(`      applies : ${a.applicabilityBasis}\n`);
      if (a.contributedRule) process.stdout.write(`      rule    : ${a.contributedRule}\n`);
    }
  }

  if (record.behaviourChange) {
    const b = record.behaviourChange;
    process.stdout.write("\nbehaviour change:\n");
    process.stdout.write(`  changed     : ${b.changed}\n`);
    process.stdout.write(`  before      : ${b.beforeDecision}\n`);
    process.stdout.write(`  after       : ${b.afterDecision}\n`);
    if (b.addedRequiredChecks.length) {
      process.stdout.write(`  added checks:\n`);
      for (const c of b.addedRequiredChecks) process.stdout.write(`      - ${c}\n`);
    }
    process.stdout.write(`  explanation : ${b.explanation}\n`);
  } else {
    process.stdout.write("\nbehaviour change: none (no applicable memory)\n");
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const dir = mkdtempSync(path.join(tmpdir(), "aftermath-learning-"));
  const store = resolveAuditStore({ ...config, databaseUrl: null, dbPath: path.join(dir, "demo.db") });
  const memory = resolveMemoryAdapter(config).adapter;
  const status = await memory.status();

  process.stdout.write("AFTERMATH — deepest learning loop demonstration\n");
  process.stdout.write(`memory backend : ${memory.backend} (live=${memory.isLive})\n`);
  process.stdout.write(`backend state  : ${status.state} — ${status.detail}\n`);

  const deps = {
    resolveEvidence: () => new IncidentEvidenceAdapter(),
    memory,
    store,
  };

  try {
    const first = await runSubmissionPipeline(
      { text: FIRST_INCIDENT } satisfies IncidentSubmission,
      deps,
    );
    reportRecord(first, "STAGE 1-3 · first investigation: learn and persist");

    const second = await runSubmissionPipeline(
      { text: SECOND_INCIDENT } satisfies IncidentSubmission,
      deps,
    );
    reportRecord(second, "STAGE 4-6 · second investigation: recall and change behaviour");

    rule("VERDICT");
    const learned = first.learnedSafeguards?.[0];
    const secondApplied = (second.safeguardApplications ?? []).filter((a) => a.applicable);
    const changed = Boolean(second.behaviourChange?.changed);
    process.stdout.write(`safeguard learned        : ${learned ? learned.memoryId : "none"}\n`);
    process.stdout.write(`persisted to memory      : ${learned?.walrus.persisted ?? false}\n`);
    process.stdout.write(`recalled on second run   : ${(second.recalledMemories ?? []).length > 0}\n`);
    process.stdout.write(`applied on second run    : ${secondApplied.length > 0}\n`);
    process.stdout.write(`behaviour changed        : ${changed}\n`);
    if (second.behaviourChange) {
      process.stdout.write(
        `decision before -> after : ${second.behaviourChange.beforeDecision} -> ${second.behaviourChange.afterDecision}\n`,
      );
    }
    process.stdout.write(
      `\nThe loop is ${learned && changed ? "COMPLETE" : "INCOMPLETE"} for this run.\n`,
    );
  } finally {
    await store.close();
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
