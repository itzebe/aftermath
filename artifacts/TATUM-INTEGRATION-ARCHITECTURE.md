# AFTERMATH — Tatum Sui integration

*Independently audited and verified on 2026-11-03 against production
(`https://aftermath-7tij.vercel.app`).*

This document explains what Tatum actually does inside AFTERMATH, why it is
load-bearing rather than decorative, and how each claim can be reproduced by a
reader.

---

## 1. What Tatum is used for

AFTERMATH investigates a reported operation and decides whether to accept it.
For any operation that touches Sui, the agent's own claim ("the transaction
succeeded") is not evidence — it is the thing under test. The authoritative
question is what the ledger says.

Tatum's Sui Mainnet gateway is the component that answers that question. It is
the **only** evidence source in AFTERMATH that can turn a claimed transaction
outcome into a `VERIFIED_SUCCESS` or a `VERIFIED_FAILURE`. Everything else the
finance path produces — the diagnosis, the decision, the safeguard — is derived
from Tatum's answer.

Concretely, when a submission names a Sui transaction digest:

1. The digest is extracted from the material by rule (base58, 43–44 chars).
2. The submission is routed to the **finance** domain, whose evidence adapter is
   bound to the Tatum-backed verifier.
3. AFTERMATH performs a **read-only** lookup of that digest through Tatum.
4. The ledger's execution status is folded into the record as
   `investigation.authoritativeLookup`, and the decision engine consumes it.

No transaction is ever broadcast. No wallet key is requested. Tatum is used
purely as an authoritative, read-only source of on-chain truth.

---

## 2. Architecture

```
 submission (Sui digest present)
        │
        ▼
 domain inference ─────────────► domain = "finance"
        │
        ▼
 FinanceEvidenceAdapter  (src/lib/adapters/finance-evidence.ts)
        │  verifyEvidence(incident)
        ▼
 CompositeSuiVerifier  (src/lib/adapters/sui-verifier.ts)
        │
        ├── primary  ──► TatumSuiGrpcAdapter      (sui.rpc.v2.LedgerService/GetTransaction)
        │                https://sui-mainnet-grpc.gateway.tatum.io
        │
        └── fallback ──► TatumSuiGraphqlAdapter   (GraphQL transactionEffects)
                         https://sui-mainnet.gateway.tatum.io/graphql
        │
        ▼
 EvidenceAssessment { status, verified, evidenceType, evidenceReference, raw }
        │
        ▼
 diagnosis ─► decision (ALLOW / REQUIRE_VERIFICATION / BLOCK) ─► safeguard
```

The rest of the application depends on the `SuiVerifier` interface, not on a
wire protocol, so the transport can change without touching the pipeline.

### Files

| File | Responsibility |
| --- | --- |
| `src/lib/adapters/tatum-sui-grpc.ts` | Primary interface. `sui.rpc.v2.LedgerService/GetTransaction` over gRPC. |
| `src/lib/adapters/tatum-sui-graphql.ts` | Fallback interface. GraphQL `transactionEffects`. |
| `src/lib/adapters/tatum-sui.ts` | Legacy JSON-RPC adapter and the shared result types. Retained but **not wired** (see §6). |
| `src/lib/adapters/tatum-retry.ts` | Retry with exponential backoff for gateway rate limits (`RESOURCE_EXHAUSTED` / HTTP 429). |
| `src/lib/adapters/sui-network.ts` | Sui Mainnet chain identifier and `isSuiMainnet`, so health fails closed on the wrong network. |
| `src/lib/adapters/sui-verifier.ts` | `SuiVerifier` interface and the `CompositeSuiVerifier` that prefers gRPC and falls back only on transport failure. |
| `src/lib/adapters/finance-evidence.ts` | Domain adapter: digest extraction, then a Tatum lookup; reports `UNKNOWN` (never a fabricated outcome) when no lookup can run. |
| `src/lib/demos/finance.ts` | Builds the verifier from config; live discovery of recent digests. |
| `src/lib/runtime.ts` | Wires the verifier into the runtime the submission pipeline uses. |

---

## 3. Why gRPC, not JSON-RPC

The Sui Foundation disabled JSON-RPC on Mainnet full nodes and documents gRPC as
the supported replacement. Tatum's own Sui documentation reflects this: the
legacy `sui-mainnet.gateway.tatum.io` JSON-RPC interface is no longer served,
and the same host now exposes GraphQL. AFTERMATH therefore treats **gRPC as the
primary interface** and **GraphQL as the fallback**, and keeps the legacy
JSON-RPC adapter only for historical reference.

The fallback is deliberately narrow. It is used **only** when the primary
interface could not answer at all (`transportOk: false` — a timeout, a network
error, an auth failure, or a server error). A definitive answer — success,
failure, or "the node holds no such transaction" — always carries
`transportOk: true` and is returned immediately, so a digest is never queried
twice when the first interface already answered. The interface that produced an
assessment is recorded in `evidenceType` (`tatum_sui_grpc` vs `tatum_sui_graphql`),
so the UI and the audit trail never claim gRPC evidence that actually came from
GraphQL.

---

## 4. Safety properties

- **Read-only.** Only transaction lookups and a health probe are performed. There
  is no broadcast path and no signing key.
- **Transport ≠ outcome.** A transport failure, an auth failure, or a missing
  transaction all resolve to `UNKNOWN`. A lookup can never manufacture a
  `VERIFIED_FAILURE` (or a `VERIFIED_SUCCESS`) out of an infrastructure problem.
- **Credential hygiene.** The API key is sent as gRPC metadata (`x-api-key`) and
  as a GraphQL header; it is masked in any configuration the API serves
  (`(51 chars, hidden)`), and redacted from error messages surfaced to callers.
- **Fail-closed.** With no `TATUM_API_KEY`, the adapter refuses to make an
  unauthenticated request and reports `UNKNOWN` with an explicit infrastructure
  reason. The finance path degrades honestly rather than guessing.
- **Bounded.** Every lookup has a timeout (`TATUM_TIMEOUT_MS`, default 12 s) and
  rate-limit retries back off, so a slow or throttled gateway surfaces as a
  retryable condition, never as a held-open request or a wrong verdict.
- **Network identity.** Both health checks assert the gateway's `chainIdentifier`
  is Sui Mainnet's (`isSuiMainnet` in `src/lib/adapters/sui-network.ts`). A
  gateway that is reachable and authenticated but on another network fails health
  rather than reporting a healthy-but-wrong chain.

---

## 5. Live verification (2026-11-03)

All figures below were read from the live production deployment on 2026-11-03
and are reproduced in `artifacts/evidence/2026-11-03-tatum-integration.json`.

### Health

`GET /api/overview` reported:

```json
{
  "tatumHealth": {
    "ok": true,
    "detail": "Tatum Sui Mainnet gRPC reachable and authenticated (chain mainnet).",
    "chainIdentifier": "4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S"
  }
}
```

### Behaviour change, proved by counterfactual

The same class of submission — an agent claiming a Sui transaction succeeded —
was submitted four times through the **anonymous** public endpoint. The only
variable was the digest, and therefore Tatum's answer:

| Digest | Tatum reports | Record | Decision |
| --- | --- | --- | --- |
| `GHAuBeydSov1zyT6sUKS2cFxWtNWkeamtKANsHwZJHve` | `VERIFIED_SUCCESS` | `8f12d8ec…` | **ALLOW** |
| `A9iiTMAxi5BY2uwxu4HnuonfF6A4hhGbaCK8HfTFK26x` | `VERIFIED_FAILURE` | `d820a66b…` | **BLOCK** |
| `9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM` | `UNKNOWN` (not found) | `13912043…` | **REQUIRE_VERIFICATION** |
| `1111111111111111111111111111111111111111111` | `UNKNOWN` (malformed) | `5c75d532…` | **REQUIRE_VERIFICATION** |

The first two rows are the point: an identical claim of success is **allowed**
when the chain confirms success and **blocked** when the chain reports failure.
The verdict is a function of Tatum's answer, not of the agent's claim. Remove
Tatum and the success claim is unsupported; the failure case disappears.

The `A9iiTMAxi5BY2uwxu4HnuonfF6A4hhGbaCK8HfTFK26x` digest is a real failed Sui
Mainnet transaction, and it is the digest offered by the "Use a Sui transaction
sample" button on the public front door.

### Independent cross-check

The same digests were queried directly against Tatum's public Sui Mainnet
GraphQL endpoint, from outside the application:

```
transactionEffects(digest: "GHAuBeydSov1zyT6sUKS2cFxWtNWkeamtKANsHwZJHve")
  → status: SUCCESS, checkpoint 237661232

transactionEffects(digest: "A9iiTMAxi5BY2uwxu4HnuonfF6A4hhGbaCK8HfTFK26x")
  → status: FAILURE
```

The ledger state observed independently matches the verdicts the application
recorded.

### Product visibility

The interface that produced an assessment is rendered on the Safeguard Record
itself (`investigation.authoritativeLookup.source` shows *"Tatum Sui Mainnet
gRPC (primary; fallback: Tatum Sui Mainnet GraphQL)"*), alongside the lookup
status, the digest reference, and the human-readable detail. The Evaluation Lab
shows the same health, with the chain identifier. A reader never has to take the
integration on faith.

---

## 6. Honest boundaries

- **Tatum AI Builder is not used.** The optional Tatum AI Builder track is not
  part of AFTERMATH. The AI-assisted reading (an *additive* second opinion that
  never feeds the deterministic verdict) runs on Groq's free tier. This is stated
  plainly rather than implied otherwise.
- **The legacy JSON-RPC adapter is not wired.** It remains in the tree for
  historical reference; the runtime builds the gRPC + GraphQL composite.
- **The key is not readable by the auditor.** `TATUM_API_KEY` is a sensitive
  Vercel environment variable and cannot be decrypted through the Vercel API. Its
  presence is confirmed through the application's own reported health, which
  itself requires the key to have been accepted by the gateway.
- **Rate limits are real.** The gateway throttles rapid lookups (observed: a few
  rapid calls succeed, then a rejection). The retry adapter backs off so a burst
  becomes a retryable condition, not a wrong verdict.

---

## 7. Reproduce it

```bash
# 1. Health (unauthenticated read).
curl -s https://aftermath-7tij.vercel.app/api/overview | jq .tatumHealth

# 2. A live on-chain verification. A real failed transaction: the agent claims
#    success, the chain says otherwise, so AFTERMATH blocks the claim.
curl -s -X POST https://aftermath-7tij.vercel.app/api/incidents/submit \
  -H "content-type: application/json" \
  -d '{"text":"Sui transaction A9iiTMAxi5BY2uwxu4HnuonfF6A4hhGbaCK8HfTFK26x reported completed successfully."}' \
  | jq '{status: .record.investigation.authoritativeLookup.status,
         source: .record.investigation.authoritativeLookup.source,
         decision: .record.decision.decision}'

# 3. Or open https://aftermath-7tij.vercel.app and press
#    "Use a Sui transaction sample", then "Investigate incident".
```
