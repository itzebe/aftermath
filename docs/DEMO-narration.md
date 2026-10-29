# AFTERMATH — demo video narration script

Recorded video: <https://github.com/itzebe/aftermath/releases/tag/demo-v1> (2:12,
1920×1080, H.264 + AAC, burned-in captions). Sidecar captions:
[`DEMO.srt`](DEMO.srt). Captured from the live production deployment with
Playwright and narrated with a local TTS voice.

| # | Scene | Time | Narration |
| --- | --- | --- | --- |
| 0 | Title card | 0:00–0:08 | "Aftermath. Every failure should leave a safeguard. A demonstration for the Total Recall hackathon, built on Tatum and Walrus Memory." |
| 1 | The problem (home) | 0:08–0:23 | "Aftermath's thesis is one line: a claim is not evidence. When an AI agent reports that something worked, that is a claim, not a fact. Aftermath asks for the proof, and when a failure is verified, it leaves behind a safeguard so the same failure cannot recur unnoticed." |
| 2 | Submit an incident | 0:23–0:41 | "This is the real product. I paste the shipped sample incident: a charge request that returned a 503, was retried, and then an agent claimed it succeeded. Aftermath parses the material, and never executes it. The Safeguard Record shown here is the genuine result of this exact submission." |
| 3 | Evidence + additive AI | 0:41–1:21 | "Read the record top to bottom. Evidence first: every observed fact carries a verbatim span copied from the submitted material. Notice the evidence status is Unknown. The material names no authoritative system, so Aftermath refuses to decide whether the charge succeeded. That refusal is the product working, not a gap. The AI reading is additive, never an authority. A Groq model proposes candidate mechanisms, but every fact it keeps must cite a span that appears verbatim in the material, or it is discarded and counted as a rejected claim. The model never sets the evidence status, the diagnosis, the decision, or the verification. The deterministic engine owns all of those." |
| 4 | Walrus Memory | 1:21–1:45 | "Every verified incident and its lesson is written to Walrus Memory on Mainnet, under a content-hash idempotency key, and confirmed by a recall query. The ledger reads live. Against a requirement of ten genuine Mainnet memories, this instance reports eighty-eight completed writes, and eighty-seven independently recall-verified. Simulated writes are excluded, and the relayer reports two hundred forty-three memories in the namespace." |
| 5 | Learning loop + close | 1:45–2:12 | "In the Evaluation Lab, the controlled scenarios show the learning loop. A repeat attempt is refused, because a previously stored lesson was recalled and required verification. That is memory changing a later decision. I will be precise: this is a controlled scenario, and I am not claiming it proves a production intervention. The recall itself is real. Aftermath is open source, with the repository and blog on screen. Every failure should leave a safeguard." |

## Accuracy notes

- Counts (88 completed / 87 recall-verified / 243 namespace / 0 simulated) are
  read live from `GET /api/overview` at recording time, not asserted.
- Scene 2 fills the form with the app's own sample; the Safeguard Record shown is
  the genuine result of one real submission (record `3d8a0234…`), which was
  performed to demonstrate the live workflow. It is not described as an external
  incident.
- Scene 5 explicitly states the `workflow-repeat-refused` scenario is a
  controlled scenario, not a production intervention.
- No secrets appear in the video, captions, or metadata.
