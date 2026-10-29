# Total Recall — submission package

AFTERMATH, prepared for **Total Recall** (Tatum × Walrus Memory), 20 Oct – 10 Nov
2026, 17:00 UTC.

> This document is the submission worksheet: the official requirements, the
> artifacts that satisfy each one, the submission-form fields, and the demo plan.
> The write-up itself is [`BLOG.md`](BLOG.md) (canonical) / the
> [published Medium article](https://medium.com/@jonathanebi05/aftermath-every-failure-should-leave-a-safeguard-25446fdbcd71)
> / the [GitHub Pages mirror](https://itzebe.github.io/aftermath/).

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
| 02 | Tatum RPC used for onchain data where relevant | ✅ | Read-only Sui adapter on the documented gRPC primary with a GraphQL fallback, server-side API key. Real Mainnet transactions (successful **and** unsuccessful) back the finance evidence cases. No transaction is ever broadcast. See [`src/lib/adapters/tatum-sui.ts`](../src/lib/adapters/tatum-sui.ts). |
| 03 | At least 10 memories stored on Mainnet | ✅ | The live ledger reports **87 completed** and **86 recall-verified** Mainnet writes — see `GET /api/overview` (`completedLiveWrites`, `recallVerifiedWrites`). Simulated writes are tracked separately and excluded. |
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
| Tatum dashboard account ID | *owner* |
| `MEMWAL_AGENT_ID` (Walrus Memory delegate public key) | *owner* |

## Demo plan (≈5 minutes)

1. **The front door — a claim is not evidence.** Submit a pasted failure:
   `HTTP 500` plus `Connection pool exhausted / max pool size: 50`. Read the
   Safeguard Record: observed facts with their verbatim spans, hypotheses,
   unknowns, and next checks, each labelled with how far it is verified. Point at
   the `Evidence: UNKNOWN` label — a paste is material, not proof.
2. **The AI reading is additive.** Show `aiAnalysis.ran` on the record. When
   `GROQ_API_KEY` is set, a grounded reading appears; every fact it keeps cites a
   span that appears verbatim in the submission. Without a key the record is the
   deterministic parse and says so. The model never sets the evidence status,
   diagnosis, decision, or verification.
3. **The learning loop.** Open the **Evaluation Lab** (`/lab`) → **Run from
   scratch**. The run advances in bounded batches because every scenario waits on
   a real Mainnet write. Watch a repeat scenario (`workflow-repeat-refused`)
   recall a lesson and be refused — that is the memory changing the decision.
4. **Honesty under pressure.** If a batch hits the shared relayer rate limit,
   show the deferral: the scenario returns to `pending`, the batch stops, the
   client waits `retry_after_seconds`, and the next batch resumes it — *no
   verdict recorded*. A transport problem is never a scenario failure.
5. **The ledger.** Open `/memory` and read the counts directly: completed vs
   recall-verified writes are separate columns; historical failed writes stay
   counted. The requirement is ten genuine Mainnet memories; the instance has
   far more, and says so from the ledger rather than asserting it.

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
