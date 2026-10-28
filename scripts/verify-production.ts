/**
 * Verify a deployed AFTERMATH instance end to end.
 *
 * This is the safe path to proving the live integrations work in production.
 * It is read-only by default: it inspects the deployed API and asserts the
 * properties that matter for the submission, without triggering any Walrus
 * write or touching any credential. It never fabricates a result — every check
 * reads the deployment's own reported state.
 *
 * Checks:
 *   1. every page and API endpoint responds 2xx (not a 404/503)
 *   2. the audit index is durable (the persistence fix is deployed)
 *   3. the Walrus Memory backend is live and pointed at Mainnet
 *   4. the Tatum Sui adapter is configured
 *   5. at least ten completed, recall-verified Mainnet writes exist
 *   6. a recall query returns stored memories
 *
 * Usage:
 *   npm run verify:prod                       # verify the default URL
 *   npm run verify:prod -- --url https://...  # verify a specific deployment
 *   npm run verify:prod -- --run              # first trigger the scenario run
 *                                             # (opt-in; causes real Mainnet writes)
 *
 * Exit code is non-zero if any check fails, so it can gate a release.
 */

import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const DEFAULT_URL = process.env.AFTERMATH_PROD_URL ?? "https://aftermath-7tij.vercel.app";
const REQUIRED_WRITES = 10;

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * The subset of `/api/overview` this verifier reads. Kept loose because a stale
 * deployment may omit fields entirely — that omission is itself a finding, not
 * a reason to throw.
 */
export interface OverviewShape {
  counts?: Record<string, number>;
  configuration?: {
    persistence?: { backend: string; durable: boolean; detail: string };
    memory?: { backend: string; isLive: boolean; network: string; reason: string };
    tatum?: { configured: boolean; interface: string };
  };
  mainnetRequirement?: {
    required: number;
    completedLive: number;
    recallVerified: number;
    remaining: number;
    satisfied: boolean;
  };
  tatumHealth?: { ok: boolean; detail: string };
  memoryStatus?: { state: string; authenticated: boolean; detail: string };
}

/**
 * Turn a parsed `/api/overview` payload into checks.
 *
 * Pure and exported so the honesty rules — a missing persistence block fails,
 * a simulated backend fails, a live mainnet connection is required — are pinned
 * by tests without any network access.
 */
export function assessOverview(ov: OverviewShape | null): Check[] {
  if (!ov) {
    return [
      { name: "GET /api/overview parsed", ok: false, detail: "no payload" },
    ];
  }
  const checks: Check[] = [];
  const persistence = ov.configuration?.persistence;
  checks.push({
    name: "audit index is durable",
    ok: Boolean(persistence?.durable),
    detail: persistence
      ? `${persistence.backend} — ${persistence.detail}`
      : "persistence block missing (stale deployment?)",
  });

  const memory = ov.configuration?.memory;
  checks.push({
    name: "Walrus Memory backend is live",
    ok: Boolean(memory?.isLive),
    detail: memory ? `${memory.backend} — ${memory.reason}` : "memory block missing",
  });

  // Require BOTH the mainnet network and a live adapter. A simulated backend
  // whose default config happens to point at the mainnet relayer has not
  // actually reached Mainnet, so it must not pass this check.
  checks.push({
    name: "Walrus Memory reaches Mainnet (live)",
    ok: Boolean(memory?.isLive) && memory?.network === "mainnet",
    detail: memory
      ? `network=${memory.network}, live=${memory.isLive}`
      : "memory block missing",
  });

  checks.push({
    name: "Walrus Memory credentials accepted",
    ok: Boolean(ov.memoryStatus?.authenticated),
    detail: ov.memoryStatus
      ? `${ov.memoryStatus.state} — ${ov.memoryStatus.detail}`
      : "memory status missing",
  });

  checks.push({
    name: "Tatum Sui adapter configured",
    ok: Boolean(ov.configuration?.tatum?.configured),
    detail: ov.configuration?.tatum
      ? `interface=${ov.configuration.tatum.interface}`
      : "tatum block missing",
  });

  checks.push({
    name: "Tatum Sui gateway healthy",
    ok: Boolean(ov.tatumHealth?.ok),
    detail: ov.tatumHealth?.detail ?? "no tatum health reported",
  });

  const req = ov.mainnetRequirement;
  checks.push({
    name: `≥ ${REQUIRED_WRITES} completed Mainnet writes`,
    ok: Boolean(req && req.completedLive >= REQUIRED_WRITES),
    detail: req
      ? `${req.completedLive} completed, ${req.recallVerified} recall-verified, ${req.remaining} remaining`
      : "requirement block missing",
  });

  checks.push({
    name: `≥ ${REQUIRED_WRITES} recall-verified Mainnet writes`,
    ok: Boolean(req && req.recallVerified >= REQUIRED_WRITES),
    detail: req ? `${req.recallVerified} recall-verified` : "requirement block missing",
  });

  return checks;
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = await res.text().catch(() => null);
  }
  return { status: res.status, body };
}

async function postJson(url: string, payload: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = await res.text().catch(() => null);
  }
  return { status: res.status, body };
}

async function main(): Promise<number> {
  const base = (arg("--url") ?? DEFAULT_URL).replace(/\/$/, "");
  const doRun = process.argv.includes("--run");
  const checks: Check[] = [];

  console.log("AFTERMATH production verification");
  console.log("─────────────────────────────────");
  console.log(`target : ${base}`);
  console.log(`mode   : ${doRun ? "run scenarios, then verify" : "read-only verify"}`);
  console.log("");

  // 0. Reachability of every user-facing page and API route.
  for (const path of [
    "/",
    "/incidents",
    "/safeguards",
    "/memory",
    "/evaluation",
    "/api/overview",
    "/api/config",
    "/api/incidents",
    "/api/rules",
    "/api/memory",
    "/api/evaluation",
  ]) {
    const res = await fetch(base + path, { redirect: "manual" });
    checks.push({
      name: `GET ${path}`,
      ok: res.status >= 200 && res.status < 300,
      detail: `HTTP ${res.status}`,
    });
  }

  // 1. Optionally trigger the scenario run (real Mainnet writes — opt-in only).
  if (doRun) {
    process.stdout.write("Triggering scenario run (this writes to Walrus Mainnet)… ");
    const run = await postJson(`${base}/api/scenarios/run`, {});
    if (run.status !== 200) {
      checks.push({
        name: "POST /api/scenarios/run",
        ok: false,
        detail: `HTTP ${run.status} — ${JSON.stringify(run.body).slice(0, 300)}`,
      });
    } else {
      checks.push({ name: "POST /api/scenarios/run", ok: true, detail: "HTTP 200" });
      process.stdout.write("done\n");
      // Give asynchronous Mainnet writes a moment to settle before verifying.
      process.stdout.write("Waiting for writes to settle… ");
      await delay(20_000);
      process.stdout.write("done\n");
    }
    console.log("");
  }

  // 2. Overview: persistence durability, integrations, write counts.
  const overview = await getJson(`${base}/api/overview`);
  const ov = overview.body as OverviewShape | null;

  if (overview.status !== 200) {
    checks.push({
      name: "GET /api/overview parsed",
      ok: false,
      detail: `HTTP ${overview.status}`,
    });
  } else {
    checks.push(...assessOverview(ov));
  }

  // 3. Recall must return something, proving the stored lessons are readable
  //    through the deployed instance (not just counted in a ledger).
  const recall = await postJson(`${base}/api/memory-verify`, {
    query: "require authoritative verification before reporting success",
    limit: 5,
  });
  const recallBody = recall.body as { count?: number; isLive?: boolean; backend?: string } | null;
  checks.push({
    name: "recall query returns memories",
    ok: recall.status === 200 && (recallBody?.count ?? 0) > 0,
    detail:
      recall.status === 200
        ? `${recallBody?.count ?? 0} result(s) from ${recallBody?.backend} (live=${recallBody?.isLive})`
        : `HTTP ${recall.status} — ${JSON.stringify(recall.body).slice(0, 200)}`,
  });

  // Report.
  console.log("");
  console.log("Results");
  console.log("───────");
  let failures = 0;
  for (const c of checks) {
    if (!c.ok) failures += 1;
    console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name.padEnd(42)} ${c.detail}`);
  }
  console.log("");
  if (failures === 0) {
    console.log(`All ${checks.length} checks passed against ${base}.`);
  } else {
    console.log(`${failures} of ${checks.length} checks FAILED against ${base}.`);
    console.log(
      "This is reported honestly. A failing check means the deployment does not " +
        "yet satisfy that property — it is not padded or retried into a pass.",
    );
  }
  return failures === 0 ? 0 : 1;
}

// Only run the network verification when executed directly, so tests can import
// assessOverview without making requests.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error("verification failed to run:", err);
      process.exit(2);
    });
}
