# AFTERMATH — demo storyboard (2–3 minutes)

Recording status: **not recorded.** No screen-capture tool is available in the
build environment, so this is a timestamped storyboard with exact click paths and
copy-paste material, plus recording instructions. Nothing here is presented as a
recorded video.

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

1. Open <https://aftermath-7tij.vercel.app/> (the **Investigate** page). The hero
   reads *"Every failure should leave a safeguard."*
2. Paste this sample into the incident box (the app ships a similar default):

   ```text
   2026-03-01T10:00:00Z ERROR checkout-service
   POST /v1/charge returned 503 Service Unavailable
   retrying (attempt 2/3)...
   2026-03-01T10:00:07Z WARN checkout-service charge status: unknown
   2026-03-01T10:00:08Z INFO agent "the charge completed successfully"
   ```

3. Click **Investigate incident**. The progress steps appear in order:
   validating → parsing (rule-based) → reading (AI-assisted, if configured) →
   consulting connected sources → assembling the evidence assessment → retrieving
   related memories → proposing a safeguard → verifying against the decision
   engine → preserving the record.

### 0:55–1:35 — The evidence is grounded, and uncertainty is explicit

1. On the resulting **Safeguard Record**, point at the **observed facts**: each
   one carries a **verbatim span** copied from the submitted material. Nothing is
   paraphrased into a "fact."
2. Point at **Evidence: UNKNOWN** — the sample names no authoritative system, so
   the engine will not conclude the charge succeeded or failed. That label is the
   product working, not a gap.
3. Show **Supporting / Contradicting / Unknowns / Assumptions** as separate
   lists, with **Expected / Actual** kept apart.
4. **Key line:** the record refuses to upgrade the agent's claim into a verdict
   without evidence.

### 1:35–2:00 — The AI reading is additive, and says whether it ran

1. On the record, show the AI section and the **`aiAnalysis.ran`** flag. In
   production the provider is `groq`, model `openai/gpt-oss-120b`, so `ran` is
   `true` and a grounded reading appears.
2. **Key line:** every fact the model keeps must cite a span that appears
   verbatim in the submission; anything else is discarded and counted as a
   rejected claim. The model cannot set the evidence status, the diagnosis, the
   decision, or the verification — it is a claim generator, not a decider.
3. If you want to show the no-provider path, note that without `GROQ_API_KEY`
   the same record is the deterministic parse and states no model was configured.
   Do not imply a model ran when `ran` is `false`.

### 2:00–2:30 — Memory: the lesson is preserved on Walrus Mainnet

1. Click **Memory Ledger** in the nav (`/memory`).
2. Show the two numbers kept **separately**: **Completed Mainnet writes** and
   **Recall-verified** writes, plus **Memories in namespace** (the authoritative
   relayer count). Explain why they differ: a write can be completed but its
   follow-up recall can itself be rate-limited.
3. Run a recall query on the page and show real blobs coming back — the stored
   lesson is retrievable, not just written.
4. **Key line:** the requirement is ten genuine Mainnet memories; the live
   instance reports far more, read from the ledger rather than asserted.

### 2:30–3:00 — The learning loop and the close

1. Open the **Evaluation Lab** (`/lab`).
2. Press **Run from scratch**. The run advances in bounded batches (a full run
   exceeds one serverless request) because several scenarios perform a real
   Walrus Memory Mainnet write. Show the repeat scenario
   `workflow-repeat-refused`, titled "Repeat attempt refused by the safeguard":
   the engine **recalls** the earlier lesson and the decision is
   `REQUIRE_VERIFICATION`, not `ALLOW`. That is memory changing the decision —
   the whole point.
   - Honesty note if asked: the scenario's input fixture is labelled
     `simulated` (it is a controlled world), but the memory write it produces is
     real — on the live deployment every write carries
     `backend: memwal-mainnet`, `provenance: live`.
3. Show **Safeguard Records** (`/records`) listing the connected artifacts.
4. Close on the repo and blog on screen:
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
