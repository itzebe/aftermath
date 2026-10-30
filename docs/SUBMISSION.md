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
| 03 | At least 10 memories stored on Mainnet | ✅ | The live ledger reports **155 completed** and **154 recall-verified** Mainnet writes — see `GET /api/overview` (`completedLiveWrites`, `recallVerifiedWrites`). `mainnetRequirement` returns `{required: 10, completedLive: 155, recallVerified: 154, remaining: 0, satisfied: true}`. `simulatedWrites` is **0**; every write carries `backend: memwal-mainnet`, `provenance: live`. The relayer reports **310** memories in the `aftermath` namespace. Simulated writes are tracked separately and excluded. |
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

**Architecture.** A seven-stage pipeline. Incident intake (regex, never
execution; credential-shaped strings redacted) → evidence verification against a
connected authoritative source → rule-based failure diagnosis → corrective-rule
engine → Walrus Memory adapter → safeguard decision engine → learning
evaluation. Durable audit index in PostgreSQL; a resumable, bounded-batch runner
for the demonstration because the full run makes many real Mainnet writes and
cannot fit in one serverless request.

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
  `MAINNET_AUTH_CONFIRMED`); the live ledger reports **155 completed** Mainnet
  writes, of which **154** were confirmed by a recall query, with
  `simulatedWrites: 0`. The relayer reports **310** memories in the `aftermath`
  namespace. Completed and recall-verified counts are reported separately and
  never merged — the 155 writes are **not** all recall-verified.
- Tatum Sui gRPC gateway configured and healthy (authenticated, chain
  identifier matching Sui Mainnet). The finance case has verified **one** live
  Mainnet transaction as `VERIFIED_SUCCESS`; the `UNKNOWN` path is also present
  in production. `VERIFIED_FAILURE` is covered by unit tests only.
- On the controlled scenarios (figures from the last verified run; see
  [`BLOG.md`](BLOG.md)): **4/4** unsupported claims caught, **0** allowed to
  stand, **100%** repeat-prevention, **0%** false-block, **100%**
  memory-retrieval relevance. These describe the controlled scenarios, not
  production reliability.
- Checks: `typecheck` clean, `lint` clean, unit suite **345 passed / 21
  skipped**, `verify:prod` **20/20 passed**, live `verify:ai` **`ran=true`**.

**Demo URL:** <https://aftermath-7tij.vercel.app/>
**Repository:** <https://github.com/itzebe/aftermath>
**Blog:** <https://itzebe.github.io/aftermath/>
**Demo video:** <https://github.com/itzebe/aftermath/releases/tag/demo-v1>
(2:12, 1920×1080, captioned). Storyboard and script in [`DEMO.md`](DEMO.md).

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
| Genuine Mainnet writes completed | `GET /api/overview` → `counts.completedLiveWrites` | **155** |
| Writes confirmed retrievable by recall | `GET /api/overview` → `counts.recallVerifiedWrites` | **154** |
| Simulated writes (excluded) | `GET /api/overview` → `counts.simulatedWrites` | **0** |
| Requirement eval | `GET /api/overview` → `mainnetRequirement` | `{required: 10, completedLive: 155, recallVerified: 154, remaining: 0, satisfied: true}` |
| Namespace memories (relayer-reported, authoritative) | `GET /api/overview` → `memoryStatus.namespaceMemoryCount` | **310** |
| Backend is genuinely Mainnet | `GET /api/config` / `/api/overview` | `backend: memwal-mainnet`, `isLive: true`, `network: mainnet` |
| Every ledger row | `GET /api/memory` → `writes[]` | 188 rows, **all** `backend: memwal-mainnet`, `provenance: live` |
| Relayer auth | `GET /api/overview` → `memoryStatus` | `state: MAINNET_AUTH_CONFIRMED`, `authenticated: true` |

**Interpretation.** 155 completed writes and 154 recall-verified writes means the
instance has written at least **154 memories that a recall query returned**, more
than fifteen times the required ten. Because `simulatedWrites` is `0` and every
ledger row carries `backend: memwal-mainnet` with `provenance: live`, the count
is not inflated by fixtures: the simulated input worlds the scenarios use are
labelled `simulated`, and none of them is counted here. Completed and
recall-verified are reported **separately** and never merged, so a write that
completed but whose follow-up recall was rate-limited is not silently promoted —
**the 155 completed writes are not all recall-verified.**

The standalone check `npm run verify:prod` includes the memory checks and passes
**20/20**; `verify:ai` is read-only.

## Demo video

- Video: <https://github.com/itzebe/aftermath/releases/tag/demo-v1> — 2:12,
  1920×1080, H.264 + AAC, burned-in captions. Direct file:
  <https://github.com/itzebe/aftermath/releases/download/demo-v1/aftermath-hackathon-demo.mp4>.
- Captions (SRT): [`DEMO.srt`](DEMO.srt) (also attached to the release).
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
npm run verify:prod   # 20 checks against the deployed application
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
