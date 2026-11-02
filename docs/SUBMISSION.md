# Total Recall — submission package

AFTERMATH, prepared for **Total Recall** (Tatum × Walrus Memory), 20 Oct – 10 Nov
2026, 17:00 UTC.

> This document is the submission worksheet: the official requirements, the
> artifacts that satisfy each one, the submission-form fields, and the demo plan.
> The write-up itself is [`BLOG.md`](BLOG.md) (canonical) / the
> [published Medium article](https://medium.com/@jonathanebi05/aftermath-every-failure-should-leave-a-safeguard-25446fdbcd71)
> / the [GitHub Pages mirror](https://itzebe.github.io/aftermath/).
> The 2–3 minute demo storyboard is [`DEMO.md`](DEMO.md).

## Links

| Artifact | URL |
| --- | --- |
| Working demo (production) | <https://aftermath-7tij.vercel.app/> |
| Public repository | <https://github.com/itzebe/aftermath> |
| Blog (rendered) | <https://itzebe.github.io/aftermath/> |
| Blog (published) | <https://medium.com/@jonathanebi05/aftermath-every-failure-should-leave-a-safeguard-25446fdbcd71> |
| Blog (canonical source) | [`docs/BLOG.md`](BLOG.md) |

## Track

**02 — Smart Agents for Real Life.** AFTERMATH is an evidence-based
failure-prevention engine for AI agents: it turns a verified execution incident
into a scoped corrective rule, preserves the lesson through Walrus Memory, and
applies the safeguard to later actions — so an agent that failed once does not
fail the same way twice.

## Submission checklist (official)

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 01 | Walrus Memory integrated and writing on Mainnet | ✅ | Real SDK writes to `https://relayer.memory.walrus.xyz`, namespace `aftermath`. Each write is awaited to a blob id and confirmed by a recall query. See [`src/lib/adapters/memwal-memory.ts`](../src/lib/adapters/memwal-memory.ts) and the live counts on `/memory`. |
| 02 | Tatum RPC used for onchain data where relevant | ✅ | Read-only Sui verifier on Tatum's documented gRPC primary (`LedgerService/GetTransaction`) with a GraphQL fallback, server-side API key. It is the authoritative evidence source for the **finance** case: a Sui transaction digest in the submitted material is looked up and classified `VERIFIED_SUCCESS` / `VERIFIED_FAILURE` / `UNKNOWN`. Digests are discovered from the live ledger at runtime, never hardcoded. No transaction is ever broadcast. See [`src/lib/adapters/tatum-sui-grpc.ts`](../src/lib/adapters/tatum-sui-grpc.ts). |
| 03 | At least 10 memories stored on Mainnet | ✅ | The live ledger reports **167 completed** and **166 recall-verified** Mainnet writes — see `GET /api/overview` (`completedLiveWrites`, `recallVerifiedWrites`). `mainnetRequirement` returns `{required: 10, completedLive: 167, recallVerified: 166, remaining: 0, satisfied: true}`. `simulatedWrites` is **0**; every write carries `backend: memwal-mainnet`, `provenance: live`. The relayer reports **322** memories in the `aftermath` namespace. Simulated writes are tracked separately and excluded. |
| 04 | Published blog post (what it does, how it uses Tatum + Walrus, how it learned) | ✅ | [`BLOG.md`](BLOG.md), published on Medium and mirrored on GitHub Pages. Covers the pipeline, both integrations, the transient-failure/deferral fix, and measured results. |
| 05 | Working demo and public repo | ✅ | Demo: <https://aftermath-7tij.vercel.app/>. Repo: <https://github.com/itzebe/aftermath> (public). |
| 06 | Optional: build with Tatum AI Builder (ai.tatum.io) — $500 bonus | ⛔ Not pursued | AFTERMATH was built as an indie project. The dedicated AI-Builder award is out of scope; the app still uses Tatum RPC/Data APIs directly. |

## Judging criteria — how AFTERMATH answers each

- **Walrus and Tatum Integration (30%).** Walrus Memory is the persistence layer
  of the learning loop, not a bolt-on: a scenario writes an incident and a lesson
  under content-hash idempotency keys, and a later scenario *recalls* that lesson
  through the relayer and changes its decision because of it. Tatum Sui RPC/Data
  is the authoritative evidence source for the finance case, and the adapter
  degrades to `UNKNOWN` rather than guessing when the source is unavailable.
- **Technical Quality (30%).** Type-checked and lint-clean; a hermetic unit suite
  plus a live smoke suite that hits the real relayer and gateway; a durable
  PostgreSQL-backed audit index; a resumable bounded-batch runner for the
  ~16–18 real Mainnet writes; transport-failure classification that refuses to
  convert a rate limit into a verdict.
- **Creativity (20%).** The product's thesis — *a claim is not evidence, and
  every failure should leave a safeguard* — is applied to the software's own
  reliability: transient failures are deferred, not recorded as failures, and the
  UI keeps historical failures distinct from the latest successful run.
- **Presentation (20%).** A public demo, a public repo, a published article, and
  honest state labels at every link of the record.

## Submission draft (ready to paste)

**Title:** AFTERMATH — every failure should leave a safeguard

**One line:** An evidence-first failure-prevention engine that turns a verified
incident into a scoped safeguard, preserves the lesson on Walrus Memory Mainnet,
and applies that safeguard the next time the same failure pattern appears.

**Problem.** An agent saying "it worked" is a claim, not evidence. Systems log
failures and discard them, so the same failure recurs. And when a source cannot
be reached, ordinary software converts "unknown" into a false verdict.

**Solution.** AFTERMATH takes pasted failure material and returns a **Safeguard
Record** that connects incident → evidence → hypothesis → safeguard →
verification → memory, with an honest state label at every link. Facts are
grounded by verbatim span; uncertainty stays explicit; a safeguard is proposed,
then tested, and only ever called *validated* with proof.

The investigation workspace is **public**: a visitor can submit an incident from
the home page without a credential, because that is the product's core act. The
operator console stays separate and gated. Anonymous submission is enabled only
when every safety control holds at request time — a live Walrus Memory Mainnet
backend, a shared durable (PostgreSQL) audit index, and a configured per-client
cap — and fails closed otherwise. The deployment reports which decision it made
through `GET /api/config` (`publicSubmission`), and the home page renders the
form only when submission is genuinely available, stating the honest reason when
it is not.

**Architecture.** A seven-stage pipeline. Incident intake (regex, never
execution; credential-shaped strings redacted before storage and again on read)
→ evidence verification against a
connected authoritative source → rule-based failure diagnosis → corrective-rule
engine → Walrus Memory adapter → safeguard decision engine → learning
evaluation. Durable audit index in PostgreSQL; a resumable, bounded-batch runner
for the demonstration because the full run makes many real Mainnet writes and
cannot fit in one serverless request.

**Credential redaction — the actual boundary.** A submitted incident is
untrusted and often carries a token by accident, so it is redacted at two
boundaries: before it is persisted, and again before any record is served (so a
record written before the rule existed is still protected). The rule set is:

- *Recognisable formats* — provider API keys (`sk-`, `AIza`, `ghp_`,
  `github_pat_`, `AKIA`/`ASIA`, `xox*`, Tatum), JSON Web Tokens, HTTP
  `Basic`/`Bearer` credentials, PEM private-key blocks, connection strings, and
  bare 64-hex values (a 32-byte key is exactly that shape).
- *Labelled values* — anything after `password`/`secret`/`token`/`api_key` and
  friends, in both the assignment form (`password=x`) and the loose form
  (`password hunter2secret`, `the password is x`).
- *Unlabelled high-entropy tokens* — a long token mixing case and digits, or a
  short token that mixes a secret word with a digit, is marked
  `[possible-secret]` (the marker is deliberately honest: the match is a
  heuristic, not a certainty).

The redaction **preserves evidence**: a Sui transaction digest (base58, 43-44
chars), a hash or UUID the surrounding text labels as such, and ordinary slugs
are left intact, because destroying them would break the verification the
product depends on. A bare UUID or bare 64-hex value is ambiguous (it is also a
key shape), so it is conservatively redacted — a deliberate, documented
trade-off. Preserved values are not exempt from the *format* rules, however: an
identity, reference, or enum value (an `evidence` reference, a `kind`, a `ref`)
that *contains* a provider key, a JWT, a connection string, or a PEM block has
that credential stripped, because a submission's own digest is copied back out
of the raw material and a secret pasted beside it would otherwise ride along.
Only the ambiguous rules (bare hex, bare UUID, unlabelled high-entropy token)
are skipped for those keys, so a digest or hash keeps its shape. This is **not**
perfect detection and is not described as such: a short, low-entropy secret
pasted with no label and no distinguishing format is indistinguishable from
ordinary prose. The behaviour is pinned by `tests/redact.test.ts`.

**Walrus integration (specific).** The live adapter talks to the Mainnet relayer
`https://relayer.memory.walrus.xyz`, namespace `aftermath`. Each write is
submitted with a **content-hash idempotency key**, awaited to a **blob id**, and
counted as verified only when a **recall query returns the record**. Completed
and recall-verified writes are tracked separately from simulated ones, and the
namespace total is read from the relayer's own signed `listNamespaces` call.

**Tatum integration (specific).** A read-only Sui verifier on Tatum's documented
**gRPC** endpoint (`sui-mainnet-grpc.gateway.tatum.io`), using
`LedgerService/GetTransaction` for transaction verification, with a **GraphQL**
fallback (`sui-mainnet.gateway.tatum.io/graphql`), authenticated with a
server-side API key. It is the authoritative evidence source for the **finance**
case only — it reads genuine Mainnet transaction execution status and classifies
it as `VERIFIED_SUCCESS`, `VERIFIED_FAILURE`, or `UNKNOWN`. Transaction digests
are retrieved dynamically from the live ledger, never hardcoded. **No transaction
is ever broadcast and no wallet key is ever requested.** Transport, authentication,
and missing-data failures are always reported as `UNKNOWN` and are never
misrepresented as a transaction failure. **Verified in production:** one live
successful Mainnet transaction was verified this way; the failure branch
(`VERIFIED_FAILURE`) is covered by unit tests, not by a production demonstration.

**AI investigation and safeguards.** An optional, additive Groq reading
(`openai/gpt-oss-120b`, free tier) proposes, but cannot decide: every fact it
keeps must cite a span that appears verbatim in the submission or it is
discarded and counted as a rejected claim. The model never sets the evidence
status, diagnosis, decision, or verification. Whether a model actually ran is
reported per record (`aiAnalysis.ran`), never inferred. Transient transport
problems (rate limits, 5xx, timeouts) are classified and **deferred** — the
scenario returns to `pending` behind a wait gate and no verdict is recorded — so
a dependency being briefly unavailable is never mistaken for a verified failure.

**Verified evidence and metrics.** Read live from the production deployment
(`GET /api/overview`, `GET /api/memory`):

- Walrus Memory is **live** (`backend: memwal-mainnet`, `isLive: true`,
  `MAINNET_AUTH_CONFIRMED`); the live ledger reports **167 completed** Mainnet
  writes, of which **166** were confirmed by a recall query, with
  `simulatedWrites: 0`. The relayer reports **322** memories in the `aftermath`
  namespace. Completed and recall-verified counts are reported separately and
  never merged — the 167 writes are **not** all recall-verified.
- Tatum Sui gRPC gateway configured and healthy (authenticated, chain
  identifier matching Sui Mainnet). The finance case has verified **one** live
  Mainnet transaction as `VERIFIED_SUCCESS`; the `UNKNOWN` path is also present
  in production. `VERIFIED_FAILURE` is covered by unit tests only.
- On the controlled scenarios (figures from the last verified run; see
  [`BLOG.md`](BLOG.md)): **4/4** unsupported claims caught, **0** allowed to
  stand, **100%** repeat-prevention, **0%** false-block, **100%**
  memory-retrieval relevance. These describe the controlled scenarios, not
  production reliability.
- Checks: `typecheck` clean, `lint` clean, unit suite **587 passed / 40
  skipped**, `verify:prod` **27/28 read-only** (the recall-query check needs the operator token; it passes when run by the operator), live `verify:ai` **`ran=true`**.

**Demo URL:** <https://aftermath-7tij.vercel.app/>
**Repository:** <https://github.com/itzebe/aftermath>
**Blog:** <https://itzebe.github.io/aftermath/>
**Demo video:** <https://github.com/itzebe/aftermath/releases/tag/demo-v2>
(2:36, 1920×1080, narrated, captioned). A second, silent captioned recording of
the current public build is in
[`artifacts/mission9/aftermath-demo-m9.mp4`](../artifacts/mission9/aftermath-demo-m9.mp4)
(1:31). Storyboard and script in [`DEMO.md`](DEMO.md).

**Honest limitations.** The finance case needs a `TATUM_API_KEY`; without it,
`UNKNOWN`. The AI reading needs `GROQ_API_KEY`; without it, the deterministic
parse and it says so. The coding and workflow demonstrations are controlled
harnesses, not general-purpose platforms. The audit index is durable only with
`DATABASE_URL`. The evaluation metrics describe the controlled scenarios only.

## Submission-form fields

Fill these on the Tatum submission form. Values marked *owner* are known only to
the account owner and must not be guessed.

| Field | Value |
| --- | --- |
| Project name | AFTERMATH |
| Tagline | Every failure should leave a safeguard. |
| Track | Smart Agents for Real Life |
| Demo URL | <https://aftermath-7tij.vercel.app/> |
| Repository URL | <https://github.com/itzebe/aftermath> |
| Blog URL | <https://itzebe.github.io/aftermath/> (also on Medium) |
| Demo video URL | <https://github.com/itzebe/aftermath/releases/tag/demo-v1> (2:12) — direct file: <https://github.com/itzebe/aftermath/releases/download/demo-v1/aftermath-hackathon-demo.mp4> |
| Tatum dashboard account ID | *owner* |
| `MEMWAL_AGENT_ID` (Walrus Memory delegate public key) | *owner* |

## Confirmed vs. uncertain requirements

**Confirmed** (from the official page at
<https://tatum.io/hackathon/total-recall>, fetched during this build):

- Public source repository, working public demo, published blog post.
- Walrus Memory integrated and writing on Mainnet; **at least 10 memories on
  Mainnet**.
- Tatum RPC used for onchain data "where relevant".
- Optional Tatum AI Builder path with its own $500 award.
- Judging weights: Walrus/Tatum 30%, technical quality 30%, creativity 20%,
  presentation 20%.
- Deadline 10 Nov 2026, 17:00 UTC; three tracks; $4,500 pool; submissions
  solicited via a **Submit Project** form.

**Uncertain** (verify on the form / in the event Discord before relying on it):

- Whether a **demo video** is a hard requirement or merely encouraged. The
  public page lists "working demo" without a video; the submission form is
  behind a login and could not be inspected without submitting. A video is
  prepared regardless ([`DEMO.md`](DEMO.md)) as it strengthens the 20%
  presentation score.
- The exact **form fields** and whether `MEMWAL_AGENT_ID` is the delegate public
  key verbatim. The form is authenticated and was not filled in.
- Whether the wallet/account used must be shared as part of the submission.

## Mainnet memory requirement — verification

Requirement 03 (≥ 10 genuine memories on Walrus Memory Mainnet) is verified from
read-only production endpoints. No write was made to produce this evidence.
Figures verified **30 October 2026 (UTC)**.

| Check | Command / source | Result |
| --- | --- | --- |
| Genuine Mainnet writes completed | `GET /api/overview` → `counts.completedLiveWrites` | **167** |
| Writes confirmed retrievable by recall | `GET /api/overview` → `counts.recallVerifiedWrites` | **166** |
| Simulated writes (excluded) | `GET /api/overview` → `counts.simulatedWrites` | **0** |
| Requirement eval | `GET /api/overview` → `mainnetRequirement` | `{required: 10, completedLive: 167, recallVerified: 166, remaining: 0, satisfied: true}` |
| Namespace memories (relayer-reported, authoritative) | `GET /api/overview` → `memoryStatus.namespaceMemoryCount` | **322** |
| Backend is genuinely Mainnet | `GET /api/config` / `/api/overview` | `backend: memwal-mainnet`, `isLive: true`, `network: mainnet` |
| Every ledger row | `GET /api/memory` → `writes[]` | 200 rows, **all** `backend: memwal-mainnet`, `provenance: live` |
| Relayer auth | `GET /api/overview` → `memoryStatus` | `state: MAINNET_AUTH_CONFIRMED`, `authenticated: true` |

**Interpretation.** 167 completed writes and 166 recall-verified writes means the
instance has written at least **166 memories that a recall query returned**, more
than sixteen times the required ten. Because `simulatedWrites` is `0` and every
ledger row carries `backend: memwal-mainnet` with `provenance: live`, the count
is not inflated by fixtures: a fixture is a record whose submission carries an
explicit `TEST FIXTURE` marker, and those are counted separately and excluded
from every production figure. `provenance` is a different axis — whether a write
was really persisted — and a `simulated` provenance is a real investigation that
happened to run without credentials, counted and labelled rather than hidden.
Completed and
recall-verified are reported **separately** and never merged, so a write that
completed but whose follow-up recall was rate-limited is not silently promoted —
**the 167 completed writes are not all recall-verified.**

The standalone check `npm run verify:prod` includes the memory checks and passes
**27/28 read-only**; the recall-query check requires `AFTERMATH_ADMIN_TOKEN` and is reported as a failure with an explicit reason rather than silently skipped. `verify:ai` is read-only.

## Learning integrity — a failure in our own metrics, corrected

The learning loop makes a claim on `/learning`:

> Every figure is counted from durable records, never estimated. Test fixtures
> are excluded from production evidence and counted separately.

That claim was not true. The headline figures were computed over every record,
including labelled fixtures, so a single labelled probe submitted through the
public endpoint inflated the counters the page presents as production evidence:
`memoriesApplied` moved 2 → 5 and `investigationsInfluenced` moved 1 → 2. An
inflated learning claim is exactly the misleading memory the system exists to
prevent, so it was fixed rather than explained away.

Two corrections were required for the claim to hold:

1. The headline figures and their provenance now count production records only.
   Fixtures stay visible in the history, retrieval and behaviour views — each
   entry carries a `fixture` flag, rendered as a `TEST FIXTURE` pill — and are
   counted under `fixtures`, but they never move a production metric.
2. A fixture is now defined by the explicit `TEST FIXTURE` marker, not by
   `provenance: simulated`. Provenance is a separate honesty axis — whether a
   write was really persisted. Conflating the two would have zeroed the metrics
   for any credential-less deployment, hiding real investigations instead of
   labelling them.

Measured on the **same** production store, with the fixture still present:

| Figure | Before the fix | After the fix |
| --- | --- | --- |
| `memoriesApplied` | 5 (inflated) | **2** |
| `investigationsInfluenced` | 2 (inflated) | **1** |
| `fixtures.records` | 1 | 1 (still counted) |
| Fixture labelled in the UI | no | **yes** |

The production verifier (`npm run verify:prod`) had the same defect in reverse:
it compared the production-only counter against *all* applicable retrievals and
so reported a false FAIL (`memoriesApplied=2 vs 5 applicable retrieval(s)`). It
now filters fixtures before deriving its expectations, while the traceability and
provenance checks still run over every entry — so nothing becomes invisible. Both
corrections are pinned by tests, and the regression test was confirmed to fail
without the fix.

## Live end-to-end evidence: a memory changes a decision

Run against production with no operator token (the public self-service path):

1. **Learn.** An earlier investigation of an unsupported completion claim
   established that a success claim with no authoritative record cannot stand,
   and persisted a safeguard to Walrus Memory Mainnet
   (`blobId dVhv7FPhVWAkym3xA93WsbJOCKGbZiTkr7pVCRNxgMM`, namespace `aftermath`,
   recall-verified).
2. **Recall.** A fresh anonymous submission of the same failure pattern returned
   `recordId 98365402-f3cf-2ce7-5070-13fd3dc4f569`, recalled **5** memories,
   found the safeguard **applicable** (`relation: candidate_pattern_match`;
   *domain and failure pattern match the recalled lesson*), and attached it as
   `applicableMemoryIds: ["safeguard-incident-unsupported_completion_claim@v1"]`.
3. **Change behaviour.** The safeguard added **2 required verification checks**
   the engine would not otherwise require — replay through the decision engine,
   and capture the operation's own authoritative record — while the verdict
   remained `REQUIRE_VERIFICATION` rather than being upgraded to verified
   success. The change is recorded as `attributableToMemory: true` with the
   memory id and the honest limitation stated on the record.
4. **Verify.** `GET /api/learning` now reports
   `investigationsInfluenced: 2`, `verificationRequirementsStrengthened: 2`,
   `memoriesApplied: 6`, and `provenance.influenced` names the new record. The
   fixture is excluded from all of it.

The full cycle is readable at
<https://aftermath-7tij.vercel.app/learning> and
<https://aftermath-7tij.vercel.app/records/98365402-f3cf-2ce7-5070-13fd3dc4f569>.

## Demo video

**Two recordings exist.** Both were captured from the live production
deployment with Playwright and cut with ffmpeg; neither invents an incident, a
hash, or a Mainnet write.

- **Narrated, published:** <https://github.com/itzebe/aftermath/releases/tag/demo-v2>
  — 2:36, 1920×1080, H.264 + AAC, burned-in captions (the primary submission
  video). Direct file:
  <https://github.com/itzebe/aftermath/releases/download/demo-v2/aftermath-demo-v2.mp4>.
- **Fresh, silent, captioned (Mission 9):**
  [`artifacts/mission9/aftermath-demo-m9.mp4`](../artifacts/mission9/aftermath-demo-m9.mp4)
  — 1:31, 1920×1080, H.264, burned-in captions, no narration. It shows the
  **now-public** investigation workspace and the current live figures. Recording
  a fresh *narrated* track was not possible in this environment: no TTS engine
  (espeak, piper, festival) or microphone is available, so the voice track could
  not be produced. The captioned video is the honest alternative, and every
  on-screen figure in it is read from the live ledger.
- Captions (SRT): [`artifacts/mission9/aftermath-demo-m9.srt`](../artifacts/mission9/aftermath-demo-m9.srt),
  plus the narrated [`DEMO.srt`](DEMO.srt).
- Storyboard and script: [`DEMO.md`](DEMO.md).

## Demo plan (2–3 minutes)

The full timestamped storyboard, click paths, per-scene factual claims, recording
instructions, and the "what is genuinely demonstrable live" table are in
[`DEMO.md`](DEMO.md). In short, five scenes, each with a claim it supports:

1. **0:00–0:20 — The problem.** A claim is not evidence; every failure should
   leave a safeguard. *Claim:* AFTERMATH exists to stop the same failure recurring.
2. **0:20–0:55 — Submit an incident.** Paste the app's own sample on the
   **Investigate** page and run it. *Claim:* failure material becomes a structured
   record through a fixed, inspectable pipeline (parsed, never executed).
3. **0:55–2:00 — Grounded evidence, additive AI.** On the **Safeguard Record**:
   observed facts carry verbatim spans; **Evidence: UNKNOWN** because the sample
   names no authoritative source; `aiAnalysis.ran` shows whether a model actually
   ran. *Claim:* a claim is not upgraded into a verdict without evidence; the
   model cannot set the status, diagnosis, decision, or verification.
4. **2:00–2:30 — Walrus Memory.** **Memory Ledger** (`/memory`) shows completed
   vs recall-verified writes separately, beside the relayer's namespace count;
   a recall query returns real blobs. *Claim:* genuine Mainnet persistence,
   confirmed by recall.
5. **2:30–3:00 — The learning loop.** **Evaluation Lab** (`/lab`) → **Run from
   scratch**: `workflow-repeat-refused` recalls an earlier lesson and the repeat
   decision is `REQUIRE_VERIFICATION`, not `ALLOW`. *Claim:* memory changes a
   later decision. Close on the public repo and blog.

> Deferral under a relayer rate limit is **not** reproducible on demand; if it
> appears mid-run it is narrated honestly, and never staged.

## Pre-submission checks

```bash
npm run typecheck     # clean
npm run lint          # clean
npm test              # hermetic unit + integration suite
npm run verify:prod   # 28 checks against the deployed application
                      # (27 pass read-only; the recall-query check needs
                      #  AFTERMATH_ADMIN_TOKEN and is reported honestly)
AFTERMATH_AI_VERIFY_TOKEN=<token> npm run verify:ai   # read-only live AI check
```

## Honest state

Everything above is verifiable from the live application and the public repo.
Where a capability depends on a credential (`GROQ_API_KEY`, `TATUM_API_KEY`),
the application states which path it took rather than implying more. The
evaluation metrics describe the nine controlled scenarios, not production
reliability. The `aiAnalysis.ran` flag is the sole source of truth for whether a
model ran; nothing in the UI or this document upgrades a claim that the evidence
does not support.
