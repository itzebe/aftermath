/**
 * The hero's visual anchor: the product's thesis as one object.
 *
 * A piece of incident material and the safeguard derived from it, joined by the
 * same rail that runs through a real Safeguard Record. It is labelled as an
 * illustration and its content is generic — the homepage never presents this as
 * a record from the store, and never invents live activity.
 */
export function HeroVisual() {
  return (
    <figure className="rounded-lg border hairline bg-[#090c11] p-5">
      <figcaption className="label mb-4 flex items-center gap-2">
        Illustration
        <span className="h-px flex-1 bg-ink-700" aria-hidden />
      </figcaption>

      <div className="space-y-3">
        <div className="rounded-md border hairline bg-[#06080b] px-3.5 py-3">
          <div className="label mb-2">Incident material</div>
          <p className="mono text-[0.75rem] leading-relaxed text-paper-500">
            A log line, an error, a failed request — treated strictly as data.
          </p>
        </div>

        <div className="relative flex h-10 items-center justify-center" aria-hidden>
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-ink-600" />
          <span className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full border border-ink-600 bg-[#06080b] text-[0.625rem] text-paper-500">
            ↓
          </span>
        </div>

        <div className="rounded-md border border-signal-info/25 bg-signal-info/[0.05] px-3.5 py-3">
          <div className="label mb-2">Derived safeguard</div>
          <p className="text-[0.8125rem] leading-relaxed text-paper-100">
            One specific, testable rule — with its assumptions and its
            verification state stated, never assumed.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t hairline pt-4">
        <span className="pill pill-warn">a hypothesis is not evidence</span>
        <span className="mono text-[0.6875rem] text-paper-500">
          every link carries a state
        </span>
      </div>
    </figure>
  );
}
