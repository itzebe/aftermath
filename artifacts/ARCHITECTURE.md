# AFTERMATH — architecture

A judge-friendly technical explanation, grounded in the actual code. Where a
capability depends on a credential or is covered only by tests, it says so.

---

## 60-second explanation

AFTERMATH is a failure-prevention engine with a memory. An incident — a stack
trace, a log, a report — goes in. The engine parses it as data (never executes
it), grounds every fact to a verbatim span, and tries to resolve the incident's
claim against an authoritative source. If the source cannot be reached, the
evidence status is **UNKNOWN**, not a guess.

When a failure is genuinely verified, the engine distils a **safeguard**: a
scoped corrective rule with an authority level, a version, and an applicability
condition. The safeguard is written to **Walrus Memory Mainnet**, and it counts
as verified only when a **recall query returns it**.

Later, a new incident triggers a recall. If a recalled safeguard's conditions
match, it is fed into the decision engine as an additional required check. To
show what that memory actually did, the engine runs **twice** over identical
evidence — once with the safeguard held out, once enforced — and the difference
is reported, including when the difference is nothing.

The whole chain is inspectable: incident → safeguard → Walrus blob → the later
investigations it reached.

---

## Application layer

**Incident intake** (`src/lib/parse.ts`, `src/lib/schemas.ts`). The submitted
material is untrusted. It is parsed with regular expressions, never executed and
never interpolated into a command or a query. Credential-shaped strings are
redacted at two boundaries — before persistence and again before serving — so a
record written before a redaction rule existed is still protected. The redaction
deliberately *preserves* evidence (Sui transaction digests, labelled hashes,
slugs) because destroying it would break verification.

**Investigation** (`src/lib/pipeline.ts`). A fixed, inspectable sequence: parse →
extract candidate facts → ground each fact to a verbatim span → classify the
failure pattern → propose a safeguard → decide → record.

**Evidence handling** (`src/lib/evidence.ts`, `src/lib/verifiers/`). The incident's
claim is resolved against a connected authoritative source. For the finance case
this is **Tatum Sui Mainnet gRPC** (`LedgerService/GetTransaction`), with a
GraphQL fallback, authenticated with a server-side key. It reads genuine Mainnet
execution status and returns `VERIFIED_SUCCESS`, `VERIFIED_FAILURE`, or `UNKNOWN`.
No transaction is broadcast and no wallet key is requested. Transport,
authentication, and missing-data failures are always `UNKNOWN`.

**Decision engine** (`src/lib/decision.ts`). Deterministic. Input: grounded facts,
the diagnosis, active rules, and any applicable recalled safeguards. Output: a
verdict (`ALLOW` / `REQUIRE_VERIFICATION` / `BLOCK`) plus a set of required
verification checks. The engine is a pure function of its inputs, which is what
makes the two-arm comparison a real counterfactual.

---

## Learning layer

**Safeguard generation** (`src/lib/safeguard.ts`). A verified failure is mapped
to a corrective rule: a scoped instruction, the failure pattern it addresses, and
the action type it applies to.

**Authority assessment.** Every safeguard carries an authority level —
`authoritative` when the failure was verified against a source, `unverified`
otherwise. Only authoritative safeguards may change a decision. An unverified
safeguard is still persisted and shown, but it cannot move a verdict.

**Versioning and supersession.** A safeguard has an id of the form
`safeguard-<domain>-<pattern>@v<n>`. A new safeguard for the same pattern
supersedes the prior version; the supersession link is recorded so the lineage is
inspectable.

**Applicability.** On recall, a candidate memory is scored: it applies only if it
shares **both** the domain and the failure pattern of the current investigation
(and, for safeguards, the action type). A memory retrieved by similarity that
does not share both is shown as *possible similarity — not applied* rather than
being counted as applied.

**Recurrence tracking.** The learning evaluation counts, from durable records,
how many times each pattern recurred, which memories were recalled, which were
applicable, which were applied, and which actually changed a decision.

---

## Persistence layer

**Walrus Memory Mainnet** (`src/lib/memory/`). The live adapter talks to the
Mainnet relayer `https://relayer.memory.walrus.xyz`, namespace `aftermath`.

**Namespace.** A single namespace, `aftermath`. The total memory count is read
from the relayer's own signed `listNamespaces` call, not from our own counter.

**Memory writes.** Each write uses a **content-hash idempotency key**, so a
retry of the same record does not create a duplicate. The write is awaited to a
**blob id**. Completed, recall-verified, and simulated writes are tracked
separately and never merged.

**Recall and recall verification.** A recall query retrieves candidate memories
by domain and pattern. A write is counted as *recall-verified* only when a recall
query returns it — so "completed" (reached a blob id) and "verified" (a recall
returned it) are different numbers, and both are shown.

**Provenance.** Each memory links back to the originating incident, its Walrus
blob reference, and every later investigation that retrieved or was influenced by
it. This is what makes the learning claim inspectable rather than asserted.

---

## Infrastructure

**Tatum Sui Mainnet gRPC.** The read-only authoritative verifier, with a GraphQL
fallback. Authenticated with a server-side API key. It is load-bearing, not
decorative: the verdict follows the ledger, not the agent's claim. See
`artifacts/TATUM-INTEGRATION-ARCHITECTURE.md` for the full interface, the
safety properties, and the live counterfactual evidence.

**Neon / PostgreSQL.** The durable audit index. Records, learning retrieval
entries, and the shared rate-limit counters live here, so they hold across
serverless instances instead of resetting on every cold start. The application
reports whether the index is durable and degrades honestly when it is not.

**Audit records.** Every write and every learning event is appended to the
durable index, which is what the evaluation metrics are computed from.

**Production hosting.** Next.js (App Router) on Vercel. The read path is bounded:
external status probes and the rate-limit counter write both run within a budget
and degrade to an honest "unavailable" rather than holding a request open.

---

## Behaviour-change layer

The central claim is not "we stored a lesson". It is "the retrieved lesson
changed later work, and here is the proof".

**Two arms, identical inputs.**

- **Arm A — memory held out.** The decision engine with the applicable safeguard
  excluded. Legacy lessons and active rules are unchanged.
- **Arm B — memory enforced.** The same engine with the applicable safeguard
  active.

The only variable is the memory. Any difference is the memory's own
contribution — a real counterfactual over the engine, not a simulation.

**What the system records:**

- **Additional required checks.** Checks Arm B requires that Arm A does not.
- **Verdict changes, where justified.** When the arms disagree on the verdict.
- **The actual memory contribution.** Which recalled memory caused the change.
- **Cases where memory did not change the verdict.** Reported as carefully as the
  positive case — "the decision is unchanged … but the applicable safeguard adds
  N required verification check(s) the engine would not otherwise require."

**Why memory cannot override stronger evidence.** A safeguard tells the engine
*what to check next*, not what to conclude. A recalled safeguard can **add**
required checks and can **escalate** a decision (toward `REQUIRE_VERIFICATION` or
`BLOCK`). It cannot downgrade a decision or make an unsupported claim stand. The
verdict remains a function of the evidence; memory only sharpens the verification
the evidence must satisfy.

---

## Diagram

```
                        ┌──────────────────────────────────────────┐
  incident material ───▶│ INTAKE   parse as data · redact secrets   │
  (stack trace, log)    └────────────────────┬─────────────────────┘
                                             ▼
                        ┌──────────────────────────────────────────┐
                        │ INVESTIGATE  ground facts to verbatim     │
                        │              spans · classify pattern     │
                        └────────────────────┬─────────────────────┘
                                             ▼
             ┌───────────────────────────────────────────────────────┐
             │ EVIDENCE   resolve the claim against a source          │
             │            Tatum Sui Mainnet gRPC (read-only)          │
             │            → VERIFIED_SUCCESS | VERIFIED_FAILURE |     │
             │              UNKNOWN  (never a guess)                  │
             └────────────────────┬──────────────────────────────────┘
                                  ▼
             ┌───────────────────────────────────────────────────────┐
             │ LEARN   verified failure → scoped SAFEGUARD            │
             │         authority level · version · applicability      │
             └────────────────────┬──────────────────────────────────┘
                                  ▼
             ┌───────────────────────────────────────────────────────┐
             │ PERSIST   Walrus Memory Mainnet · namespace "aftermath"│
             │           content-hash idempotency key → blob id       │
             │           counted verified only if RECALL returns it   │
             └────────────────────┬──────────────────────────────────┘
                                  │
        ┌─────────────────────────┘
        ▼   (a later investigation)
             ┌───────────────────────────────────────────────────────┐
             │ RECALL   retrieve candidates by domain + pattern       │
             │          applicability: both must match               │
             └────────────────────┬──────────────────────────────────┘
                                  ▼
             ┌───────────────────────────────────────────────────────┐
             │ DECIDE — two arms, identical evidence                  │
             │   Arm A: memory held out                               │
             │   Arm B: memory enforced                               │
             │   diff = the memory's own contribution                 │
             │   (adds required checks / changes verdict / nothing)   │
             └────────────────────┬──────────────────────────────────┘
                                  ▼
             ┌───────────────────────────────────────────────────────┐
             │ VERIFY   provenance: memory → origin incident →        │
             │          Walrus blob → later investigations reached    │
             │          durable audit index: Neon / PostgreSQL        │
             └───────────────────────────────────────────────────────┘
```

---

## Data flow, in one paragraph

An incident is parsed into grounded facts and resolved against an authoritative
source; the result is a verdict plus a set of required checks. If a failure is
verified, a scoped safeguard is written to Walrus Memory Mainnet under a
content-hash idempotency key and confirmed by recall. A later incident triggers a
recall; each candidate is scored for applicability, and applicable safeguards are
fed into the decision engine. The engine is run twice over identical evidence —
once with the safeguard held out, once enforced — and the difference, or its
absence, is recorded alongside provenance that links the memory to its origin and
to every investigation it reached.
