import type {
  ExtractedFact,
  MemoryRelation,
  SafeguardRecord,
  VerificationState,
} from "@/lib/schemas";
import { Pill, type Tone } from "@/components/ui";

/**
 * The Safeguard Record, rendered as one connected argument.
 *
 *   Incident -> Evidence -> Hypothesis -> Safeguard -> Verification -> Memory
 *
 * The connecting rail is deliberate: the point of the product is that these are
 * not six unrelated panels but a single chain, and every link carries an honest
 * state label. Nothing here is decorative — each colour encodes a real status,
 * and a claim is never upgraded as it moves down the chain.
 */

const VERIFICATION_TONE: Record<VerificationState, Tone> = {
  recommended: "info",
  test_planned: "info",
  // A test ran, but a single incident cannot prove a repeat was prevented.
  // Amber, not green, is the honest colour for that.
  test_executed: "warn",
  verified: "ok",
  inconclusive: "warn",
  failed: "bad",
};

const VERIFICATION_LABEL: Record<VerificationState, string> = {
  recommended: "recommended · nothing executed",
  test_planned: "test planned · not executed",
  test_executed: "test executed · effect shown, recurrence not proven",
  verified: "verified",
  inconclusive: "inconclusive",
  failed: "failed",
};

const RELATION_TONE: Record<MemoryRelation, Tone> = {
  retrieved: "info",
  possible_similarity: "warn",
  confirmed_recurrence: "bad",
};

const RELATION_LABEL: Record<MemoryRelation, string> = {
  retrieved: "retrieved",
  possible_similarity: "possible similarity",
  confirmed_recurrence: "confirmed recurrence",
};

function ChainNode({
  index,
  title,
  state,
  children,
}: {
  index: number;
  title: string;
  state?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="chain-node">
      <span className="chain-dot" aria-hidden />
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[0.8125rem] font-semibold tracking-tight">
          <span className="mono mr-1.5 text-[0.6875rem] text-paper-500">
            {String(index).padStart(2, "0")}
          </span>
          {title}
        </h3>
        {state}
      </div>
      <div className="mt-1.5 space-y-2 text-[0.8125rem] leading-relaxed">
        {children}
      </div>
    </li>
  );
}

function FactList({
  facts,
  tone = "neutral",
}: {
  facts: ExtractedFact[];
  tone?: Tone;
}) {
  if (facts.length === 0) {
    return <p className="text-[0.75rem] text-paper-500">None extracted.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {facts.map((f, i) => (
        <li key={`${f.kind}-${f.value}-${i}`} className="rounded border hairline bg-[#0a0d12] px-2.5 py-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={tone}>{f.kind.replace(/_/g, " ")}</Pill>
            <span className="mono min-w-0 break-all text-[0.75rem]">{f.value}</span>
          </div>
          <div className="mt-1 border-l-2 border-[#2b3442] pl-2 text-[0.6875rem] leading-snug text-paper-500">
            <span className="mono">span:</span> {f.source}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Bullets({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1">
      {items.map((t, i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-paper-500" aria-hidden />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

export function SafeguardRecordView({ record }: { record: SafeguardRecord }) {
  const { investigation, recommendation, verification, memory } = record;
  const c = investigation.categories;

  return (
    <article className="panel overflow-hidden rounded">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b hairline px-4 py-3">
        <div className="min-w-0">
          <div className="label">Safeguard record</div>
          <h2 className="mt-0.5 text-[0.9375rem] font-semibold tracking-tight">
            {investigation.summary}
          </h2>
          <div className="mono mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[0.6875rem] text-paper-500">
            <span>record {record.recordId.slice(0, 8)}</span>
            <span>incident {record.incidentId.slice(0, 8)}</span>
            <span>{record.createdAt.slice(0, 19).replace("T", " ")}</span>
            <span>extraction {investigation.extractionMethod}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill tone={record.provenance === "live" ? "ok" : "warn"}>
            {record.provenance === "live" ? "memory live" : "memory simulated"}
          </Pill>
          <Pill tone="neutral">{investigation.domain}</Pill>
        </div>
      </header>

      <div className="px-4 py-4">
        <ol className="chain">
          <ChainNode
            index={1}
            title="Incident"
            state={<Pill tone="neutral">reported by a person</Pill>}
          >
            <p className="text-paper-300">
              {record.submission.service ? (
                <span className="mono mr-2 rounded bg-[#141a23] px-1.5 py-0.5 text-[0.6875rem]">
                  {record.submission.service}
                </span>
              ) : null}
              The material was submitted as text and treated strictly as data.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {record.submission.expectedBehavior ? (
                <div className="rounded border hairline px-2.5 py-1.5">
                  <div className="label">Expected</div>
                  <div className="mt-0.5 text-[0.75rem]">
                    {record.submission.expectedBehavior}
                  </div>
                </div>
              ) : null}
              {record.submission.actualBehavior ? (
                <div className="rounded border hairline px-2.5 py-1.5">
                  <div className="label">Actual</div>
                  <div className="mt-0.5 text-[0.75rem]">
                    {record.submission.actualBehavior}
                  </div>
                </div>
              ) : null}
            </div>
          </ChainNode>

          <ChainNode
            index={2}
            title="Evidence"
            state={
              <Pill tone={c.confirmedFacts.length > 0 ? "ok" : "warn"}>
                {c.observedEvidence.length} observed · {c.confirmedFacts.length} confirmed
              </Pill>
            }
          >
            <div>
              <div className="label mb-1">Observed (supported by the material)</div>
              <FactList facts={c.observedEvidence} tone="neutral" />
            </div>
            <div>
              <div className="label mb-1">Confirmed (input or connected source)</div>
              {c.confirmedFacts.length > 0 ? (
                <FactList facts={c.confirmedFacts} tone="ok" />
              ) : (
                <p className="text-[0.75rem] text-paper-500">
                  Nothing was confirmed by an external source.
                </p>
              )}
            </div>
            <div className="rounded border hairline bg-[#0a0d12] px-2.5 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="label">Authoritative lookup</span>
                <Pill
                  tone={
                    investigation.authoritativeLookup.verified
                      ? "ok"
                      : investigation.authoritativeLookup.attempted
                        ? "warn"
                        : "unknown"
                  }
                >
                  {investigation.authoritativeLookup.verified
                    ? "verified"
                    : investigation.authoritativeLookup.attempted
                      ? "attempted · unverified"
                      : "not attempted"}
                </Pill>
                <span className="mono text-[0.6875rem] text-paper-500">
                  {investigation.authoritativeLookup.source}
                </span>
              </div>
              <p className="mt-1 text-[0.75rem] leading-relaxed text-paper-300">
                {investigation.authoritativeLookup.detail}
              </p>
            </div>
          </ChainNode>

          <ChainNode
            index={3}
            title="Hypothesis"
            state={
              <Pill tone={investigation.diagnosis.actionable ? "warn" : "unknown"}>
                {investigation.diagnosis.pattern.replace(/_/g, " ")} ·{" "}
                {Math.round(investigation.diagnosis.confidence * 100)}% confidence
              </Pill>
            }
          >
            <p className="text-paper-300">{investigation.diagnosis.hypothesis}</p>
            <div>
              <div className="label mb-1">Considered explanations</div>
              <Bullets items={c.hypotheses} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="label mb-1">Unknowns</div>
                <Bullets items={c.unknowns} />
              </div>
              <div>
                <div className="label mb-1">Next checks</div>
                <Bullets items={c.nextChecks} />
              </div>
            </div>
          </ChainNode>

          <ChainNode
            index={4}
            title="Safeguard"
            state={
              <div className="flex flex-wrap gap-2">
                <Pill tone={recommendation.action === "BLOCK" ? "bad" : "warn"}>
                  {recommendation.action.replace(/_/g, " ")}
                </Pill>
                <Pill
                  tone={
                    recommendation.severity === "critical" || recommendation.severity === "high"
                      ? "bad"
                      : recommendation.severity === "medium"
                        ? "warn"
                        : "info"
                  }
                >
                  {recommendation.severity}
                </Pill>
              </div>
            }
          >
            <p className="rounded border hairline bg-[#0a0d12] px-3 py-2 font-medium">
              {recommendation.statement}
            </p>
            <div>
              <div className="label mb-1">Failure mode addressed</div>
              <p className="text-paper-300">{recommendation.failureMode}</p>
            </div>
            <div>
              <div className="label mb-1">Why the evidence supports it</div>
              <p className="text-paper-300">{recommendation.whyEvidenceSupports}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="label mb-1">Assumptions</div>
                <Bullets items={recommendation.assumptions} />
              </div>
              <div>
                <div className="label mb-1">How to test it</div>
                <Bullets items={recommendation.testPlan} />
              </div>
            </div>
            <div className="rounded border hairline px-2.5 py-1.5">
              <div className="label">Success criteria</div>
              <div className="mt-0.5 text-[0.75rem]">{recommendation.successCriteria}</div>
            </div>
            {record.proposedRule ? (
              <div className="mono text-[0.6875rem] text-paper-500">
                rule {record.proposedRule.ruleId}@v{record.proposedRule.version} ·{" "}
                {record.proposedRule.validationStatus}
                {record.activatedRule
                  ? ` · activated as ${record.activatedRule.ruleId}@v${record.activatedRule.version}`
                  : " · not activated (a single submission cannot justify a standing rule)"}
              </div>
            ) : (
              <div className="mono text-[0.6875rem] text-paper-500">
                no rule derived — the diagnosis was not actionable
              </div>
            )}
          </ChainNode>

          <ChainNode
            index={5}
            title="Verification"
            state={
              <Pill tone={VERIFICATION_TONE[verification.state]}>
                {VERIFICATION_LABEL[verification.state]}
              </Pill>
            }
          >
            <p className="text-paper-300">
              <span className="mono text-[0.6875rem] text-paper-500">executed: </span>
              {verification.executed}
            </p>
            <ul className="space-y-1.5">
              {verification.steps.map((s, i) => (
                <li
                  key={i}
                  className="rounded border hairline bg-[#0a0d12] px-2.5 py-1.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill
                      tone={
                        s.outcome === "pass"
                          ? "ok"
                          : s.outcome === "fail"
                            ? "bad"
                            : s.outcome === "inconclusive"
                              ? "warn"
                              : "info"
                      }
                    >
                      {s.outcome}
                    </Pill>
                    <span className="mono text-[0.6875rem]">{s.step}</span>
                  </div>
                  <div className="mt-1 text-[0.75rem] leading-relaxed text-paper-300">
                    {s.detail}
                  </div>
                </li>
              ))}
            </ul>
            <div className="rounded border hairline px-2.5 py-2">
              <div className="label">What this establishes</div>
              <div className="mt-0.5 text-[0.75rem] leading-relaxed">
                {verification.established}
              </div>
            </div>
          </ChainNode>

          <ChainNode
            index={6}
            title="Memory"
            state={
              <Pill
                tone={
                  memory.recallVerified ? "ok" : memory.lesson?.state === "completed" ? "warn" : "unknown"
                }
              >
                {memory.recallVerified
                  ? "recall verified"
                  : memory.lesson?.state === "completed"
                    ? "stored · recall not confirmed"
                    : memory.incident.state === "completed"
                      ? "incident stored"
                      : "not stored"}
              </Pill>
            }
          >
            <div className="flex flex-wrap gap-2">
              <Pill tone={memory.isLive ? "ok" : "warn"}>{memory.backend}</Pill>
              <span className="mono text-[0.6875rem] text-paper-500">
                incident {memory.incident.state}
                {memory.incident.blobId ? ` · ${memory.incident.blobId.slice(0, 12)}…` : ""}
              </span>
              {memory.lesson ? (
                <span className="mono text-[0.6875rem] text-paper-500">
                  lesson {memory.lesson.state}
                  {memory.lesson.blobId ? ` · ${memory.lesson.blobId.slice(0, 12)}…` : ""}
                </span>
              ) : (
                <span className="mono text-[0.6875rem] text-paper-500">no lesson write</span>
              )}
            </div>
            <p className="text-[0.75rem] leading-relaxed text-paper-300">
              {memory.isLive
                ? "Writes were submitted to the live memory backend. A write counts as stored only when the relayer returned a blob id, and as recall-verified only when a recall query returned the record."
                : "The memory backend is simulated, so these writes were not stored on Walrus Mainnet. The record is labelled simulated accordingly."}
            </p>

            <div>
              <div className="label mb-1">
                Recalled prior records ({record.recalledMemories.length})
              </div>
              {record.recalledMemories.length === 0 ? (
                <p className="text-[0.75rem] text-paper-500">
                  No prior record was similar enough to retrieve. A first
                  occurrence has nothing to recall.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {record.recalledMemories.map((m) => (
                    <li
                      key={m.blobId}
                      className="rounded border hairline bg-[#0a0d12] px-2.5 py-1.5"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill tone={RELATION_TONE[m.relation]}>
                          {RELATION_LABEL[m.relation]}
                        </Pill>
                        <span className="mono text-[0.6875rem] text-paper-500">
                          {m.blobId.slice(0, 12)}… · distance {m.distance.toFixed(3)}
                        </span>
                      </div>
                      <div className="mt-1 text-[0.75rem] leading-relaxed text-paper-300">
                        {m.why}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </ChainNode>
        </ol>
      </div>
    </article>
  );
}
