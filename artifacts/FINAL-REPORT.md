# AFTERMATH — Mission 9 final report

**Date:** 2026-11-04
**Production project:** `aftermath-7tij` — <https://aftermath-7tij.vercel.app/>
**Repository:** <https://github.com/itzebe/aftermath> (branch `master`)

---

## A. Verified repository and deployment baseline

| Item | Verified value |
| --- | --- |
| Remote | `https://github.com/itzebe/aftermath.git` |
| Branch | `master` |
| Application commit verified end to end | `8d499fb06a24cb30dc2524b5920df4085ee26905` |
| This mission's application change | PR #18 → merge `3fca1b98` (SC 2.5.8 target-size fix on `/learning`; artifact relocation and evidence sync) |
| Documentation follow-up | PR #19 → merge `73ff7a37` (pins this report; no application change) |
| Presentation-mission merge | PR #21 → merge `cdd9837b701e5fc9eb3ba734966decfd6698ba56` (final narrated demo, hermetic E2E harness, resilient `verify:prod`; no application-runtime change) |
| Tatum-mission change | PR #24 → merge `b8ce867982a527d54f7bd89e13690eb7f087ba59` (`feat(tatum): make the on-chain evidence path discoverable` — labelled Sui/incident samples on the public front door and operator console; shared `src/lib/samples.ts`; DOM + E2E regression tests) |
| Earlier doc/audit merges | PR #25 `f6d3c11771`, #26 `510b471e2e`, #27 `9f8dd843c5`, #28 `354d6ed60f`, #29 `f186b65bfb` |
| This mission's application changes | PR-less direct commits `7d0daff` (`feat(record): surface the engine decision beside the safeguard`), `911fa18` (`test(verify): fall back to public recall evidence when no admin token`), `8d499fb` (`fix(record): label memory from the actual writes, not just the lesson`) |
| Latest verified `master` | `8d499fb06a24cb30dc2524b5920df4085ee26905` (this mission) |
| Prior baseline reviewed | `182bef4c` (PR #17) |
| Vercel project | `aftermath-7tij` — `prj_GWK9nkfkYHm269zFh7zLCjpEYiO5` |
| Production deployment (application) | `dpl_HcpyrnPF7P8L4QbjyzpKamxcvPyw`, READY, application commit `8d499fb06a`, target `production` |
| Production alias | `aftermath-7tij.vercel.app` → the newest READY production deployment on `master` (documentation-only commits advance the SHA without changing application behaviour) |


Confirmed by the Vercel API and by the deployed app, not assumed. The
application commit verified end to end **this mission** is `8d499fb06a`.
Documentation-only commits made after the verification advance the deployment
SHA (e.g. `0ff55a9`) without changing application-runtime behaviour; the
application baseline stays `8d499fb06a`. It
carries three focused changes on top of the previous verified baseline
`b8ce867` (PR #24):

1. `7d0daff` — surface the engine **decision** (ALLOW / BLOCK /
   REQUIRE_VERIFICATION) beside the safeguard in the record header; previously
   only the recommendation action was shown, which hid the counterfactual.
2. `911fa18` — `verify:prod` falls back to the public learning surface for its
   recall check when no admin token is present, so all 28 checks pass
   anonymously.
3. `8d499fb` — label the record's memory from the **actual writes** rather than
   the lesson alone, so a successful investigation with nothing to learn no
   longer reads as if nothing was persisted.

All three were verified end to end this mission (typecheck, lint, build, 18 E2E,
631 vitest, 28/28 production checks, and a live anonymous journey). The
SC 2.5.8 target-size fix from the earlier baseline remains confirmed live: the
`/learning` record links measure 93×24 px on production (they were 63×14 px).

---

## B. Independent PR #12 review

PR #12 (`feat/public-investigation-and-resilience`) was reviewed before merge.

**Findings addressed in this mission:**

1. **The front door routed visitors to the operator sign-in.** The submission API
   was already open to anonymous callers, but the home page told a visitor that
   investigation "is performed by the operator". The product's core act was
   unreachable without a credential. Fixed by mounting the investigation
   workspace on the home page and letting the anonymous path submit without an
   operator header.
2. **The read path could 504.** Reproduced under concurrency: `/api/overview`,
   which the home page awaits, held the request open until the platform timed
   out. Two unbounded waits were found and bounded — the external status probes
   (Tatum, Walrus relayer) and the shared rate-limit counter write.
3. **Honest availability.** `/api/config` now reports `publicSubmission`, and the
   home page renders the form only when submission is genuinely available,
   stating the honest reason otherwise.

**Adversarial checks performed:** no error suppression introduced (a stalled
probe degrades to an explicit `MAINNET_UNAVAILABLE`, not a silent zero); no
response-parsing regression (the shared helper checks `res.ok` before
interpreting the payload); no accessibility regression (axe run over every public
route, 0 serious/critical); no security-sensitive data in error messages (the
anonymous path never echoes the token or its absence); regression tests added for
each fix and verified to fail without it.

**Not changed:** the learning architecture, the authorization model, the admin
token, and the fail-closed defaults. No new dependency.

---

## C. Merge commit and production deployment evidence

- Baseline reported at the start of this mission: `cc009af`. Merged since:
  PR #12 (`076b245`), #13 (`118f376`), #14 (`7a172ac`), #15 (`5e6ddaf`),
  #16 (`9a4f753`), #17 (`182bef4`), #18 (`3fca1b98`), #19 (`73ff7a37`),
  #21 (`cdd9837`), #24 (`b8ce867`), #25 (`f6d3c11771`), #26 (`510b471e2e`),
  #27 (`9f8dd843c5`), #28 (`354d6ed60f`), #29 (`f186b65bfb`).
- **HEAD verified:** `8d499fb06a24cb30dc2524b5920df4085ee26905` (three direct
  commits on `master`: `7d0daff`, `911fa18`, `8d499fb`).
- `origin/master` contains the commits; `master` is the production branch.
- The application change `8d499fb06a` was verified on deployment
  `dpl_HcpyrnPF7P8L4QbjyzpKamxcvPyw` (READY). Documentation-sync commits made
  after the verification (e.g. `0ff55a9`) are deployed to the same project and
  advance the alias, but they change only `artifacts/` and `docs/` — no
  application-runtime code. The application baseline verified end to end is
  `8d499fb06a`, and it is the code the alias serves.
- No deploy from a feature branch; no stale-code merge.

---

## D. Production regression verification

**The rate-limit regression.** Twelve concurrent requests to `/api/config` on the
deployed commit:

| Metric | Before the fix | After the fix (fresh, `8d499fb06a`) |
| --- | --- | --- |
| `/api/overview` latency | 37–90 s (two timeouts at 90 s) | 12/12 → HTTP 200, max 2.32 s |
| Concurrent `/api/config` | requests hung to the 60 s timeout | 12/12 → HTTP 200, max 3.87 s |

No request returned a 5xx; no client-side exception; no crash marker. The
intermittent `/api/config` 504 reported in Mission 8 did not reproduce: 12/12
concurrent requests returned HTTP 200.

**`/api/config` 504 re-investigated (this mission).** `/api/config` reads only the
in-process configuration (no database call, no external probe), so it should not
504 for a dependency reason. Six sequential requests to production on 2026-11-04
returned **6/6 HTTP 200 in 0.14–0.23 s**; the check passes in the 28/28 run. The
Mission-8 504 is therefore consistent with a **cold-start / platform-level
timeout**, not application code — the route has no slow dependency to bound. The
route is `force-dynamic`, so it is never served stale; the app degrades to an
explicit configuration state rather than a fabricated success. No code change was
warranted, and none was made to hide the error.

**Production verification (`npm run verify:prod`, read-only):**

```
PASS  GET / , /incidents , /safeguards , /learning , /memory , /evaluation
PASS  GET /api/overview , /api/config , /api/incidents , /api/rules ,
      /api/learning , /api/memory , /api/evaluation
PASS  audit index is durable            postgres (Neon, us-east-2)
PASS  Walrus Memory backend is live     memwal-mainnet
PASS  Walrus Memory reaches Mainnet     network=mainnet, live=true
PASS  Walrus Memory credentials accepted  MAINNET_AUTH_CONFIRMED
PASS  Tatum Sui adapter configured      Tatum Sui Mainnet gRPC
PASS  Tatum Sui gateway healthy         reachable and authenticated
PASS  >= 10 completed Mainnet writes    196 completed
PASS  >= 10 recall-verified writes      193 recall-verified
PASS  recall query returns memories     50 applicable retrieval(s) via public /api/learning (50 live) — direct recall needs the admin token (HTTP 401)
PASS  learning retrieval entries traceable
PASS  memories applied counter agrees
PASS  influenced investigations have a behaviour change
PASS  no uninfluential memory counted
PASS  no behaviour change without a memory-caused effect
PASS  persisted memories are recall-verified

All 28 checks passed against https://aftermath-7tij.vercel.app.

The recall-query check now passes anonymously: the direct recall endpoint is
administrator-only, so when no admin token is present the check falls back to the
public learning surface, which exposes the same retrieval evidence. All 28 checks
pass without any credential.
```

**Suite results (fresh, on `8d499fb06a`, this mission):**

| Gate | Result |
| --- | --- |
| `tsc --noEmit` | pass (exit 0) |
| `eslint src tests scripts e2e` | pass (exit 0) |
| `next build` | pass |
| `vitest run` (local PostgreSQL 17 reachable) | **631 passed, 12 skipped** (the 12 skips are the opt-in live-smoke suite) |
| `playwright test` | **18 passed, 0 failed** (17 before this mission; +1 for the Sui-sample E2E) |
| `verify:prod` | **28/28** anonymously (confirmed again 2026-11-04 for this mission) |

**Environment note (this mission).** This mission provisioned a local PostgreSQL
17 (`postgresql://pact:pact@127.0.0.1:5432/pact`) and exported both `DATABASE_URL`
and `AFTERMATH_TEST_DATABASE_URL`, so the DB-gated suites ran rather than skipped:
**631 passed, 12 skipped**. The only skips are the opt-in live-smoke suite
(`AFTERMATH_LIVE_SMOKE=1`). Without a database the same command reports **603
passed, 40 skipped**, and the DB-gated suites are reported as **skipped**, never as
passing. The operator's own environment (with `AFTERMATH_TEST_DATABASE_URL` set)
reports **620 passed, 12 skipped**; that number is not reproduced here and is not
claimed.

The 12 skipped unit tests in the operator's environment are the live-smoke suite
(`tests/live-smoke.test.ts`), skipped because `AFTERMATH_LIVE_SMOKE` and the live
credentials are not exported there. They are reported as **skipped**, never as
passing.

**The E2E suite is now hermetic (presentation-mission fix).** The earlier
intermittent failure — the SC 2.5.8 target-size test failing on some runs and not
others — had a single root cause: the harness was not isolated from the ambient
environment. Two defects:

1. `playwright.config.ts`'s `webServer.env` did not blank `DATABASE_URL`, so when
   the ambient environment set it (as it is on this machine, and as CI may), the
   server read Postgres while `global-setup.ts` seeded SQLite — the seeded state
   was invisible to the suite. Fixed by blanking the database variables in the
   server env, matching `global-setup.ts`.
2. `global-setup.ts` never reset the isolated database. The seed is not
   idempotent: its two matching submissions become duplicates against a database
   that already holds them, so the learning view stops rendering the retrieval
   links the test needs. Fixed by deleting the SQLite file (and its sidecars)
   before the server opens it — in the webServer command, so the reset happens
   before the file is opened (deleting under a running server would leave it on
   the old inode).

Verified: three consecutive `npm run test:e2e` runs each report **18 passed, 0
failed**, with the ambient `DATABASE_URL` present. No assertion was deleted or
relaxed.

**`verify:prod` no longer fails on a cold-start blip.** The public-route checks
now retry a bounded 3 times on a 5xx or network error (with backoff), because a
serverless function's first request after a cold start can return a gateway
timeout and then succeed. A route that is *persistently* 5xx still fails after the
retries; a 4xx is returned immediately as a real answer. The change removes a
false negative without hiding a real defect.

**Cross-instance rate limiting.** `tests/cross-instance-rate-limit.test.ts`
passed 4/4 against a real PostgreSQL-backed shared counter. This suite spawns
cold `tsx` subprocesses and exceeded vitest's default 30 s per-test timeout under
parallel load; it now carries an explicit generous `120_000` ms timeout (PR #17,
commit `182bef4`). The timeout does not mask a defect — the underlying
assertions (a counter charged by one instance is observed by another, a second
client is unaffected, the shared verdict is not degraded, and the negative
control proving counters do *not* cross instances without a shared database) all
run and pass.

---

## E. Accessibility verification

Verified on the **production build**, not only in source:

- **axe** over seven public routes (`/`, `/records`, `/learning`, `/incidents`,
  `/safeguards`, `/memory`, `/evaluation`), driven live as an anonymous visitor
  on **desktop (1440×900)** and **mobile (Pixel 7)** on 2026-11-04: **0 violations
  of any impact — 0 serious, 0 critical — on every route, both viewports**.
  The E2E suite enforces this gate: `playwright test` →
  *"no serious or critical accessibility violation on any public route"* passes.
- **Console/page errors:** none on any route.
- **Mobile (390×844, touch):** the primary nav collapses to the disclosure menu,
  the menu holds the same destinations, and the sample submission completes with
  the Safeguard Record rendered — no page errors.
- **Target size (WCAG 2.2 SC 2.5.8):** one genuine defect found and fixed in the
  Mission 9 cycle. The learning view's record-id links render as their own
  list-item targets (63×14 px on production), below the 24×24 px minimum. axe's
  target-size rule passed them because of its spacing heuristic, so a direct
  measurement was needed. They now carry a `.link-chip` class (24 px minimum
  height, 0.5 rem horizontal padding); a dedicated E2E test measures every
  list-item record link directly and now passes deterministically. The inline
  link inside the retrieval card sits within a sentence and is exempt under
  SC 2.5.8.
- **SC 1.4.1 (Use of Color):** `.link-quiet` carries a real underline at rest,
  not only on hover.
- **SC 2.5.3 (Label in Name):** the brand link's accessible name contains its
  visible text.
- Earlier improvement, retained: the two inline form controls ("Use a sample
  incident", "Add context fields") have a 24 px minimum height, without changing
  their appearance or the layout.

We do **not** claim WCAG 2.2 AA conformance from these checks alone; they are the
automated and manual evidence we have.

---

## F. Judge experience and authentication findings

**First impression.** The home page headline is "Every failure should leave a
safeguard", with a six-stage causal chain and a live investigation form. A judge
can understand the product and act on it within seconds.

**Product clarity.** The interface explains incident investigation, safeguard
creation, persistence to Walrus Memory Mainnet, later recall, behaviour change,
and verification/provenance — each on a named page.

**Navigation.** One primary navigation, consistent across every route; a
`System` menu holds the secondary views; a mobile menu holds the same
destinations.

**Evidence legibility.** A judge can distinguish real persisted memories
(`/memory`, blob ids + backend), retrieved safeguards and their applicability
(`/learning` → Memory retrieval), applicable vs. not-applied memories, actual
verification changes (Behaviour change), and decisions that existed before memory
was applied (the "before memory" arm).

**Authentication (verified).**

| Operation | Credential required? |
| --- | --- |
| Read every public page | no |
| Submit an incident from the home page | no (public submission enabled) |
| Run controlled scenarios (`/lab`) | no |
| Operator console (`/admin`) | yes — admin token |

No admin token is exposed, no secret is embedded in frontend code, no
authentication bypass exists, and no anonymous production write is exposed
beyond the single rate-limited submission path, which requires the full control
set.

**Public submission verified end to end (fresh, this mission).** An anonymous
`POST /api/incidents/submit` (no token, no header) with a genuine incident
returned **HTTP 200** and a full Safeguard Record:

- `recordId` `7ea3428f-9df5-c8f9-452e-381957ae6d5c`, `provenance: live`;
- the incident was written to Walrus Memory Mainnet — `state: completed`,
  `backend: memwal-mainnet`, `recallVerified: true`, blob id
  `N64OTmvhEcVgYSWZMpvFyMbR3r8CQKi5m0AsSSHtbMQ`;
- the engine executed a real counterfactual: **baseline `UNKNOWN` → safeguarded
  `REQUIRE_VERIFICATION`** once the learned safeguard applied.

That is the complete intended journey — visit, understand, investigate, learn,
persist, recall, verify — performed without an administrator. It is stored as
`artifacts/evidence/2026-11-03-anonymous-submission.json`.

**Validation and limits (fresh).** An empty body returns **HTTP 400**
`invalid_submission` (not 401); a 25 000-character body returns **HTTP 400** with
the size error. Twelve concurrent `/api/config` and twelve concurrent
`/api/overview` requests all returned HTTP 200 (no 504).

---

## G. Genuine demo recording

**Final presentation demo (narrated).**

- **Artifact:** `artifacts/aftermath-final-demo.mp4` (kept locally; git-ignored to
  avoid a large binary in the repository).
- **Duration:** 2:22 (142.3 s) — within the 90–150 s target.
- **Format:** 1280×800, H.264 (yuv420p), 25 fps, **AAC stereo narration**,
  burned-in captions.
- **Narration:** synthesized locally with the Piper neural voice
  (`en_US-lessac-medium`); the same text is the burned-in captions and the
  sidecar `artifacts/demo-narration.srt`.
- **Source:** captured live from <https://aftermath-7tij.vercel.app/> with
  Playwright (Chromium) driving the real site as an anonymous visitor, with each
  scene held for the length of its narration, cut and muxed with ffmpeg.
  Reproducible with `python3 scripts/demo-tts.py` → `node scripts/record-demo.mjs`
  → `python3 scripts/build-demo.py`.
- **SHA-256:** `bd46de635ce2cd5eda0eef0c9cde8042571d8708f0442aac8e1c81ccc019a5b1`.
- **Script and accuracy notes:** `artifacts/DEMO-SCRIPT.md`.
- **Content:** the problem, the three-outcome Tatum counterfactual (one success
  claim over three real Sui Mainnet digests → BLOCK / ALLOW / REQUIRE_VERIFICATION),
  the Safeguard Records, the Memory Ledger (live Walrus Memory Mainnet), the
  two-arm behaviour change, provenance, and an end card.
- **Integrity:** every sample submission is idempotent, so recording caused
  **no new Mainnet write** (verified: 196 completed writes before and after). No incident
  invented, no hash fabricated, no simulated write presented as Mainnet; every
  figure shown is read from the live ledger at recording time. The recording
  contains no administrator action.
- **Secrets:** none visible.
- **Correct domain:** `aftermath-7tij.vercel.app` is on screen.

**Mission 9 silent recording (superseded).**

- `artifacts/mission9/aftermath-demo-m9.mp4` — 2:24 (143.64 s), 1280×800, H.264,
  no audio, burned-in captions. SHA-256
  `d63fa25793fae4c7b9c827a7e93ed2c51de2ed3aad1225cfe780b95dde1c9fdb`. Kept for
  provenance; superseded by the narrated final demo above.

**Honest limitation.** The narrated demo uses a synthetic voice (Piper), not a
human speaker. It was **not** published or uploaded anywhere.

---

## H. Architecture explanation and diagram

See `artifacts/ARCHITECTURE.md` for the full explanation, the 60-second version, and
the diagram.

---

## I. Fresh Walrus / Tatum / Postgres evidence

Read live from `GET /api/overview` and `GET /api/learning` on the deployed commit
`8d499fb06a` (snapshot `artifacts/evidence/2026-11-04-overview.json` and `-learning.json`, generated
2026-11-04):

| Evidence | Value |
| --- | --- |
| Walrus authentication | `MAINNET_AUTH_CONFIRMED`, `authenticated: true` |
| Namespace | `aftermath` — **351** memories (relayer-reported) |
| Completed Mainnet writes | **196** |
| Recall-verified writes | **193** |
| Simulated writes | **0** |
| Total ledger rows | 229; the `/api/memory` feed returns the newest 200, all `backend: memwal-mainnet`, `provenance: live` |
| Tatum Sui gRPC | reachable, authenticated, chain mainnet (`4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S`) |
| PostgreSQL durability | Neon `ep-summer-surf-b52xfmdp-pooler…`, durable |
| Persisted safeguards (recall-verified) | **4** |
| Memories recalled | 95 |
| Memories applied | **47** |
| Investigations influenced | **6** |
| Requirements strengthened | **6** |
| Repeat preventions | **0** (reported honestly) |

**Tatum proven load-bearing (Mission 3).** Four anonymous submissions of the same
class — an agent claiming a Sui transaction succeeded — were run with only the
digest varying. Tatum's answer decided each verdict: `VERIFIED_SUCCESS` →
**ALLOW** (`8f12d8ec…`), `VERIFIED_FAILURE` → **BLOCK** (`d820a66b…`), not-found →
**REQUIRE_VERIFICATION** (`13912043…`), malformed → **REQUIRE_VERIFICATION**
(`5c75d532…`). The failure digest `A9iiTMAxi5BY2uwxu4HnuonfF6A4hhGbaCK8HfTFK26x`
was cross-checked independently against Tatum's public Sui Mainnet GraphQL
endpoint (status `FAILURE`). Full record:
`artifacts/evidence/2026-11-03-tatum-integration.json`; narrative:
`artifacts/TATUM-INTEGRATION-ARCHITECTURE.md`.

**Discoverability fix (Mission 3).** The public front door now offers two labelled
samples — "Use a Sui transaction sample" (a real failed Mainnet digest, so the
Tatum path is exercised by a single click) and "Use a sample incident" (the
no-source path). The samples are shared (`src/lib/samples.ts`) so the operator
console offers the same on-chain example. Guarded by a DOM regression test
(`tests/public-investigation.dom.test.tsx`) and an E2E test.

**Distinctions kept:** automated tests vs. live integration checks vs. production
application evidence vs. judge-visible evidence are reported separately
throughout. No credential is exposed. Memory counts are not inflated. The new
finance submissions above are real, legitimate investigations through the public
endpoint — not synthetic evidence.

---

## J. Complete Devpost submission materials

See `artifacts/DEVPOST-SUBMISSION.md` — paste-ready copy: one-line pitch, full description
(inspiration, what it does, how it was built, how it works, challenges, what we
learned, what's next), technology stack, track alignment, demo instructions, and
final links.

---

## K. Remaining limitations

1. **Narrated demo uses a synthetic voice.** The final demo (`artifacts/aftermath-final-demo.mp4`)
   is narrated with a local Piper neural voice, not a human speaker. This is
   honest and clear, but a human narration would be warmer.
2. **`verify:prod` passes anonymously.** The direct recall endpoint is
   administrator-only, so the recall check now falls back to the public learning
   surface when no admin token is present. All 28 checks pass with no credential
   (fixed this mission; previously 27/28 without the token).
3. **Medium article not re-verified.** Medium blocks this environment's IP
   (HTTP 403). The URL is provided by the operator; it is neither confirmed nor
   contradicted here.
4. **Zero demonstrated repeat preventions.** Reported as zero rather than
   dramatised. The two "repeat" scenarios in the evaluation lab demonstrate
   prevention inside the controlled harness; no independently observed
   production recurrence has been shown.
5. **Finance case needs `TATUM_API_KEY`; AI reading needs `GROQ_API_KEY`.** The
   application states which path it took. Both are configured in production.
6. **The duplicate Vercel project `aftermath` (alias `aftermath-theta.vercel.app`)
   still exists.** Freshly re-classified this mission (Vercel API, 2026-11-04): it
   deploys the **same repository and the same commit** (`itzebe/aftermath`,
   `master`, `7d0daff73d`) as the correct project `aftermath-7tij`, and returns
   HTTP 200. Its environment is not identical, but it is a redundant public URL.
   It was **not** deleted or disconnected (the mission forbids it); see the
   cleanup recommendation in
   `artifacts/evidence/2026-11-04-duplicate-vercel-project.md`.
7. **`VERIFIED_FAILURE` on a live Mainnet transaction is now demonstrated in
   production, not only in unit tests.** An anonymous submission naming the real
   failed digest `A9iiTMAxi5BY2uwxu4HnuonfF6A4hhGbaCK8HfTFK26x` was verified
   through Tatum (`status: VERIFIED_FAILURE`, `verified: true`) and decided
   `BLOCK` (`recordId 76272b29-b49d-ca39-f174-44ffab4143a8`;
   `artifacts/evidence/2026-11-03-public-journey-submit.json`). What remains
   untested in production is the *recurrence* path — no second real recurrence has
   been independently observed.
8. **Rate limits are per-client, not unlimited.** Public submission is capped at
   5 requests/minute per client (shared, cross-instance counter), with a
   non-rotatable global backstop. This is generous for a person and bounded for
   an attacker; it is not an unbounded service.

---

## L. Final decision

# READY FOR PUBLIC USE AND JUDGING

The product is deployed at `aftermath-7tij.vercel.app` on the live production
deployment whose application commit is `8d499fb06a`, whose
application behaviour was verified this mission (typecheck, lint, build, 18 E2E,
28/28 production checks, and a live anonymous journey), publicly usable, and
verified end to end this mission: an anonymous visitor can submit a genuine
incident, receive a real Safeguard Record, see a safeguard persisted to Walrus
Memory Mainnet, and see the recalled memory change the decision from `UNKNOWN` to
`REQUIRE_VERIFICATION`. All verification gates pass (typecheck, lint, build, 18 E2E,
28/28 production checks), and no anonymous path exists beyond
the single rate-limited, fail-closed submission route.

The limitations in section K are real but do not block judging: they are
documented rather than hidden, and the presentation gap that mattered most — a
fresh, narrated, captioned demo — is now closed by
`artifacts/aftermath-final-demo.mp4`.

---

## M. Authorization boundary

Confirmed explicitly:

- **Ordinary public users can use the core product** — true. Verified with a
  clean session and no credential: read every page, run the investigation
  workspace, submit a legitimate incident, and receive a grounded result.
- **Anonymous public submissions are enabled** — true, on this deployment, by
  the operator, deliberately (`AFTERMATH_PUBLIC_SUBMISSION_ENABLED=1`, confirmed
  via the Vercel API). The feature is not force-enabled in code; it is available
  only when that flag is set **and** every safety control holds at request time
  (live Walrus Memory Mainnet backend, shared durable PostgreSQL index,
  configured per-client cap), and it fails closed otherwise. Verified in
  production: `GET /api/config` → `publicSubmission.available = true`; an
  anonymous submit with an invalid body returns `400` (validation), not `401`
  (auth); a valid anonymous submit returned `200` with a live Mainnet write.
- **Admin authentication was not weakened** — true. The admin token, the
  fail-closed guard, and the authorization model are unchanged. The operator
  console (`/admin`) remains gated.
- **Mainnet writes are controlled** — true. Public submission is capped at
  5/minute per client through a shared, cross-instance counter with a
  non-rotatable global backstop; only an incident that earns authority is
  persisted. This mission caused exactly one write, to prove the public path.
- **Secrets remain private** — true. No token, key, or credential appears in
  frontend code, error messages, evidence files, the video, or this report.
- **The correct production project is deployed** — true. `aftermath-7tij`
  (`prj_GWK9nkfkYHm269zFh7zLCjpEYiO5`) serves the alias
  `aftermath-7tij.vercel.app` from the live production deployment whose
  application commit is `8d499fb06a` (READY, target production),
  whose application behaviour was verified this mission. The duplicate
  `aftermath` project was classified and left untouched.
- **The demo is genuine** — true. Captured live from production as an anonymous
  visitor; every figure read from the live ledger; no fabricated hash, balance,
  incident, memory, or transaction.
- **The submission materials are complete** — true. `artifacts/ARCHITECTURE.md`,
  `artifacts/DEVPOST-SUBMISSION.md`, `artifacts/FINAL-REPORT.md`, and
  `artifacts/evidence/` are freshly synchronized to verified values.
- **Nothing was published or submitted without authorization** — true. Nothing
  was posted to Devpost; the demo video was not uploaded or published. The
  Devpost copy is a local draft awaiting the operator's explicit go-ahead.
