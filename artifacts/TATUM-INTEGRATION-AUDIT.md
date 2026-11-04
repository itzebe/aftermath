# AFTERMATH — Tatum Integration: Deep Technical Audit

*Audit date: 2026-11-04. Audited against production
`https://aftermath-7tij.vercel.app`, deployed commit `9f8dd843c5`
(`dpl_8GZhWM9v6BBHb7rJDFZV1BvP1cGX`).*

**Question this audit answers:** does Tatum perform a *meaningful function in the
real application architecture*, or is it merely configured and healthy?

**Answer: it is load-bearing.** Tatum is the only evidence source that can turn a
claimed Sui transaction outcome into a verified success or failure, and the
decision engine's verdict follows it. The audit also found and fixed one genuine
correctness gap: nothing asserted *which network* the gateway was on.

---

## 1. Does Tatum actually do something?

Yes. In the finance domain, the agent's own claim ("the transaction succeeded")
is **not** evidence — it is the thing under test. Tatum's Sui Mainnet gateway is
the component that answers the authoritative question, and its answer becomes the
verdict.

```
VERIFIED_SUCCESS  → ALLOW                 (the success claim may stand)
VERIFIED_FAILURE  → BLOCK                 (the claim is contradicted by the ledger)
UNKNOWN           → REQUIRE_VERIFICATION  (never a fabricated outcome)
```

Evidence that the verdict follows the chain, not the claim — three submissions of
the **same class**, only the digest varying, through the **public** endpoint:

| Digest | Tatum reports (independent) | App verdict |
| --- | --- | --- |
| `GHAuBeydSov1zyT6sUKS2cFxWtNWkeamtKANsHwZJHve` | `SUCCESS` | `VERIFIED_SUCCESS` → **ALLOW** |
| `A9iiTMAxi5BY2uwxu4HnuonfF6A4hhGbaCK8HfTFK26x` | `FAILURE` | `VERIFIED_FAILURE` → **BLOCK** |
| `9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM` | `null` (not held) | `UNKNOWN` → **REQUIRE_VERIFICATION** |

Remove Tatum and the failure case cannot exist, and the success claim becomes
unsupported. The integration is not decorative.

## 2. Is it reachable, authenticated, and on the right network?

Health (`GET /api/overview` → `tatumHealth`):

```json
{
  "ok": true,
  "detail": "Tatum Sui Mainnet gRPC reachable and authenticated (chain mainnet).",
  "chainIdentifier": "4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S"
}
```

The `chainIdentifier` is Sui Mainnet's live identifier (independently confirmed
against the public GraphQL gateway: `{"data":{"chainIdentifier":"4btiui…DR6S"}}`).

## 3. What was verified (the 12-item checklist)

| # | Item | Result |
| --- | --- | --- |
| 1 | Endpoint configuration | **VERIFIED** — gRPC primary + GraphQL fallback, read from `/api/config`. |
| 2 | Authentication | **VERIFIED** — health requires an accepted key; the key is server-side only. |
| 3 | Correct network | **FIXED** — was unasserted; now fails closed (see §4). |
| 4 | Successful transaction | **VERIFIED** — `SUCCESS` → `VERIFIED_SUCCESS` → ALLOW. |
| 5 | Failed transaction | **VERIFIED** — `FAILURE` → `VERIFIED_FAILURE` → BLOCK. |
| 6 | Invalid/nonexistent digest | **VERIFIED** — not-found and malformed both → `UNKNOWN`, never a verdict. |
| 7 | Timeout handling | **VERIFIED** — bounded by `AbortController` / gRPC deadline; timeout → `UNKNOWN`. |
| 8 | Error handling | **VERIFIED** — 401/403/429/5xx classified; transport failures never become outcomes. |
| 9 | Data accuracy | **VERIFIED** — app verdicts match an independent key-free GraphQL cross-check. |
| 10 | Rate-limit handling | **VERIFIED** — only 429 / `RESOURCE_EXHAUSTED` retried with backoff + `Retry-After`. |
| 11 | Fallback behaviour | **VERIFIED** — GraphQL used only when gRPC could not answer at all. |
| 12 | Product relevance | **VERIFIED** — Tatum drives the verdict and is named on the served record. |

## 4. The gap found and fixed

**Finding.** Both adapters proved a gateway was reachable and authenticated, but
neither asserted *which network* answered. A misconfigured URL (a testnet host, a
bad `TATUM_SUI_GRPC_URL`) would have reported `ok: true` while verifying against
the wrong chain — and a Sui Mainnet verdict built on another chain's execution
statuses would be wrong.

**Fix.** `src/lib/adapters/sui-network.ts` defines
`SUI_MAINNET_CHAIN_IDENTIFIER` and `isSuiMainnet`. Both health checks now fail
closed when the reported `chainIdentifier` is not Sui Mainnet's:

```ts
// tatum-sui-grpc.ts        const chainIdentifier = info.response.chainId;
// tatum-sui-graphql.ts     const { chainIdentifier } = await this.query(...);
if (!isSuiMainnet(chainIdentifier)) {
  return { ok: false, detail: "…is not on Sui Mainnet…", chainIdentifier };
}
```

**Regression coverage.** `tests/tatum-network-identity.test.ts` — Mainnet
accepted; testnet / empty / undefined rejected; both adapters fail closed. The
live smoke test now asserts the live identifier *is* Mainnet rather than merely
truthy.

**Shipped.** PR #27, squash-merged as `9f8dd84`; production deploy
`dpl_8GZhWM9v6BBHb7rJDFZV1BvP1cGX` (SHA `9f8dd843c5`), HTTP 200.

## 5. Verification gates (post-deploy)

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npx vitest run` | 601 passed, 40 skipped (live-smoke opt-in) |
| `npm run test:e2e` | 18 passed |
| `npm run verify:prod` | **28/28 PASS** |

## 6. Hackathon readiness

Official requirements (Walrus × Tatum "Total Recall") and how AFTERMATH meets
them:

| Requirement | Status |
| --- | --- |
| Walrus Memory integrated and writing on Mainnet | **PASS** — `memwal-mainnet`, 196 completed writes. |
| Tatum RPC used for onchain data where relevant | **PASS** — read-only Sui Mainnet verification, product-critical. |
| At least 10 memories stored on Mainnet | **PASS** — 351 memories in namespace `aftermath`. |
| Published blog post | **PASS** — Medium article (see Devpost). |
| Working demo and public repo | **PASS** — public URL + `github.com/itzebe/aftermath`. |

Judging criteria alignment:

- **Walrus + Tatum integration (30%).** Tatum is the authoritative verifier; Walrus
  is the durable memory. Both are load-bearing, and the counterfactual proves it.
- **Technical quality (30%).** 601 unit tests, 18 E2E, 28/28 production checks;
  fail-closed on transport, network identity, and missing credentials.
- **Creativity (20%).** Memory that changes verification requirements, with the
  contribution shown or honestly reported as "no material contribution".
- **Presentation (20%).** Architecture, evidence, judge quick-start, demo, and a
  live public URL.

## 7. Honest boundaries

- **Tatum AI Builder is not used.** The optional AI Builder track is not part of
  AFTERMATH. The AI-assisted reading is an additive second opinion on Groq's free
  tier and never feeds the deterministic verdict.
- **The legacy JSON-RPC adapter is not wired.** Retained for reference; the runtime
  builds the gRPC + GraphQL composite.
- **The key is not readable by the auditor.** `TATUM_API_KEY` is a sensitive Vercel
  variable; its presence is confirmed through the app's reported health.
- **Live smoke tests are opt-in.** They require `TATUM_API_KEY` and are skipped in
  a keyless run, so they are not counted as passing here.
- **Rate limits are real.** The gateway throttles rapid lookups; the retry adapter
  turns a burst into a retryable condition, not a wrong verdict.
