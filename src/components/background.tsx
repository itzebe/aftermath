/**
 * The page backdrop.
 *
 * Two layers sit behind every page, inside the isolated `.bg-field` stacking
 * context established in the shell:
 *
 *   - a survey lattice (`.bg-lattice`): a fine grid inside a coarser one,
 *     masked so it dissolves before it can sit behind body text;
 *   - trace diagrams (`.bg-traces`): node-and-link structures that read as a
 *     verification network — the product's causal-chain idea at architectural
 *     scale. They are fixed, so they stay still while the content moves.
 *
 * The whole thing is decorative: it is `aria-hidden`, carries no text, and is
 * never animated, so it is inert for assistive technology and safe under
 * `prefers-reduced-motion` by construction. Every tone is drawn from the
 * existing palette (the hairline greys and the brand accent), so the identity
 * is unchanged — only its depth is.
 */
export function Background() {
  return (
    <>
      <div className="bg-lattice" aria-hidden />
      <div className="bg-traces" aria-hidden>
        <svg
          viewBox="0 0 1440 900"
          preserveAspectRatio="xMidYMid slice"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Ambient structure: two concentric reticles, read as calibration
              targets rather than decoration. */}
          <g stroke="currentColor" strokeWidth="1" opacity="0.55">
            <circle cx="1195" cy="250" r="200" />
            <circle cx="1195" cy="250" r="118" />
            <circle cx="205" cy="600" r="168" />
            <circle cx="205" cy="600" r="96" />
          </g>

          {/* The causal chain: a diagonal run of connected stages from the
              lower left toward the upper right, one rail, no shortcuts. */}
          <g
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
            opacity="0.9"
          >
            <path d="M-40 720 L150 640 L360 686 L560 596 L800 640 L1040 540" />
            <path d="M150 640 L120 470" />
            <path d="M560 596 L520 430 L700 360" />
            <path d="M800 640 L960 760 L1180 700 L1360 780" />
          </g>
          <g fill="currentColor" opacity="0.95">
            <circle cx="150" cy="640" r="3.4" />
            <circle cx="360" cy="686" r="3.4" />
            <circle cx="560" cy="596" r="3.4" />
            <circle cx="800" cy="640" r="3.4" />
            <circle cx="1040" cy="540" r="3.4" />
            <circle cx="520" cy="430" r="3.4" />
            <circle cx="960" cy="760" r="3.4" />
            <circle cx="1180" cy="700" r="3.4" />
          </g>

          {/* The verification mesh: a small triangulated cluster, the shape a
              cross-source confirmation makes. One link is drawn in the brand
              accent — the single confirmation, not a decoration. */}
          <g stroke="currentColor" strokeWidth="1" opacity="0.85">
            <path d="M1090 150 L1250 96 L1360 214 L1240 300 L1090 150" />
            <path d="M1090 150 L1240 300" />
            <path d="M1250 96 L1240 300" />
          </g>
          <path
            d="M1360 214 L1250 96"
            stroke="rgba(91, 157, 255, 0.5)"
            strokeWidth="1"
          />
          <g fill="currentColor" opacity="0.95">
            <circle cx="1090" cy="150" r="3.4" />
            <circle cx="1250" cy="96" r="3.4" />
            <circle cx="1360" cy="214" r="3.4" />
            <circle cx="1240" cy="300" r="3.4" />
          </g>
          <circle
            cx="1250"
            cy="96"
            r="12"
            stroke="rgba(91, 157, 255, 0.42)"
            strokeWidth="1"
          />

          {/* The settlement rail: a single horizontal run with periodic ticks,
              like the ledger line a transaction settles onto. */}
          <g stroke="currentColor" strokeWidth="1" opacity="0.7">
            <path d="M60 836 L1380 836" strokeDasharray="1 11" />
            <path d="M360 828 L360 844" />
            <path d="M720 828 L720 844" />
            <path d="M1080 828 L1080 844" />
          </g>

          {/* A vertical spine at the far right edge — the frame's edge rail. */}
          <g stroke="currentColor" strokeWidth="1" opacity="0.6">
            <path d="M1404 40 L1404 860" />
            <path d="M1396 220 L1412 220" />
            <path d="M1396 470 L1412 470" />
            <path d="M1396 720 L1412 720" />
          </g>
        </svg>
      </div>
    </>
  );
}
