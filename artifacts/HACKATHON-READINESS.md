# AFTERMATH — hackathon readiness (Total Recall)

**Event:** Walrus × Tatum: **Total Recall**, 20 Oct – 10 Nov 2026 (submit by
10 Nov 2026, 17:00 UTC). **Track:** 02 — **Smart Agents for Real Life**.
**Verified:** 2026-11-04 against production <https://aftermath-7tij.vercel.app/>
and the official form <https://recall-tatum-walrus.vercel.app/>.

Status legend: **VERIFIED** · **PREPARED** · **USER INPUT REQUIRED** ·
**BLOCKED** · **NOT APPLICABLE**. Every value names its source. Nothing here is a
projection.

---

## 1. Official submission requirements

Source: Event Rules <https://thewalrussessions.wal.app/tatum-total-recall>
("Submission Requirements") and the event page
<https://tatum.io/hackathon/total-recall>.

| # | Requirement (official) | Status | Evidence | Remaining action |
| --- | --- | --- | --- | --- |
| 1 | Walrus Memory integrated and writing on **Mainnet** | **VERIFIED** | Real SDK writes to `https://relayer.memory.walrus.xyz`, namespace `aftermath`; `GET /api/config` → `memory.backend=memwal-mainnet`, `isLive:true`. | none |
| 2 | Tatum RPC used for on-chain data where relevant | **VERIFIED** | `sui.rpc.v2.LedgerService/GetTransaction` on Tatum Sui Mainnet gRPC (GraphQL fallback). Load-bearing: same claim over three real digests → ALLOW/BLOCK/REQUIRE_VERIFICATION. Re-confirmed 3/3 this mission against Tatum **and** a public Sui fullnode. | none |
| 3 | At least **10 memories** stored on Mainnet | **VERIFIED** | **196** completed / **193** recall-verified live writes, `simulatedWrites: 0`; `mainnetRequirement = {required:10, remaining:0, satisfied:true}`. | none |
| 4 | Published **blog post** (what it does, how it uses Tatum + Walrus, how it learned) | **VERIFIED** | Medium article present in the author's public RSS feed; GitHub Pages mirror HTTP 200. | optional: update the article's stale instance count (see §5) |
| 5 | Working **demo** and public **repo** | **VERIFIED** | Production HTTP 200; repo HTTP 200; demo `artifacts/aftermath-final-demo.mp4` (142.32 s) + published `demo-v2` (2:36). | choose a demo URL for field 13 (Step 4 of checklist) |
| 6 | Optional: build with Tatum AI Builder (ai.tatum.io) — $500 bonus | **NOT APPLICABLE** | Built directly on Tatum RPC/Data APIs; AI Builder not used. The form asks to say so briefly (field 17). | none (honest answer prepared) |

## 2. Official judging criteria

Source: Event Rules, "Judgment of Submissions".

| Criterion | Weight | How AFTERMATH answers it | Evidence |
| --- | --- | --- | --- |
| Walrus and Tatum integration | 30% | Walrus Memory is the substrate of the loop (write → recall → applied → behaviour change); Tatum is the authoritative verifier and is proven to *decide* the verdict. | `/api/overview`, `/api/learning`, `TOTAL-RECALL-EVIDENCE.md` |
| Technical quality | 30% | Type-checked, lint-clean, hermetic unit + E2E suites, 28/28 production checks; redaction, idempotency, shared rate limiting, fail-closed guards. | §4 gates |
| Creativity | 20% | Contribution *proven* by a two-arm counterfactual over the decision engine; the system reports its own null results (0 repeat preventions). | `/learning` behaviour change; `TOTAL-RECALL-EVIDENCE.md` |
| Presentation | 20% | Narrated demo (2:22), architecture doc, blog post, live figures on every page. | `artifacts/aftermath-final-demo.mp4`, `docs/BLOG.md` |
| Bonus: share on X / LinkedIn | — | **USER INPUT REQUIRED** — owner action; tags optional. | — |

## 3. Official form fields (20 controls)

Source: live form inspected 2026-11-04. Full copy in
[`TOTAL-RECALL-FORM-ANSWERS.md`](TOTAL-RECALL-FORM-ANSWERS.md).

| Field | Status | Remaining action |
| --- | --- | --- |
| 1 Email | **USER INPUT REQUIRED** | supply |
| 2 Discord handle | **USER INPUT REQUIRED** | supply |
| 3 LinkedIn | **USER INPUT REQUIRED** | supply |
| 4 Telegram ID (optional) | **USER INPUT REQUIRED** | supply or leave blank |
| 5 How did you hear about this event? | **USER INPUT REQUIRED** | choose truthfully |
| 6 Community/account (optional, ≤200) | **PREPARED** | optional |
| 7 First Web3 project? | **USER INPUT REQUIRED** | Yes/No |
| 8 Tatum ID | **USER INPUT REQUIRED** | dashboard.tatum.io |
| 9 SUI address | **USER INPUT REQUIRED** | supply |
| 10 Account ID (SUI) | **USER INPUT REQUIRED** | `MEMWAL_ACCOUNT_ID` |
| 11 MEMWAL_AGENT_ID | **USER INPUT REQUIRED** | delegate public key |
| 12 Project description | **PREPARED** | paste |
| 13 Demo video URL | **PREPARED** | choose hosted URL (Step 4) |
| 14 GitHub repo | **PREPARED** | paste |
| 15 Additional documentation | **PREPARED** | paste (optional) |
| 16 Walrus experience | **PREPARED** | paste |
| 17 Tatum AI Builder experience | **PREPARED** | paste (says "did not use") |
| 18 Walrus friction (optional) | **PREPARED** | paste or leave blank |
| 19 Social post links (optional) | **USER INPUT REQUIRED** | post + paste (bonus) |
| 20 Agreement checkbox | **PREPARED** | review terms, then tick |

## 4. Verification gates (fresh, 2026-11-04)

| Gate | Result | Notes |
| --- | --- | --- |
| `npx tsc --noEmit` | **PASS** | exit 0 |
| `npm run lint` | **PASS** | exit 0 |
| `npm run build` | **PASS** | production build succeeds |
| `npm test` (vitest) | **PASS** | **631 passed, 12 skipped** (skips = opt-in live-smoke) |
| `npm run test:e2e` (playwright) | **PASS** | **19 passed, 0 failed** |
| `npm run verify:prod` | **PASS** | **28/28** anonymously (no admin token) |
| Anonymous submission (live) | **PASS** | real record through Tatum; idempotent (no new write) |
| Cross-instance rate limit | **PASS** | first 429 at request 4; `retry-after` + JSON hint |
| Redaction | **PASS** | secrets masked in `/api/config`; digests preserved |
| Duplicate / idempotency | **PASS** | resubmission returns existing record; no extra Mainnet write |
| Live axe sweep, 8 public routes | **PASS** | 0 violations |
| Mobile overflow, 8 public routes | **PASS** | 0 px |
| Production deployment identity | **VERIFIED** | `dpl_6VHGZpcPwoL6j5MQaBTZVCoQMjEM`, READY, commit `7f2e7a5388` |

## 5. Honest limitations

- **0 demonstrated repeat preventions.** The instance has not independently shown
  a memory preventing a *second* real recurrence. The loop's contribution is shown
  as a counterfactual and as added verification requirements (6 investigations
  influenced, 6 verification requirements strengthened), not as a claimed repeat
  prevention.
- **Medium article instance count is stale** (says 51; current is 196). The
  article is otherwise accurate; a dated edit or note is optional.
- **Unit suite needs a database.** Postgres-gated suites skip where no Postgres is
  reachable and are reported as skipped, never as passing.
- **Duplicate Vercel project** `aftermath` (`aftermath-theta.vercel.app`) still
  exists (same repo, simulated backend). Not deleted per mission rules.
- **Not full WCAG 2.2 AA conformance** — the axe sweep is evidence, not a
  conformance claim.

## 6. Links

| Artifact | URL | Verified |
| --- | --- | --- |
| Production | <https://aftermath-7tij.vercel.app/> | HTTP 200 |
| Repository | <https://github.com/itzebe/aftermath> | HTTP 200 |
| Medium article | <https://medium.com/@jonathanebi05/aftermath-every-failure-should-leave-a-safeguard-25446fdbcd71> | in public RSS feed (URL 403s to bots only) |
| GitHub Pages mirror | <https://itzebe.github.io/aftermath/> | HTTP 200 |
| Demo (published) | <https://github.com/itzebe/aftermath/releases/tag/demo-v2> | HTTP 200 |
| Demo (final cut) | `artifacts/aftermath-final-demo.mp4` (2:22) | container-verified |
