# AFTERMATH — final demo script

**Video:** `artifacts/aftermath-final-demo.mp4`
**Duration:** 2:01 (121.4 s)
**Format:** 1280×800, H.264 (yuv420p), 25 fps, AAC stereo narration, burned-in captions
**Recorded:** 2026-11-03, from the live production deployment
<https://aftermath-7tij.vercel.app/> (application commit `3fca1b98`), as an
anonymous visitor — no admin token, no seed data.
**Narration:** synthesized locally with the Piper neural voice
(`en_US-lessac-medium`); the same text is the burned-in caption track and the
sidecar `artifacts/demo-narration.srt`.
**Reproduce:** `python3 scripts/demo-tts.py --voice <model.onnx>` →
`node scripts/record-demo.mjs` → `python3 scripts/build-demo.py`.

> **Live figures have advanced since recording.** The numbers spoken in Scenes 4
> and 5 (completed 180, recall-verified 177, namespace 335) are the values read
> live at recording time on 2026-11-03 and are what the video shows on screen.
> They are kept here because they must match the recording. The current live
> figures — verified independently the same day — are **191 completed**, **188
> recall-verified**, **0 simulated**, **346** memories in the namespace, **5**
> persisted recall-verified safeguards, **36** memories applied, **4**
> investigations influenced, **4** requirements strengthened, **0** demonstrated
> repeat preventions. See `artifacts/evidence/2026-11-03-tatum-integration.json`
> and `GET /api/overview`.

---

## Scene 1 — The problem (0:00–0:15)

**On screen:** title card — "An investigation can find out why something failed.
But what happens when the same mistake happens again?"

**Narration:**
> An investigation can find out why something failed. But what happens when the
> same mistake happens again? Most incident reports are read once, then filed
> away, and the lesson stays trapped inside the report it came from. AFTERMATH
> exists to close that gap.

---

## Scene 2 — Investigate (0:15–0:40)

**On screen:** the live product at `aftermath-7tij.vercel.app`. The public
investigation form; **Use a sample incident**; **Investigate incident**; the
result renders.

**Narration:**
> This is the real, deployed product, and it is public: a visitor submits
> failure material with no account and no approval. I will use the built-in
> sample. A checkout service returned a 503, the charge status came back
> unknown, and an agent still reported the charge as completed successfully.
> AFTERMATH parses the material strictly as data, never executes it, and grounds
> every fact in a verbatim span from the submission.

**Why this is honest:** the sample incident is the application's own built-in
sample (`src/components/public-investigation.tsx`, `SAMPLE`). The submission is
idempotent — it returns the existing record `3d8a0234…` — so recording causes no
new Mainnet write.

---

## Scene 3 — The safeguard (0:40–0:58)

**On screen:** the Safeguard Record, scrolled through evidence, hypothesis, and
the proposed safeguard.

**Narration:**
> The result is a Safeguard Record: evidence with its verbatim spans, a
> hypothesis with a confidence, and one proposed safeguard. Notice the evidence
> status is Unknown. The material names no authoritative source, so AFTERMATH
> refuses to decide whether the charge succeeded. That refusal is the product
> working, not a gap.

**Why this is honest:** the record shows `AUTHORITATIVE LOOKUP — not attempted`
and the evidence status `Unknown`. The narration does not claim a verified
failure for this incident.

---

## Scene 4 — Persist to Walrus Memory (0:58–1:16)

**On screen:** the Memory Ledger (`/memory`).

**Narration:**
> Verified safeguards are written to Walrus Memory on Mainnet, and a write
> counts as verified only when a recall query returns it. This ledger reads live
> from the relayer: one hundred eighty completed writes, one hundred
> seventy-seven recall-verified, zero simulated, and three hundred thirty-five
> memories in the namespace.

**Why this is honest:** the figures are read live from `GET /api/overview` at
recording time and are also visible on screen (completed 180, recall-verified
177, simulated 0, namespace 335). "Completed" and "recall-verified" are stated as
different numbers.

---

## Scene 5 — Recall changes a later decision (1:16–1:45)

**On screen:** the Learning Loop (`/learning`), Section C **Behaviour change**,
then Section E **Memory provenance**.

**Narration:**
> Here is the moment that matters. A later investigation reports a build passing
> in continuous integration with no log attached. AFTERMATH recalls an applicable
> safeguard, then runs the decision engine twice over identical evidence: once
> with the memory held out, once enforced. The only difference is the memory. The
> verdict is unchanged, but the memory adds two required verification checks the
> engine would not otherwise require. Provenance shows the chain from that
> incident, to this Walrus blob, to these later investigations.

**Why this is honest:** the on-screen card states the verdict is unchanged
(`REQUIRE_VERIFICATION` in both arms) and that the safeguard adds 2 required
verification checks. The narration says exactly that. It does not claim a verdict
change or a prevented repeat failure.

---

## Scene 6 — Close (1:45–2:01)

**On screen:** end card.

**Narration:**
> AFTERMATH does not merely remember that something happened. It makes the next
> investigation check what the last one taught us to check. Every failure should
> leave a safeguard.

---

## Accuracy notes

- Every figure shown is read live at recording time; none is asserted.
- The sample submission is idempotent (returns record `3d8a0234…`); no new
  Mainnet write is caused by recording.
- The narration describes the behaviour-change card exactly as the UI states it:
  the verdict is unchanged and the memory adds two required checks.
- Zero demonstrated repeat preventions is the current figure and is not
  contradicted anywhere in the video.
- No API key, token, private key, or personal information appears in any frame,
  caption, or metadata. The Memory Ledger shows only a masked account id
  ("(66 chars, hidden)") as the live product itself renders it.
- "Completed" writes (180) and "recall-verified" writes (177) are presented as
  distinct numbers, as the product presents them.
