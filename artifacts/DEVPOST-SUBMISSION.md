# AFTERMATH — Every Failure Should Leave a Safeguard

*Devpost submission copy. Paste-ready. Every figure below was read live from the
production deployment on 2026-11-03; where a capability depends on a credential
or is covered only by tests, it says so.*

---

## One-line pitch

**AFTERMATH turns a verified failure into a safeguard that persists on Walrus
Memory Mainnet and changes how the next investigation is decided — and it proves
that change rather than claiming it.**

---

## Project summary

AFTERMATH is an evidence-first failure-prevention engine for AI agents. An agent
reporting "the charge completed successfully" is making a *claim*; AFTERMATH asks
what the authoritative source actually says. When a failure is verified, it turns
the lesson into a scoped safeguard, persists it to Walrus Memory Mainnet, and —
during a later investigation — recalls it, applies it, and shows exactly what it
changed. The system runs the decision engine twice over identical evidence with
only the recalled memory differing, so the memory's own contribution is a real
counterfactual rather than a narrative. The investigation workspace is public:
anyone can submit an incident and get a genuine Safeguard Record without an
account, an invitation, or an administrator.

---

## Inspiration

An AI agent says "the charge completed successfully." Is that true?

Most systems cannot answer, because two things are missing. First, a claim is
treated as a fact: nothing checks it against an authoritative record, so
"unknown" quietly becomes "success" or "failure". Second, even when a failure is
found, the lesson lives in a log or a ticket and disappears between
investigations. The next agent starts from zero and makes the same mistake.

We kept seeing the same shape of incident: an operation failed, a retry happened,
and a report claimed success with no evidence behind it. The failure was not that
the agent was wrong. It was that the system had no memory of being wrong before.
So we asked a narrower, testable question: **can a verified failure leave a
safeguard that provably changes a later decision?**

---

## What it does

AFTERMATH takes pasted failure material — a stack trace, a log excerpt, an
incident report — and returns a **Safeguard Record** that connects:

> incident → evidence → hypothesis → safeguard → verification → memory

with an honest state label at every link.

1. **Investigate.** The material is parsed with regular expressions and is never
   executed. Facts are grounded by verbatim span: a fact that cannot be copied
   out of the submission does not survive.
2. **Assess evidence.** The system checks the material against a connected
   authoritative source. If the source cannot be reached, the evidence status is
   **UNKNOWN** — never silently upgraded to success or failure.
3. **Learn.** A verified failure yields a scoped **safeguard**: a corrective rule
   with an explicit authority level, a version, and an applicability condition.
4. **Persist.** The safeguard is written to **Walrus Memory Mainnet** under a
   content-hash idempotency key, awaited to a blob id, and counted as verified
   only when a **recall query returns the record**.
5. **Recall and apply.** A later investigation retrieves the safeguard, checks
   whether its conditions match, and — if they do — feeds it into the decision
   engine as an additional required check.
6. **Prove the change.** The decision engine is run twice over identical
   evidence: once with the applicable safeguard held out, once with it enforced.
   The difference is the memory's own contribution. The provenance shows what
   changed, and it also shows when memory changed nothing.

The investigation workspace is **public**: a visitor can submit an incident from
the home page without a credential, because that is the product's core act. The
operator console stays separate and gated. Anonymous submission is enabled only
when every safety control holds at request time — a live Walrus Memory Mainnet
backend, a shared durable (PostgreSQL) audit index, and a configured per-client
cap — and it fails closed otherwise. The deployment reports which decision it
made through `GET /api/config` (`publicSubmission`).

---

## How we built it

A seven-stage pipeline, all deterministic except one optional, additive AI
reading:

**Incident intake** parses the material and redacts credential-shaped strings at
two boundaries — before persistence, and again before any record is served, so a
record written before the rule existed is still protected. The redaction
preserves evidence: a Sui transaction digest, a labelled hash, and ordinary slugs
are left intact, because destroying them would break the verification the product
depends on.

**Evidence verification** resolves the incident's claim against a connected
authoritative source. For the finance case this is **Tatum's Sui Mainnet gRPC**
endpoint (`LedgerService/GetTransaction`), with a GraphQL fallback, using a
server-side API key. It reads genuine Mainnet transaction execution status and
classifies it `VERIFIED_SUCCESS`, `VERIFIED_FAILURE`, or `UNKNOWN`. **No
transaction is ever broadcast and no wallet key is ever requested.** Transport,
authentication, and missing-data failures are always `UNKNOWN`, never a
misrepresented transaction failure.

**Diagnosis** is rule-based: it maps the grounded facts to a failure pattern
(unsupported completion claim, evidence unavailable, repeated failed operation,
connection pool exhaustion).

**The safeguard engine** proposes a corrective rule with an authority level
(`authoritative` / `unverified`), a version, an applicability condition, and a
supersession link. A rule is only ever called *validated* with proof.

**The Walrus Memory adapter** talks to the Mainnet relayer
`https://relayer.memory.walrus.xyz`, namespace `aftermath`. Each write uses a
content-hash idempotency key, awaits a blob id, and is counted as recall-verified
only when a recall query returns it. Completed, recall-verified, and simulated
writes are tracked separately and never merged; the namespace total is read from
the relayer's own signed `listNamespaces` call.

**The decision engine** produces a verdict (`ALLOW` / `REQUIRE_VERIFICATION` /
`BLOCK`) plus a set of required verification checks. It is deterministic, and it
refuses to let a recalled memory override stronger evidence: memory can *add*
required checks and can strengthen a decision, but it cannot make an unsupported
claim stand.

**The learning evaluation** computes, from durable records, which memories were
recalled, which were applicable, which were applied, and which actually changed
a decision — with test fixtures excluded from production figures and counted
separately.

Durable state lives in **Neon/PostgreSQL**, so the audit index, the rate-limit
counters, and the records hold across serverless instances. The app is a
**Next.js** (App Router) application hosted on **Vercel**.

---

## How it works

**How a safeguard is learned.** An incident is parsed into grounded facts. If the
evidence resolves and a failure is verified, the diagnosis maps it to a pattern
and the safeguard engine proposes a scoped rule. The rule is not trusted on
sight: it carries an authority level and a version, and it is only *authoritative*
when the failure was actually verified against a source.

**Why Tatum is load-bearing, not decorative.** An agent's own claim ("the
transaction succeeded") is never evidence — it is the thing under test. When a
submission names a Sui transaction digest, AFTERMATH performs a **read-only**
lookup through Tatum's Sui Mainnet gateway (`sui.rpc.v2.LedgerService/GetTransaction`,
GraphQL fallback) and folds the ledger's execution status into the record. The
verdict is then a function of Tatum's answer, not of the claim. The same class of
submission resolves to **ALLOW** when the chain confirms success, **BLOCK** when
the chain reports failure, and **REQUIRE_VERIFICATION** when the chain cannot
answer — three different decisions from one claim, decided by on-chain truth. No
transaction is broadcast and no wallet key is requested. A transport failure, an
auth failure, or a missing transaction always resolves to `UNKNOWN`, never to a
fabricated outcome. See `artifacts/TATUM-INTEGRATION-ARCHITECTURE.md`.

**How it is persisted.** The rule and its lesson are written to Walrus Memory
Mainnet under a content-hash idempotency key. The write is awaited to a blob id.
A write is counted as *recall-verified* only after a recall query returns it — so
"completed" and "verified" are different numbers, and both are shown.

**How it is retrieved and evaluated.** When a later incident is investigated, a
recall query retrieves candidate memories. Each candidate is scored for
applicability: the domain and the failure pattern must match. A memory that does
not share both does not apply, and the UI says so ("possible similarity — not
applied") rather than implying it did.

**How it is applied — the two-arm comparison.** For an investigation whose
applicable safeguard exists, the decision engine is run twice over identical
inputs:

- **Arm A — memory held out.** The engine with the applicable safeguard excluded;
  legacy lessons and active rules unchanged.
- **Arm B — memory enforced.** The same engine with the applicable safeguard
  active.

The only difference between the arms is the memory. When the arms differ, the UI
shows exactly what changed: the added required verification checks, or a changed
verdict. When the verdict does not change, it says so: *"the decision is
unchanged … but the applicable safeguard adds N required verification check(s)
the engine would not otherwise require."* Honest attribution means recording the
cases where memory changed nothing, too.

**Why memory cannot override stronger evidence.** The decision engine's verdict
is a function of the evidence. A recalled safeguard can add required checks and
can escalate a decision (toward `REQUIRE_VERIFICATION` or `BLOCK`), but it cannot
downgrade a decision or make an unsupported claim stand. This is deliberate: a
safeguard is a lesson about *what to check*, not a licence to skip the evidence.

---

## Challenges

**Evidence grounding.** The first temptation is to let a language model decide.
We refused. The model is additive and capped: every fact it keeps must cite a
span that appears verbatim in the submission or it is discarded and counted as a
rejected claim. The model never sets the evidence status, the diagnosis, the
decision, or the verification.

**Authority assessment.** A safeguard learned from an unverified incident must
not carry the same weight as one learned from a verified failure. So every
safeguard carries an explicit authority level, and only authoritative ones are
allowed to change a decision.

**Durable persistence and honest counting.** "We wrote it" and "it is really
there" are different claims. We split completed from recall-verified, excluded
simulated writes, and read the namespace total from the relayer rather than
trusting our own counter. We also found a real defect in our own metrics — the
headline figures had included test fixtures — and we corrected it and documented
it rather than quietly changing the number.

**Provenance.** It is easy to claim a memory influenced a decision. We made it
inspectable: each memory links back to the incident that produced it, its Walrus
blob reference, and every later investigation it reached.

**The hardest part was honesty.** We kept finding places where the easy
implementation would have overstated what happened — a rate limit reported as a
failure, a simulated backend presented as Mainnet, a memory counted as applied
when it did not apply. Each of those is now a deliberate refusal in the code, and
several of them are pinned by tests.

---

## What we learned

**Storing information is not enough.** The interesting question is not "did we
persist the lesson?" It is "did the retrieved lesson change later work, and can
we prove it?" A memory that is retrieved but never applied is a log entry with
extra steps. So the product's central claim is the two-arm comparison, and the
product is built to report the *null* result as carefully as the positive one.

**Refusing to decide is a feature.** When a source cannot be reached, the honest
answer is `UNKNOWN`. Converting a transport failure into a verdict is exactly the
mistake the product exists to prevent — and it took discipline to make the system
say "I do not know" instead of guessing.

**Memory must not outrank evidence.** A safeguard tells you what to check next,
not what to conclude. Letting memory override evidence would make the system
confidently wrong, which is worse than ignorant.

---

## What's next

Planned, not yet built — listed honestly so nothing here is mistaken for a
shipped capability:

- **More authoritative connectors.** The finance case verifies against Tatum Sui
  Mainnet today. Generalising the evidence layer to more systems (CI providers,
  payment APIs) is the obvious next step, and it is the same interface.
- **A first-class SDK.** Right now the demonstration cases are controlled
  harnesses. A small SDK would let a real agent call the decision engine before
  acting.
- **Recall relevance tuning.** The retrieval currently matches on domain and
  failure pattern. Better ranking — and a richer applicability model — would
  reduce the "possible similarity — not applied" set.
- **Supersession workflows.** Safeguard versioning and supersession exist;
  operator-facing review of supersession is not built.
- **Repeat-prevention evidence.** The system counts repeat preventions, but the
  current instance shows **zero** demonstrated repeat preventions. Building the
  conditions that produce them, and reporting them honestly, is future work.

---

## Technology stack

Actually used, verified in the repository and the live deployment:

- **Next.js 15** (App Router, React 19, TypeScript) — the application and the API routes.
- **Walrus Memory Mainnet** — persistent memory (relayer `relayer.memory.walrus.xyz`, namespace `aftermath`).
- **Tatum Sui Mainnet gRPC** — read-only authoritative transaction verification (`LedgerService/GetTransaction`), GraphQL fallback.
- **Neon / PostgreSQL** — durable audit index, rate-limit counters, and records.
- **Groq** (`openai/gpt-oss-120b`) — optional, additive, span-grounded AI reading.
- **Vercel** — production hosting.
- **Playwright**, **Vitest**, **ESLint**, **TypeScript** — testing and quality gates.
- **ffmpeg** — demo video production.

---

## Hackathon track alignment

**Track: 02 — Smart Agents for Real Life.** AFTERMATH is an evidence-based
failure-prevention engine for AI agents: it turns a verified execution incident
into a scoped corrective rule, preserves the lesson on Walrus Memory, and applies
the safeguard to later actions, so an agent that failed once does not fail the
same way twice.

**Walrus Memory.** Persistence is the substrate of the product, not a checkbox.
The safeguard is written to Walrus Memory Mainnet and counted as verified only
when a recall query returns it. Recall is what makes the behaviour change
possible: without a working recall path there is no second arm in the
comparison. As of 2026-11-03 the instance reports **189 completed** and **186
recall-verified** Mainnet writes, `simulatedWrites: 0`, with **344** memories in
the namespace.

**Deepest learning loop.** The brief asks for the deepest loop, and that is the
part we built most carefully. The loop is closed and provable:

> investigate → learn → persist → recall → **change a decision** → verify the change

The change is demonstrated by a real counterfactual over the decision engine (the
same engine, twice, with only the memory varying), and the provenance shows the
memory's contribution — including the cases where it changed nothing.

*Honest scoping.* The instance currently shows **5** persisted, recall-verified
safeguards, **33** memories applied, **4** investigations influenced, and **4**
requirements strengthened. It shows **0** demonstrated repeat preventions. We
report those numbers as they are.

**Tatum is load-bearing, and provable.** Four submissions of the same class — an
agent claiming a Sui transaction succeeded — were run through the anonymous
public endpoint with only the digest varying. Tatum's answer decided the outcome:
a confirmed success → **ALLOW**, a confirmed failure → **BLOCK**, an unknown
digest → **REQUIRE_VERIFICATION**, a malformed digest → **REQUIRE_VERIFICATION**.
The digests and record ids are in
`artifacts/evidence/2026-11-03-tatum-integration.json`; the failure digest was
cross-checked independently against Tatum's public GraphQL endpoint.

---

## Evidence of real implementation

Everything a judge can check independently, without trusting this document:

- **Production application** — <https://aftermath-7tij.vercel.app/> (verified 200),
  live and public, serving application commit `3fca1b98`.
- **`GET /api/config`** — reports `publicSubmission.available: true` with the exact
  reason, and fails closed otherwise.
- **`GET /api/overview`** — reports the live Walrus namespace count (**344**),
  completed (**189**) and recall-verified (**186**) writes, simulated writes
  (**0**), Tatum Sui Mainnet health, and the persistence backend — all read from
  the real services, not asserted.
- **`GET /api/learning`** — returns the impact counters, the behaviour-change
  counterfactuals (Arm A / Arm B), and the provenance chain.
- **Source and tests** — <https://github.com/itzebe/aftermath>; the evidence
  artifacts live under `artifacts/` (architecture, final report, evidence JSON,
  screenshots, demo script).
- **Production verification** — `npm run verify:prod` → **28/28** with the operator
  token for the recall-query check (27/28 without it, reported explicitly).
- **Demo video** — `artifacts/aftermath-final-demo.mp4`, recorded live from the
  production deployment.

---

## Demo instructions

**Production URL:** <https://aftermath-7tij.vercel.app/>

**What to inspect, and where:**

1. **The front door (`/`).** The investigation form is public — no credential.
   Click **Use a Sui transaction sample** and submit; AFTERMATH verifies the
   named digest read-only against Sui Mainnet through Tatum and folds the
   authoritative result into the record. (The sample is a real failed
   transaction, so an agent's success claim is blocked.) **Use a sample
   incident** exercises the no-source path instead. Either way you get a genuine
   Safeguard Record.
2. **Safeguard Records (`/records`).** Every investigation, newest first. Each
   record states honestly how far its safeguard is verified (simulated, live, or
   recall-verified).
3. **Memory Ledger (`/memory`).** Live Walrus Memory Mainnet state: relayer
   authentication, namespace total, and the write rows — each with its blob id
   and backend. Completed and recall-verified are shown separately.
4. **Learning Loop (`/learning`).** The whole loop. Scroll to **Learning impact**
   for the counted figures, **Behaviour change** for the two-arm comparison, and
   **Memory provenance** for the chain from a memory back to its origin incident.
5. **Evaluation Lab (`/lab`).** Run the controlled scenarios. `workflow-repeat-refused`
   shows a recalled lesson changing a repeat decision to `REQUIRE_VERIFICATION`.

**What to expect:** deterministic investigation output; an evidence status of
`UNKNOWN` when no authoritative source is named; AI reading that is additive and
reports whether it ran.

**Authentication:** reading every public page needs no account. Submitting an
incident from the home page needs no account (public submission is enabled on
this deployment). The **operator console** (`/admin`) requires the operator's
admin token; it is not needed for any of the steps above.

**Known limitations:**

- The finance case needs `TATUM_API_KEY`; without it, `UNKNOWN`.
- The AI reading needs `GROQ_API_KEY`; without it, the deterministic parse runs
  and says so.
- The coding and workflow demonstrations are controlled harnesses, not
  general-purpose platforms.
- The evaluation metrics describe the controlled scenarios, not production
  reliability.
- The standalone `npm run verify:prod` passes **28/28** with the operator token
  set. Without it, the recall-query check is reported as a failure with an
  explicit reason rather than silently skipped.

---

## Final links

| Artifact | URL | Status |
| --- | --- | --- |
| Production application | <https://aftermath-7tij.vercel.app/> | verified 200 |
| Public repository | <https://github.com/itzebe/aftermath> | verified 200 |
| Final demo (this submission) | `artifacts/aftermath-final-demo.mp4` | 2:01, narrated + captioned, not published |
| Narrated demo video (v2) | <https://github.com/itzebe/aftermath/releases/tag/demo-v2> | verified (2:36) |
| Silent captioned demo (Mission 9) | `artifacts/mission9/aftermath-demo-m9.mp4` | verified (2:24), not published |
| Rendered blog | <https://itzebe.github.io/aftermath/> | verified 200 |
| Published blog (Medium) | <https://medium.com/@jonathanebi05/aftermath-every-failure-should-leave-a-safeguard-25446fdbcd71> | provided by the operator; Medium blocks this environment's IP (HTTP 403), so it was not re-verified here |
| Judge quick start | `artifacts/JUDGE-QUICK-START.md` | one-minute path |
