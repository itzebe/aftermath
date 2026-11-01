import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Route-level test for the learning-loop API.
 *
 * The route is exercised through the real service and a real file-backed store,
 * with the memory backend forced to the simulated adapter — no Mainnet call is
 * made. Two submissions with the same failure pattern are run through the real
 * pipeline so the view model has genuine records to summarise; the point under
 * test is that the route exposes only real, counted learning evidence, and that
 * it is reachable without authentication.
 */
let dir: string;
let GET: () => Promise<Response>;
let POST: (req: Request) => Promise<Response>;

const ADMIN_TOKEN = "learning-route-test-token";

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "aftermath-learning-route-"));
  process.env.AFTERMATH_FORCE_MOCK_MEMORY = "1";
  process.env.AFTERMATH_DB_PATH = path.join(dir, "aftermath.db");
  process.env.DATABASE_URL = "";
  process.env.POSTGRES_URL = "";
  process.env.AFTERMATH_DATABASE_URL = "";
  process.env.AFTERMATH_ADMIN_TOKEN = ADMIN_TOKEN;
  ({ GET } = await import("@/app/api/learning/route"));
  ({ POST } = await import("@/app/api/incidents/submit/route"));
});

afterAll(async () => {
  const { resetRuntime } = await import("@/lib/runtime");
  await resetRuntime().catch(() => {});
  await rm(dir, { recursive: true, force: true });
  delete process.env.AFTERMATH_FORCE_MOCK_MEMORY;
  delete process.env.AFTERMATH_DB_PATH;
  delete process.env.AFTERMATH_ADMIN_TOKEN;
});

function submit(text: string): Promise<Response> {
  return POST(
    new Request("http://test/api/incidents/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ADMIN_TOKEN}`,
      },
      body: JSON.stringify({ text }),
    }),
  );
}

const FIRST = `2026-03-01T10:00:00Z settlement-worker POST /v1/settle
the agent reported success for the settlement, but no transaction verification record was captured`;

const SECOND = `2026-03-02T09:00:00Z settlement-worker POST /v1/settle
the agent reported success for the settlement operation; no transaction verification record was captured`;

describe("GET /api/learning", () => {
  it("is reachable without authentication and returns a view model", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("history");
    expect(body).toHaveProperty("impact");
    expect(body).toHaveProperty("provenance");
  });

  it("reports the real learning loop after two matching submissions", async () => {
    expect((await submit(FIRST)).status).toBe(200);
    expect((await submit(SECOND)).status).toBe(200);

    const res = await GET();
    const body = await res.json();

    expect(body.impact.totalVerifiedSafeguards).toBeGreaterThanOrEqual(1);
    expect(body.impact.safeguardsPersisted).toBeGreaterThanOrEqual(1);
    expect(body.impact.investigationsInfluenced).toBeGreaterThanOrEqual(1);

    // The second investigation's before/after must be present. The verdict is
    // reached by the pre-existing legacy lesson path, which the comparison holds
    // constant; the memory's own, isolated contribution is the added verification
    // requirement. Reporting the verdict as memory-caused would be the
    // attribution error this guards against, so the decision is unchanged across
    // the two arms and no repeat-prevention is claimed.
    const changed = body.behaviourChanges.find(
      (b: { attributableToMemory: boolean }) => b.attributableToMemory,
    );
    expect(changed).toBeDefined();
    expect(changed.beforeDecision).toBe("REQUIRE_VERIFICATION");
    expect(changed.afterDecision).toBe("REQUIRE_VERIFICATION");
    expect(changed.addedRequiredChecks.length).toBeGreaterThan(0);
    expect(changed.changedByMemoryVersion).toBe(1);

    // Provenance links the memory to its origin incident and its influence.
    const prov = body.provenance[0];
    expect(prov.originIncidentId).toBeTruthy();
    expect(prov.influenced.length).toBeGreaterThanOrEqual(1);
  });
});
