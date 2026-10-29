import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

/**
 * Route-level tests for the read-only AI verification endpoint.
 *
 * The endpoint runs the real inference path against a stubbed `fetch` (the only
 * place a stand-in is justified — the real provider needs a credential and the
 * network, and the suite must never spend free-tier quota). Everything above the
 * transport boundary — auth, rate limiting, validation, grounding, fallback — is
 * the real code under test.
 *
 * Two properties are proven here beyond the happy path: that the endpoint is
 * *fail-closed* when unconfigured, and that it *cannot* submit an incident or
 * persist anything, verified both structurally (its imports) and behaviourally
 * (no database file is created by a call).
 */

const TOKEN = "verify-token-abc123";
const GROQ_KEY = "gsk_test_key_not_real_0000000000000000000000";
const FIXTURE = `2026-03-01T10:00:00Z payment-api POST /v1/charge
HTTP 500 Internal Server Error
ERROR: Connection pool exhausted
Active connections: 50
idle connections: 0
max pool size: 50
Database connection acquisition timed out after 5000ms`;

let POST: (req: Request) => Promise<Response>;
let resetVerifyLimiter: () => void;
let dir: string;
let originalFetch: typeof fetch;

beforeEach(async () => {
  if (!POST) {
    dir = await mkdtemp(path.join(tmpdir(), "aftermath-ai-verify-"));
    process.env.AFTERMATH_FORCE_MOCK_MEMORY = "1";
    process.env.AFTERMATH_DB_PATH = path.join(dir, "aftermath.db");
    process.env.DATABASE_URL = "";
    process.env.POSTGRES_URL = "";
    process.env.AFTERMATH_DATABASE_URL = "";
    originalFetch = globalThis.fetch;
    ({ POST } = await import("@/app/api/ai/verify/route"));
    ({ resetVerifyLimiter } = await import("@/lib/api/verify-guard"));
  }
  process.env.AFTERMATH_AI_VERIFY_TOKEN = TOKEN;
  process.env.AFTERMATH_AI_VERIFY_MAX = "3";
  process.env.AFTERMATH_AI_VERIFY_WINDOW_MS = "60000";
  // Each test starts with a fresh rate-limit window.
  resetVerifyLimiter();
});

afterAll(async () => {
  globalThis.fetch = originalFetch;
  await rm(dir, { recursive: true, force: true });
  for (const k of [
    "AFTERMATH_AI_VERIFY_TOKEN",
    "AFTERMATH_AI_VERIFY_MAX",
    "AFTERMATH_AI_VERIFY_WINDOW_MS",
    "AFTERMATH_FORCE_MOCK_MEMORY",
    "AFTERMATH_DB_PATH",
    "GROQ_API_KEY",
  ]) {
    delete process.env[k];
  }
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function groqOk(content: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** A grounded response: facts and measurements that all appear in FIXTURE. */
function groundedBody(): string {
  return JSON.stringify({
    interpretation: "The connection pool is saturated.",
    observedFacts: [
      { kind: "http_status", value: "HTTP 500", source: "HTTP 500 Internal Server Error" },
    ],
    measurements: [
      { label: "active connections", value: "50", unit: "", source: "Active connections: 50" },
      {
        label: "acquisition timeout",
        value: "5000",
        unit: "ms",
        source: "Database connection acquisition timed out after 5000ms",
      },
    ],
    hypotheses: [],
    missingEvidence: ["whether connections are released"],
    recommendedInvestigations: [],
    candidateSafeguards: [],
    verificationRequirements: [],
    unknownOutcomes: [],
  });
}

function call(
  body: unknown,
  opts: { token?: string | null; ip?: string; raw?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = opts.token === undefined ? TOKEN : opts.token;
  if (token) headers.authorization = `Bearer ${token}`;
  headers["x-forwarded-for"] = opts.ip ?? "10.0.0.1";
  return POST(
    new Request("http://test/api/ai/verify", {
      method: "POST",
      headers,
      body: opts.raw ?? JSON.stringify(body),
    }),
  );
}

describe("POST /api/ai/verify — access control", () => {
  it("fails closed with 503 when no token is configured", async () => {
    const saved = process.env.AFTERMATH_AI_VERIFY_TOKEN;
    delete process.env.AFTERMATH_AI_VERIFY_TOKEN;
    const res = await call({ text: FIXTURE }, { ip: "10.9.9.9" });
    process.env.AFTERMATH_AI_VERIFY_TOKEN = saved;
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("ai_verify_disabled");
  });

  it("rejects a missing token with 401", async () => {
    const res = await call({ text: FIXTURE }, { token: null, ip: "10.9.9.8" });
    expect(res.status).toBe(401);
  });

  it("rejects a wrong token with 401", async () => {
    const res = await call({ text: FIXTURE }, { token: "nope", ip: "10.9.9.7" });
    expect(res.status).toBe(401);
  });

  it("rate-limits a caller past the configured window cap", async () => {
    globalThis.fetch = async () => groqOk(groundedBody());
    process.env.GROQ_API_KEY = GROQ_KEY;
    const ip = "10.7.7.7";
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      statuses.push((await call({ text: FIXTURE }, { ip })).status);
    }
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses[3]).toBe(429);
  });
});

describe("POST /api/ai/verify — inference status", () => {
  it("returns a grounded analysis with inference.ran=true when the model runs", async () => {
    process.env.GROQ_API_KEY = GROQ_KEY;
    let sawAuth = "";
    let sawBody = "";
    globalThis.fetch = async (_url, init) => {
      sawAuth = String((init?.headers as Record<string, string>)?.authorization ?? "");
      sawBody = String(init?.body ?? "");
      return groqOk(groundedBody());
    };

    const res = await call({ text: FIXTURE }, { ip: "10.1.1.1" });
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as {
      inference: { ran: boolean; configured: boolean; availability: string };
      analysis: { observedFacts: unknown[]; measurements: unknown[] };
    };
    expect(body.inference.configured).toBe(true);
    expect(body.inference.ran).toBe(true);
    expect(body.inference.availability).toBe("ran");
    expect(body.analysis.observedFacts.length).toBeGreaterThan(0);
    expect(body.analysis.measurements.length).toBe(2);
    // The key is used server-side but never echoed back in the response.
    expect(sawAuth).toContain(GROQ_KEY);
    expect(text).not.toContain(GROQ_KEY);
    // The synthetic fixture reached the model.
    expect(sawBody).toContain("Connection pool exhausted");
  });

  it("reports not_configured honestly when no provider key is present", async () => {
    delete process.env.GROQ_API_KEY;
    globalThis.fetch = async () => {
      throw new Error("the network must not be reached when unconfigured");
    };
    const res = await call({ text: FIXTURE }, { ip: "10.2.2.2" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      inference: { configured: boolean; ran: boolean; availability: string };
      analysis: { observedFacts: unknown[] };
    };
    expect(body.inference.configured).toBe(false);
    expect(body.inference.ran).toBe(false);
    expect(body.inference.availability).toBe("not_configured");
    expect(body.analysis.observedFacts).toEqual([]);
  });

  it("maps a provider 429 to rate_limited without a verdict", async () => {
    process.env.GROQ_API_KEY = GROQ_KEY;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: { message: "rate limited" } }), {
        status: 429,
        headers: { "retry-after": "30" },
      });
    const res = await call({ text: FIXTURE }, { ip: "10.3.3.3" });
    const body = (await res.json()) as { inference: { ran: boolean; availability: string } };
    expect(body.inference.ran).toBe(false);
    expect(body.inference.availability).toBe("rate_limited");
  });

  it("maps a malformed completion to invalid_response", async () => {
    process.env.GROQ_API_KEY = GROQ_KEY;
    globalThis.fetch = async () => groqOk("this is not JSON");
    const res = await call({ text: FIXTURE }, { ip: "10.4.4.4" });
    const body = (await res.json()) as { inference: { ran: boolean; availability: string } };
    expect(body.inference.ran).toBe(false);
    expect(body.inference.availability).toBe("invalid_response");
  });

  it("rejects a fabricated measurement while keeping grounded claims", async () => {
    process.env.GROQ_API_KEY = GROQ_KEY;
    const fabricated = JSON.stringify({
      interpretation: "Reading.",
      observedFacts: [
        { kind: "http_status", value: "HTTP 500", source: "HTTP 500 Internal Server Error" },
      ],
      measurements: [
        // The span is real but the value is invented: must be rejected.
        { label: "active connections", value: "9999", unit: "", source: "Active connections: 50" },
      ],
      hypotheses: [],
      missingEvidence: [],
      recommendedInvestigations: [],
      candidateSafeguards: [],
      verificationRequirements: [],
      unknownOutcomes: [],
    });
    globalThis.fetch = async () => groqOk(fabricated);
    const res = await call({ text: FIXTURE }, { ip: "10.5.5.5" });
    const body = (await res.json()) as {
      inference: { ran: boolean };
      analysis: { measurements: unknown[]; rejectedClaims: { claim: string }[] };
    };
    expect(body.analysis.measurements).toEqual([]);
    expect(body.analysis.rejectedClaims.length).toBeGreaterThan(0);
    // A grounded fact survives, so a model still "ran".
    expect(body.inference.ran).toBe(true);
  });

  it("rejects a malformed fixture before any inference", async () => {
    process.env.GROQ_API_KEY = GROQ_KEY;
    globalThis.fetch = async () => {
      throw new Error("must not be reached");
    };
    const res = await call({ text: "" }, { ip: "10.6.6.6" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_submission");
  });
});

describe("POST /api/ai/verify — persistence safety", () => {
  it("imports nothing that can persist or transact", () => {
    const files = [
      "src/app/api/ai/verify/route.ts",
      "src/lib/engines/ai-verify.ts",
      "src/lib/api/verify-guard.ts",
    ];
    const forbidden = [
      "@/lib/runtime",
      "@/lib/service",
      "submission-pipeline",
      "@/lib/db/",
      "memory-factory",
      "memwal",
      "tatum",
      "safeguard-store",
      "audit-store",
    ];
    for (const f of files) {
      const src = readFileSync(path.resolve(process.cwd(), f), "utf8");
      const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
      for (const bad of forbidden) {
        expect(imports.some((i) => i.includes(bad)), `${f} imports ${bad}`).toBe(false);
      }
    }
  });

  it("creates no database file and no record when called", async () => {
    process.env.GROQ_API_KEY = GROQ_KEY;
    globalThis.fetch = async () => groqOk(groundedBody());
    const before = await readdir(dir);
    const res = await call({ text: FIXTURE }, { ip: "10.8.8.8" });
    expect(res.status).toBe(200);
    const after = await readdir(dir);
    expect(after).toEqual(before);
    expect(after.some((f) => f.endsWith(".db"))).toBe(false);
  });
});
