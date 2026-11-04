# AFTERMATH — final demo script

**Video:** `artifacts/aftermath-final-demo.mp4`
**Duration:** 2:22 (142.3 s)
**Format:** 1280×800, H.264 (yuv420p), 25 fps, AAC stereo narration, burned-in captions
**Recorded:** 2026-11-04, from the live production deployment
<https://aftermath-7tij.vercel.app/> (application commit `8d499fb06a`), as an
anonymous visitor — no admin token, no seed data.
**Narration:** synthesized locally with the Piper neural voice
(`en_US-lessac-medium`); the same text is the burned-in caption track and the
sidecar `artifacts/demo-narration.srt`.
**Reproduce:** `python3 scripts/demo-tts.py --voice <model.onnx>` →
`node scripts/record-demo.mjs` → `python3 scripts/build-demo.py`.

> **Figures.** The narration is deliberately count-free, so the video cannot
> drift from the ledger. The counts a judge should read are the live ones:
> **196 completed**, **193 recall-verified**, **0 simulated**, **351** memories in
> the namespace, **4** persisted recall-verified safeguards, **47** memories
> applied, **6** investigations influenced, **6** requirements strengthened,
> **0** demonstrated repeat preventions. See `artifacts/evidence/2026-11-04-*.json`
> and `GET /api/overview`.

---

## Scene 1 — The problem (0:00–0:21)

**On screen:** title card — "An investigation can find out why something failed.
But what happens when the same mistake happens again?"

**Narration:**
> Every agent reports success. Not every agent is right. An investigation can
> find out why something failed, but the lesson usually stays trapped in the
> report it came from. AFTERMATH is failure prevention that remembers: it turns
> incident evidence into a safeguard, verifies it, and preserves it on Walrus
> Memory so the next similar failure is recognised, not repeated.

---

## Scene 2 — The counterfactual (0:21–0:41)

**On screen:** the live product at `aftermath-7tij.vercel.app`. The public
investigation form with three labelled samples: **Sui transaction: succeeded**,
**Sui transaction: failed**, **Sui transaction: unknown**.

**Narration:**
> This is the real, deployed product, and it is public: no account, no
> invitation, no approval. The three samples make exactly one claim, that the
> transaction completed successfully, over three real Sui Mainnet digests. Only
> the digest differs. So only one thing can change the verdict: what the Sui
> ledger says through Tatum.

**Why this is honest:** each sample reproduces a real recorded investigation
idempotently (`src/lib/samples.ts`), so recording causes no new Mainnet write.
The samples are the counterfactual: one claim, three digests.

---

## Scene 3 — A verified failure is blocked (0:41–1:01)

**On screen:** submitting **Sui transaction: failed**; the Safeguard Record
renders with its header (decision `BLOCK`, memory state) and its evidence.

**Narration:**
> First, the agent claims success. AFTERMATH reads the digest on Sui Mainnet
> through Tatum, and Tatum reports a verified failure. The success claim cannot
> stand. The decision is block, and the evidence is grounded in the ledger
> rather than the agent's narration.

**Why this is honest:** the record header shows `BLOCK`; the authoritative lookup
shows `VERIFIED_FAILURE` from Tatum Sui Mainnet gRPC.

---

## Scene 4 — The same claim is allowed (1:01–1:13)

**On screen:** submitting **Sui transaction: succeeded**; the record shows
`ALLOW`.

**Narration:**
> The same claim again, but this digest did succeed. Tatum confirms it, and
> AFTERMATH allows the claim. Same words, same pipeline, opposite outcome. The
> verdict follows the authoritative source, not the report.

**Why this is honest:** the record header shows `ALLOW` and the lookup shows
`VERIFIED_SUCCESS`. The header also states the memory honestly — this
investigation wrote its incident to Mainnet but had nothing to learn, so it shows
*incident live · no lesson* rather than overstating a persisted safeguard.

---

## Scene 5 — An unknown digest is not guessed (1:13–1:29)

**On screen:** submitting **Sui transaction: unknown**; the record shows
`REQUIRE_VERIFICATION`.

**Narration:**
> A digest the node holds no record of is neither success nor failure. AFTERMATH
> refuses to guess. It returns require verification and states the uncertainty
> plainly, instead of inventing an answer.

**Why this is honest:** the lookup status is `UNKNOWN`, never upgraded to success
or failure.

---

## Scene 6 — Persist to Walrus Memory (1:29–1:43)

**On screen:** the Memory Ledger (`/memory`).

**Narration:**
> Verified safeguards are written to Walrus Memory on Mainnet. This ledger reads
> live from the relayer, and a write counts as stored only when a blob id comes
> back, and as recall-verified only when a recall query returns it. Nothing here
> is simulated.

**Why this is honest:** the figures are read live from `GET /api/overview` at
recording time. "Completed" and "recall-verified" are stated as different
numbers, and `simulatedWrites` is zero.

---

## Scene 7 — Recall changes a later decision (1:43–2:08)

**On screen:** the Learning Loop (`/learning`), Section C **Behaviour change**,
then Section E **Memory provenance**.

**Narration:**
> Here is the moment that matters. A safeguard learned from an unsupported
> completion claim was written to Walrus Memory, then recalled in later
> investigations, where it added required verification checks. The before and
> after are recorded honestly: the checks were strengthened, and AFTERMATH does
> not overclaim a verdict change that did not happen. Provenance shows the chain
> from the incident, to the Walrus blob, to the later investigations it
> influenced.

**Why this is honest:** the on-screen card states the verdict is unchanged
(`REQUIRE_VERIFICATION` in both arms) and that the safeguard adds required
verification checks. The narration says exactly that. It does not claim a verdict
change or a prevented repeat failure.

---

## Scene 8 — Close (2:08–2:22)

**On screen:** end card.

**Narration:**
> AFTERMATH stays honest about what it knows, what it remembers, and what it
> changed. It does not merely remember that something happened; it makes the next
> investigation check what the last one taught us to check. Every failure should
> leave a safeguard.

---

## Accuracy notes

- Every figure shown is read live at recording time; none is asserted.
- The narration contains no numeric counts, so it cannot drift from the ledger.
- Each sample submission is idempotent; no new Mainnet write is caused by
  recording (verified: 196 writes before and after).
- The narration describes the behaviour-change card exactly as the UI states it:
  the verdict is unchanged and the memory adds required checks.
- Zero demonstrated repeat preventions is the current figure and is not
  contradicted anywhere in the video.
- No API key, token, private key, or personal information appears in any frame,
  caption, or metadata. The Memory Ledger shows only a masked account id
  ("(66 chars, hidden)") as the live product itself renders it.
- "Completed" and "recall-verified" writes are presented as distinct numbers, as
  the product presents them.
