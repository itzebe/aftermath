/**
 * Prove that a deployed AFTERMATH instance really runs the configured model.
 *
 * This is the read-only counterpart to `verify:prod`. It calls the deployed
 * `POST /api/ai/verify` with a synthetic fixture and reports, honestly, whether
 * a model actually ran. It submits no incident, creates no Walrus Memory, and
 * touches no audit record — the endpoint it calls holds no writer at all.
 *
 * It needs a token, because the endpoint fails closed without one:
 *
 *   AFTERMATH_AI_VERIFY_TOKEN=<token> npm run verify:ai
 *   npm run verify:ai -- --url https://... --token <token>
 *
 * The exit code is non-zero unless `inference.ran` is true. If the deployment
 * has no `GROQ_API_KEY`, or the token is wrong, this fails — on purpose. It
 * never reports a pass for a run that did not happen.
 */

import { pathToFileURL } from "node:url";

const DEFAULT_URL =
  process.env.AFTERMATH_PROD_URL ?? "https://aftermath-7tij.vercel.app";

/**
 * A synthetic incident — the same shape the regression fixtures use, with a
 * concrete mechanism and measurements. It contains no real credentials, hosts,
 * or customer data.
 */
const FIXTURE = `2026-03-01T10:00:00Z payment-api POST /v1/charge
HTTP 500 Internal Server Error
ENVIRONMENT: production
ERROR: Connection pool exhausted
Active connections: 50
idle connections: 0
max pool size: 50
Database pool utilization reached 100%
Database connection acquisition timed out after 5000ms`;

export interface AiVerifyResponse {
  inference?: {
    configured?: boolean;
    provider?: string;
    model?: string;
    ran?: boolean;
    availability?: string;
  };
  analysis?: {
    interpretation?: string;
    observedFacts?: unknown[];
    measurements?: unknown[];
    rejectedClaims?: unknown[];
    error?: string;
  };
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export interface Verdict {
  ok: boolean;
  lines: string[];
}

/** Turn the endpoint's response into an honest pass/fail verdict. */
export function assessAiVerify(status: number, body: AiVerifyResponse | null): Verdict {
  const lines: string[] = [];
  if (status !== 200) {
    return {
      ok: false,
      lines: [`HTTP ${status} — ${JSON.stringify(body).slice(0, 300)}`],
    };
  }
  const inf = body?.inference;
  if (!inf) return { ok: false, lines: ["response had no `inference` block"] };

  lines.push(`provider     : ${inf.provider ?? "?"}`);
  lines.push(`model        : ${inf.model ?? "?"}`);
  lines.push(`configured   : ${inf.configured}`);
  lines.push(`availability : ${inf.availability}`);
  lines.push(`ran          : ${inf.ran}`);
  lines.push(
    `grounded     : ${body?.analysis?.observedFacts?.length ?? 0} fact(s), ` +
      `${body?.analysis?.measurements?.length ?? 0} measurement(s), ` +
      `${body?.analysis?.rejectedClaims?.length ?? 0} rejected claim(s)`,
  );

  // The only pass is a model that actually ran. Anything else is reported as
  // it is — never massaged into a success.
  return { ok: inf.ran === true, lines };
}

async function main(): Promise<number> {
  const base = (arg("--url") ?? DEFAULT_URL).replace(/\/$/, "");
  const token = arg("--token") ?? process.env.AFTERMATH_AI_VERIFY_TOKEN;

  console.log("AFTERMATH AI verification (read-only)");
  console.log("─────────────────────────────────────");
  console.log(`target : ${base}`);
  console.log("mode   : read-only — no incident, no memory write, no record");
  console.log("");

  if (!token) {
    console.error(
      "No token. Set AFTERMATH_AI_VERIFY_TOKEN (or pass --token). The endpoint\n" +
        "fails closed without one, by design.",
    );
    return 2;
  }

  const res = await fetch(`${base}/api/ai/verify`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ text: FIXTURE, service: "payment-api" }),
  });

  let body: AiVerifyResponse | null = null;
  try {
    body = (await res.json()) as AiVerifyResponse;
  } catch {
    body = null;
  }

  const verdict = assessAiVerify(res.status, body);
  for (const line of verdict.lines) console.log(line);
  console.log("");
  if (verdict.ok) {
    console.log("PASS — a model ran and returned grounded output.");
    if (body?.analysis?.interpretation) {
      console.log("");
      console.log("Reading:");
      console.log(body.analysis.interpretation);
    }
  } else {
    console.log("NOT VERIFIED — no confirmed live inference.");
    console.log(
      "This is reported honestly. A deployment with no provider key, or a bad\n" +
        "token, does not pass this check.",
    );
  }
  return verdict.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error("verification failed to run:", err);
      process.exit(2);
    });
}
