# AFTERMATH — hackathon readiness (Total Recall)

**Event:** Walrus × Tatum: **Total Recall**, 20 Oct – 10 Nov 2026 (submit by
10 Nov, 17:00 UTC). **Track:** 02 — **Smart Agents for Real Life**.
**Verified:** 2026-11-03 against production
<https://aftermath-7tij.vercel.app/>.

Every status below is `PASS`, `FAIL`, `BLOCKED`, or `NOT TESTED`, and every value
has a source. Nothing here is a projection.

---

## 1. Submission requirements (official)

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Walrus Memory integrated and writing on Mainnet | **PASS** | Real SDK writes to `https://relayer.memory.walrus.xyz`, namespace `aftermath`. `GET /api/overview` → `memoryStatus.state = MAINNET_AUTH_CONFIRMED`, `isLive: true`, `network: mainnet`. Each write awaited to a blob id and confirmed by a recall query. |
| 2 | Tatum RPC used for on-chain data where relevant | **PASS** | `sui.rpc.v2.LedgerService/GetTransaction` on Tatum Sui Mainnet gRPC, GraphQL fallback. Proven load-bearing: the same class of submission → `ALLOW` / `BLOCK` / `REQUIRE_VERIFICATION` strictly by Tatum's answer (`artifacts/evidence/2026-11-03-tatum-integration.json`). |
| 3 | At least 10 memories stored on Mainnet | **PASS** | **189** completed, **186** recall-verified live writes (`simulatedWrites: 0`); `mainnetRequirement` = `{required: 10, completedLive: 189, recallVerified: 186, remaining: 0, satisfied: true}`. |
| 4 | Published blog post (what it does, how it uses Tatum + Walrus, how it learned) | **PASS** | Medium article live (HTTP 200, `artifacts/…`; see Final links) and GitHub Pages mirror (HTTP 200). Source `docs/BLOG.md`. |
| 5 | Working demo and public repo | **PASS** | Production app HTTP 200; public repo HTTP 200; local demo `artifacts/aftermath-final-demo.mp4` (121.4 s). |
| 6 | Optional: build with Tatum AI Builder (ai.tatum.io) — $500 bonus | **NOT PURSUED** | AFTERMATH uses Tatum RPC/Data APIs directly. The dedicated AI-Builder award is out of scope and is not claimed. |

## 2. Judging criteria (official)

| Criterion | Weight | How AFTERMATH answers it | Evidence |
| --- | --- | --- | --- |
| Walrus and Tatum integration | 30% | Walrus Memory is the substrate of the loop (write → recall → applied → behaviour change), not a bolt-on; Tatum is the authoritative verifier and is proven to *decide* the verdict. | `/api/overview`, `/api/learning`, `TATUM-INTEGRATION-ARCHITECTURE.md` |
| Technical quality | 30% | Type-checked, lint-clean, hermetic unit suite, hermetic E2E, 28/28 production checks; strict data handling, redaction, idempotency, shared rate limiting, fail-closed guards. | §4 verification gates below |
| Creativity | 20% | The contribution is *proven* by a two-arm counterfactual over the decision engine, and the system reports its own null results (0 repeat preventions) rather than inflating them. | `/learning` behaviour change; `FINAL-REPORT.md` §K |
| Presentation | 20% | Judge quick-start, narrated demo (2:01), architecture, Devpost copy, live figures on every page. | `JUDGE-QUICK-START.md`, `artifacts/aftermath-final-demo.mp4` |
| Bonus: share on X / LinkedIn | — | Not performed by this mission. Owner action. | — |

## 3. Special prizes

| Prize | Applies? | Why |
| --- | --- | --- |
| Best Walrus Memory Prize ($500) — deepest learning loop, memories that visibly change the product | **Targeted** | The loop is closed and demonstrated by a counterfactual; memory changes `requiredChecks` and, where applicable, the verdict. Provenance shows the contribution and the cases where it changed nothing. |
| Best Tatum AI Builder App Prize ($500) | **Not pursued** | Built with Tatum RPC/Data APIs, not the AI Builder. Not claimed. |

## 4. Verification gates (fresh, 2026-11-03)

| Gate | Result | Notes |
| --- | --- | --- |
| `tsc --noEmit` | **PASS** | exit 0 |
| `eslint src tests scripts e2e` | **PASS** | exit 0 |
| `next build` | **PASS** | production build succeeds |
| `vitest run` (no Postgres in this env) | **PASS** | 595 passed, 40 skipped (Postgres-gated) — skips reported, never counted as pass |
| `vitest run` (operator env, `AFTERMATH_TEST_DATABASE_URL`) | **PASS** | 620 passed, 12 skipped |
| `playwright test` | **PASS** | 18 passed, 0 failed |
| `npm run verify:prod` | **PASS** | **28/28** with `AFTERMATH_ADMIN_TOKEN` |
| Anonymous submission (live) | **PASS** | real `BLOCK` record from a real failed Sui digest through Tatum; see §5 |
| Cross-instance rate limit | **PASS** (operator env) | shared PostgreSQL counter; 4/4 |
| Redaction | **PASS** | secrets masked in `/api/config` and evidence; digest preserved |
| Duplicate / idempotency | **PASS** | resubmission of the sample returns the existing record id; no extra Mainnet write |

## 5. Live public user journey (anonymous, 2026-11-03)

Performed with no account, no invitation, and no admin token:

| Step | Result |
| --- | --- |
| Discovery — homepage explains what/why | **PASS** |
| Access — home, `/incidents`, `/records`, `/safeguards`, `/learning`, `/memory`, `/lab` | **PASS** |
| Submission — anonymous POST accepted | **PASS** (`recordId 76272b29-b49d-ca39-f174-44ffab4143a8`) |
| Investigation — grounded in the submitted digest | **PASS** |
| Learning — authoritative lookup folded in | **PASS** (`authoritativeLookup.verified: true`, `status: VERIFIED_FAILURE`) |
| Persistence — incident written to Walrus Mainnet | **PASS** (`state: completed`, `backend: memwal-mainnet`, `provenance: live`) |
| Recall — prior safeguards retrieved | **PASS** (5 recalled) |
| Behaviour change — visible, honest | **PASS** (`changed: false` — the safeguard was redundant against the legacy lessons; reported, not hidden) |
| Transparency — provenance and contribution visible | **PASS** |

Raw response: `artifacts/evidence/2026-11-03-public-journey-submit.json`.

## 6. Honest limitations

- **0 demonstrated repeat preventions.** The instance has not independently shown
  a memory preventing a *second* real recurrence. The learning loop's contribution
  is shown as a counterfactual and as added verification requirements, not as a
  claimed repeat prevention.
- **Unit suite needs a database.** The Postgres-gated suites skip where no Postgres
  is reachable; they are reported as skipped.
- **`verify:prod` recall check is admin-gated.** Passes 28/28 with the operator
  token; without it, that one check is an explicit failure (27/28), never skipped.
- **Duplicate Vercel project.** `aftermath` (`aftermath-theta.vercel.app`) still
  exists and deploys from the same repo on a simulated backend. Left in place per
  instruction; see `FINAL-REPORT.md` §K and
  `artifacts/evidence/2026-11-03-duplicate-vercel-project.md`.

## 7. Links

| Artifact | URL | Verified |
| --- | --- | --- |
| Production | <https://aftermath-7tij.vercel.app/> | HTTP 200 |
| Repository | <https://github.com/itzebe/aftermath> | HTTP 200 |
| Medium article | <https://medium.com/@jonathanebi05/aftermath-every-failure-should-leave-a-safeguard-25446fdbcd71> | HTTP 403 to automated clients (Medium bot protection); renders for humans |
| GitHub Pages mirror | <https://itzebe.github.io/aftermath/> | HTTP 200 |
| Demo video | `artifacts/aftermath-final-demo.mp4` (2:01 / 121.4 s) | container-verified |
