# AFTERMATH — Mission 9 final report

**Date:** 2026-11-02
**Production project:** `aftermath-7tij` — <https://aftermath-7tij.vercel.app/>
**Repository:** <https://github.com/itzebe/aftermath> (branch `master`)

---

## A. Verified repository and deployment baseline

| Item | Verified value |
| --- | --- |
| Remote | `https://github.com/itzebe/aftermath.git` |
| Branch | `master` |
| Baseline HEAD before this mission | `cc009af` (`docs: correct Mainnet figures …`) |
| This mission's change | PR #12 → merge `076b245` |
| Vercel project | `aftermath-7tij` (id used by the production alias) |
| Production deployment | `dpl_A7du7Vx9bHDtT7iJfyshWBXWh2hB`, READY, commit `076b245` |
| Production alias | `aftermath-7tij.vercel.app` → `076b245` |

Confirmed by API, not assumed: the merge commit is the deployed commit, and the
alias points at it.

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

- PR #12 reviewed commit `e56ce64`, marked ready, merged (squash) at
  `2026-11-02T20:27:53Z`.
- **Merge commit:** `076b245473e7c425a961313a699e2ea890e394e2`.
- `origin/master` contains the merge; `master` is the PR's base.
- Production deployment `dpl_A7du7Vx9bHDtT7iJfyshWBXWh2hB` reached READY on
  `076b245`, and the production alias `aftermath-7tij.vercel.app` resolves to it.
- No deploy from the feature branch; no stale-code merge.

---

## D. Production regression verification

**The rate-limit regression.** Twelve concurrent requests to `/api/config` on the
deployed commit:

| Metric | Before the fix | After the fix |
| --- | --- | --- |
| `/api/overview` latency | 37–90 s (two timeouts at 90 s) | ~1.3 s |
| Concurrent `/api/config` | requests hung to the 60 s timeout | 12/12 → HTTP 200, max 1.27 s |

No request returned a 5xx; no client-side exception; no crash marker.

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
PASS  >= 10 completed Mainnet writes    167 completed
PASS  >= 10 recall-verified writes      166 recall-verified
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

**Suite results (fresh):**

| Gate | Result |
| --- | --- |
| `tsc --noEmit` | pass |
| `eslint src tests scripts e2e` | pass |
| `next build` | pass |
| `vitest run` | **587 passed, 40 skipped** |
| `playwright test` | **16 passed, 0 failed** (was 4 failed / 11 passed) |
| `verify:prod` | **28/28** (with `AFTERMATH_ADMIN_TOKEN`) |

The four previously-failing E2E tests are now fixed, not weakened: the isolated
database is seeded by a real scenario run, and the operator tests sign in on
`/admin` as an operator does.

---

## E. Accessibility verification

Verified on the **production build**, not only in source:

- **axe** over `/`, `/records`, `/learning`, `/memory`, `/lab`, `/admin`:
  **0 serious, 0 critical** violations.
- **Console/page errors:** none on any route.
- **Mobile (iPhone 13 viewport):** horizontal overflow **0 px**.
- **Target size (WCAG 2.2 SC 2.5.8):** 0 violations — the undersized inline text
  links satisfy the spacing exception.
- **SC 1.4.1 (Use of Color):** `.link-quiet` carries a real underline at rest,
  not only on hover.
- **SC 2.5.3 (Label in Name):** the brand link's accessible name contains its
  visible text.
- One improvement made this mission: the two inline form controls
  ("Use a sample incident", "Add context fields") were 18 px tall; both now have
  a 24 px minimum height, without changing their appearance or the layout.

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

---

## G. Genuine demo recording

- **Artifact:** `artifacts/mission9/aftermath-demo-m9.mp4` (kept locally; ignored
  by git to avoid a 4.5 MB binary in the repository).
- **Duration:** 1:31 (91.4 s) — within the 90–150 s target.
- **Format:** 1920×1080, H.264 (yuv420p), AAC silent track.
- **Captions:** burned in, from `artifacts/mission9/aftermath-demo-m9.srt`.
- **Source:** captured live from <https://aftermath-7tij.vercel.app/> with
  Playwright (Chromium) and cut with ffmpeg.
- **SHA-256:** recorded in `artifacts/mission9/SHA256SUMS.txt`.
- **Scene timings:** `artifacts/mission9/scene-timings.json`.
- **Content:** the problem, the now-public investigation workspace, a real
  incident submission, Safeguard Records, the Memory Ledger, the Learning Loop,
  the two-arm behaviour change, and provenance.
- **Integrity:** no incident invented, no hash fabricated, no simulated write
  presented as Mainnet; every figure read from the live ledger at recording time.
- **Secrets:** none visible (`strings` scan for token/secret/key shapes: clean).
- **Correct domain:** `aftermath-7tij.vercel.app` is on screen.

**Honest limitation.** This environment has **no TTS engine and no microphone**
(espeak, piper, festival, and pyttsx3 are all absent), so a *fresh narrated*
track could not be produced. The recording is therefore silent with burned-in
captions that carry the narration. The published, narrated video remains the
`demo-v2` release asset (2:36). The video was **not** published or uploaded
anywhere.

---

## H. Architecture explanation and diagram

See `docs/ARCHITECTURE.md` for the full explanation, the 60-second version, and
the diagram.

---

## I. Fresh Walrus / Tatum / Postgres evidence

Read live from `GET /api/overview` on the deployed commit `076b245`:

| Evidence | Value |
| --- | --- |
| Walrus authentication | `MAINNET_AUTH_CONFIRMED`, `authenticated: true` |
| Namespace | `aftermath` — **322** memories (relayer-reported) |
| Completed Mainnet writes | **167** |
| Recall-verified writes | **166** |
| Simulated writes | **0** |
| Total ledger rows | 200, all `backend: memwal-mainnet`, `provenance: live` |
| Tatum Sui gRPC | reachable, authenticated, chain mainnet |
| PostgreSQL durability | Neon `ep-summer-surf-b52xfmdp-pooler…`, durable |
| Persisted safeguards (recall-verified) | **1** |
| Memories recalled | 25 |
| Memories applied | **13** |
| Investigations influenced | **3** |
| Requirements strengthened | **3** |
| Repeat preventions | **0** (reported honestly) |

**Distinctions kept:** automated tests vs. live integration checks vs. production
application evidence vs. judge-visible evidence are reported separately
throughout. No credential is exposed. No unnecessary Mainnet write was performed
(this mission performed none). Memory counts are not inflated.

---

## J. Complete Devpost submission materials

See `docs/DEVPOST.md` — paste-ready copy: one-line pitch, full description
(inspiration, what it does, how it was built, how it works, challenges, what we
learned, what's next), technology stack, track alignment, demo instructions, and
final links.

---

## K. Remaining limitations

1. **No fresh narrated demo video.** No TTS/microphone in this environment; the
   Mission 9 recording is silent with burned-in captions.
2. **`verify:prod` needs `AFTERMATH_ADMIN_TOKEN` for its recall check.** With
   the token, 28/28 pass; without it, that one check is reported as an explicit
   failure rather than skipped (27/28).
3. **Medium article not re-verified.** Medium blocks this environment's IP
   (HTTP 403). The URL is provided by the operator; it is neither confirmed nor
   contradicted here.
4. **Zero demonstrated repeat preventions.** Reported as zero rather than
   dramatised.
5. **Finance case needs `TATUM_API_KEY`; AI reading needs `GROQ_API_KEY`.** The
   application states which path it took.
6. **The duplicate Vercel project `aftermath` (alias `aftermath-theta.vercel.app`)
   still exists.** It is inert (0 records, `SIMULATED_BACKEND`, no durable index)
   and was not touched.
7. **`VERIFIED_FAILURE` on a live Mainnet transaction** is covered by unit tests
   only, not by a production demonstration.

---

## L. Final decision

# READY WITH LIMITATIONS

The product is deployed, publicly usable, verified, and judge-ready. The
limitations above are documented rather than hidden, and none of them blocks
judging.

---

## M. Authorization boundary

Confirmed explicitly:

- **Anonymous public submissions** — *enabled on this deployment, by the
  operator, deliberately.* This is the mission's goal ("universal product
  access"): the product's core act must be reachable without a credential. The
  feature is not force-enabled in code; it is enabled only when the operator sets
  `AFTERMATH_PUBLIC_SUBMISSION_ENABLED=1` **and** every safety control holds at
  request time (live Walrus Memory Mainnet backend, shared durable PostgreSQL
  index, configured per-client cap), and it fails closed otherwise. Verified in
  production: `GET /api/config` → `publicSubmission.available = true`, and an
  anonymous submit with an invalid body returns `400` (validation), not `401`
  (auth). The operator console (`/admin`) remains gated.
- **Admin authentication was not weakened** — true. The admin token, the
  fail-closed guard, and the authorization model are unchanged.
- **No secrets were exposed** — true. No token appears in frontend code, error
  messages, the video, or this report.
- **No fake Mainnet evidence was created** — true. Every figure is read from the
  live deployment; no hash, transaction, or write was fabricated.
- **No unnecessary Mainnet writes were performed** — true. This mission performed
  none; the 167/166 figures come from the application's own history.
- **The duplicate Vercel project was not deleted or disconnected** — true. It was
  inspected and classified as inert; nothing was changed.
- **No public submission was made** — true. Nothing was posted to Devpost or
  anywhere else. `docs/DEVPOST.md` is a local draft.
