import Link from "next/link";
import { getOverview } from "@/lib/service";
import { SubmitIncidentForm } from "@/components/submit-incident-form";
import { Pill } from "@/components/ui";
import { ChainDiagram } from "@/components/chain-diagram";
import { HeroVisual } from "@/components/hero-visual";

export const dynamic = "force-dynamic";

const SAMPLE = `2026-03-01T10:00:00Z ERROR checkout-service
POST /v1/charge returned 503 Service Unavailable
retrying (attempt 2/3)...
2026-03-01T10:00:07Z WARN checkout-service charge status: unknown
2026-03-01T10:00:08Z INFO agent "the charge completed successfully"`;

const PRINCIPLES = [
  {
    title: "Evidence before conclusions",
    body: "Every fact in a record is extracted from the submitted material with a verbatim span behind it. The engine forms a diagnosis only after it has stated what it observed.",
  },
  {
    title: "Uncertainty is explicit",
    body: "What is observed, what an external source confirmed, and what is still unknown are three separate lists. A lookup that cannot run resolves to unknown — never to success.",
  },
  {
    title: "A safeguard is not called verified without proof",
    body: "A safeguard is recommended, then tested against the decision engine. A single incident can show an effect; it can never on its own justify calling a rule verified.",
  },
  {
    title: "Lessons can be preserved and retrieved",
    body: "Each record is written to Walrus Memory with a deterministic key, so a later, similar failure can recall the lesson — and a repeat is recognised as a repeat.",
  },
];

/**
 * The incident-first landing page.
 *
 * AFTERMATH's promise is that every failure should leave a safeguard, so the
 * front door is the act that produces one: submitting a real incident. The
 * composition is deliberate — hero, workspace, mechanism, principles — and the
 * reliability console is one link away, because it is evidence *for* the
 * mechanism, not the product's purpose.
 */
export default async function HomePage() {
  const overview = await getOverview().catch(() => null);
  const configured = overview && !("error" in overview) ? overview : null;

  return (
    <div className="space-y-24 md:space-y-32">
      {/* ---- hero ---------------------------------------------------- */}
      <section>
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-16">
          <div className="max-w-prose">
            <div className="label mb-5">Evidence-first failure prevention</div>
            <h1 className="display text-[2.25rem] sm:text-[3rem] lg:text-[3.5rem]">
              Every failure should leave a safeguard.
            </h1>
            <p className="lead mt-6 max-w-prose">
              Turn incident evidence into actionable safeguards. Understand what
              happened, identify what remains uncertain, and preserve lessons that
              can be retrieved when similar failures occur.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link href="#investigate" className="action primary">
                Investigate an incident
              </Link>
              <Link href="#how-it-works" className="action">
                Explore how it works
              </Link>
            </div>
          </div>
          <div>
            <HeroVisual />
          </div>
        </div>
      </section>

      {/* ---- incident workspace -------------------------------------- */}
      <section id="investigate" className="scroll-mt-24">
        <div className="mb-6 max-w-prose">
          <div className="label mb-3">Investigation workspace</div>
          <h2 className="heading text-[1.5rem] md:text-[1.75rem]">
            Submit an incident, get a Safeguard Record.
          </h2>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-paper-500">
            The material is treated strictly as data: parsed with rules, never
            executed, and never interpolated into a command or a query.
          </p>
        </div>
        <SubmitIncidentForm sample={SAMPLE} />
      </section>

      {/* ---- how it works -------------------------------------------- */}
      <section id="how-it-works" className="scroll-mt-24">
        <div className="mb-10 max-w-prose">
          <div className="label mb-3">How it works</div>
          <h2 className="heading text-[1.5rem] md:text-[1.75rem]">
            One chain, six links, no shortcuts.
          </h2>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-paper-500">
            A record is a single connected argument. Each link carries an honest
            state label, and a claim is never upgraded as it moves down the
            chain.
          </p>
        </div>
        <ChainDiagram />
      </section>

      {/* ---- product principles -------------------------------------- */}
      <section>
        <div className="mb-10 max-w-prose">
          <div className="label mb-3">Principles</div>
          <h2 className="heading text-[1.5rem] md:text-[1.75rem]">
            What makes AFTERMATH different.
          </h2>
        </div>
        <div className="grid gap-x-12 gap-y-10 md:grid-cols-2">
          {PRINCIPLES.map((p, i) => (
            <div key={p.title} className="flex gap-5">
              <div className="mono shrink-0 pt-0.5 text-[0.75rem] text-paper-600">
                {String(i + 1).padStart(2, "0")}
              </div>
              <div className="min-w-0">
                <h3 className="heading text-[1.0625rem]">{p.title}</h3>
                <p className="mt-2 text-[0.875rem] leading-relaxed text-paper-500">
                  {p.body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---- technical status ---------------------------------------- */}
      <section className="border-t hairline pt-12">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="max-w-prose">
            <div className="label mb-3">Technical status</div>
            <h2 className="heading text-[1.25rem]">Live system state</h2>
            <p className="mt-3 text-[0.875rem] leading-relaxed text-paper-500">
              Infrastructure metadata and the controlled evaluation scenarios
              live in the Evaluation Lab, away from the primary journey. Every
              figure there is read from the running system; nothing is
              illustrative.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Link href="/lab" className="link-quiet text-[0.875rem]">
                Open the Evaluation Lab →
              </Link>
              <Link href="/records" className="link-quiet text-[0.875rem]">
                Browse Safeguard Records →
              </Link>
            </div>
          </div>
          {configured ? (
            <div className="panel w-full shrink-0 p-5 md:w-80">
              <div className="flex items-center justify-between gap-3">
                <span className="label">Memory backend</span>
                <Pill
                  tone={configured.configuration.memory.isLive ? "ok" : "warn"}
                >
                  {configured.configuration.memory.isLive ? "live" : "simulated"}
                </Pill>
              </div>
              <div className="mono mt-2 text-[0.8125rem]">
                {configured.configuration.memory.backend}
              </div>
              <div className="mt-4 border-t hairline pt-4">
                <div className="label">Safeguard records</div>
                <div className="tabular mt-1.5 text-[1.75rem] font-semibold leading-none">
                  {configured.counts.records}
                </div>
                <div className="mt-1.5 text-[0.75rem] leading-snug text-paper-500">
                  Investigations preserved from submissions.
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
