# AFTERMATH — judge quick start (about one minute)

Everything here works with no account, no invitation, no approval, and no
administrator. Open one tab and follow along.

**Production:** <https://aftermath-7tij.vercel.app/>

---

## The one-minute path

1. **Open the home page.** <https://aftermath-7tij.vercel.app/> — the front door
   is the product itself: an investigation form. The page states what AFTERMATH
   does and why persistent memory matters.

2. **Submit an incident.** Click **Use a sample incident**, then **Investigate
   incident**. In a few seconds you get a genuine **Safeguard Record** — the same
   pipeline the operator console uses. No credential is requested.

3. **Read the record top to bottom.** Notice:
   - **Evidence** — every fact carries a verbatim span copied out of the
     submission. A fact that cannot be copied out does not survive.
   - **Evidence status: Unknown** — the sample names no authoritative source, so
     AFTERMATH refuses to decide whether the charge succeeded. That refusal is the
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

- **Live figures (2026-11-03):** 335 memories in the Walrus namespace; 180
  completed writes; 177 recall-verified; 0 simulated; 4 verified safeguards; 3
  persisted and recall-verified; 31 memories applied; 3 investigations
  influenced; 3 requirements strengthened; **0 demonstrated repeat preventions**.
  Read them yourself at `/api/overview` and `/api/learning`.
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

`npm run verify:prod` passes **28/28** with the operator token set (for the
recall-query check); without it, that check is reported as an explicit failure
(27/28), never silently skipped.

---

## Links

| Artifact | URL |
| --- | --- |
| Production application | <https://aftermath-7tij.vercel.app/> |
| Source repository | <https://github.com/itzebe/aftermath> |
| Demo video (local) | `artifacts/aftermath-final-demo.mp4` (2:01) |
| Narrated walkthrough (v2) | <https://github.com/itzebe/aftermath/releases/tag/demo-v2> |
| Rendered article | <https://itzebe.github.io/aftermath/> |
| Devpost copy | `artifacts/DEVPOST-SUBMISSION.md` |
| Architecture | `artifacts/ARCHITECTURE.md` |
| Final report | `artifacts/FINAL-REPORT.md` |
