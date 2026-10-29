/**
 * The six-stage causal chain, as one connected diagram.
 *
 *   Incident → Evidence → Hypothesis → Safeguard → Verification → Memory
 *
 * These are not six interchangeable cards: the connector between them is the
 * point. Each stage states what it consumes and what it hands on, and only the
 * final stage resolves — because that is the only one that changes a later
 * outcome. On a narrow screen the diagram becomes a vertical rail, so it never
 * needs horizontal scrolling or unreadably small type.
 */

interface Stage {
  name: string;
  consumes: string;
  note: string;
}

const STAGES: Stage[] = [
  {
    name: "Incident",
    consumes: "the submitted material",
    note: "Treated strictly as data. Parsed with rules, never executed.",
  },
  {
    name: "Evidence",
    consumes: "verbatim spans",
    note: "Observed facts separated from what a source confirmed.",
  },
  {
    name: "Hypothesis",
    consumes: "the observed facts",
    note: "A candidate mechanism with a confidence and a list of unknowns.",
  },
  {
    name: "Safeguard",
    consumes: "the diagnosis",
    note: "One specific, testable rule — with its assumptions stated.",
  },
  {
    name: "Verification",
    consumes: "the safeguard",
    note: "Executed against the decision engine. Never asserted.",
  },
  {
    name: "Memory",
    consumes: "the verified record",
    note: "Preserved with a deterministic key, retrievable later.",
  },
];

export function ChainDiagram() {
  return (
    <ol className="chain-diagram" aria-label="The AFTERMATH pipeline, in order">
      {STAGES.map((stage, i) => {
        const final = i === STAGES.length - 1;
        return (
          <li
            key={stage.name}
            className="chain-stage"
            data-final={final ? "true" : undefined}
          >
            <div className="chain-marker">
              <span className="chain-badge" aria-hidden>
                {String(i + 1).padStart(2, "0")}
              </span>
            </div>
            <div className="chain-body">
              <h3 className="heading text-[1rem]">{stage.name}</h3>
              <p className="mono mt-1.5 text-[0.6875rem] uppercase tracking-[0.1em] text-paper-500">
                {stage.consumes}
              </p>
              <p className="mt-2.5 text-[0.875rem] leading-relaxed text-paper-500">
                {stage.note}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
