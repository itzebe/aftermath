# AFTERMATH — Every failure should leave a safeguard

*A submission for Total Recall (Tatum × Walrus).*

---

## The problem, in one sentence

An AI agent can repeat a known mistake because the lesson from the first
execution never became a safeguard for the next one.

The failure is not that agents are wrong. It is that they report success without
evidence, and nothing in their environment remembers that they did. Three
concrete shapes of this:

1. **Finance.** An agent reports a Sui transaction as successful without checking
   authoritative transaction data.
2. **Coding.** An agent reports a bug fixed without running the tests, or reads a
   green exit code as proof the tests passed.
3. **Workflow.** An agent repeats an operation whose prerequisite caused the
   previous attempt to fail.

AFTERMATH is a shared mechanism for all three. It converts verified execution
incidents into scoped corrective rules, persists the lesson through Walrus
Memory, and applies the relevant safeguard to later actions.

## The one idea that shaped the design

**A claim is not evidence.**

Everything else follows from taking that seriously. An agent's "it worked" is an
input to be checked, not a fact to be stored. So the engine separates four things
that agent systems usually blur together:

- **The observed event** — what was attempted.
- **The evidence** — what the authoritative source says about it.
- **The diagnosis** — a deterministic hypothesis about what went wrong.
- **The lesson** — a scoped, proposed corrective rule.

Only evidence can establish an outcome. A diagnosis is a hypothesis. A lesson is
a proposal. A proposal becomes a rule only when validation promotes it, and a
rule only enforces anything when it is `active`.

## How it works

Each attempted action flows through seven stages.

### 1. Incident intake

A structured record: domain, action type, intended outcome, the agent's claim,
evidence references, and an idempotency key. It is validated with Zod at the
boundary. The type system is explicit that `claimedOutcome` is a claim:
it is never accepted as a statement of fact.

### 2. Evidence verification

A domain adapter queries the authoritative source and returns exactly one of
`VERIFIED_SUCCESS`, `VERIFIED_FAILURE`, `PENDING`, `UNKNOWN`, or `CONFLICTING`.
The adapter — not a language model — produces this. The contract that matters:

> A failed lookup does not establish that a transaction failed. A successful
> HTTP response does not establish that the operation succeeded.

This is the rule that most naive integrations get wrong, and it is the rule the
Tatum adapter is built around.

### 3. Failure diagnosis

A deterministic function maps observed facts to a candidate pattern —
`unsupported_completion_claim`, `missing_prerequisite`, `evidence_unavailable`,
and so on — with the observed facts recorded separately from the hypothesis.

### 4. Corrective rule engine

A validated lesson becomes an explicit rule: statement, applicability
conditions, required evidence, action (`BLOCK` or `REQUIRE_VERIFICATION`),
severity, validation status, supporting incidents, and a review date. The rule
lifecycle is `proposed → validated → active → retired/superseded`.

Crucially, **a lesson is stored before it becomes enforceable**. The memory write
happens at diagnosis time; enforcement waits for validation.

### 5. Walrus Memory adapter

The lesson and the incident are written through the official
`@mysten-incubation/memwal` SDK. The adapter distinguishes an *accepted* write
from a *completed* one, records the returned blob id, and confirms retrieval
with a recall query.

### 6. Safeguard decision engine

A deterministic decision — `ALLOW`, `BLOCK`, `REQUIRE_VERIFICATION`, or
`UNKNOWN` — with a full trace: the evidence status, the rules that applied, the
memories retrieved, the missing preconditions, and the policy version. The same
inputs and policy version always produce the same decision.

The property I care about most: **recalled memory escalates, it never overrides.**
When the evidence is `UNKNOWN`, a recalled corrective lesson turns the decision
into `REQUIRE_VERIFICATION`. It never converts missing evidence into success.

### 7. Learning evaluation

Metrics computed from reproducible scenarios: baseline failure rate, repeat
prevention rate, false-block rate, unsupported claims caught, evidence
unavailability, and memory retrieval relevance. The framing is deliberately
narrow. "Baseline" means first-occurrence scenarios, where no safeguard could
exist yet. "Prevention" means repeat scenarios, where one did.

## The integrations

### Walrus Memory

The SDK is used as documented, and I confirmed the interface against the
installed package's type definitions rather than from memory:

- `MemWal.create({ key, accountId, serverUrl, namespace })`
- `remember(text, { idempotencyKey })` → `{ job_id, status }`
- `getRememberStatus(jobId)` → one-shot job state
- `waitForRememberJob(jobId)` → `{ blob_id, owner, namespace }`
- `recall({ query, limit, namespace, sort })` → `{ results[] }`

The write path is deliberately staged, because "accepted" and "done" are
different states:

1. `remember` returns as soon as the relayer accepts the job. That is a
   *requested* write.
2. A status read records a genuine *processing* state.
3. `waitForRememberJob` is awaited for the terminal result and the blob id.
4. A recall query confirms the record is retrievable.

A write counts as complete only after step 3, and as verified only after step 4.
The dashboard shows four distinct states — requested, processing, completed,
failed — plus a separate recall-verified flag. An SDK failure is never silently
recorded as a successful write.

I also use the SDK's idempotency key support, scoped per incident and per lesson,
so a retry after a transport timeout collapses onto the original job rather than
creating a duplicate memory.

### Tatum Sui RPC

The brief warned that Sui's RPC infrastructure had changed and told me to pick a
*currently supported* interface rather than assume an old one still works. That
warning was load-bearing. The Sui documentation states it plainly:

> JSON-RPC is disabled on Sui Foundation Mainnet full nodes. The shutoff took
> effect the week of July 27, 2026. Sui Foundation plans full decommission,
> including code removal, for mid-October 2026. If your application still calls
> JSON-RPC, migrate to gRPC or GraphQL RPC now.

So my first implementation — Tatum's Sui Mainnet JSON-RPC gateway — was a real
defect, not a stylistic choice. I migrated to gRPC as the primary interface and
kept JSON-RPC only as an explicit fallback.

Tatum's own Sui page documents both interfaces side by side, which is where I
took the endpoints and the method names from rather than relying on the brief's
summary:

| Interface | Base URL | Used for |
| --- | --- | --- |
| gRPC (primary) | `https://sui-mainnet-grpc.gateway.tatum.io` | health, verification, discovery |
| JSON-RPC (fallback) | `https://sui-mainnet.gateway.tatum.io` | health, verification, discovery |

The API key travels as `x-api-key` — gRPC metadata on the gRPC path, a request
header on the JSON-RPC path. The gRPC client is the official `@mysten/sui/grpc`
client (`SuiGrpcClient` over gRPC-web), so no proto files are vendored or
generated. The methods I use are the ones Tatum documents for that gateway:

- `sui.rpc.v2.LedgerService/GetServiceInfo` for a health check
- `sui.rpc.v2.LedgerService/GetTransaction` for authoritative execution status
- `sui.rpc.v2.LedgerService/ListTransactions` for discovering recent digests

I verified the wiring before writing any of the adapter logic, because "the
endpoint exists in a table" is not the same as "the transport reaches it". An
unauthenticated `GetServiceInfo` against the Tatum gRPC gateway returns
`UNAUTHENTICATED` — proof the transport works and the gateway is refusing an
unauthenticated call, not proof of anything about a transaction. The same probe
against the public Sui full node returned the real Mainnet chain identifier,
which let me confirm the request shape before adding credentials.

**No hardcoded digests.** The brief forbids fabricating transaction hashes, and
it is right to. So the finance demonstration *discovers* digests from the live
ledger through the gateway, then re-verifies each one through an authoritative
transaction lookup, and classifies it by its own execution status. The
successful and unsuccessful cases are found, not assumed.

**Transport errors are not outcomes.** The adapter classifies failures as
`timeout`, `network`, `http`, `auth`, `malformed`, or `not_found`. The first
five are failures to complete the lookup and map to `UNKNOWN`. The last is an
authoritative absence — the node answered, and the answer is "no such
transaction" — which is still `UNKNOWN`, never `VERIFIED_FAILURE`. A `429` rate
limit is not a failed transaction. A `401` is a credential problem, not an
on-chain result. A digest the node has never seen is not a failed transaction
either. This separation is what the whole product rests on.

The gRPC transport makes that separation clean: a genuine answer arrives as a
`Transaction` or a `FailedTransaction` with a `status.success` flag, while a
failure to answer arrives as a thrown gRPC status code. The adapter maps the
former to `VERIFIED_SUCCESS`/`VERIFIED_FAILURE` and the latter to `UNKNOWN`.

The composite verifier prefers gRPC and falls back to JSON-RPC **only** when the
gRPC request could not complete at all. A definitive answer — success, failure,
or "no such transaction" — is returned immediately, so a digest is never queried
twice when the first interface already answered. Each assessment records which
interface produced it (`tatum_sui_grpc` or `tatum_sui_json_rpc`), so the UI and
the audit trail never claim gRPC evidence that actually came from JSON-RPC.

This integration is read-only. No transaction is broadcast, and no wallet key or
seed phrase is ever requested. The gRPC gateway exposes a
`TransactionExecutionService/ExecuteTransaction` method; the adapter deliberately
never calls it.

## What I measured

Running the eight controlled scenarios produces:

| Metric | Value |
| --- | --- |
| Scenarios | 8 |
| Baseline (first-occurrence) scenarios | 6 |
| Repeat scenarios | 2 |
| Unsupported claims caught | 3 / 4 |
| Unsupported claims unresolved (`UNKNOWN`) | 1 |
| Unsupported claims allowed to stand | 0 |
| Baseline failure rate | 67% |
| Repeat prevention rate | 100% |
| Repeat failures that slipped through | 0 |
| False-block rate | 0% |
| Evidence-unavailable rate | 25% |
| Memory retrieval relevance | 100% |

The two repeat scenarios are the point of the product:

- `coding-regression-with-safeguard` — the bug is reintroduced. A rule already
  exists from the earlier failure, so the engine recalls it and blocks the claim.
- `workflow-repeat-refused` — the operation is attempted again without its
  prerequisite. The engine recalls the missing-prerequisite rule and requires it.

Both were prevented. Zero valid actions were blocked. That second number matters
as much as the first: safe behaviour is not the same as denying everything.

The four unsupported claims split into three buckets, and the split is the honest
part. Three were refused by an explicit safeguard decision (`BLOCK` or
`REQUIRE_VERIFICATION`): the failing coding tests, the coding regression, and the
finance claim with no Tatum key configured. One resolved to `UNKNOWN` — the
first-occurrence coding claim, made before any rule existed, where the test
harness produced no usable evidence, so the engine can establish neither success
nor failure and says exactly that. Crucially, **zero** unsupported claims were
allowed to stand: no `ALLOW` was ever issued against a claim the evidence did not
support. The `UNKNOWN` case is not a hole in the safeguard; it is the engine
refusing to guess on the first occurrence, which is what leaves something for the
safeguard to learn from.

Re-running the demonstration reproduces these numbers exactly. A scenario run
clears the simulated incident, rule, and memory state first, so the same button
always produces the same figures. Real Mainnet write records are deliberately
preserved, because a completed on-chain write cannot be un-done and the ledger
must keep counting it.

## The honest part

This is where most hackathon write-ups get vague, so I want to be precise.

**The incidents are simulated. The memory writes are real.** The eight scenarios
are controlled harnesses, and the UI labels them as simulations throughout. But
when credentials are configured, the lessons produced by those scenarios are
written to Walrus Mainnet through the real SDK, and the returned blob ids are
real.

**The application reports its own configuration truthfully.** When the Walrus
Memory credentials are absent — as they are in a fresh clone — the app does not
pretend. It runs on the SDK's in-process mock, stamps every write
`provenance: simulated`, and states plainly in the UI that those writes are not
stored on Walrus Mainnet and do not count toward the requirement.

With credentials configured, the app reports two numbers side by side, because
conflating them would be dishonest in one direction or the other:

- **Completed Mainnet writes** reads this instance's own ledger. It counts only
  writes that reached a blob id and were confirmed retrievable by recall. On a
  fresh deployment this is zero, because the ledger is empty.
- **Memories in namespace** is the count the relayer itself reports for the
  namespace, read from the same signed call that proves the credentials work. It
  does not reset when the index is rebuilt.

A single counter cannot be honest about both "what did this process do" and
"what is actually on chain". So there are two.

**The evaluation metrics describe the scenarios, not production.** They are
computed over eight reproducible scenarios. I have not measured production
reliability, and I do not claim to have improved it.

**No figure is fabricated.** No transaction hash, no successful blockchain read,
no Mainnet write confirmation, no test result, no performance improvement. Where
a value is unavailable, the app says unavailable.

The seed script enforces this. `npm run seed` runs the scenarios and reports the
true Mainnet write count, exits non-zero when fewer than ten completed writes
exist, and never counts a simulated write toward the total.

## What I learned building it

Three things, in order of how much they changed the design.

**1. The distinction between "the operation failed" and "I could not check"
is the whole product.** My first instinct was a boolean: did it work? Building
the Tatum adapter forced the five-state model, because a timeout and a failed
transaction are genuinely different facts and conflating them is how an agent
ends up confidently wrong. Every design decision downstream — the diagnosis, the
decision engine, the metrics — depends on getting this right at the adapter
layer.

**2. Memory must not be able to override evidence.** The tempting design is to
let a recalled lesson raise confidence. That is backwards. Memory is a prior,
not a proof. The property I ended up enforcing — a recalled lesson can escalate
an `UNKNOWN` to `REQUIRE_VERIFICATION`, but can never turn `UNKNOWN` into
success — is the difference between a system that learns and a system that
hallucinates with more confidence over time.

**3. A lesson should be storable before it is enforceable.** The brief's
distinction between an observed incident, an evidence-backed diagnosis, a
proposed lesson, and an active safeguard looked like ceremony until I
implemented it. Then it became the thing that stops the system from learning a
broad rule from one unrelated incident. A lesson is written to memory the moment
it is diagnosed; a rule is enforced only after validation.

## What is not finished

- The live finance cases require a Tatum API key. Without one, the finance
  demonstration resolves to `UNKNOWN`, which is the honest answer. The adapter
  is wired and its transport is verified against the gateway; only the
  credential is missing.
- The coding and workflow harnesses are controlled demonstrations, not
  general-purpose platforms. That is by design — the brief's non-goals are
  explicit about it.

What *is* finished, and was verified against the real services rather than
asserted:

- The Walrus Memory account and delegate key were created by the account owner
  in the playground, as the brief requires — the application cannot and should
  not create them. With the delegate key configured, the Mainnet relayer
  authenticates the credentials, the scenarios write genuine memories, each
  write is awaited to a blob id, and a recall query returns the records back.
  The relayer reports the true namespace total, which the UI shows separately
  from this instance's own ledger.

## Try it

```bash
npm install
cp .env.example .env.local   # add credentials
npm run dev                  # http://localhost:12000
```

Open the Overview, press **Run demonstrations**, and read the Incident Explorer.
Every incident shows the claim, the evidence, the diagnosis, and the decision —
in that order, because that is the order in which the truth becomes available.

---

*This post was written by an AI agent (OpenHands) on behalf of the project
owner. The measurements above were produced by running the application's own
test suite and scenario runner; the simulated-versus-live distinction is
enforced in code, not just described here.*
