"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  BehaviourChangeEntry,
  LearningHistoryEntry,
  LearningLoop,
  LearningProvenanceEntry,
  MemoryRetrievalEntry,
} from "@/lib/engines/learning-loop";
import {
  EmptyState,
  Loading,
  Metric,
  Notice,
  PageHeader,
  Panel,
  Pill,
  Section,
  type Tone,
} from "@/components/ui";

/**
 * The Learning Loop.
 *
 * A public, anonymous view of the product's memory: what it learned, what it
 * recalled, what the recalled safeguard actually changed, and where every claim
 * came from. Every figure is computed from durable Safeguard Records; nothing is
 * illustrative and nothing is a simulated before/after screen — the before/after
 * is the decision engine's own output with and without the applicable memory.
 */
export default function LearningPage() {
  const [data, setData] = useState<LearningLoop | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/learning")
      .then((r) => r.json())
      .then((d: LearningLoop) => {
        if (!cancelled) setData(d);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div>
        <PageHeader eyebrow="Learning loop" title="Learning Loop" />
        <Panel>
          <p className="text-[0.875rem] text-signal-bad">{error}</p>
        </Panel>
      </div>
    );
  }
  if (!data) return <Loading label="Loading the learning loop…" />;

  const { impact } = data;
  const influenced = data.behaviourChanges.filter((b) => b.attributableToMemory);
  const hasAnyLearning = data.history.length > 0;

  return (
    <div className="space-y-16 md:space-y-20">
      <PageHeader
        eyebrow="Learning loop"
        title="Memories that change the product"
        lead="Every verified failure leaves a safeguard. This page shows the loop end to end: what was learned, what was recalled, and — the part that matters — what a recalled safeguard actually changed in a later investigation."
        right={
          <Link href="/records" className="action">
            Browse Safeguard Records
          </Link>
        }
      />

      {!hasAnyLearning ? (
        <EmptyState title="No investigations yet">
          Submit an incident from the workspace. A verified failure leaves a
          safeguard; a later incident recalls it and the change is recorded here.
        </EmptyState>
      ) : (
        <>
          <LearningDiagram />

          {/* ---- D. Learning impact -------------------------------- */}
          <Section
            id="impact"
            eyebrow="Section D"
            title="Learning impact"
            lead="Every figure is counted from durable records, never estimated. Test fixtures are excluded from production evidence and counted separately."
          >
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Metric
                label="Verified safeguards"
                value={impact.totalVerifiedSafeguards}
                tone={impact.totalVerifiedSafeguards > 0 ? "ok" : "neutral"}
                sub="Authoritative safeguards learned from a verified failure."
              />
              <Metric
                label="Memories persisted"
                value={impact.safeguardsPersisted}
                tone={impact.safeguardsPersisted > 0 ? "ok" : "warn"}
                sub="Safeguards durably written to the memory backend with a blob id."
              />
              <Metric
                label="Recall-verified"
                value={impact.safeguardsRecallVerified}
                tone={impact.safeguardsRecallVerified > 0 ? "ok" : "warn"}
                sub="Persisted safeguards a recall query returned."
              />
              <Metric
                label="Memories recalled"
                value={impact.memoriesRecalled}
                tone="info"
                sub="Historical records retrieved for an investigation."
              />
              <Metric
                label="Memories applied"
                value={impact.memoriesApplied}
                tone="info"
                sub="Recalled memories whose conditions actually matched."
              />
              <Metric
                label="Investigations influenced"
                value={impact.investigationsInfluenced}
                tone={impact.investigationsInfluenced > 0 ? "ok" : "neutral"}
                sub="Investigations whose verdict or required checks a memory changed."
              />
              <Metric
                label="Requirements strengthened"
                value={impact.verificationRequirementsStrengthened}
                tone={
                  impact.verificationRequirementsStrengthened > 0 ? "ok" : "neutral"
                }
                sub="Investigations where a memory added a required verification check."
              />
              <Metric
                label="Repeat preventions"
                value={impact.demonstratedRepeatPreventions}
                tone={impact.demonstratedRepeatPreventions > 0 ? "ok" : "neutral"}
                sub="A memory learned earlier changed a later investigation's decision."
              />
            </div>
            {impact.fixtures.records > 0 ? (
              <div className="mt-4">
                <Notice tone="warn" title="Test fixtures present">
                  {impact.fixtures.records} record(s) and {impact.fixtures.safeguards}{" "}
                  safeguard(s) are labelled TEST FIXTURES and are excluded from the
                  production figures above. They exist for automated tests only.
                </Notice>
              </div>
            ) : null}
          </Section>

          {/* ---- A. Learning history ------------------------------- */}
          <Section
            id="history"
            eyebrow="Section A"
            title="Learning history"
            lead="Each verified incident, the safeguard it produced, the honesty of that safeguard's persistence, and the later investigations it went on to influence."
          >
            {data.history.length === 0 ? (
              <EmptyState title="No history yet" />
            ) : (
              <ol className="space-y-4">
                {data.history.map((h) => (
                  <HistoryCard key={h.recordId} entry={h} />
                ))}
              </ol>
            )}
          </Section>

          {/* ---- B. Memory retrieval ------------------------------- */}
          <Section
            id="retrieval"
            eyebrow="Section B"
            title="Memory retrieval"
            lead="For each investigation that recalled history: which memory was retrieved, its original incident, why it matched, its relevance, and whether it was applied."
          >
            {data.retrieval.length === 0 ? (
              <EmptyState title="No memories have been recalled yet">
                A first occurrence has nothing to recall. Once a safeguard is
                stored, a later, matching incident will retrieve it here.
              </EmptyState>
            ) : (
              <div className="space-y-4">
                {data.retrieval.map((r, i) => (
                  <RetrievalCard key={`${r.recordId}-${r.blobId}-${i}`} entry={r} />
                ))}
              </div>
            )}
          </Section>

          {/* ---- C. Behaviour change ------------------------------- */}
          <Section
            id="behaviour"
            eyebrow="Section C"
            title="Behaviour change"
            lead="The decision engine run twice for the same investigation: once with the applicable safeguard held out, once with it enforced. Both arms use identical evidence, identical legacy lessons, and identical active rules, so the difference is the memory's own contribution — a real counterfactual over the engine, not a simulation."
          >
            {data.behaviourChanges.length === 0 ? (
              <EmptyState title="No memory has been applied yet">
                When a recalled safeguard applies to an investigation, the
                before/after appears here.
              </EmptyState>
            ) : (
              <div className="space-y-4">
                {data.behaviourChanges.map((b) => (
                  <BehaviourChangeCard key={b.recordId} entry={b} />
                ))}
              </div>
            )}
            {influenced.length === 0 ? (
              <div className="mt-4">
                <Notice tone="info" title="Honest limitation">
                  No recalled safeguard has yet changed a decision or added a
                  required check. Memories may have been retrieved without being
                  applicable, and a safeguard that changes nothing is never
                  counted as an influence. Where a verdict was already reached by
                  the pre-existing rule path, the memory is credited only with the
                  verification it added, never with the verdict.
                </Notice>
              </div>
            ) : null}
          </Section>

          {/* ---- E. Memory provenance ------------------------------ */}
          <Section
            id="provenance"
            eyebrow="Section E"
            title="Memory provenance"
            lead="Every visible learning claim links back to its source: the originating incident, the safeguard record, the Walrus memory reference, and the later investigations it reached."
          >
            {data.provenance.length === 0 ? (
              <EmptyState title="No safeguard memories yet" />
            ) : (
              <div className="space-y-4">
                {data.provenance.map((p) => (
                  <ProvenanceCard key={`${p.memoryId}@v${p.version}`} entry={p} />
                ))}
              </div>
            )}
          </Section>

          <p className="mono text-[0.6875rem] leading-relaxed text-paper-600">
            Computed {data.generatedAt.slice(0, 19).replace("T", " ")} UTC from{" "}
            {data.history.length} durable record(s). Figures update as new
            investigations are recorded.
          </p>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Components
 * ------------------------------------------------------------------ */

function LearningDiagram() {
  const steps = [
    { n: "01", t: "Investigate", d: "An incident is parsed and evidence assessed." },
    { n: "02", t: "Learn", d: "A verified failure yields a safeguard." },
    { n: "03", t: "Persist", d: "The safeguard is written to Walrus Memory." },
    { n: "04", t: "Recall", d: "A later incident retrieves it." },
    { n: "05", t: "Change", d: "The safeguard changes a real decision." },
    { n: "06", t: "Verify", d: "The change is recorded and provable." },
  ];
  return (
    <section aria-label="The learning loop">
      <ol className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {steps.map((s) => (
          <li
            key={s.n}
            className="panel relative p-4"
          >
            <div className="mono text-[0.6875rem] text-signal-info">{s.n}</div>
            <div className="heading mt-1.5 text-[0.9375rem]">{s.t}</div>
            <p className="mt-1.5 text-[0.75rem] leading-snug text-paper-500">
              {s.d}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function WalrusPill({ entry }: { entry: LearningHistoryEntry["safeguard"] }) {
  if (!entry) return <Pill tone="neutral">no safeguard</Pill>;
  if (entry.recallVerified)
    return <Pill tone="ok">Walrus · recall verified</Pill>;
  if (entry.persisted) return <Pill tone="warn">Walrus · stored, recall unconfirmed</Pill>;
  return <Pill tone="unknown">not persisted</Pill>;
}

function HistoryCard({ entry }: { entry: LearningHistoryEntry }) {
  const s = entry.safeguard;
  return (
    <li className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="mono text-[0.6875rem] text-paper-500">
            {entry.createdAt.slice(0, 19).replace("T", " ")} ·{" "}
            {entry.domain} · {entry.failureCategory.replace(/_/g, " ")}
          </div>
          <div className="heading mt-1.5 text-[1rem]">{entry.summary}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill tone={entry.provenance === "live" ? "ok" : "warn"}>
            {entry.provenance}
          </Pill>
          <WalrusPill entry={s} />
        </div>
      </div>

      {s ? (
        <div className="mt-4 rounded-md border hairline bg-[#0a0d12] px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="label">Safeguard learned</span>
            <span className="mono text-[0.6875rem] text-paper-500">
              {s.memoryId}@v{s.version}
            </span>
            <Pill tone={s.authoritative ? "ok" : "warn"}>
              {s.authoritative ? "authoritative" : "unverified · not enforced"}
            </Pill>
          </div>
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-paper-200">
            {s.correctiveRule}
          </p>
          <div className="mono mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.6875rem] text-paper-600">
            <span>backend {s.backend}</span>
            {s.blobId ? <span>blob {s.blobId.slice(0, 16)}…</span> : null}
          </div>
        </div>
      ) : (
        <p className="mt-3 text-[0.8125rem] text-paper-500">
          This investigation produced no safeguard: the diagnosis was not
          actionable.
        </p>
      )}

      <div className="mt-4">
        <div className="label mb-1">Later investigations influenced</div>
        {entry.influencedInvestigationIds.length === 0 ? (
          <p className="text-[0.75rem] text-paper-500">
            None yet. The safeguard has not changed a later decision.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {entry.influencedInvestigationIds.map((id) => (
              <li key={id}>
                <Link
                  href={`/records/${id}`}
                  className="link-quiet mono text-[0.6875rem]"
                >
                  {id.slice(0, 8)}… →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

const RELATION_TONE: Record<string, Tone> = {
  retrieved: "info",
  possible_similarity: "warn",
  candidate_pattern_match: "warn",
  confirmed_recurrence: "bad",
};

function RetrievalCard({ entry }: { entry: MemoryRetrievalEntry }) {
  return (
    <div className="panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="mono min-w-0 text-[0.6875rem] text-paper-500">
          retrieved for{" "}
          <Link href={`/records/${entry.recordId}`} className="link-quiet">
            {entry.incidentId.slice(0, 8)}…
          </Link>{" "}
          · {entry.createdAt.slice(0, 19).replace("T", " ")}
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill tone={RELATION_TONE[entry.relation] ?? "neutral"}>
            {entry.relation.replace(/_/g, " ")}
          </Pill>
          <Pill tone={entry.applicable ? "ok" : "neutral"}>
            {entry.applicable ? "applied" : "not applied"}
          </Pill>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded border hairline px-3 py-2">
          <div className="label">Retrieved memory</div>
          <div className="mono mt-1 break-all text-[0.6875rem]">
            {entry.memoryId}
          </div>
          <div className="mono mt-0.5 break-all text-[0.6875rem] text-paper-500">
            blob {entry.blobId.slice(0, 20)}…
          </div>
          {entry.originalIncidentId ? (
            <div className="mono mt-0.5 text-[0.6875rem] text-paper-500">
              original incident {entry.originalIncidentId.slice(0, 8)}…
            </div>
          ) : null}
        </div>
        <div className="rounded border hairline px-3 py-2">
          <div className="label">Why it matched</div>
          <p className="mt-1 text-[0.75rem] leading-relaxed text-paper-300">
            {entry.applicabilityBasis}
          </p>
        </div>
      </div>

      <div className="mt-3 text-[0.8125rem] leading-relaxed text-paper-300">
        {entry.relevance}
      </div>

      {entry.contributedRule ? (
        <div className="mt-3 rounded border hairline bg-[#0a0d12] px-3 py-2">
          <div className="label">Rule it contributed</div>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-paper-200">
            {entry.contributedRule}
          </p>
        </div>
      ) : null}
    </div>
  );
}

const DECISION_TONE: Record<string, Tone> = {
  ALLOW: "ok",
  BLOCK: "bad",
  REQUIRE_VERIFICATION: "warn",
  UNKNOWN: "unknown",
};

function BehaviourChangeCard({ entry }: { entry: BehaviourChangeEntry }) {
  return (
    <div className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="mono text-[0.6875rem] text-paper-500">
            {entry.createdAt.slice(0, 19).replace("T", " ")} ·{" "}
            <Link href={`/records/${entry.recordId}`} className="link-quiet">
              {entry.incidentId.slice(0, 8)}…
            </Link>
          </div>
          <div className="heading mt-1.5 text-[0.9375rem]">{entry.summary}</div>
        </div>
        <Pill tone={entry.changed ? "ok" : "neutral"}>
          {entry.beforeDecision !== entry.afterDecision
            ? "verdict changed"
            : entry.changed
              ? "requirements strengthened"
              : "no change"}
        </Pill>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
        <div className="rounded-md border border-signal-unknown/30 bg-[#0a0d12] px-3 py-3">
          <div className="label">Before memory</div>
          <div className="mt-2">
            <Pill tone={DECISION_TONE[entry.beforeDecision] ?? "neutral"}>
              {entry.beforeDecision.replace(/_/g, " ")}
            </Pill>
          </div>
          <p className="mt-2 text-[0.75rem] leading-relaxed text-paper-500">
            The decision engine with the applicable safeguard held out; legacy
            lessons and active rules are unchanged.
          </p>
        </div>
        <div
          className="hidden items-center justify-center sm:flex"
          aria-hidden
        >
          <span className="mono text-[1.25rem] text-paper-600">→</span>
        </div>
        <div
          className={`rounded-md border px-3 py-3 ${
            entry.changed
              ? "border-signal-ok/40 bg-signal-ok/[0.05]"
              : "border hairline bg-[#0a0d12]"
          }`}
        >
          <div className="label">After memory</div>
          <div className="mt-2">
            <Pill tone={DECISION_TONE[entry.afterDecision] ?? "neutral"}>
              {entry.afterDecision.replace(/_/g, " ")}
            </Pill>
          </div>
          <p className="mt-2 text-[0.75rem] leading-relaxed text-paper-500">
            The same engine with the applicable safeguard enforced.
          </p>
        </div>
      </div>

      {entry.addedRequiredChecks.length > 0 ? (
        <div className="mt-4">
          <div className="label mb-1">Verification requirements added</div>
          <ul className="space-y-1.5">
            {entry.addedRequiredChecks.map((c, i) => (
              <li key={i} className="flex gap-2.5 text-[0.8125rem] text-paper-300">
                <span
                  className="mt-[0.5rem] h-1 w-1 shrink-0 rounded-full bg-signal-ok"
                  aria-hidden
                />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {entry.changedByRule ? (
        <div className="mt-4 rounded border hairline bg-[#0a0d12] px-3 py-2">
          <div className="label">The rule that changed it</div>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-paper-200">
            {entry.changedByRule}
          </p>
          {entry.changedByMemoryId ? (
            <div className="mono mt-1 text-[0.6875rem] text-paper-600">
              from memory {entry.changedByMemoryId}
              {entry.changedByMemoryVersion !== undefined
                ? `@v${entry.changedByMemoryVersion}`
                : ""}
            </div>
          ) : null}
        </div>
      ) : null}

      <p className="mt-4 text-[0.75rem] leading-relaxed text-paper-500">
        {entry.explanation}
      </p>
    </div>
  );
}

function ProvenanceCard({ entry }: { entry: LearningProvenanceEntry }) {
  return (
    <div className="panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="mono min-w-0 break-all text-[0.8125rem]">
          {entry.memoryId}@v{entry.version}
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill tone={entry.provenance === "live" ? "ok" : "warn"}>
            {entry.provenance}
          </Pill>
          <Pill tone={entry.status === "active" ? "info" : "neutral"}>
            {entry.status}
          </Pill>
          <Pill
            tone={
              entry.recallVerified ? "ok" : entry.persisted ? "warn" : "unknown"
            }
          >
            {entry.recallVerified
              ? "Walrus · recall verified"
              : entry.persisted
                ? "Walrus · stored"
                : "not persisted"}
          </Pill>
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-[0.75rem] leading-relaxed text-paper-400 sm:grid-cols-2">
        <div>
          <span className="label">Origin incident</span>
          <div className="mono mt-0.5 break-all">
            {entry.originIncidentId}
          </div>
        </div>
        <div>
          <span className="label">Walrus reference</span>
          <div className="mono mt-0.5 break-all">
            {entry.blobId ?? "(no blob id — not persisted)"}
          </div>
          <div className="mono text-paper-600">backend {entry.backend}</div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div>
          <div className="label mb-1">Retrieved in</div>
          {entry.retrievedIn.length === 0 ? (
            <p className="text-[0.75rem] text-paper-500">—</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {entry.retrievedIn.map((id) => (
                <li key={id}>
                  <Link
                    href={`/records/${id}`}
                    className="link-quiet mono text-[0.6875rem]"
                  >
                    {id.slice(0, 8)}…
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="label mb-1">Influenced</div>
          {entry.influenced.length === 0 ? (
            <p className="text-[0.75rem] text-paper-500">
              Not yet — no decision changed.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {entry.influenced.map((id) => (
                <li key={id}>
                  <Link
                    href={`/records/${id}`}
                    className="link-quiet mono text-[0.6875rem]"
                  >
                    {id.slice(0, 8)}…
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
