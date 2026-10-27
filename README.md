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
- Deadline: 10 November 2026, 17:00 UTC

---

## What it actually does

For each attempted action, the engine runs a fixed pipeline:

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
| **Finance** | Reporting a Sui transaction as successful without checking the chain | Tatum Sui Mainnet JSON-RPC (`sui_getTransactionBlock` effects) |
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

---

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in credentials (see below)
npm run dev                  # http://localhost:12000
```

Then open the Overview page and press **Run demonstrations**. That executes the
controlled scenarios and populates the incident timeline, safeguards, memory
ledger, and evaluation metrics.

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
| `MEMWAL_PRIVATE_KEY` | Ed25519 delegate key (hex or `suiprivkey1…`). Server-side only. |
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
| `TATUM_API_KEY` | Tatum API key, sent as the `x-api-key` header. Server-side only. |
| `TATUM_SUI_RPC_URL` | Defaults to `https://sui-mainnet.gateway.tatum.io`. |
| `TATUM_TIMEOUT_MS` | Per-request timeout. Defaults to `12000`. |

### Application

| Variable | Meaning |
| --- | --- |
| `AFTERMATH_DB_PATH` | SQLite file for the incident index and audit history. |
| `AFTERMATH_HARNESS_DIR` | Scratch space for the coding demonstration harness. |

---

## Verifying the integrations

### Tatum Sui JSON-RPC

The adapter uses the documented Tatum Sui Mainnet gateway. The interface was
confirmed against <https://docs.tatum.io/reference/rpc-sui>:

- Base URL: `https://sui-mainnet.gateway.tatum.io`
- Auth header: `x-api-key`
- Methods used: `sui_getChainIdentifier` (health), `sui_getTransactionBlock`
  (verification), `suix_queryTransactionBlocks` (digest discovery)

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
npm run test:e2e    # playwright: browser tests (needs a running server)
```

The suite covers the Tatum adapter's transport-versus-outcome separation, the
live memory adapter's write lifecycle (accepted vs. completed vs. failed), the
rule engine's validation gating, the decision engine's evidence-governs-memory
property, the coding harness wiring, and the full eight-scenario pipeline end to
end.

`npm run test:live` is skipped by default because it contacts real services. It
proves the production code path reaches the Mainnet relayer (unauthenticated
`health`) and that unregistered credentials are refused rather than silently
treated as a successful write. It also confirms that a rejected Tatum key maps
to `UNKNOWN`, never to a failed transaction.

---

## Architecture

```
src/
  app/                    Next.js routes (Overview, Incidents, Safeguards,
                          Memory, Evaluation) and API routes
  components/             Design system and shell
  lib/
    schemas.ts            Zod schemas — the boundary contract
    config.ts             Server-side configuration
    runtime.ts            Server-side singletons (all secrets live here)
    adapters/
      evidence.ts         Evidence adapter interface
      tatum-sui.ts        Tatum Sui JSON-RPC (read-only)
      finance-evidence.ts Finance domain adapter
      coding-harness.ts   Real `node --test` harness
      coding-evidence.ts  Coding domain adapter
      workflow-state.ts   Persisted workflow state
      workflow-evidence.ts Workflow domain adapter
      memory.ts           Memory adapter interface
      memwal-memory.ts    Walrus Memory (MemWal SDK)
      simulated-memory.ts Simulated backend (SDK mock, clearly labelled)
    engines/
      pipeline.ts         The seven-stage pipeline
      diagnosis.ts        Deterministic failure diagnosis
      rule-engine.ts      Corrective rule lifecycle
      decision-engine.ts  Safeguard decision engine
      evaluation.ts       Honest metric computation
    db/store.ts           SQLite incident index and audit history
    demos/                The eight controlled scenarios
```

## Known limitations

- The coding and workflow demonstrations are controlled harnesses, not a
  general-purpose coding or automation platform. They are labelled as such in
  the UI.
- The finance demonstration cannot run without a Tatum API key. It reports
  `UNKNOWN` rather than guessing.
- The evaluation metrics are measured over the eight controlled scenarios. They
  describe those scenarios; they are not claims about production reliability.
- The workflow state store is in-process. It is a reproducible harness, not a
  durable queue.
