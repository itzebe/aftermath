# AFTERMATH

**Every failure should leave a safeguard.**

AFTERMATH is an evidence-based failure-prevention engine for AI agents. It turns
verified execution incidents into scoped corrective rules, preserves the useful
lesson through Walrus Memory, and applies the relevant safeguard to later
actions.

An agent saying "it worked" is a claim. AFTERMATH asks a different question:
what does the authoritative source actually say, and what should happen next
time this pattern appears?

- Hackathon: **Total Recall** (Tatum × Walrus)
- Primary track: **Smart Agents for Real Life**
- Deadline: 10 November 2026, 17:00 UTC
- Published article (Medium): [AFTERMATH — Every failure should leave a safeguard](https://medium.com/@jonathanebi05/aftermath-every-failure-should-leave-a-safeguard-25446fdbcd71)
- Rendered article (GitHub Pages): <https://itzebe.github.io/aftermath/>
- Article source: [`docs/BLOG.md`](docs/BLOG.md)

---

## Technical Blog

The write-up of AFTERMATH is published externally on Medium:

**[AFTERMATH — Every failure should leave a safeguard](https://medium.com/@jonathanebi05/aftermath-every-failure-should-leave-a-safeguard-25446fdbcd71)**

The article covers the problem AFTERMATH addresses, the design principle that
shaped it (*a claim is not evidence*), how the seven-stage pipeline works, the
Walrus Memory and Tatum Sui integrations, the evaluation results, and the
lessons learned while building it — including what is deliberately not finished.
It is published externally (Medium), and the same text is versioned in this
repository as [`docs/BLOG.md`](docs/BLOG.md), which is the canonical source.

The repository also renders that source to a static page on GitHub Pages:
<https://itzebe.github.io/aftermath/>. Both links point at the same article;
Medium is the externally published copy, and GitHub Pages is the
repository-owned mirror. See [Publishing the blog](#publishing-the-blog) for how
the static page is built and deployed.

---

## What it actually does

The front door is an incident submission. Paste real failure material — an
error, a stack trace, a log excerpt, a failed request — and AFTERMATH returns a
**Safeguard Record**: a single connected artifact that runs from the incident to
the safeguard, with honest state labels at every link.

```
Incident -> Evidence -> Hypothesis -> Safeguard -> Verification -> Memory
```

- **Incident** — the submitted text, treated strictly as data: parsed with
  regular expressions, never executed, credential-shaped strings redacted before
  storage.
- **Evidence** — observed facts (each with its verbatim span), confirmed facts,
  hypotheses, unknowns, and next checks, kept strictly separate. A submission is
  material, not proof, so with no connected source the assessment is `UNKNOWN`.
  A Sui digest, if present, is looked up read-only through Tatum and folded in.
- **Hypothesis** — a deterministic, rule-based diagnosis with a confidence. A
  rate limit or timeout *on its own* is classified as `evidence_unavailable`,
  never a failure; but a named mechanism (such as database connection-pool
  exhaustion) outranks the transport symptom, so a pool incident is diagnosed
  as `connection_pool_exhaustion` and reasoned from its own measurements.
- **Safeguard** — a specific, testable recommendation: rule statement, failure
  mode, supporting evidence, assumptions, test plan, success criteria. The
  recommendation is pattern-specific — a pool incident yields a control that
  instruments acquisition and release, with measurable success criteria — not a
  generic "require verification". Validated through the shared rule engine; a
  single submission's rule is `proposed`, never `active`.
- **Verification** — the decision engine is executed twice (baseline vs.
  safeguarded) and both decisions are recorded. The state is `test_executed`,
  never `verified`: one incident cannot prove a repeat was prevented.
- **Memory** — the incident and lesson are written through the Walrus Memory
  adapter with content-hash idempotency keys; recall is reported separately from
  storage, and recalled records are labelled by documented criteria: confirmed
  recurrence, candidate pattern match (recurrence *not* established), or
  possible similarity. The similarity distance is shown as a ranking, not a
  probability.

### AI-assisted reading (additive, free tier only)

The deterministic parse is always what produces the record. Alongside it, when a
free provider is configured, an **AI-assisted reading** is attached — clearly
labelled and strictly additive. It reads unfamiliar material (a distributed
request sequence, an unfamiliar stack trace) and proposes candidate mechanisms,
missing evidence, and investigations to pursue.

It cannot decide anything. The model never sets the evidence status, the
diagnosis, the decision, or the verification state; those remain the
deterministic engine's, and the model has no database, shell, wallet, or
transaction capability. Every fact or measurement it proposes is **grounded
claim-by-claim against the submitted material** before it is kept: the cited
span must appear verbatim in the submission, and the value it names must appear
in that span. Anything that fails grounding is listed under *rejected by
grounding* rather than shown as evidence. Instruction-like text in the material
(for example, "ignore previous instructions") is detected and reported, and is
never obeyed.

The record states honestly whether a model ran and, if not, why
(`not_configured`, `unavailable`, `rate_limited`, `timeout`,
`invalid_response`, `grounding_failed`). `extractionMethod` is `model` only when
the model genuinely ran *and* contributed at least one grounded finding;
otherwise it stays `rule-based`. **No paid provider or model is reachable from
the application** — only the Groq free tier, on a fixed model
(`openai/gpt-oss-120b`), is wired.

Underneath, the same seven-stage engine the product was built on still runs:

1. **Incident intake** — a structured record of the attempt, validated with Zod
   at the boundary. A client-supplied "success" is a *claim*, never evidence.
2. **Evidence verification** — a domain adapter queries the authoritative source
   and returns one of `VERIFIED_SUCCESS`, `VERIFIED_FAILURE`, `PENDING`,
   `UNKNOWN`, or `CONFLICTING`. This is produced by an adapter, never by a
   language model.
3. **Failure diagnosis** — a deterministic hypothesis derived from the observed
   facts. A diagnosis is not evidence and does not enforce anything.
4. **Corrective rule engine** — turns a validated lesson into an explicit,
   scoped rule with required evidence and an action. Rules are proposed first
   and only enforced once their validation status is `active`.
5. **Walrus Memory adapter** — persists incidents and lessons, waits for the
   write job to complete, records the returned blob id, and confirms the record
   is retrievable by recall.
6. **Safeguard decision engine** — a deterministic decision: `ALLOW`, `BLOCK`,
   `REQUIRE_VERIFICATION`, or `UNKNOWN`, with a full decision trace.
7. **Learning evaluation** — measures whether the safeguards actually changed
   the outcome, over reproducible scenarios.

## The three demonstrations

| Domain | Failure prevented | Authoritative evidence |
| --- | --- | --- |
| **Finance** | Reporting a Sui transaction as successful without checking the chain | Tatum Sui Mainnet gRPC (primary), GraphQL fallback (transaction execution status) |
| **Coding** | Reporting a bug fixed without running the tests | The real `node --test` process: exit code and pass/fail counts |
| **Workflow** | Repeating an operation whose prerequisite was never met | Persisted application state and prerequisite checks |

The finance demonstration is **read-only**. No transaction is ever broadcast and
no wallet key or seed phrase is ever requested.

## Honest state

The application reports its own configuration truthfully. When Walrus Memory
credentials are absent it says so, labels every write `simulated`, and states
that those writes are **not** stored on Walrus Mainnet and do **not** count
toward the requirement. The dashboard shows `Mainnet writes completed: N / 10`
and never pads the number.

With credentials present, the writes are real. The Lab and Memory pages
report two numbers separately, because they mean different things:

- **Completed Mainnet writes** — writes submitted through this deployment's
  audit index, awaited to a blob id, and confirmed retrievable by recall. The
  ledger is durable when `DATABASE_URL` is set (shared across instances and
  surviving redeploys); without it the ledger is a per-instance SQLite file and
  a fresh deployment starts at zero. The Lab page states which of the two
  is in effect.
- **Memories in namespace** — the authoritative count the relayer reports for
  the configured namespace. This comes from the same signed `listNamespaces`
  call that proves authentication, so it is independent of the local ledger and
  does not reset when the index is rebuilt.

Reporting both is deliberate. A deployment that has lost its ledger should not
claim zero memories exist on chain, and a local counter should not be mistaken
for the on-chain total.

---

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in credentials (see below)
npm run dev                  # http://localhost:12000
```

Then open the **Evaluation Lab** (`/lab`) and press **Run from scratch** (or
**Resume / continue** to pick up an unfinished run). That executes the controlled
scenarios and populates the incident timeline, safeguards, memory ledger, and
evaluation metrics. Because each scenario performs real Walrus Mainnet writes, the run
advances in bounded batches across several requests; the page reports progress
until the job completes.

### Durable audit index (required on Vercel)

On a serverless host the deployment bundle is read-only and each request may run
in a different instance, so a file-backed index cannot be shared. Set
`DATABASE_URL` to a PostgreSQL connection string (Neon, Supabase, RDS, or any
Postgres) to store the incident index in a shared database. Without it the app
still runs, but it uses a per-instance SQLite file and the Lab page reports
the index as **per-instance · not shared**. The store never silently substitutes
one for the other: if `DATABASE_URL` is set but unreachable, requests fail with
an explicit `503` rather than reporting success against a fallback.

```bash
# Example (Neon). Any Postgres connection string works.
DATABASE_URL="postgresql://user:password@ep-xxx.region.aws.neon.tech/aftermath?sslmode=require"
```

### Deploying to Vercel

The production deployment needs four environment variables set in
**Vercel → Project → Settings → Environment Variables** (all environments), then
a redeploy. All four are server-only; none is prefixed with `NEXT_PUBLIC_`, so
none reaches the browser.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Durable audit index. Without it the deployment reports `per-instance · not shared`. |
| `MEMWAL_ACCOUNT_ID` | Walrus Memory `MemWalAccount` object id (Mainnet). |
| `MEMWAL_PRIVATE_KEY` | Delegate private key for that account. Revocable on-chain. |
| `TATUM_API_KEY` | Tatum Sui gateway key for on-chain evidence. |

`MEMWAL_SERVER_URL` and `MEMWAL_NAMESPACE` are optional; they default to the
Mainnet relayer and the `aftermath` namespace. After the redeploy, run
`npm run verify:prod -- --url <deployment>` to confirm the live state.

The GitHub Pages site hosts only the static blog. The application itself runs on
Vercel, because it has API routes and server-side secrets that a static export
cannot support.

### Verify the ten-Mainnet-memory requirement

```bash
npm run seed              # run scenarios, then report the true Mainnet write count
npm run seed -- --check   # report only, without re-running scenarios
```

The seed script exits non-zero when fewer than ten completed Mainnet writes
exist. It never fabricates a write and never counts a simulated one.

### Setting up Walrus Memory credentials

`npm run keygen` generates a delegate keypair locally using the SDK's
documented `generateDelegateKey()` helper and prints the private key and public
key. It touches no network.

The rest of the setup requires the account owner's Sui wallet, so it is a
user-controlled action the application deliberately does not perform:

1. Open <https://memory.walrus.xyz> and connect your Sui wallet.
2. Create a `MemWalAccount`. This is an on-chain transaction.
3. Add the public key from `npm run keygen` as a delegate key.
4. Put the account object ID in `.env.local` as `MEMWAL_ACCOUNT_ID` and the
   generated private key as `MEMWAL_PRIVATE_KEY`.
5. Run `npm run seed`.

AFTERMATH never asks for, receives, or stores an owner wallet key or seed
phrase. Only the delegate key — which can be revoked on-chain — is used.

---

## Configuration

All secrets are server-side only. None are exposed to the browser, logged, or
committed. See `.env.example` for the full list.

### Walrus Memory (required for Mainnet writes)

| Variable | Meaning |
| --- | --- |
| `MEMWAL_PRIVATE_KEY` | Ed25519 delegate key (hex or `suiprivkey1…`). Server-side only. `MEMWAL_KEY` is accepted as an alias. |
| `MEMWAL_ACCOUNT_ID` | `MemWalAccount` object id on Sui mainnet. |
| `MEMWAL_SERVER_URL` | Relayer URL. Defaults to the **Mainnet** relayer. |
| `MEMWAL_NAMESPACE` | Memory namespace. Defaults to `aftermath`. |
| `AFTERMATH_FORCE_MOCK_MEMORY` | Set to `1` to force the simulated backend. |

The account and delegate key are created in the Walrus Memory playground:
<https://memory.walrus.xyz>. This is a user-controlled action; the application
cannot create the account for you.

### Tatum Sui RPC (required for live finance evidence)

| Variable | Meaning |
| --- | --- |
| `TATUM_API_KEY` | Tatum API key, sent as `x-api-key` (gRPC metadata) and `x-api-key` (GraphQL). Server-side only. |
| `TATUM_SUI_GRPC_URL` | Primary interface. Defaults to `https://sui-mainnet-grpc.gateway.tatum.io`. |
| `TATUM_SUI_RPC_URL` | Legacy JSON-RPC URL; no longer served by Tatum. Defaults to `https://sui-mainnet.gateway.tatum.io`. |
| `TATUM_SUI_GRAPHQL_URL` | Fallback interface. Defaults to `https://sui-mainnet.gateway.tatum.io/graphql`. |
| `TATUM_TIMEOUT_MS` | Per-request timeout. Defaults to `12000`. |

### AI-assisted reading (optional, free tier only)

| Variable | Meaning |
| --- | --- |
| `GROQ_API_KEY` | Groq API key (free tier). Server-side only. When unset, the record runs deterministic-only and says so. |
| `AFTERMATH_AI_TIMEOUT_MS` | Per-request ceiling for an AI reading. Defaults to `20000`. |
| `AFTERMATH_AI_VERIFY_TOKEN` | Bearer token for the read-only `POST /api/ai/verify` endpoint. When unset the endpoint is disabled (fails closed) and returns `503`. |
| `AFTERMATH_AI_VERIFY_MAX` | Requests allowed per caller per window on the verify endpoint. Defaults to `5`. |
| `AFTERMATH_AI_VERIFY_WINDOW_MS` | Length of the verify endpoint's rate-limit window. Defaults to `60000`. |

Only the Groq free tier is recognised, on the fixed model
`openai/gpt-oss-120b`. A key for any other provider is ignored rather than used,
so the deployment cannot fall onto a paid model by surprise.

#### Verifying a live deployment actually runs the model

`POST /api/ai/verify` is a narrowly scoped, read-only endpoint that proves a
deployment's configured provider really runs, and returns the *grounded*
result — without submitting an incident, creating a Walrus Memory, or touching
the audit index. It holds no store, memory adapter, or runtime, so it has
nothing it could persist with; its only effect is one model call.

It reuses the production inference path and validation (the same client,
grounding gate, timeout, redaction, and `IncidentSubmissionSchema`), and reports
the authoritative signal `inference.ran` alongside the validated `AiAnalysis`.

It is disabled unless `AFTERMATH_AI_VERIFY_TOKEN` is set, and it fails closed:
with no token it returns `503` rather than becoming a public inference endpoint.
Requests must send `Authorization: Bearer <token>`; a wrong or missing token is
`401`, and a caller past `AFTERMATH_AI_VERIFY_MAX` requests per window is `429`.

```bash
curl -sS -X POST "$AFTERMATH_PROD_URL/api/ai/verify" \
  -H "Authorization: Bearer $AFTERMATH_AI_VERIFY_TOKEN" \
  -H "content-type: application/json" \
  -d '{"text":"2026-03-01T10:00:00Z payment-api POST /v1/charge\nHTTP 500\nERROR: Connection pool exhausted\nActive connections: 50"}'
```

`inference.ran: true` means a model ran and at least one claim survived
grounding. Any other value (`not_configured`, `unavailable`, `rate_limited`,
`timeout`, `invalid_response`, `grounding_failed`) means it did not, and the
response says which.

### Application

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string for the durable audit index. When set, incidents, rules, and memory-write records are stored in a shared database and survive across serverless instances. `POSTGRES_URL` and `AFTERMATH_DATABASE_URL` are accepted as aliases. |
| `AFTERMATH_DB_PATH` | SQLite file for the incident index. Used only when `DATABASE_URL` is unset. On a read-only host this falls back to the OS temp directory, which is **not** shared between instances. |
| `AFTERMATH_HARNESS_DIR` | Scratch space for the coding demonstration harness. |

---

## Verifying the integrations

### Verify a deployed instance

`npm run verify:prod` checks a live deployment end to end and reports honestly.
It is read-only by default — it makes no Walrus write and touches no credential —
and it exits non-zero when any property fails, so it can gate a release.

```bash
npm run verify:prod                                  # verify the default URL
npm run verify:prod -- --url https://your-app.vercel.app
npm run verify:prod -- --run                         # also trigger the scenario
                                                     # run (real Mainnet writes)
```

It asserts that every page and API route responds, that the audit index is
durable, that Walrus Memory is live **and** on Mainnet with accepted
credentials, that the Tatum Sui adapter is configured and healthy, that at least
ten completed and recall-verified Mainnet writes exist, and that a recall query
actually returns stored memories. Each check reads the deployment's own reported
state; nothing is assumed. The decision logic is a pure function
(`assessOverview`) covered by `tests/production-verifier.test.ts`, so the rules
that make a check fail cannot silently weaken.

### Tatum Sui verification (gRPC primary, GraphQL fallback)

Sui Foundation has disabled JSON-RPC on Mainnet full nodes and documents gRPC as
the supported replacement. Tatum's own Sui documentation carries a
JSON-RPC-to-gRPC migration guide with the same message. The finance adapter
therefore uses gRPC as the primary interface and keeps a GraphQL fallback for
when gRPC cannot complete a lookup. Tatum's gateway host
(`https://sui-mainnet.gateway.tatum.io`) no longer serves JSON-RPC — `POST /`
returns HTTP 404 — and now exposes GraphQL at `/graphql` on that same host.

Primary interface (gRPC), confirmed against <https://docs.tatum.io/reference/rpc-sui>:

- Base URL: `https://sui-mainnet-grpc.gateway.tatum.io`
- Auth: the API key as gRPC metadata (`x-api-key`)
- Transport: the official `@mysten/sui/grpc` client over a native gRPC channel
  (`@protobuf-ts/grpc-transport` + `@grpc/grpc-js`). Native gRPC is required
  because Tatum's gateway answers with `content-type: application/grpc`, which
  the gRPC-web transport rejects. No proto files are vendored or generated.
- Methods used: `ledgerService.getServiceInfo` (health),
  `getTransaction` (verification), `listTransactions` (digest discovery)

Fallback interface (GraphQL), same host:

- Base URL: `https://sui-mainnet.gateway.tatum.io/graphql`
- Auth header: `x-api-key`
- Operations used: the `transactionEffects(digest:)` query for verification and
  a recent-transactions query for digest discovery

The composite verifier prefers gRPC and falls back **only** when the gRPC
request could not complete at all (timeout, network, auth, or server error). A
definitive answer — success, failure, or "the node holds no such transaction" —
is returned immediately, so a digest is never queried twice when the first
interface already answered. The interface that produced each assessment is
recorded in `evidenceType` (`tatum_sui_grpc` or `tatum_sui_graphql`), so the UI
and audit trail never claim gRPC evidence that actually came from GraphQL.

The adapter's contract:

- A transport failure (timeout, network, auth, bad JSON) → `UNKNOWN`. It is
  **never** reported as a transaction failure.
- Effects reporting `success` → `VERIFIED_SUCCESS`.
- Effects reporting `failure` → `VERIFIED_FAILURE`.
- A null result (not found, or not yet indexed) → `UNKNOWN`.

No transaction digest is hardcoded. Digests are discovered from the live ledger
and classified by their own authoritative effects. When no key is configured,
the finance demonstration resolves to `UNKNOWN` — which is the correct answer,
not a fabricated one.

### Walrus Memory

The adapter uses the official `@mysten-incubation/memwal` SDK. The interface was
confirmed against the installed package's type definitions:

- `MemWal.create({ key, accountId, serverUrl, namespace })`
- `remember(text, { idempotencyKey })` → `RememberAcceptedResult { job_id, status }`
- `getRememberStatus(jobId)` → one-shot job state
- `waitForRememberJob(jobId)` → `RememberResult { blob_id, owner, namespace }`
- `recall({ query, limit, namespace, sort })` → `RecallResult { results[] }`

The adapter distinguishes an **accepted** write from a **completed** write:

1. `remember` returns as soon as the relayer accepts the job.
2. A status read records a genuine `processing` state.
3. `waitForRememberJob` is awaited for the terminal result and blob id.
4. A recall query confirms the record is retrievable.

A write only counts as complete once step 3 returns a blob id, and only counts
as verified once step 4 returns it back.

---

## Tests

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest: unit + integration
npm run test:live   # opt-in smoke tests against the real relayer and gateway
npm run test:e2e    # playwright: browser tests (auto-starts a mock-backend server on 12001)
```

The suite covers the Tatum adapters' transport-versus-outcome separation, the
composite verifier's gRPC-first/fallback-only-when-incomplete behaviour, the
live memory adapter's write lifecycle (accepted vs. completed vs. failed), the
rule engine's validation gating, the decision engine's evidence-governs-memory
property, the coding harness wiring, and the full eight-scenario pipeline end to
end.

The AI-assisted reading is tested at three levels, all hermetic (no network, no
free-tier quota spent):

- `groq-client.test.ts` — the transport boundary, with a stub `fetch`: success,
  strict `json_schema` request shape, `429`→rate-limited with `retry-after`,
  `5xx`→unavailable, network throw, abort→timeout, empty completion→invalid.
- `ai-investigation.test.ts` — grounding: verbatim-span facts kept, fabricated
  spans and fabricated numbers rejected, hypotheses kept but flagged, prompt
  injection detected, credentials redacted before send, and every failure mode
  mapped to an honest `availability`.
- `ai-pipeline.test.ts` — integration: the record is identical with and without
  a model for the deterministic fields (diagnosis, recommendation, verification,
  categories), a **hostile** model response (claiming success, `ALLOW`, and a
  fabricated blob id) cannot change any of them, and a missing provider falls
  back cleanly.

### Durable-store tests

Three suites cover the persistence fix. They need a real PostgreSQL database,
because the property under test — a record committed by one process is visible
to another — cannot be shown with a mock. Provide a connection string in
`AFTERMATH_TEST_DATABASE_URL`; the suites are skipped without it.

```bash
# Start a throwaway Postgres, or use any existing one.
docker run -d --name aft-pg -e POSTGRES_USER=aftermath \
  -e POSTGRES_PASSWORD=aftermath -e POSTGRES_DB=aftermath \
  -p 55432:5432 postgres:16-alpine

export AFTERMATH_TEST_DATABASE_URL="postgres://aftermath:aftermath@localhost:55432/aftermath"
npx vitest run tests/durable-store.test.ts tests/cross-process-durability.test.ts tests/store-failure.test.ts
```

- `durable-store.test.ts` — two stores sharing one database; a write by one is
  read by the other, and the aggregate counts agree.
- `cross-process-durability.test.ts` — spawns the store twice in **separate Node
  processes** with different working directories, different `AFTERMATH_DB_PATH`,
  and different `TMPDIR`, and shows the record still crosses. A negative control
  runs the same pair with the database switched off and asserts the record does
  **not** cross, proving the positive result comes from the database.
- `store-failure.test.ts` — an unreachable database throws instead of reporting
  success, and a configured database is never silently replaced by SQLite.

`npm run test:live` is skipped by default because it contacts real services. It
proves the production code path reaches the Mainnet relayer (unauthenticated
`health`) and that unregistered credentials are refused rather than silently
treated as a successful write. With credentials present it additionally reads
real Mainnet ledger data through the authenticated gateway and produces genuine
successful and unsuccessful evidence cases from on-chain transactions. It also
confirms that a rejected Tatum key — over both gRPC and GraphQL — maps to
`UNKNOWN`, never to a failed transaction.

---

## Architecture

```
src/
  app/                    Next.js routes (Investigate, Records, Lab, Incidents, Safeguards,
                          Memory, Evaluation) and API routes
  components/             Design system and shell
  lib/
    schemas.ts            Zod schemas — the boundary contract
    config.ts             Server-side configuration
    runtime.ts            Server-side singletons (all secrets live here)
    adapters/
      evidence.ts         Evidence adapter interface
      tatum-sui.ts        Tatum Sui JSON-RPC (legacy, read-only, not wired)
      tatum-sui-graphql.ts Tatum Sui GraphQL (fallback, read-only)
      tatum-sui-grpc.ts   Tatum Sui gRPC (primary, read-only)
      tatum-retry.ts      Rate-limit-aware retry shared by both interfaces
      sui-verifier.ts     Composite verifier: gRPC first, GraphQL fallback
      finance-evidence.ts Finance domain adapter
      coding-harness.ts   Real `node --test` harness
      coding-evidence.ts  Coding domain adapter
      workflow-state.ts   Persisted workflow state
      workflow-evidence.ts Workflow domain adapter
      memory.ts           Memory adapter interface
      memwal-memory.ts    Walrus Memory (MemWal SDK)
      simulated-memory.ts Simulated backend (SDK mock, clearly labelled)
      llm.ts              Language-model boundary (provider-agnostic)
      groq-llm.ts         Groq free-tier client (strict JSON schema, fetch)
      model-factory.ts    Client resolution + bounded AI-analysis cache
    engines/
      pipeline.ts         The seven-stage pipeline
      diagnosis.ts        Deterministic failure diagnosis
      rule-engine.ts      Corrective rule lifecycle
      decision-engine.ts  Safeguard decision engine
      evaluation.ts       Honest metric computation
      investigation.ts    Rule-based incident parse (the deterministic core)
      ai-investigation.ts Additive AI reading, grounded claim-by-claim
    db/
      audit-store.ts        Audit index interface + shared count computation
      sqlite-audit-store.ts SQLite implementation (local development, tests)
      postgres-audit-store.ts PostgreSQL implementation (durable, cross-instance)
      store-factory.ts      Selects the engine from DATABASE_URL; no silent fallback
    api/errors.ts           Store-failure handling (never reports success)
    demos/                The eight controlled scenarios
```

## Verified state

As of the last run, against the real services:

- **Walrus Memory Mainnet.** The delegate credentials authenticate against the
  Mainnet relayer (`https://relayer.memory.walrus.xyz`), namespace `aftermath`.
  Completed, recall-verified Mainnet writes are well past the required ten, and
  the relayer reports the namespace's own memory count. A write is counted only
  after `waitForRememberJob` returns a blob id *and* a recall query returns the
  record; the counts shown in the UI are read from that ledger, not asserted
  here. Simulated writes are tracked separately and excluded from the Mainnet
  total.
- **Tatum Sui.** The read-only Sui adapter is wired to the documented gRPC
  primary with a GraphQL fallback, authenticated with a server-side API key.
  Health reports the live chain identifier; finance evidence cases are produced
  from genuine Mainnet transactions (both successful and unsuccessful). No
  transaction is ever broadcast. When evidence is unavailable the case resolves
  to `UNKNOWN` rather than guessing.

## Publishing the blog

The technical blog lives in [`docs/BLOG.md`](docs/BLOG.md). The same article is
published externally on
[Medium](https://medium.com/@jonathanebi05/aftermath-every-failure-should-leave-a-safeguard-25446fdbcd71),
and this repository renders it to a static page on GitHub Pages:
<https://itzebe.github.io/aftermath/>. The Pages page is rendered by
[`.github/workflows/pages.yml`](.github/workflows/pages.yml) from the isolated
package in [`blog/`](blog), which has its own `package.json` and never touches
the application's dependencies or build. It emits a single self-contained HTML file — no JavaScript, no web
fonts, no external images — so it renders identically offline and cannot drift
back into a generic template. Its visual system reuses the application's own
dark console tokens, and its one diagram is the real pipeline, authored as
inline markup rather than a decorative asset.

The Pages site is deployed through the **GitHub Actions** source. The
workflow's own token can deploy but cannot enable Pages, so that setting was
made once by hand in **Settings → Pages → Build and deployment**. Pushes to
`master` that change `docs/BLOG.md`, `blog/**`, or the workflow itself rebuild
and redeploy automatically; the workflow can also be run on demand from the
**Actions** tab (workflow_dispatch). To build and preview locally:

```bash
cd blog
npm ci
npm run build      # writes blog/_site/index.html
```

The build fails rather than shipping a broken page: it re-parses the Markdown
source and the rendered HTML and asserts that headings, tables, code blocks,
list items, and links all survive the conversion, that the article's final line
is present, and that no wrapped prose line is mistaken for a list item.

## Known limitations

- The audit index is durable only when `DATABASE_URL` is set. Without it the
  index is a per-instance SQLite file (temp-backed on a read-only host) and is
  not shared between serverless instances. The Lab page reports which
  mode is active; it is never implied to be durable when it is not.
- The coding and workflow demonstrations are controlled harnesses, not a
  general-purpose coding or automation platform. They are labelled as such in
  the UI.
- The finance demonstration cannot produce a live on-chain verdict without a
  Tatum API key. It reports `UNKNOWN` rather than guessing.
- The AI-assisted reading is optional and free-tier-only. Without `GROQ_API_KEY`
  every record is the deterministic parse and states that no model was
  configured. When configured, the model is a claim generator whose output is
  grounded claim-by-claim against the submitted material before anything is
  kept; it cannot set the evidence status, diagnosis, decision, or verification.
  Whether a model actually ran is reported per record (`aiAnalysis.ran`), never
  inferred.
- The evaluation metrics are measured over the eight controlled scenarios. They
  describe those scenarios; they are not claims about production reliability.
- The workflow state store is durable: it lives in the same database as the
  audit index (PostgreSQL when `DATABASE_URL` is set, otherwise SQLite). It is a
  reproducible harness, not a general-purpose durable queue.
- A full demonstration run makes 16–18 Walrus Mainnet writes, each of which
  waits for the relayer job and then a recall confirmation (~20–30s per write),
  so the whole run takes several minutes. The run is therefore executed as a
  resumable job: one request advances a bounded batch, persists progress after
  every scenario, and the client repeats until the job reaches a terminal
  state. Each request stays well inside the serverless function limit, and a
  run interrupted mid-way (a closed tab, a redeploy) resumes from the durable
  job rather than restarting. The job store is the same durable backend as the
  audit index, so progress is shared across serverless instances. A single
  long-running host still completes the run in one or two passes.
- A transient dependency condition is never recorded as a scenario failure. The
  Walrus Memory relayer enforces a shared hourly rate limit, and a `429` means
  the evidence was *unavailable*, not that the scenario failed. When a scenario
  hits a rate limit, a timeout, or a `5xx`, the runner defers it — returns it to
  `pending` with a `not_before` gate taken from the relayer's own
  `retry_after_seconds` — and ends the batch, so the next request waits rather
  than hammering a dependency that just asked for a pause. Deferred scenarios
  appear in the run detail as *deferred, no verdict reached*, distinct from a
  failure. This is the product's own principle applied to its own
  infrastructure: a transport problem is missing evidence, not a failed action.
