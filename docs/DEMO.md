# AFTERMATH — demo storyboard (2–3 minutes)

Recording status: **recorded.** The playable video is published as a release
asset: <https://github.com/itzebe/aftermath/releases/tag/demo-v1> (2:12,
1920×1080, H.264 + AAC, burned-in captions). It was captured from the **live
production deployment** with Playwright, narrated with a local TTS voice, and cut
with ffmpeg. This storyboard remains the source of truth for what each scene shows
and the claim it supports; the verbatim narration is in
[`DEMO-narration.md`](DEMO-narration.md) and [`DEMO.srt`](DEMO.srt).

The whole run is reproducible against the **live production deployment**:
<https://aftermath-7tij.vercel.app/>. Every figure it shows is read from the live
ledger and the real relayer — no mocked numbers, no simulated writes presented as
Mainnet.

## What is genuinely demonstrable (and what is not)

| Feature | Demonstrable live? | How |
| --- | --- | --- |
| Incident → grounded Safeguard Record | ✅ | Submit the sample below; facts carry verbatim spans |
| AI reading is additive and grounded | ✅ | `aiAnalysis.ran` on the record; provider `groq` configured in production |
| Evidence resolves to `UNKNOWN` without a source | ✅ | The sample names no authoritative system |
| Lesson written to Walrus Memory Mainnet | ✅ | One real Mainnet write per record; shown on the record and the Memory Ledger |
| Recall of a stored lesson | ✅ | Memory Ledger recall query returns real blobs |
| A repeat is refused because memory recalled the lesson | ✅ *(via the Lab)* | `/lab` → run the scenarios; `workflow-repeat-refused` is prevented by a recalled rule |
| Deferral under a relayer rate limit | ⚠ intermittent | Only appears if the shared relayer limit is hit mid-run |

**Not demonstrable on demand:** the deferral behaviour, because it depends on the
shared Walrus relayer rate limit being exhausted at that moment. If it does not
appear, say so — do not stage it. A transport problem is never a verdict; the
honest statement is "a rate limit is not a verdict."

## Cast

- The **live application**, already deployed at
  <https://aftermath-7tij.vercel.app/>.
- One browser, one tab. Full-screen the browser so the reliability-console
  styling reads clearly.

## Storyboard

### 0:00–0:20 — The problem (talking head or title card)

> An AI agent says "the charge completed successfully." Is that true? AFTERMATH's
> thesis is one line: **a claim is not evidence — and every failure should leave
> a safeguard.** Most systems log the failure and move on. AFTERMATH turns a
> verified failure into a rule it will apply next time.

### 0:20–0:55 — The front door: submit an incident

- **Page:** the **Investigate** page, <https://aftermath-7tij.vercel.app/>.
- **Action:** paste the sample below into the incident box and click
  **Investigate incident**.
- **Observe:** the hero reads *"Every failure should leave a safeguard."* The
  progress steps appear in order: validating → parsing (rule-based) → reading
  (AI-assisted, if configured) → consulting connected sources → assembling the
  evidence assessment → retrieving related memories → proposing a safeguard →
  verifying against the decision engine → preserving the record.
- **Claim it supports:** AFTERMATH turns pasted failure material into a structured
  record through a fixed, inspectable pipeline — the input is parsed, never
  executed.

Sample (identical to the app's built-in *"Use a sample incident"* button):

```text
2026-03-01T10:00:00Z ERROR checkout-service
POST /v1/charge returned 503 Service Unavailable
retrying (attempt 2/3)...
2026-03-01T10:00:07Z WARN checkout-service charge status: unknown
2026-03-01T10:00:08Z INFO agent "the charge completed successfully"
```

### 0:55–1:35 — The evidence is grounded, and uncertainty is explicit

- **Page/feature:** the **Safeguard Record** returned from that submission.
- **Action:** scroll through the record's stages: Evidence → Hypothesis →
  Safeguard → Verification → Memory.
- **Observe:**
  1. Each **observed fact** carries a **verbatim span** copied from the submitted
     material — nothing is paraphrased into a "fact."
  2. **Evidence: UNKNOWN**. The sample names no authoritative system, so the
     engine will not conclude the charge succeeded or failed. That label is the
     product working, not a gap.
  3. **Supporting / Contradicting / Unknowns / Assumptions** appear as separate
     lists, and **Expected** and **Actual** are kept apart.
- **Claim it supports:** a claim in the material is not upgraded into a verdict
  without evidence; the record states exactly how far each remark is verified.

### 1:35–2:00 — The AI reading is additive, and says whether it ran

- **Page/feature:** the **AI-assisted reading** section of the same record.
- **Action:** point at the **`aiAnalysis.ran`** flag and the **Facts grounded in
  the material** list.
- **Observe:** in production the provider is `groq`, model `openai/gpt-oss-120b`,
  so `ran` is `true` and a grounded reading appears. Every fact the model keeps
  cites a span that appears verbatim in the submission; anything else is
  discarded and listed under **Model claims rejected by grounding**.
- **Claim it supports:** the model is a *claim generator, not a decider* — it
  cannot set the evidence status, diagnosis, decision, or verification, and
  whether it ran is reported, never inferred.
- **If `GROQ_API_KEY` is unset** (locally): the same record is the deterministic
  parse and states no model was configured. Do not imply a model ran when `ran`
  is `false`.

### 2:00–2:30 — Memory: the lesson is preserved on Walrus Mainnet

- **Page/feature:** **Memory Ledger** in the nav (`/memory`).
- **Action:** read the headline counters, then run a recall query on the page.
- **Observe:** **Completed Mainnet writes** and **Recall-verified** writes are
  kept separate, alongside **Memories in namespace** (the authoritative relayer
  count). Read live, the instance currently shows 87 completed, 86
  recall-verified, and 242 memories in the namespace. The two write counters
  differ because a write can complete while its follow-up recall is itself
  rate-limited. The recall query returns real blobs (ids, similarity distances).
- **Claim it supports:** the Walrus integration is real Mainnet persistence —
  writes are confirmed by recall, and the ≥10-memory requirement is met from the
  ledger, not asserted.

### 2:30–3:00 — The learning loop and the close

- **Page/feature:** **Evaluation Lab** (`/lab`), then **Safeguard Records**
  (`/records`).
- **Action:** press **Run from scratch**; then open **Safeguard Records**.
- **Observe:** the run advances in bounded batches (a full run exceeds one
  serverless request) because several scenarios perform a real Walrus Memory
  Mainnet write. Watch the repeat scenario `workflow-repeat-refused`, titled
  *"Repeat attempt refused by the safeguard"*: the engine **recalls** the earlier
  lesson and the decision is `REQUIRE_VERIFICATION`, not `ALLOW` — a previously
  learned safeguard changing a later decision.
- **Claim it supports:** memory changes the decision. A learning loop that
  persists a lesson and applies it to the next occurrence is the product's
  central claim, and it is reproducible from a clean run.
- **Honesty note if asked:** the scenario's *input fixture* is labelled
  `simulated` (it is a controlled world), but the *memory write* it produces is
  real — on the live deployment every write carries `backend: memwal-mainnet`,
  `provenance: live`.
- **Close on screen:** the repo and blog:
  - Repo: <https://github.com/itzebe/aftermath>
  - Blog: <https://itzebe.github.io/aftermath/>

> Every failure leaves a safeguard. The engine states exactly how far each claim
> is verified, and never further.

## Recording instructions

- Tools to use (any one): macOS QuickTime/`screencapture`, Windows Xbox Game Bar
  (`Win+G`), Linux `wf-recorder` / OBS / `ffmpeg`.
- One take, 1920×1080, system audio off, voice-over optional but recommended.
- Capture the **production** URL so the ledger and relayer figures are real.
- If a run hits the relayer rate limit, keep the footage and narrate the deferral
  honestly — it is the product's thesis in action.
- Target length 2:30; hard ceiling 3:00.
- Export H.264 MP4, ≤ 100 MB. Upload and paste the URL into the submission form
  and into `SUBMISSION.md`. A committed `docs/DEMO.md` is not a substitute for a
  recording; mark the URL once it exists.

## The shortest honest cut (if time is short)

If only 60 seconds are available, do steps 0:20–0:55 (submit), 0:55–1:35
(grounded evidence + `UNKNOWN`), and 2:30–3:00 (repeat refused via recalled
memory). Those three beats carry the thesis; the Memory Ledger numbers and the
AI `ran` flag are the proof.
