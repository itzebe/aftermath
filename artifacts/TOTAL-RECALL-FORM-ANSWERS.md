# Total Recall — official form answers

**Form:** <https://recall-tatum-walrus.vercel.app/> (opens as a modal; click
**Submit Project**). Inspected field by field in a real browser on 2026-11-04.
**Project:** AFTERMATH — Every Failure Should Leave a Safeguard.
**Track:** 02 — Smart Agents for Real Life.

The form has **four sections** and **20 user-facing controls**. The order below
matches the form exactly. Fields marked **`USER INPUT REQUIRED`** can only be
supplied by the account owner — do not invent them. Every other field is ready to
paste.

## Verified DOM schema (from the live form, 2026-11-04)

Captured directly from the rendered form (`input`/`textarea`/`select` attributes),
not inferred:

| # | `name` | type | required | maxLength |
| --- | --- | --- | --- | --- |
| 1 | `email` | email | **yes** | — |
| 2 | `discordId` | text | **yes** | — |
| 3 | `linkedinUrl` | text | **yes** | — |
| 4 | `telegramId` | text | no | — |
| 5 | `howHeard` | select-one | **yes** | — |
| 6 | `heardFromSource` | text | no | **200** |
| 7 | `firstWeb3Project` | select-one | **yes** | — |
| 8 | `tatumAccountId` | text | **yes** | — |
| 9 | `suiAddress` | text | **yes** | — |
| 10 | `accountId` | text | **yes** | — |
| 11 | `memwalAgentId` | text | **yes** | — |
| 12 | `description` | textarea | **yes** | — |
| 13 | `demoVideoUrl` | **url** | **yes** | — |
| 14 | `repoUrl` | **url** | **yes** | — |
| 15 | `additionalDocs` | text | no | — |
| 16 | `walrusExperience` | textarea | **yes** | — |
| 17 | `tatumAiBuilderExperience` | textarea | **yes** | — |
| 18 | `walrusFriction` | textarea | no | — |
| 19 | `socialPosts` | textarea | no | — |
| 20 | `acceptTerms` | checkbox | **yes** | — |

Notes from the live inspection:

- The **only** character limit on the whole form is field 6 (`maxLength=200`).
  Every other field is unbounded.
- Fields 13 and 14 are **`type="url"`**, so the browser rejects a value that is
  not a valid absolute URL. Field 13's placeholder is *"YouTube or other link"* —
  the demo video must be a **public URL**, not a file.
- Field 12 (Project description) is a `<textarea>`; the placeholder is
  *"What it does, how it uses Tatum + Walrus Memory…"*.
- Field 17 explicitly says *"If you did not use AI Builder, say so briefly"* — a
  short honest answer is correct and expected.
- The site header also carries an **unrelated** "Describe what you want to build"
  AI-Builder prompt box (`name="prompt"`, id `ai-builder-prompt`); it is **not**
  part of the submission form and must not be filled in.

---

## Section 01 — Contact ("How we reach you")

### 1. Email * — `USER INPUT REQUIRED`
Type: email, required.
> _The owner's email address. Used for prize contact._

### 2. Discord handle * — `USER INPUT REQUIRED`
Type: text, required, placeholder `username`.
> _The owner's Discord username (without the `@`)._

### 3. LinkedIn * — `USER INPUT REQUIRED`
Type: text, required, placeholder `https://linkedin.com/in/…`.
> _The owner's LinkedIn profile URL._

### 4. Telegram ID — optional — `USER INPUT REQUIRED`
Type: text, optional, placeholder `@handle`.
> _Leave blank if not applicable; the field is optional._

### 5. How did you hear about this event? * — `USER INPUT REQUIRED`
Type: select, required. Options: `Walrus Socials`, `Tatum Socials`, `Ads`,
`Hackathon Listings`, `Friends`, `Search`, `Others`.
> _Owner's truthful answer. If unsure, `Hackathon Listings` is the most likely
> accurate choice for a builder who found it on the official page / listings._

### 6. Which community or account did you hear about us through? — optional
Type: text, optional, **maxLength 200**.
> Suggested (edit to be truthful): `Official Tatum hackathon page (tatum.io/hackathon/total-recall) and the Walrus Sessions page.`

### 7. Is this your first Web3 project? * — `USER INPUT REQUIRED`
Type: select, required. Options: `Yes`, `No`.
> _Owner's truthful answer. AFTERMATH is a Web3 project (Sui Mainnet, Walrus
> Memory), but only the owner knows their prior history._

---

## Section 02 — Accounts ("Tatum + Walrus Memory identity")

> **Note:** the form itself states that **`MEMWAL_AGENT_ID` is the Public key
> under Delegate keys on memory.walrus.xyz/dashboard**, and that the **Account ID
> (SUI)** is received after creating the first delegate key. These three values
> are owner-held; they are **not** in the repository and must not be guessed.

### 8. Tatum ID * — `USER INPUT REQUIRED`
Type: text, required. Help text: "In My Account then My Account Info."
(dashboard.tatum.io).
> _The owner's Tatum dashboard account ID._

### 9. SUI address * — `USER INPUT REQUIRED`
Type: text, required, placeholder `0x…`.
> _The owner's Sui address._

### 10. Account ID (SUI) * — `USER INPUT REQUIRED`
Type: text, required, placeholder `0x3247e3da…`. Help: "You receive this after
you created your first delegate key on memory.walrus.xyz/dashboard."
> _The Walrus Memory account object ID (this is the `MEMWAL_ACCOUNT_ID` the
> production deployment uses)._

### 11. MEMWAL_AGENT_ID * — `USER INPUT REQUIRED`
Type: text, required, placeholder "Public key from Delegate keys".
> _The Walrus Memory delegate public key._

---

## Section 03 — Project ("What you shipped")

### 12. Project description * — ready to paste

> AFTERMATH is an evidence-first failure-prevention engine for AI agents. An
> agent that reports "the charge completed successfully" is making a claim;
> AFTERMATH asks what the authoritative source actually says. For a Sui
> transaction claim it queries Sui Mainnet through Tatum's gRPC gateway
> (GraphQL fallback) and returns exactly one of VERIFIED_SUCCESS,
> VERIFIED_FAILURE, or UNKNOWN — never a guess. The same success claim over
> three real Mainnet digests resolves three ways (ALLOW / BLOCK /
> REQUIRE_VERIFICATION) strictly by what the ledger says.
>
> When a failure is genuinely verified, the engine distils a scoped safeguard
> and persists it to Walrus Memory Mainnet, counting it as completed only when
> the relayer returns a blob id and as recall-verified only when a recall query
> returns it. During a later investigation the safeguard is recalled and applied
> — and the system proves the memory's contribution by running its decision
> engine twice over identical evidence, with only the recalled memory varying.
>
> Memory informs but never governs: a recalled safeguard can escalate an UNKNOWN
> outcome to REQUIRE_VERIFICATION, but can never turn missing evidence into
> success. The public workspace lets anyone submit an incident and get a genuine
> Safeguard Record with no account. Live: 196 completed and 193 recall-verified
> Mainnet writes, 351 memories in the namespace, 0 simulated writes, 6
> investigations influenced and 6 verification requirements strengthened — and 0
> demonstrated repeat preventions, which the system reports honestly rather than
> overclaiming.

### 13. Short demo video (2 to 3 min) * — see note

Type: **`url`** (required), placeholder "YouTube or other link". **Requires a
public URL** — the browser rejects a non-URL value.
> **Two ready options:**
> - **Published, paste-ready now (zero extra work):**
>   `https://github.com/itzebe/aftermath/releases/tag/demo-v2` — 2:36,
>   narrated, captioned, 1920×1080. Asset verified downloadable (HTTP 200).
> - **Final cut (recommended if you upload it):**
>   `artifacts/aftermath-final-demo.mp4` — 2:22 (142.32 s), narrated,
>   captioned, 1280×800, H.264/AAC, sha256 `bd46de63…`. Upload to YouTube
>   (unlisted is fine) and paste the link.
>
> Either satisfies the "2 to 3 min" requirement. See "Remaining actions" in
> `FINAL-REPORT.md` — uploading is an owner action.

### 14. GitHub repo * — ready to paste

```
https://github.com/itzebe/aftermath
```

### 15. Additional documentation — optional — ready to paste

```
https://itzebe.github.io/aftermath/
```
> The published blog post (also on Medium:
> https://medium.com/@jonathanebi05/aftermath-every-failure-should-leave-a-safeguard-25446fdbcd71).
> Add a docs link if you have one, e.g. the repository's `artifacts/ARCHITECTURE.md`.

---

## Section 04 — Feedback ("Helps partners improve")

### 16. How was your experience building with Walrus? * — ready to paste

> The memory model is genuinely portable, which is what made the learning loop
> buildable: `remember` returning a job id, a status read, then
> `waitForRememberJob` for the terminal blob id, and `recall` to confirm
> retrievability. Treating "accepted" and "completed" as distinct states is the
> right call and shaped our write accounting. Two friction points: (1) the
> distinction between a completed write and a recall-verified write has to be
> tracked by the application, because a blob id alone does not prove the record
> comes back from a query — we ended up reporting both numbers side by side
> rather than conflating them; (2) namespace totals come from the relayer, so an
> instance's own ledger and the namespace count diverge, which is correct but
> easy to misreport. Clearer guidance on when a write should be considered
> "durable" versus "retrievable" would help. The SDK's idempotency-key support
> was the single most useful feature — it made retries after a transport timeout
> safe.

### 17. How was your experience building with the Tatum AI Builder? * — ready to paste

> We did not use the Tatum AI Builder for this project; AFTERMATH was built
> directly against Tatum's Sui Mainnet gRPC and GraphQL gateways, so we are not
> competing for the AI Builder award. On the RPC side specifically: the gRPC
> gateway is fast and the `sui.rpc.v2.LedgerService` methods map cleanly to what
> a verifier needs. The one thing to plan for is the shared rate limit across
> interfaces (roughly three requests per second per key) — a
> discovery-then-verify burst trips it, so we added a retry helper that honours
> `Retry-After` and backs off exponentially, retrying only genuine 429s and never
> a 401 or a 500. Documenting the shared budget across gRPC and GraphQL in one
> place would save builders a debugging cycle.

### 18. One bug or friction point with Walrus Memory — optional — ready to paste

> The gap between a completed write (blob id returned) and a recall-verified
> write (a recall query returns it) is not visible from the SDK's write path
> alone. We had to run a separate recall query per write to know whether a memory
> was actually retrievable, and report the two counts separately. A first-class
> "verify retrievable" helper would remove that step.

### 19. Social post links — optional — `USER INPUT REQUIRED`
Type: text, optional. "X, LinkedIn, etc." — extra points for tagging @Tatum_io
and @WalrusFoundation.
> _Owner action: post about AFTERMATH on X or LinkedIn (tagging @Tatum_io and
> @WalrusFoundation) and paste the post URL here. This is the only explicitly
> scored bonus._

### 20. Agreement checkbox * — ready to accept
"I am 18+ and agree to the Event Rules, the Tatum Terms of Use, the Walrus
General Terms of Service, and the Walrus Privacy Policy…"
> Check this box. It is required to submit.

---

## Pre-submission sanity check

- [ ] Fields 1–4, 8–11 supplied by the owner (no invented values).
- [ ] Field 5, 7 answered truthfully by the owner.
- [ ] Field 13 points at a public video URL (upload the final cut, or use demo-v2).
- [ ] Field 19 filled if you post on socials (bonus points).
- [ ] Checkbox 20 ticked.
- [ ] One submission per person (event rule).
- [ ] Deadline: **10 Nov 2026, 17:00 UTC**.
