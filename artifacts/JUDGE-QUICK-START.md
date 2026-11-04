# AFTERMATH — judge quick start (about one minute)

Everything here works with no account, no invitation, no approval, and no
administrator. Open one tab and follow along.

**Production:** <https://aftermath-7tij.vercel.app/>

---

## The one-minute path

1. **Open the home page.** <https://aftermath-7tij.vercel.app/> — the front door
   is the product itself: an investigation form. The page states what AFTERMATH
   does and why persistent memory matters.

2. **Submit an incident — the three-outcome counterfactual.** Click each of the
   three labelled samples in turn and press **Investigate incident**:
   **Sui transaction: failed** → decision **BLOCK**; **Sui transaction:
   succeeded** → decision **ALLOW**; **Sui transaction: unknown** → decision
   **REQUIRE_VERIFICATION**. All three samples make the *same* claim — that the
   transaction completed successfully — over three real Sui Mainnet digests. Only
   the digest differs, so only the ledger decides. AFTERMATH verifies each digest
   read-only through **Tatum** (Sui Mainnet gRPC, GraphQL fallback) and the record
   shows the authoritative lookup, its source, and the digest reference. This is
   the whole point of the product — the verdict follows the ledger, not the claim.
   (Click **Use a sample incident** instead to see the no-source path, where the
   evidence status is honestly `Unknown`.) No credential is requested either way,
   and each sample is idempotent (no new Mainnet write).

3. **Read the record top to bottom.** Notice:
   - **Evidence** — every fact carries a verbatim span copied out of the
     submission. A fact that cannot be copied out does not survive.
   - **Authoritative lookup** — for the Sui sample, the on-chain status
     (`VERIFIED_FAILURE`), the interface that produced it, and the digest.
   - **Evidence status** — `Unknown` when the sample names no authoritative
     source. AFTERMATH refuses to decide rather than guessing. That refusal is the
     product working, not a gap.
   - **Hypothesis** — with a confidence, and the explanations it considered.
   - **Safeguard** — one scoped, testable rule with its verification state.

4. **Open Safeguard Records** (`/records`) — every investigation, newest first.
   Each record states honestly how far its safeguard is verified.

5. **Open System → Memory Ledger** (`/memory`) — live Walrus Memory Mainnet
   state: relayer authentication, the namespace total read from the relayer, and
   the write rows, each with its blob id. **Completed** and **recall-verified**
   are shown as different numbers.

6. **Open System → Learning Loop** (`/learning`) — the whole loop:
   - **Learning impact** — the counted figures.
   - **Behaviour change** — the two-arm comparison: the decision engine run twice
     over identical evidence, once with the recalled safeguard held out and once
     enforced. This is memory's own contribution, shown as a real counterfactual.
   - **Memory provenance** — the chain from a memory back to the incident that
     produced it, its Walrus blob, and the later investigations it reached.

7. **Open System → Evaluation Lab** (`/lab`) — run the controlled scenarios. The
   `workflow-repeat-refused` scenario shows a recalled lesson changing a repeat
   decision to `REQUIRE_VERIFICATION`.

---

## What you should see, and what is honest

- **Live figures (2026-11-04):** 351 memories in the Walrus namespace; 196
  completed writes; 193 recall-verified; 0 simulated; 6 verified safeguards; 4
  persisted and recall-verified; 47 memories applied; 6 investigations
  influenced; 6 requirements strengthened; **0 demonstrated repeat preventions**.
  Read them yourself at `/api/overview` and `/api/learning`.
- **Tatum is load-bearing.** The same class of submission — an agent claiming a
  Sui transaction succeeded — resolves to `ALLOW` when Tatum confirms success,
  `BLOCK` when Tatum reports failure, and `REQUIRE_VERIFICATION` when Tatum cannot
  answer. See `artifacts/TATUM-INTEGRATION-ARCHITECTURE.md`.
- **The null result is reported.** When a recalled safeguard changes nothing, the
  Learning Loop says so. A memory that is retrieved but not applicable is shown
  as "possible similarity — not applied", not as an influence.
- **Memory never outranks evidence.** A safeguard can add required checks and
  escalate a decision; it cannot downgrade one or make an unsupported claim stand.
- **Unknown stays unknown.** When an authoritative source is unreachable, the
  status is `UNKNOWN`, never a guessed verdict.

---

## What needs the operator (and is not required for any step above)

The **operator console** at `/admin` requires the operator's admin token. It
exposes operational controls, not the product. Reading every public page and
submitting an incident from the home page need no credential.

`npm run verify:prod` passes **28/28** anonymously — the recall check falls back
to the public learning surface when no admin token is present.

---

## Links

| Artifact | URL |
| --- | --- |
| Production application | <https://aftermath-7tij.vercel.app/> |
| Source repository | <https://github.com/itzebe/aftermath> |
| Demo video (local) | `artifacts/aftermath-final-demo.mp4` (2:22) |
| Narrated walkthrough (v2) | <https://github.com/itzebe/aftermath/releases/tag/demo-v2> |
| Rendered article | <https://itzebe.github.io/aftermath/> |
| Devpost copy | `artifacts/DEVPOST-SUBMISSION.md` |
| Architecture | `artifacts/ARCHITECTURE.md` |
| Final report | `artifacts/FINAL-REPORT.md` |
