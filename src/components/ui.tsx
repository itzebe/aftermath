import type {
  Decision,
  EvidenceStatus,
  Provenance,
  RuleValidationStatus,
} from "@/lib/schemas";

export type Tone = "ok" | "bad" | "warn" | "info" | "unknown" | "neutral";

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

/** A single measured figure. The value is the hero; the label is quiet. */
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
    <div className="panel p-4">
      <div className="label">{label}</div>
      <div className={`tabular mt-3 text-[1.75rem] font-semibold leading-none ${accent}`}>
        {value}
      </div>
      {sub ? (
        <div className="mt-2 text-[0.75rem] leading-snug text-paper-500">{sub}</div>
      ) : null}
    </div>
  );
}

/**
 * A page's opening block: an eyebrow, a single primary heading, and a short
 * orientation. Used on every route so the top of every page reads the same.
 */
export function PageHeader({
  eyebrow,
  title,
  lead,
  right,
  as: Heading = "h1",
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  right?: React.ReactNode;
  as?: "h1" | "h2";
}) {
  return (
    <header className="mb-10 border-b hairline pb-8">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 max-w-prose">
          {eyebrow ? <div className="label mb-3">{eyebrow}</div> : null}
          <Heading className="heading text-[1.75rem] md:text-[2rem]">{title}</Heading>
          {lead ? <p className="lead mt-3">{lead}</p> : null}
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
    </header>
  );
}

/**
 * A labelled sub-section within a page. Gives every section the same
 * generous rhythm and a consistent heading level.
 */
export function Section({
  id,
  eyebrow,
  title,
  lead,
  right,
  children,
  className = "",
}: {
  id?: string;
  eyebrow?: string;
  title?: string;
  lead?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`scroll-mt-24 ${className}`}>
      {title ? (
        <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 max-w-prose">
            {eyebrow ? <div className="label mb-3">{eyebrow}</div> : null}
            <h2 className="heading text-[1.375rem] md:text-[1.5rem]">{title}</h2>
            {lead ? (
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-paper-500">
                {lead}
              </p>
            ) : null}
          </div>
          {right ? <div className="shrink-0">{right}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
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
    <div className={`rounded-md border p-4 ${border}`}>
      <div className="text-[0.875rem] font-semibold">{title}</div>
      {children ? (
        <div className="mt-1.5 text-[0.8125rem] leading-relaxed text-paper-300">
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
  as: Tag = "section",
}: {
  title?: string;
  hint?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  as?: "section" | "div";
}) {
  return (
    <Tag className={`panel ${className}`}>
      {title ? (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b hairline px-5 py-4">
          <div className="min-w-0">
            <h3 className="heading text-[0.9375rem] break-words">{title}</h3>
            {hint ? (
              <p className="mt-1 max-w-2xl text-[0.8125rem] leading-relaxed text-paper-500">
                {hint}
              </p>
            ) : null}
          </div>
          {right}
        </header>
      ) : null}
      <div className="p-5">{children}</div>
    </Tag>
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
    <div className="grid grid-cols-1 gap-1 border-b hairline py-2.5 last:border-b-0 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
      <div className="label pt-0.5">{label}</div>
      <div
        className={`min-w-0 text-[0.8125rem] leading-relaxed ${mono ? "mono text-[0.75rem]" : ""}`}
      >
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
    <div className="rounded-md border border-dashed hairline px-6 py-12 text-center">
      <div className="text-[0.9375rem] font-medium text-paper-300">{title}</div>
      {children ? (
        <div className="mx-auto mt-2 max-w-md text-[0.8125rem] leading-relaxed text-paper-500">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="mono py-16 text-center text-[0.8125rem] text-paper-500">
      {label}
    </div>
  );
}
