# Total Recall — evidence index

Every major submission claim mapped to its evidence. Verified **2026-11-04**
(UTC) against production <https://aftermath-7tij.vercel.app/> and public
sources. Where a claim rests on a source that cannot be re-run here (a
credential-gated path), it says so.

Legend: **VERIFIED** = independently re-checked in this mission;
**VERIFIED (prior)** = captured earlier and still consistent with live state;
**USER-SUPPLIED** = depends on the owner.

---

## 1. Source-code evidence (repository, public)

| Claim | Source location |
| --- | --- |
| Tatum gRPC is the primary authoritative lookup | `src/lib/adapters/tatum-sui-grpc.ts` |
| Tatum GraphQL fallback | `src/lib/adapters/tatum-sui-graphql.ts` |
| Composite verifier (gRPC → GraphQL) | `src/lib/adapters/sui-verifier.ts` |
| Fail-closed Sui Mainnet identity check | `src/lib/adapters/sui-network.ts` (`isSuiMainnet`) |
| Rate-limit-aware retry (429 only) | `src/lib/adapters/tatum-retry.ts` |
| Evidence status → verdict mapping | `src/lib/engines/investigation.ts` (§`evidenceStatus`) |
| Deterministic decision gate + trace | `src/lib/engines/decision-engine.ts` |
| Submission pipeline (Tatum folded in, AI additive) | `src/lib/engines/submission-pipeline.ts` |
| Learning loop / behaviour-change counterfactual | `src/lib/engines/learning-loop.ts` |
| Walrus Memory adapter (staged write) | `src/lib/adapters/safeguard-memory-adapter.ts`, `src/lib/adapters/memory-*` |
| Secret redaction at the boundary | `src/lib/util/redact.ts` |
| Public-submission gate (fail-closed) | `src/lib/api/public-read-guard.ts`, `src/lib/config.ts` |
| Shared rate limiting | `src/lib/api/rate-limit.ts` |
| The three-digest front-door samples | `src/lib/samples.ts` |

## 2. Automated test evidence (repository)

| Suite | Command | Result (2026-11-04) |
| --- | --- | --- |
| Type check | `npx tsc --noEmit` | PASS (exit 0) |
| Lint | `npm run lint` | PASS (exit 0) |
| Build | `npm run build` | PASS |
| Unit + integration | `npm test` | **631 passed, 12 skipped** (skips = opt-in live-smoke; never counted as passes) |
| Browser / E2E | `npm run test:e2e` | **19 passed, 0 failed** |
| Production checks | `npm run verify:prod` | **28/28 anonymously** |

Targeted suites backing the Tatum/Walrus claims:
`tests/tatum-grpc-adapter.test.ts`, `tests/tatum-graphql-adapter.test.ts`,
`tests/tatum-adapter.test.ts`, `tests/tatum-network-identity.test.ts`,
`tests/tatum-retry.test.ts`, `tests/decision-engine.test.ts`,
`tests/learning-loop.test.ts`, `tests/learning-route.test.ts`,
`tests/memory-adapter.test.ts`, `tests/safeguard-memory-adapter.test.ts`.

## 3. Live integration evidence (production endpoints)

| Claim | Endpoint / source | Observed |
| --- | --- | --- |
| Public submission is enabled | `GET /api/config` → `publicSubmission.available` | `true` with reason; fails closed otherwise |
| Walrus Memory is live Mainnet | `GET /api/overview` → `memoryStatus` | `MAINNET_AUTH_CONFIRMED`, `isLive: true`, `network: mainnet` |
| Namespace memory count | `GET /api/overview` → `memoryStatus.namespaceMemoryCount` | **351** |
| Completed writes | `GET /api/overview` → `counts.completedLiveWrites` | **196** |
| Recall-verified writes | `GET /api/overview` → `counts.recallVerifiedWrites` | **193** |
| Simulated writes | `GET /api/overview` → `counts.simulatedWrites` | **0** |
| ≥ 10 memories requirement | `GET /api/overview` → `mainnetRequirement` | `{required: 10, completedLive: 196, recallVerified: 193, remaining: 0, satisfied: true}` |
| Tatum Sui Mainnet healthy | `GET /api/overview` → Tatum status; `verify:prod` | "Tatum Sui Mainnet gRPC reachable and authenticated (chain mainnet)" |
| Learning-loop counters | `GET /api/learning` → `impact` | persisted 4, recall-verified 4, recalled 95, applied 47, influenced 6, strengthened 6, **repeat preventions 0** |
| Secrets are masked | `GET /api/config` | `apiKey`, `privateKey`, `accountId` shown as `(N chars, hidden)` |
| Admin endpoints protected | `POST /api/memory-verify`, `/api/scenarios/run`, `/api/reset` (no token) | **401** |
| Public submit validates input | `POST /api/incidents/submit` (empty body) | **400** (validation, not 401) |
| All public routes reachable | `/`, `/records`, `/learning`, `/memory`, `/incidents`, `/safeguards`, `/evaluation`, `/lab`, `/admin` | **HTTP 200** |

Raw JSON: `artifacts/evidence/2026-11-04-overview.json`,
`artifacts/evidence/2026-11-04-learning.json`,
`artifacts/evidence/2026-11-04-config.json`,
`artifacts/evidence/2026-11-04-evaluation.json`,
`artifacts/evidence/2026-11-04-memory.json`,
`artifacts/evidence/2026-11-04-incidents.json`.

## 4. Independent cross-check (no app code, no API key)

Tatum's **public** Sui Mainnet GraphQL gateway answers unauthenticated. Run from
a shell with no credentials and no application code:

| Sui Mainnet digest | `transactionEffects.status` | AFTERMATH verdict → decision |
| --- | --- | --- |
| `GHAuBeydSov1zyT6sUKS2cFxWtNWkeamtKANsHwZJHve` | `SUCCESS` | `VERIFIED_SUCCESS` → **ALLOW** |
| `A9iiTMAxi5BY2uwxu4HnuonfF6A4hhGbaCK8HfTFK26x` | `FAILURE` | `VERIFIED_FAILURE` → **BLOCK** |
| `9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM` | `null` | `UNKNOWN` → **REQUIRE_VERIFICATION** |

Chain identifier `4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S` confirms Mainnet.

Evidence: `artifacts/evidence/2026-11-03-tatum-live-evidence.json`,
`artifacts/evidence/2026-11-04-counterfactual.json`.

## 5. Production evidence

| Claim | Evidence |
| --- | --- |
| Production serves the reviewed application | deployment READY; alias `aftermath-7tij.vercel.app` → newest production deployment |
| Deployment status | `dpl_cUKufrKdvnga8B1P1heatzbbcVPf` (commit `2159d5d220`, READY, target production) |
| Durable index | `GET /api/config` → `persistence.backend = postgres`, `durable: true` (Neon) |
| Anonymous submission reaches the pipeline | `artifacts/evidence/2026-11-04-public-journey.json`, `2026-11-03-public-journey-submit.json` |

## 6. Demo video evidence

| Property | `artifacts/aftermath-final-demo.mp4` | `demo-v2` (published) |
| --- | --- | --- |
| Duration | 2:22 (142.32 s) | 2:36 (156.60 s) |
| Resolution | 1280×800 | 1920×1080 |
| Video | H.264 High, yuv420p, 25 fps | H.264 High, yuv420p, 30 fps |
| Audio | AAC LC, 44.1 kHz stereo | AAC LC, 48 kHz stereo |
| Captions | burned-in (+ `demo-narration.srt`) | burned-in (+ `.srt` / `.vtt`) |
| SHA-256 (final cut) | `bd46de635ce2cd5eda0eef0c9cde8042571d8708f0442aac8e1c81ccc019a5b1` | — |
| Contains numeric claims? | No (narration is count-free by design) | No |
| Public URL | No — not uploaded | Yes — release asset, HTTP 206 |

## 7. Blog evidence

| Claim | Evidence |
| --- | --- |
| Blog post exists and is published | Article appears in the author's Medium RSS feed (`https://medium.com/feed/@jonathanebi05`), title "AFTERMATH — Every failure should leave a safeguard" |
| Blog readable | Medium returns 403 to automated clients (bot protection); GitHub Pages mirror <https://itzebe.github.io/aftermath/> returns HTTP 200 |
| Blog covers what/how it learned | `docs/BLOG.md` (source) and the live Pages render contain the problem, the Tatum/Walrus roles, and the "what I learned" section |
| Metric freshness | The Medium article states an earlier operator-instance count (51). The **current** figures are the live ones in §3. See `FINAL-REPORT.md` — a Medium edit is an owner action |

## 8. User-supplied / historical evidence

| Item | Status |
| --- | --- |
| Tatum dashboard account ID | **USER INPUT REQUIRED** — not in the repository |
| SUI address / Account ID (SUI) / `MEMWAL_AGENT_ID` | **USER INPUT REQUIRED** — owner-held Walrus Memory identity |
| Email, Discord, LinkedIn, Telegram | **USER INPUT REQUIRED** |
| "How did you hear about us", "first Web3 project" | **USER INPUT REQUIRED** — owner's truthful answer |
| Social post links (bonus) | **USER INPUT REQUIRED** — owner posts, then pastes the URL |

## 9. Claim honesty notes

- The **6 influenced investigations** added verification checks; they did **not**
  flip a verdict. Described as "requirements strengthened", never as "incidents
  prevented".
- **Demonstrated repeat preventions = 0.** Not restated as anything else.
- The succeeded sample record (`8f12d8ec…`) is labelled `provenance: simulated`
  because that reproduction had no write; the other two counterfactual records
  are `provenance: live`. This is reported as-is, not smoothed over.
- The unit suite needs a database; the 12 skips are opt-in live-smoke tests and
  are **not** counted as passes.
