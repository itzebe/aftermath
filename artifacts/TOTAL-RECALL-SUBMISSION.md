# AFTERMATH — Total Recall submission

**Hackathon:** Total Recall — Tatum × Walrus Memory (Walrus Foundation × Tatum
Technology LLC).
**Track:** 02 — Smart Agents for Real Life.
**Project title:** AFTERMATH — Every Failure Should Leave a Safeguard.
**Prepared:** 2026-11-04. Every figure below was read live from the production
deployment on that date, or independently cross-checked against a public source;
each one names its source. Nothing here is a projection.

This is the polished submission copy. The exact per-field copy for the official
form is in [`TOTAL-RECALL-FORM-ANSWERS.md`](TOTAL-RECALL-FORM-ANSWERS.md); the
claim-to-evidence map is in
[`TOTAL-RECALL-EVIDENCE.md`](TOTAL-RECALL-EVIDENCE.md).

---

## One-line description

AFTERMATH turns a verified execution failure into a safeguard that persists on
Walrus Memory Mainnet and changes how the next investigation is decided — and it
proves that change instead of claiming it.

---

## The problem

An incident can be investigated correctly, documented carefully, and still happen
again, because the lesson never changes the next operational decision.

The concrete shape: an agent says "the charge completed successfully." That is a
*claim*, not evidence. Nothing checks it against an authoritative record, so
"unknown" quietly becomes "success". And even when the failure is found, the
lesson lives in a log or a ticket and disappears between investigations. The next
agent starts from zero and repeats the mistake. The failure is not that the agent
was wrong — it is that the system had no memory of being wrong before.

## The insight

An incident report is incomplete if its findings cannot influence future
verification. Recording a failure is the easy part; the hard part is making the
recording matter to the next decision.

## Inspiration

The pattern repeats across operations: a production incident is investigated,
written up, closed — and then happens again months later because the write-up
never touched the next decision. The same shape appears in AI agents: an agent
reports "done", the claim is accepted, and nothing checks it against an
authoritative record. AFTERMATH started from a single question — *what if the
lesson of a verified failure automatically strengthened how the next claim is
checked?* — and from the discipline that answer demands: memory may raise
suspicion, but only evidence may conclude.

## The solution

AFTERMATH connects authoritative transaction evidence from **Tatum** with
persistent incident memory through **Walrus Memory**. Pasted failure material —
a stack trace, a log excerpt, an incident report — becomes a **Safeguard Record**
that links:

> incident → evidence → hypothesis → safeguard → verification → memory

with an honest state label at every link. The investigation workspace is public:
anyone can submit an incident and get a genuine Safeguard Record without an
account, an invitation, or an administrator.

## What makes it different

1. **A claim is never a fact.** The engine separates four things agent systems
   usually blur: the observed event, the evidence, the diagnosis (a hypothesis),
   and the lesson (a proposal). Only evidence can establish an outcome.
2. **Memory informs; it never governs.** A recalled safeguard can *escalate* an
   UNKNOWN outcome to REQUIRE_VERIFICATION. It can never convert missing evidence
   into success. This is the line between a system that learns and one that
   hallucinates with more confidence over time.
3. **The contribution is proven, not asserted.** The decision engine runs twice
   over identical evidence with only the recalled memory varying, so the memory's
   own contribution is a real counterfactual — and the system reports the cases
   where the memory changed *nothing* as honestly as the cases where it changed
   something.
4. **Tatum is load-bearing.** The same class of submission — one identical
   success claim over three real Sui Mainnet digests — resolves three ways
   (ALLOW / BLOCK / REQUIRE_VERIFICATION) strictly by what the ledger says
   through Tatum.

---

## How it was built

**Stack.** Next.js 15 (App Router) + React 19 + TypeScript, deployed on Vercel.
Durable audit index in PostgreSQL (Neon). All AI and blockchain calls happen
server-side; no key or credential reaches the browser.

**Tatum Sui Mainnet (primary authoritative source).**
- Interface: `sui.rpc.v2.LedgerService/GetTransaction` over the documented Tatum
  Sui Mainnet **gRPC** gateway (`https://sui-mainnet-grpc.gateway.tatum.io`),
  using the official `@mysten/sui/grpc` client over a native gRPC channel
  (`@protobuf-ts/grpc-transport` + `@grpc/grpc-js`).
- Fallback: Tatum Sui Mainnet **GraphQL**
  (`https://sui-mainnet.gateway.tatum.io/graphql`), used only when gRPC cannot
  complete at all.
- Health: `sui.rpc.v2.LedgerService/GetServiceInfo`; discovery:
  `ListTransactions`.
- The API key travels as `x-api-key` (gRPC metadata / GraphQL header). The
  integration is **read-only** — `ExecuteTransaction` is deliberately never
  called, and no wallet key or seed phrase is ever requested.
- **Fail-closed network identity:** the adapter asserts the Sui Mainnet chain
  identifier (`4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S`); a gateway that is
  not on Mainnet reports unhealthy rather than verifying against the wrong chain.

**Walrus Memory Mainnet (persistence substrate).**
- SDK: the official `@mysten-incubation/memwal` client against the Mainnet
  relayer (`https://relayer.memory.walrus.xyz`), namespace `aftermath`.
- The write path is staged because "accepted" and "done" are different states:
  `remember` (job accepted) → status read → `waitForRememberJob` (terminal result
  and blob id) → `recall` (retrievability confirmed). A write counts as
  **completed** only after the blob id returns, and as **recall-verified** only
  after a recall query returns the record.
- Idempotency keys are scoped per incident and per lesson, so a retry after a
  transport timeout collapses onto the original job instead of duplicating a
  memory.
- An SDK failure is never silently recorded as a successful write; when
  credentials are absent the app runs a labelled mock and says so.

**The deterministic core.** The evidence status, diagnosis, decision, and
verification are owned by deterministic code — not by a language model. A free-tier
model (Groq, `openai/gpt-oss-120b`) is used only to *read* unfamiliar material and
propose candidate mechanisms; its findings are grounded claim-by-claim against the
submission and ungrounded claims are rejected. The AI reading is additive and
cannot change the verdict.

---

## Architecture

```
        pasted incident material (never executed)
                     │
              parse + ground to verbatim spans
                     │
     ┌───────────────┴────────────────┐
     │                                │
  Tatum Sui Mainnet gRPC          AI reading (additive,
  GetTransaction (GraphQL         grounded, cannot set
  fallback, fail-closed           the verdict)
  chain-identity check)
     │                                │
     └───────────────┬────────────────┘
                     │
          evidence status: VERIFIED_SUCCESS | VERIFIED_FAILURE |
          PENDING | UNKNOWN | CONFLICTING   (never a guess)
                     │
          deterministic diagnosis (a hypothesis, not a fact)
                     │
      recall relevant safeguards from Walrus Memory
                     │
        decision engine — run TWICE over identical evidence,
        only the recalled memory varying (Arm A / Arm B)
                     │
     ALLOW | BLOCK | REQUIRE_VERIFICATION | UNKNOWN  + full trace
                     │
   write the verified safeguard to Walrus Memory Mainnet
   (completed on blob id, recall-verified on recall query)
                     │
        Safeguard Record: provenance from memory back to incident
```

A full technical explanation is in
[`ARCHITECTURE.md`](ARCHITECTURE.md).

## Tatum integration

**What Tatum does.** Tatum's Sui Mainnet gRPC gateway is the authoritative
verifier. For a finance-domain submission (an agent claiming a Sui transaction
succeeded), the adapter asks the ledger for that digest's execution status and
returns exactly one of `VERIFIED_SUCCESS`, `VERIFIED_FAILURE`, or `UNKNOWN`.

**Where it is used.** `src/lib/adapters/tatum-sui-grpc.ts` (primary),
`tatum-sui-graphql.ts` (fallback), `sui-verifier.ts` (composite), wired into the
submission pipeline at `src/lib/engines/submission-pipeline.ts`.

**What decision depends on it.** The verdict. Independently reproduced from the
shell, with no API key and no application code, against Tatum's public Sui
Mainnet GraphQL gateway:

| Sui Mainnet digest | Ledger status | AFTERMATH verdict | Decision |
| --- | --- | --- | --- |
| `GHAuBeydSov1zyT6sUKS2cFxWtNWkeamtKANsHwZJHve` | `SUCCESS` | `VERIFIED_SUCCESS` | **ALLOW** |
| `A9iiTMAxi5BY2uwxu4HnuonfF6A4hhGbaCK8HfTFK26x` | `FAILURE` | `VERIFIED_FAILURE` | **BLOCK** |
| `9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM` | `null` (no record) | `UNKNOWN` | **REQUIRE_VERIFICATION** |

**What would fail if Tatum were removed.** The finance verdict collapses to
`UNKNOWN` in every case: the engine could no longer distinguish a real failure
from a claim with nothing behind it, so it could never reach `BLOCK` or `ALLOW`
on a transaction. The product's central claim — that the verdict follows the
ledger rather than the agent's narration — would be gone. The three one-click
samples on the public front door exist precisely to make that dependence
visible: they are one identical claim over three digests, and only Tatum's answer
differs.

**Transport errors are not outcomes.** Timeout, network, HTTP, auth, and
malformed responses map to `UNKNOWN`; only an authoritative "no such
transaction" answer is treated as an authoritative absence — still `UNKNOWN`,
never `VERIFIED_FAILURE`. A 429 is a rate limit, not a failed transaction; a 401
is a credential problem, not an on-chain result.

## Walrus integration

**What Walrus Memory does.** It is the persistence substrate of the product, not
a checkbox. When a failure is genuinely verified, the engine distils a scoped
safeguard and writes it to Walrus Memory Mainnet. Recall is what makes the
behaviour change possible: without a working recall path there is no second arm
in the counterfactual.

**Where it is used.** `src/lib/adapters/safeguard-memory-adapter.ts` and the
`memwal` client wrapper; recalled during every submission at
`src/lib/engines/submission-pipeline.ts` and evaluated at
`src/lib/engines/decision-engine.ts`.

**Live state (read from `GET /api/overview` and `GET /api/learning`,
2026-11-04):**

| Metric | Value |
| --- | --- |
| Relayer authentication | `MAINNET_AUTH_CONFIRMED`, `isLive: true`, `network: mainnet` |
| Namespace `aftermath` (relayer-reported) | **351** memories |
| Completed Mainnet writes | **196** |
| Recall-verified writes | **193** |
| Simulated writes | **0** |
| Minimum requirement (10) | satisfied (`remaining: 0`) |

The two numbers are kept distinct on purpose: a write counts as *completed* only
once the relayer returns a blob id, and as *recall-verified* only once a recall
query returns the record. They are not the same count, and the UI shows both.

## Demonstrated learning loop

The loop is closed and provable:

> investigate → learn → persist → recall → **change a decision** → verify the change

**How it is proven.** The decision engine is run twice over identical evidence —
Arm A without the recalled safeguard, Arm B with it — so the memory's
contribution is a real counterfactual rather than a narrative. From
`GET /api/learning` on 2026-11-04:

| Counter | Value |
| --- | --- |
| Verified safeguards | 6 |
| Safeguards persisted | 4 |
| Safeguards recall-verified | 4 |
| Memories recalled | 95 |
| Memories applied | 47 |
| Investigations influenced | 6 |
| Verification requirements strengthened | 6 |
| **Demonstrated repeat preventions** | **0** |

**The honest part.** Six investigations were influenced: in each, an applicable
safeguard *added required verification checks* that the engine would not
otherwise have required. In none of them did the safeguard flip the verdict
itself — the before and after decision are both `REQUIRE_VERIFICATION`, with the
checks strengthened. AFTERMATH reports that plainly rather than overclaiming a
verdict change. The count of demonstrated repeat preventions is **0**, and it
stays 0 until an independently verifiable second recurrence is shown.

**A memory that changed nothing is also recorded.** Where a recalled safeguard
was redundant against the existing rules, the record says so
(`changed: false`, `attributableToMemory: false`) and it is not counted as
influence.

## Challenges

1. **Sui disabled JSON-RPC on Mainnet.** The brief warned that Sui's RPC
   infrastructure had changed. The first implementation used Tatum's Sui Mainnet
   JSON-RPC gateway — a real defect, not a style choice. The adapter migrated to
   gRPC as primary with an HTTP fallback; when Tatum's host itself dropped
   JSON-RPC (probed directly: `POST /` → 404), the fallback became GraphQL. The
   JSON-RPC adapter is retained only as a documented, unwired legacy reference.
2. **Tatum's rate limit is real and shared.** Roughly three requests per second
   per key, shared across the gRPC and GraphQL interfaces. A discovery-then-verify
   burst trips it. The fix is a retry helper that retries only genuine rate limits
   (never a 401 or a 500), honours `Retry-After`, backs off exponentially, and has
   an injectable delay so unit tests run without waiting.
3. **"Failed" and "could not check" are different facts.** Conflating a timeout
   with a failed transaction is exactly how an agent ends up confidently wrong.
   The five-state evidence model (plus explicit transport-error classification)
   is the fix, and every downstream decision depends on getting it right at the
   adapter layer.
4. **Keeping memory from becoming an oracle.** The tempting design lets a recalled
   lesson raise confidence. That is backwards; memory is a prior, not a proof. The
   enforced property — escalate UNKNOWN to REQUIRE_VERIFICATION, never to success —
   is what keeps the system honest as it accumulates memory.
5. **Proving a contribution rather than narrating one.** Running the engine twice
   and diffing the traces, then reporting the null results, was more work than
   writing a claim — and is the reason the claim is credible.

## What we learned

Memory is only useful when it demonstrably influences a later decision or
verification requirement. A system can store thousands of lessons and change
nothing; the value is in the *delta*. That is why AFTERMATH measures the delta
directly — the added verification checks, the before/after decision, and the
cases where the memory made no difference — and refuses to count an influenced
investigation as a prevented incident. The most useful sentence the product can
say is not "I remember" but "here is exactly what I changed, and here is what I
did not".

## Current limitations

- **0 demonstrated repeat preventions.** The loop's contribution is shown as a
  counterfactual and as added verification requirements, not as a claimed
  second-recurrence prevention.
- The finance verdict needs `TATUM_API_KEY`; without it, `UNKNOWN` (the honest
  answer).
- The AI reading needs `GROQ_API_KEY`; without it, the deterministic parse runs
  and the record says so.
- The coding and workflow demonstrations are controlled harnesses, not
  general-purpose platforms.
- The evaluation metrics describe the controlled scenarios, not production
  reliability.
- Public submissions are rate-limited (5/minute per client, with a shared
  cross-instance counter) — generous, but not unlimited.

## Future potential

- **Durable repeat-prevention evidence**: instrument a real second recurrence to
  move the demonstrated-prevention counter off zero.
- **More authoritative adapters** behind the same evidence contract (other chains
  via Tatum, CI systems, payment APIs) so the safeguard engine is domain-general.
- **Operator review workflow** to promote proposed lessons to validated, active
  rules with a review date.
- **Shared memory namespaces** so separate agents inherit a common safeguard set.

---

## Track justification

**Chosen track: 02 — Smart Agents for Real Life.**

The official brief for this track is "agents that monitor inboxes, expenses,
habits, or workflows", with portable memory so they "pick up where they left off
across tools and sessions" — and the example "workflow bots that learn your
escalation rules". AFTERMATH is exactly that: it watches an agent's reported
outcome (a settlement agent, a coding agent, a workflow agent), checks the claim
against authoritative evidence, and learns escalation rules that change the next
decision. The finance case (Sui transaction claims) is the concrete instance, but
the product is agent infrastructure for real workflows, not a consumer money app.

Why not the other tracks:
- **01 — Markets & Sports Prediction** requires a prediction product (odds,
  picks, credibility scores). AFTERMATH does not predict; it verifies.
- **03 — Consumer Finance Apps** requires a consumer money product people open
  (budgets, savings, payments) with the blockchain invisible. AFTERMATH is a
  developer/operator-facing verification engine; the blockchain is the point.

The best-fit special prize is **Best Walrus Memory Prize ($500)** — "deepest
learning loop; memories that visibly change the product" — which is the exact
thing AFTERMATH measures with its counterfactual.

---

## Links

| Item | Value | Verified |
| --- | --- | --- |
| Production application | <https://aftermath-7tij.vercel.app/> | HTTP 200 |
| Public repository | <https://github.com/itzebe/aftermath> | public, HTTP 200 |
| Blog (GitHub Pages mirror) | <https://itzebe.github.io/aftermath/> | HTTP 200 |
| Blog (Medium) | <https://medium.com/@jonathanebi05/aftermath-every-failure-should-leave-a-safeguard-25446fdbcd71> | published; in the author's RSS feed (the article URL returns 403 to automated clients — Medium bot protection, not unpublished) |
| Demo video (published) | <https://github.com/itzebe/aftermath/releases/tag/demo-v2> (2:36) | asset downloads, HTTP 206 |
| Demo video (final cut) | `artifacts/aftermath-final-demo.mp4` (2:22) | local; container-verified; **not published** — needs an upload to become a form-ready URL |
| Judge quick start | [`JUDGE-QUICK-START.md`](JUDGE-QUICK-START.md) | — |

## Evidence references

- `artifacts/evidence/2026-11-04-overview.json` — live Walrus/Tatum/persistence status
- `artifacts/evidence/2026-11-04-learning.json` — learning-loop counters and behaviour changes
- `artifacts/evidence/2026-11-04-counterfactual.json` — the three-digest Tatum counterfactual
- `artifacts/evidence/2026-11-03-tatum-live-evidence.json` — Tatum health and independent cross-check
- `artifacts/evidence/2026-11-04-config.json` — live `/api/config` (secrets masked)
- `artifacts/evidence/2026-11-04-public-journey.json` — anonymous public journey
- `artifacts/TOTAL-RECALL-EVIDENCE.md` — full claim-to-evidence index
