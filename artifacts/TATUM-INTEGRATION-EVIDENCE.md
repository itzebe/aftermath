# AFTERMATH — Tatum Integration Evidence

*Independently audited and verified on 2026-11-04 against production
`https://aftermath-7tij.vercel.app`. Every value below was read from the live
deployment or the live Tatum gateway on that date; no historical figure is
reused without re-verification.*

This document is the evidence companion to
[`TATUM-INTEGRATION-ARCHITECTURE.md`](./TATUM-INTEGRATION-ARCHITECTURE.md),
which explains the design. This file records what was actually observed and how
each claim can be reproduced.

---

## A. Integration architecture

The complete read path for a Sui-backed incident:

| Step | File | Function |
| --- | --- | --- |
| Domain inference (a digest names a source) | `src/lib/engines/investigation.ts` | `inferDomain` |
| Evidence adapter | `src/lib/adapters/finance-evidence.ts` | `FinanceEvidenceAdapter.verifyEvidence` |
| Verifier composition | `src/lib/adapters/sui-verifier.ts` | `CompositeSuiVerifier.verifyTransaction` |
| Primary interface (gRPC) | `src/lib/adapters/tatum-sui-grpc.ts` | `TatumSuiGrpcAdapter.verifyTransaction` |
| Fallback interface (GraphQL) | `src/lib/adapters/tatum-sui-graphql.ts` | `TatumSuiGraphqlAdapter.verifyTransaction` |
| Rate-limit retry | `src/lib/adapters/tatum-retry.ts` | `withRateLimitRetry` |
| Network identity guard | `src/lib/adapters/sui-network.ts` | `isSuiMainnet` |
| Verdict consumption | `src/lib/engines/decision-engine.ts` | `decide` |
| Wiring | `src/lib/runtime.ts` | `build` → `resolveSubmissionEvidence` |
| Verifier construction | `src/lib/demos/finance.ts` | `buildSuiVerifier` |

Data flow:

```
submission (Sui digest) → inferDomain → finance domain
   → FinanceEvidenceAdapter → CompositeSuiVerifier
        ├─ primary  TatumSuiGrpcAdapter    sui.rpc.v2.LedgerService/GetTransaction
        └─ fallback TatumSuiGraphqlAdapter transactionEffects
   → EvidenceAssessment{status, verified, evidenceType, raw}
   → decision-engine: VERIFIED_SUCCESS→ALLOW / VERIFIED_FAILURE→BLOCK / UNKNOWN→REQUIRE_VERIFICATION
   → SafeguardRecord (served to the user, with the source interface named)
```

---

## B. Mainnet configuration

Read from `GET /api/config` (redacted for serving):

```json
{
  "grpcUrl": "https://sui-mainnet-grpc.gateway.tatum.io",
  "rpcUrl": "https://sui-mainnet.gateway.tatum.io",
  "interface": "Tatum Sui Mainnet gRPC (primary; fallback: Tatum Sui Mainnet GraphQL)",
  "apiKey": "(51 chars, hidden)",
  "configured": true
}
```

The API key is a server-side Vercel environment variable (`TATUM_API_KEY`). It is
never served: the config endpoint reports only its length. It is sent as gRPC
metadata (`x-api-key`) and as a GraphQL header, and it is redacted from every
error message surfaced to a caller.

---

## C. Live verification

**Timestamp:** 2026-11-04T20:32Z.

### C.1 Health (`GET /api/overview` → `tatumHealth`)

```json
{
  "ok": true,
  "detail": "Tatum Sui Mainnet gRPC reachable and authenticated (chain mainnet).",
  "chainIdentifier": "4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S"
}
```

The `chainIdentifier` is the live Sui Mainnet identifier. As of this audit the
adapters **assert** it (see §E): a gateway on any other network now fails the
health check instead of reporting healthy.

### C.2 Live on-chain lookup, end to end, through the public endpoint

An anonymous `POST /api/incidents/submit` naming a real failed Sui Mainnet
digest was investigated by production:

```
recordId      76272b29-b49d-ca39-f174-44ffab4143a8
evidenceStatus VERIFIED_FAILURE (verified: true)
source        Tatum Sui Mainnet gRPC (primary; fallback: Tatum Sui Mainnet GraphQL)
decision      BLOCK
reason        Authoritative evidence proves the operation failed, so a success
              claim must not be made.
```

This is the deterministic record id for the submission text, so the request is
idempotent and created no additional Mainnet write.

### C.3 Independent cross-check (outside the application, no key)

The same digests were queried directly against Tatum's public Sui Mainnet
GraphQL gateway, from the shell, with no application code and no API key:

| Digest | Independent `transactionEffects.status` | App's recorded verdict |
| --- | --- | --- |
| `GHAuBeydSov1zyT6sUKS2cFxWtNWkeamtKANsHwZJHve` | `SUCCESS` | `VERIFIED_SUCCESS` → **ALLOW** |
| `A9iiTMAxi5BY2uwxu4HnuonfF6A4hhGbaCK8HfTFK26x` | `FAILURE` | `VERIFIED_FAILURE` → **BLOCK** |
| `9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM` | `null` (not held) | `UNKNOWN` → **REQUIRE_VERIFICATION** |

The independent ledger state matches every verdict the application recorded.

---

## D. Product relevance

Tatum is the **only** evidence source in AFTERMATH that can turn a claimed
transaction outcome into a `VERIFIED_SUCCESS` or `VERIFIED_FAILURE`. The
finance-domain evidence adapter is bound to the Tatum-backed verifier, and the
decision engine keys its verdict directly off the assessment status
(`src/lib/engines/decision-engine.ts`):

- `VERIFIED_SUCCESS` → `ALLOW` — a success claim may stand.
- `VERIFIED_FAILURE` → `BLOCK` — a success claim contradicted by the ledger is refused.
- `UNKNOWN` (transport failure, not found, malformed) → `REQUIRE_VERIFICATION` —
  never converted into a fabricated outcome.

The counterfactual in C.2/C.3 is the proof: the *same class of submission* — an
agent claiming a Sui transaction succeeded — is allowed when the chain confirms
success and blocked when the chain reports failure. The verdict is a function of
Tatum's answer, not of the agent's claim. Remove Tatum and the failure case
cannot exist; the success claim becomes unsupported.

The interface that answered is named on the served record
(`investigation.authoritativeLookup.source`), so a reader never has to take the
integration on faith.

---

## E. Reliability

- **Timeouts.** Every lookup is bounded (`TATUM_TIMEOUT_MS`, default 12 s) via
  `AbortController` (HTTP) or the gRPC channel deadline.
- **Retries.** Only a rate-limit response (`HTTP 429` / gRPC
  `RESOURCE_EXHAUSTED`) is retried, with exponential backoff honouring
  `Retry-After`. A retry is safe because the request is read-only and a rate
  limit is "no answer yet", never a transaction outcome.
- **Fallback.** `CompositeSuiVerifier` tries gRPC first and falls back to GraphQL
  **only** when the primary could not answer at all (`transportOk: false`). A
  definitive answer — success, failure, or not-found — is returned immediately,
  so a digest is never queried twice when the first interface already answered.
- **Network identity (added this audit).** `src/lib/adapters/sui-network.ts`
  defines `SUI_MAINNET_CHAIN_IDENTIFIER` and `isSuiMainnet`. Both health checks
  now fail closed when the gateway's `chainIdentifier` is not Sui Mainnet's, so
  a misconfigured URL (a testnet host, a bad environment variable) can no longer
  report healthy while verifying against the wrong chain.
- **Transport ≠ outcome.** A transport failure, an auth failure, or a missing
  transaction all resolve to `UNKNOWN`. No infrastructure problem can manufacture
  a `VERIFIED_FAILURE` (or a `VERIFIED_SUCCESS`).

---

## F. Security

- **Server-side only.** `TATUM_API_KEY` is read in `src/lib/config.ts` and never
  sent to the browser.
- **Redaction.** Error messages pass through `src/lib/util/redact.ts`; a health
  failure detail never contains the key (test:
  `does not leak the api key in a health failure detail`).
- **Read-only.** Only `GetTransaction`, `ListTransactions`, and `getServiceInfo`
  are called. There is no broadcast path and no signing key.
- **Fail-closed.** With no key, the adapters refuse to make an unauthenticated
  request and report `UNKNOWN` with an explicit infrastructure reason.

---

## G. Tests

All of the following are **mocked** unit tests (deterministic, offline) unless
marked live.

| File | Coverage |
| --- | --- |
| `tests/tatum-network-identity.test.ts` | **New.** Mainnet identifier accepted; testnet/empty/undefined rejected; both adapters fail closed on a non-Mainnet chain. |
| `tests/tatum-grpc-adapter.test.ts` | Success/failure classification; transport failure never becomes failure; not-found; malformed; auth; health; discovery; `classifyError`; `CompositeSuiVerifier` fallback semantics; `toGrpcHost`. |
| `tests/tatum-graphql-adapter.test.ts` | Success/failure; not-found; unrecognised status; timeout; 5xx; auth rejection; credential hygiene; health; discovery. |
| `tests/tatum-adapter.test.ts` | Legacy JSON-RPC contract + `FinanceEvidenceAdapter` (no digest, no key, client-supplied success is not evidence). |
| `tests/tatum-retry.test.ts` | 429/RESOURCE_EXHAUSTED retried; other failures not; `Retry-After` handling. |
| `tests/live-smoke.test.ts` | **Live (opt-in, `AFTERMATH_LIVE_SMOKE=1`).** Authenticated gRPC and GraphQL reads against the real gateway; now assert the live chain identifier is Sui Mainnet. |

Mocked tests are **not** presented as live evidence. The live evidence is C.1–C.3.

---

## H. Limitations

- **Tatum AI Builder is not used.** The optional AI Builder track is not part of
  AFTERMATH. The AI-assisted reading is an *additive* second opinion on Groq's
  free tier and never feeds the deterministic verdict. Stated plainly.
- **The legacy JSON-RPC adapter is not wired.** It remains for reference; the
  runtime builds the gRPC + GraphQL composite.
- **The key is not readable by the auditor.** `TATUM_API_KEY` is a sensitive
  Vercel variable and cannot be decrypted through the Vercel API. Its presence is
  confirmed indirectly through the application's reported health, which requires
  the key to have been accepted by the gateway.
- **Rate limits are real.** The gateway throttles rapid lookups; the retry
  adapter backs off so a burst is a retryable condition, not a wrong verdict.
- **`rpcUrl` is retained in config but unused at runtime.** It is kept so the
  redacted config still names the host a reader may recognise; the runtime never
  calls it.
