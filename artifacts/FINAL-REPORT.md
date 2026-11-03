# AFTERMATH — Mission 9 final report

**Date:** 2026-11-03
**Production project:** `aftermath-7tij` — <https://aftermath-7tij.vercel.app/>
**Repository:** <https://github.com/itzebe/aftermath> (branch `master`)

---

## A. Verified repository and deployment baseline

| Item | Verified value |
| --- | --- |
| Remote | `https://github.com/itzebe/aftermath.git` |
| Branch | `master` |
| Application commit verified end to end | `3fca1b9849cdc51fd15f0a4454d6d5ea53953283` |
| This mission's application change | PR #18 → merge `3fca1b98` (SC 2.5.8 target-size fix on `/learning`; artifact relocation and evidence sync) |
| Documentation follow-up | PR #19 → merge `73ff7a37` (pins this report; no application change) |
| Prior baseline reviewed | `182bef4c` (PR #17) |
| Vercel project | `aftermath-7tij` — `prj_GWK9nkfkYHm269zFh7zLCjpEYiO5` |
| Production deployment | READY; application code `3fca1b98` |
| Production alias | `aftermath-7tij.vercel.app` → the production deployment |

Confirmed by the Vercel API and by the deployed app, not assumed. Every figure
in this report was measured against the deployment built from the application
commit `3fca1b98`. A later docs-only merge (PR #19, `73ff7a37`) advances the
production deployment SHA without changing application behaviour, so this report
pins the application commit rather than the ever-moving deployment SHA. The fix
was first verified on the local production build by negative control, then
confirmed live: the `/learning` record links now measure 93×24 px on production
(they were 63×14 px).

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

- Baseline reported before this mission: `cc009af`. Merged since: PR #12
  (`076b245`), #13 (`118f376`), #14 (`7a172ac`), #15 (`5e6ddaf`), #16 (`9a4f753`),
  #17 (`182bef4`), #18 (`3fca1b98`).
- **HEAD verified:** `3fca1b9849cdc51fd15f0a4454d6d5ea53953283` (PR #18).
- `origin/master` contains the merge; `master` is the PR's base.
- Production deployment `aftermath-7tij-oj062s7j7` reached READY on
  `3fca1b98`, and the production alias `aftermath-7tij.vercel.app` resolves to it
  (confirmed by the Vercel API: newest production deployment carries commit
  `3fca1b98`).
- No deploy from a feature branch; no stale-code merge.

---

## D. Production regression verification

**The rate-limit regression.** Twelve concurrent requests to `/api/config` on the
deployed commit:

| Metric | Before the fix | After the fix (fresh, `3fca1b98`) |
| --- | --- | --- |
| `/api/overview` latency | 37–90 s (two timeouts at 90 s) | 12/12 → HTTP 200, max 2.32 s |
| Concurrent `/api/config` | requests hung to the 60 s timeout | 12/12 → HTTP 200, max 3.87 s |

No request returned a 5xx; no client-side exception; no crash marker. The
intermittent `/api/config` 504 reported in Mission 8 did not reproduce: 12/12
concurrent requests returned HTTP 200.

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
PASS  >= 10 completed Mainnet writes    180 completed
PASS  >= 10 recall-verified writes      177 recall-verified
PASS  recall query returns memories     5 result(s) from memwal-mainnet (live=true)
PASS  learning retrieval entries traceable
PASS  memories applied counter agrees
PASS  influenced investigations have a behaviour change
PASS  no uninfluential memory counted
PASS  no behaviour change without a memory-caused effect
PASS  persisted memories are recall-verified

All 28 checks passed against https://aftermath-7tij.vercel.app.

The recall-query check is administrator-only. It passes when
AFTERMATH_ADMIN_TOKEN is set (as it was for this run). Without the token the
check is reported as an explicit failure, never silently skipped — a read-only
run without the token scores 27/28.
```

**Suite results (fresh, on `3fca1b98`; re-run for the presentation mission):**

| Gate | Result |
| --- | --- |
| `tsc --noEmit` | pass (exit 0) |
| `eslint src tests scripts e2e` | pass (exit 0) |
| `next build` | pass |
| `vitest run` (with `AFTERMATH_TEST_DATABASE_URL`) | **620 passed, 12 skipped** |
| `playwright test` | **17 passed, 0 failed** (deterministic over 3 consecutive runs) |
| `verify:prod` | **28/28** (with `AFTERMATH_ADMIN_TOKEN`) |

The 12 skipped unit tests are the live-smoke suite (`tests/live-smoke.test.ts`),
skipped because `AFTERMATH_LIVE_SMOKE` and the live credentials are not exported
in this environment. They are reported as **skipped**, never as passing.

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

Verified: three consecutive `npm run test:e2e` runs each report **17 passed, 0
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

- **axe** over all eight public routes (`/`, `/records`, `/learning`, `/lab`,
  `/incidents`, `/safeguards`, `/memory`, `/evaluation`), driven live as an
  anonymous visitor (2026-11-03): **0 serious, 0 critical, 0 any-impact
  violations** on every route. Report: `artifacts/evidence/public-experience-audit.json`.
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
  avoid an 8 MB binary in the repository).
- **Duration:** 2:01 (121.4 s) — within the 90–150 s target.
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
- **SHA-256:** `06edb0695dd130106e9fad3cb5c317d8c7b44525856dcdcd20ddefd1404dca03`.
- **Script and accuracy notes:** `artifacts/DEMO-SCRIPT.md`.
- **Content:** the problem, the public investigation workspace, a real anonymous
  sample submission, the Safeguard Record, the Memory Ledger (live Walrus Memory
  Mainnet), the two-arm behaviour change, provenance, and an end card.
- **Integrity:** the sample submission is idempotent (returns the existing record
  `3d8a0234…`), so recording caused **no new Mainnet write**. No incident
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

Read live from `GET /api/overview` on the deployed commit `3fca1b98` (snapshot
`artifacts/evidence/2026-11-03-overview.json`, generated 2026-11-03):

| Evidence | Value |
| --- | --- |
| Walrus authentication | `MAINNET_AUTH_CONFIRMED`, `authenticated: true` |
| Namespace | `aftermath` — **335** memories (relayer-reported) |
| Completed Mainnet writes | **180** |
| Recall-verified writes | **177** |
| Simulated writes | **0** |
| Total ledger rows | 213; the `/api/memory` feed returns the newest 200, all `backend: memwal-mainnet`, `provenance: live` |
| Tatum Sui gRPC | reachable, authenticated, chain mainnet (`4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S`) |
| PostgreSQL durability | Neon `ep-summer-surf-b52xfmdp-pooler…`, durable |
| Persisted safeguards (recall-verified) | **3** |
| Memories recalled | 55 |
| Memories applied | **31** |
| Investigations influenced | **3** |
| Requirements strengthened | **3** |
| Repeat preventions | **0** (reported honestly) |

**Distinctions kept:** automated tests vs. live integration checks vs. production
application evidence vs. judge-visible evidence are reported separately
throughout. No credential is exposed. The one Mainnet write this mission caused
is the single anonymous submission used to prove the public path works end to
end; nothing else was written. Memory counts are not inflated.

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
2. **`verify:prod` needs `AFTERMATH_ADMIN_TOKEN` for its recall check.** With
   the token, 28/28 pass; without it, that one check is reported as an explicit
   failure rather than skipped (27/28). The token is set in production.
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
   still exists.** Freshly re-classified: it deploys the same repository
   (`itzebe/aftermath`, `master`) but runs the **simulated** backend
   (`SIMULATED_BACKEND`, no `MEMWAL_PRIVATE_KEY`), a per-instance SQLite index,
   and has public submission **disabled** — 0 records, 0 writes. It is not a
   security risk and holds no unique data, but it is a public URL that presents
   simulated output as if it were the product. It was **not** deleted or
   disconnected (the mission forbids it); see the cleanup recommendation in
   `artifacts/evidence/2026-11-03-duplicate-vercel-project.md`.
7. **`VERIFIED_FAILURE` on a live Mainnet transaction** is covered by unit tests
   only, not by a production demonstration.
8. **Rate limits are per-client, not unlimited.** Public submission is capped at
   5 requests/minute per client (shared, cross-instance counter), with a
   non-rotatable global backstop. This is generous for a person and bounded for
   an attacker; it is not an unbounded service.

---

## L. Final decision

# READY FOR PUBLIC USE AND JUDGING

The product is deployed at `aftermath-7tij.vercel.app` on the verified commit
`3fca1b98`, publicly usable, and verified end to end this mission: an anonymous
visitor can submit a genuine incident, receive a real Safeguard Record, see a
safeguard persisted to Walrus Memory Mainnet, and see the recalled memory change
the decision from `UNKNOWN` to `REQUIRE_VERIFICATION`. All verification gates
pass (typecheck, lint, build, 620 unit tests, 17 E2E, 28/28 production checks),
and no anonymous path exists beyond the single rate-limited, fail-closed
submission route.

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
  `aftermath-7tij.vercel.app` from commit `3fca1b98`. The duplicate `aftermath`
  project was classified and left untouched.
- **The demo is genuine** — true. Captured live from production as an anonymous
  visitor; every figure read from the live ledger; no fabricated hash, balance,
  incident, memory, or transaction.
- **The submission materials are complete** — true. `artifacts/ARCHITECTURE.md`,
  `artifacts/DEVPOST-SUBMISSION.md`, `artifacts/FINAL-REPORT.md`, and
  `artifacts/evidence/` are freshly synchronized to verified values.
- **Nothing was published or submitted without authorization** — true. Nothing
  was posted to Devpost; the demo video was not uploaded or published. The
  Devpost copy is a local draft awaiting the operator's explicit go-ahead.
