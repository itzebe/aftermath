# Total Recall — final submission checklist

**Destination:** <https://recall-tatum-walrus.vercel.app/> (the official form).
**Deadline:** 10 Nov 2026, 17:00 UTC. **Track:** 02 — Smart Agents for Real Life.
**Prepared:** 2026-11-04. **Nothing has been submitted or published.**

Follow this top to bottom. Every "paste" value is copy-ready; every
`USER INPUT REQUIRED` value must come from you. Stop before the final **Submit
project** click — that action is yours.

---

## Step 0 — Before you open the form

- [ ] Confirm the current production deployment is still healthy:
      `curl -s https://aftermath-7tij.vercel.app/api/overview | head -c 200`.
      Expected: `memory.backend = "memwal-mainnet"`, `completedLiveWrites: 196`.
- [ ] Have your owner-held values ready (see Step 3). Do **not** type them into
      any file in this repository.
- [ ] Decide the demo-video URL (Step 4).

## Step 1 — Open the form

- [ ] Go to <https://recall-tatum-walrus.vercel.app/>.
- [ ] Click **Submit Project** (top-right). A modal opens with sections
      **01 Contact**, **02 Accounts**, **03 Project**, **04 Feedback**.
- [ ] Do **not** touch the header "Describe what you want to build" box — that is
      the AI-Builder prompt, not the form.

## Step 2 — Paste the ready answers

Copy each value from `TOTAL-RECALL-FORM-ANSWERS.md` (same field order). Summary:

| Field | Paste value |
| --- | --- |
| 12 Project description | the 2-paragraph description in `FORM-ANSWERS.md` §12 |
| 13 Demo video URL | see Step 4 |
| 14 GitHub repo | `https://github.com/itzebe/aftermath` |
| 15 Additional documentation | `https://itzebe.github.io/aftermath/` (blog mirror; Medium linked there) |
| 16 Walrus experience | `FORM-ANSWERS.md` §16 |
| 17 Tatum AI Builder experience | `FORM-ANSWERS.md` §17 — states plainly we did **not** use AI Builder |
| 18 Walrus friction (optional) | `FORM-ANSWERS.md` §18 |
| 19 Social post links (optional) | see Step 6 |

## Step 3 — Supply your owner-held details (`USER INPUT REQUIRED`)

These cannot be invented and are not in the repository:

| Field | What to supply |
| --- | --- |
| 1 Email | your email |
| 2 Discord handle | your Discord username (no `@`) |
| 3 LinkedIn | your LinkedIn URL |
| 4 Telegram ID | optional — leave blank if none |
| 5 How did you hear about this event? | your truthful select option |
| 6 Community/account (optional, ≤200 chars) | optional |
| 7 Is this your first Web3 project? | Yes / No (your truthful answer) |
| 8 Tatum ID | dashboard.tatum.io → My Account → My Account Info |
| 9 SUI address | your Sui address (`0x…`) |
| 10 Account ID (SUI) | the Walrus Memory account object id (`MEMWAL_ACCOUNT_ID`) |
| 11 MEMWAL_AGENT_ID | the delegate **public key** on memory.walrus.xyz/dashboard |

## Step 4 — Demo video

- [ ] **Fastest:** paste `https://github.com/itzebe/aftermath/releases/tag/demo-v2`
      (2:36, verified downloadable) into field 13.
- [ ] **Or** upload `artifacts/aftermath-final-demo.mp4` (2:22, 1280×800) to
      YouTube (unlisted is fine) and paste that URL. Field 13 is `type=url`.
- [ ] Do not paste a local file path — the field requires a public URL.

## Step 5 — Review the declaration

- [ ] Tick **"I am 18+ and agree to the Event Rules, the Tatum Terms of Use, the
      Walrus General Terms of Service, and the Walrus Privacy Policy…"** only
      after you have read those terms. This is the only consent checkbox.
- [ ] Confirm the event rules: one submission per person; original work;
      Mainnet Walrus Memory (10+ writes) — AFTERMATH has 196 completed / 193
      recall-verified writes, so this is satisfied.

## Step 6 — Optional scored bonus

- [ ] Post about AFTERMATH on X or LinkedIn, tagging `@Tatum_io` and
      `@WalrusFoundation` (tagging is optional but may earn extra points), then
      paste the post URL into field 19.

## Step 7 — Final review before submitting

- [ ] Re-read every pasted field once for accuracy.
- [ ] Confirm fields 13 and 14 are valid URLs (browser will enforce).
- [ ] Confirm field 6 is ≤200 characters.
- [ ] Confirm no field contains a secret, private key, or token.
- [ ] Click **Submit project**. This is the only irreversible action and is
      **yours to take**.

---

## What is already done for you

- The application is deployed and healthy at
  <https://aftermath-7tij.vercel.app/> (all eight public routes HTTP 200).
- Mainnet requirement satisfied: 196 completed / 193 recall-verified Walrus
  writes, 0 simulated.
- Tatum Sui Mainnet integration is live and load-bearing (three-digest
  counterfactual verified 3/3 through Tatum and a public Sui fullnode).
- The blog post is published and publicly discoverable.
- All submission documents in this folder are synchronized to the current
  deployment.

## What must not happen

- Do not submit the Devpost file (`artifacts/DEVPOST-SUBMISSION.md`). Devpost is
  **not** the destination for this hackathon.
- Do not publish the demo video or the social post until you have reviewed them.
- Do not delete the duplicate Vercel project `aftermath`
  (`aftermath-theta.vercel.app`) as part of this mission.
