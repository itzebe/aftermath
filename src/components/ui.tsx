import type {
  Decision,
  EvidenceStatus,
  Provenance,
  RuleValidationStatus,
} from "@/lib/schemas";

type Tone = "ok" | "bad" | "warn" | "info" | "unknown" | "neutral";

const TONE_CLASS: Record<Tone, string> = {
  ok: "pill-ok",
  bad: "pill-bad",
  warn: "pill-warn",
  info: "pill-info",
  unknown: "pill-unknown",
  neutral: "pill-neutral",
};

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: React.ReactNode;
}) {
  return <span className={`pill ${TONE_CLASS[tone]}`}>{children}</span>;
}

const EVIDENCE_TONE: Record<EvidenceStatus, Tone> = {
  VERIFIED_SUCCESS: "ok",
  VERIFIED_FAILURE: "bad",
  PENDING: "warn",
  UNKNOWN: "unknown",
  CONFLICTING: "bad",
};

export function EvidencePill({ status }: { status: EvidenceStatus }) {
  return <Pill tone={EVIDENCE_TONE[status]}>{status.replace(/_/g, " ")}</Pill>;
}

const DECISION_TONE: Record<Decision, Tone> = {
  ALLOW: "ok",
  BLOCK: "bad",
  REQUIRE_VERIFICATION: "warn",
  UNKNOWN: "unknown",
};

export function DecisionPill({ decision }: { decision: Decision }) {
  return <Pill tone={DECISION_TONE[decision]}>{decision.replace(/_/g, " ")}</Pill>;
}

const RULE_TONE: Record<RuleValidationStatus, Tone> = {
  proposed: "info",
  validated: "info",
  active: "ok",
  retired: "neutral",
  superseded: "neutral",
};

export function RuleStatusPill({ status }: { status: RuleValidationStatus }) {
  return <Pill tone={RULE_TONE[status]}>{status}</Pill>;
}

export function ProvenancePill({ provenance }: { provenance: Provenance }) {
  return (
    <Pill tone={provenance === "live" ? "ok" : "warn"}>
      {provenance === "live" ? "live" : "simulated"}
    </Pill>
  );
}

export function Metric({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: Tone;
}) {
  const accent =
    tone === "ok"
      ? "text-signal-ok"
      : tone === "bad"
        ? "text-signal-bad"
        : tone === "warn"
          ? "text-signal-warn"
          : tone === "unknown"
            ? "text-signal-unknown"
            : "text-paper-100";
  return (
    <div className="panel rounded p-3.5">
      <div className="mono text-[0.625rem] uppercase tracking-[0.1em] text-paper-500">
        {label}
      </div>
      <div className={`tabular mt-2 text-2xl font-semibold ${accent}`}>{value}</div>
      {sub ? (
        <div className="mt-1 text-[0.6875rem] leading-snug text-paper-500">{sub}</div>
      ) : null}
    </div>
  );
}

export function SectionTitle({
  title,
  hint,
  right,
}: {
  title: string;
  hint?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h2 className="text-[0.9375rem] font-semibold tracking-tight">{title}</h2>
        {hint ? (
          <p className="mt-0.5 max-w-2xl text-[0.75rem] leading-relaxed text-paper-500">
            {hint}
          </p>
        ) : null}
      </div>
      {right}
    </div>
  );
}

export function Notice({
  tone = "info",
  title,
  children,
}: {
  tone?: Tone;
  title: string;
  children?: React.ReactNode;
}) {
  const border =
    tone === "bad"
      ? "border-signal-bad/40 bg-signal-bad/[0.06]"
      : tone === "warn"
        ? "border-signal-warn/40 bg-signal-warn/[0.06]"
        : tone === "ok"
          ? "border-signal-ok/40 bg-signal-ok/[0.06]"
          : "border-signal-info/40 bg-signal-info/[0.06]";
  return (
    <div className={`rounded border p-3 ${border}`}>
      <div className="text-[0.8125rem] font-semibold">{title}</div>
      {children ? (
        <div className="mt-1 text-[0.75rem] leading-relaxed text-paper-300">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function Panel({
  title,
  hint,
  right,
  children,
  className = "",
}: {
  title?: string;
  hint?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel rounded ${className}`}>
      {title ? (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b hairline px-3.5 py-2.5">
          <div className="min-w-0">
            <h3 className="text-[0.8125rem] font-semibold tracking-tight break-words">
              {title}
            </h3>
            {hint ? (
              <p className="mt-0.5 max-w-2xl text-[0.6875rem] leading-relaxed text-paper-500">
                {hint}
              </p>
            ) : null}
          </div>
          {right}
        </header>
      ) : null}
      <div className="p-3.5">{children}</div>
    </section>
  );
}

/** A labelled value row used throughout the incident and rule detail views. */
export function Field({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b hairline py-1.5 last:border-b-0 sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:gap-3">
      <div className="mono pt-0.5 text-[0.625rem] uppercase tracking-[0.1em] text-paper-500">
        {label}
      </div>
      <div className={`min-w-0 text-[0.8125rem] leading-relaxed ${mono ? "mono text-[0.75rem]" : ""}`}>
        {children}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded border border-dashed hairline px-4 py-6 text-center">
      <div className="text-[0.8125rem] font-medium text-paper-300">{title}</div>
      {children ? (
        <div className="mx-auto mt-1 max-w-md text-[0.75rem] leading-relaxed text-paper-500">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="mono py-6 text-center text-[0.75rem] text-paper-500">
      {label}
    </div>
  );
}
