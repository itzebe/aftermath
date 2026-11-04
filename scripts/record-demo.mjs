/**
 * Record the final production demo.
 *
 * Drives the live deployment at https://aftermath-7tij.vercel.app as an
 * anonymous visitor (no admin token, no seed data) and captures video with
 * Playwright. Each scene is held for the length of its narration so the
 * synthesized audio track lines up; scene boundaries are written to
 * artifacts/demo-audio/scene-log.json for the audio builder.
 *
 * The centrepiece is the Tatum counterfactual: one claim over three real Sui
 * Mainnet digests, yielding ALLOW, BLOCK and REQUIRE_VERIFICATION. Every
 * digest is a genuine Mainnet transaction and each sample reproduces a record
 * that already exists, so the run spends no new Mainnet writes.
 *
 *   node scripts/record-demo.mjs
 */
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "https://aftermath-7tij.vercel.app";
const OUT = "/tmp/demorec/video";
const TIMINGS = JSON.parse(fs.readFileSync("artifacts/demo-audio/timings.json", "utf8"));
const dur = (id) => TIMINGS.find((t) => t.id === id).seconds;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const TITLE_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#06080b;color:#eceff5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
.wrap{height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 96px}
.k{font:600 15px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:3px;color:#5b9dff;text-transform:uppercase}
h1{font-size:56px;line-height:1.1;margin:20px 0 0;font-weight:650;letter-spacing:-.5px}
p{margin:24px 0 0;font-size:20px;color:#b6c0cf;max-width:940px;line-height:1.55}
.q{margin-top:40px;font-size:22px;color:#eceff5;max-width:900px;line-height:1.5;border-left:3px solid #d7a63f;padding-left:22px}
.t{margin-top:40px;font:500 14px/1.4 ui-monospace,monospace;color:#7e8a9c;letter-spacing:1px}
</style></head><body><div class="wrap">
<div class="k">Total Recall &middot; Tatum &times; Walrus</div>
<h1>AFTERMATH</h1>
<div class="q">Every agent reports success. Not every agent is right.</div>
<p>Every failure should leave a safeguard.</p>
<div class="t">Recorded live from aftermath-7tij.vercel.app</div>
</div></body></html>`;

const END_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#06080b;color:#eceff5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
.wrap{height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 96px}
h1{font-size:44px;margin:0;font-weight:650;letter-spacing:-.5px}
p{margin:22px 0 0;font-size:20px;color:#b6c0cf;max-width:900px;line-height:1.55}
.t{margin-top:38px;font:500 14px/1.4 ui-monospace,monospace;color:#7e8a9c;letter-spacing:1px}
</style></head><body><div class="wrap">
<h1>Every failure should leave a safeguard.</h1>
<p>Investigate &rarr; learn &rarr; persist to Walrus Memory Mainnet &rarr; recall &rarr; change a later decision &rarr; verify the change.</p>
<div class="t">aftermath-7tij.vercel.app &nbsp;&middot;&nbsp; github.com/itzebe/aftermath</div>
</div></body></html>`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  recordVideo: { dir: OUT, size: { width: 1600, height: 1000 } },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();
const sceneLog = [];
let t0 = 0;
const now = () => (Date.now() - t0) / 1000;

async function scene(id, fn, minSeconds) {
  const start = now();
  try { await fn(); } catch (e) { sceneLog.push({ id, err: String(e).slice(0, 200) }); }
  const elapsed = now() - start;
  const hold = Math.max(0, (minSeconds ?? 0) - elapsed);
  if (hold > 0) await page.waitForTimeout(hold * 1000);
  sceneLog.push({ id, start: +start.toFixed(3), end: +now().toFixed(3), duration: +(now() - start).toFixed(3) });
  console.log(`${id}: ${(now() - start).toFixed(1)}s (narration ${(minSeconds ?? 0).toFixed(1)}s)`);
}

/** Scroll a spine node (evidence/safeguard/verification/memory) to the top. */
async function showNode(index) {
  await page.evaluate((i) => {
    const n = document.querySelectorAll("li.spine-node")[i];
    if (n) n.scrollIntoView({ block: "start" });
    window.scrollBy(0, -140);
  }, index);
}

/** Submit the named sample on a fresh page and wait for the record. */
async function investigate(sampleLabel) {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const e = document.querySelector("#investigate");
    if (e) e.scrollIntoView({ block: "start" });
    window.scrollBy(0, -90);
  });
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: sampleLabel }).click({ timeout: 15000 });
  await page.waitForTimeout(350);
  await page.getByRole("button", { name: "Investigate incident" }).click({ timeout: 15000 });
  await page.getByText("Investigation complete").first().waitFor({ timeout: 90000 });
  await page.waitForTimeout(900);
}

t0 = Date.now();

await scene("problem", async () => {
  await page.goto("data:text/html;charset=utf-8," + encodeURIComponent(TITLE_HTML), { waitUntil: "load" });
}, dur("problem"));

await scene("counterfactual", async () => {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1400);
  await page.evaluate(() => {
    const e = document.querySelector("#investigate");
    if (e) e.scrollIntoView({ block: "start" });
    window.scrollBy(0, -90);
  });
  await page.waitForTimeout(1200);
}, dur("counterfactual"));

await scene("failed", async () => {
  await investigate("Sui transaction: failed");
  await showNode(3);          // 04 Safeguard — BLOCK
  await page.waitForTimeout(3600);
  await showNode(1);          // 02 Evidence — VERIFIED_FAILURE
}, dur("failed"));

await scene("succeeded", async () => {
  await investigate("Sui transaction: succeeded");
  await showNode(3);          // 04 Safeguard — ALLOW
  await page.waitForTimeout(3200);
  await showNode(1);          // 02 Evidence — VERIFIED_SUCCESS
}, dur("succeeded"));

await scene("unknown", async () => {
  await investigate("Sui transaction: unknown");
  await showNode(3);          // 04 Safeguard — REQUIRE VERIFICATION
  await page.waitForTimeout(3000);
  await showNode(1);          // 02 Evidence — the honest unknown
}, dur("unknown"));

await scene("persist", async () => {
  await page.goto(BASE + "/memory", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3200);
  await page.evaluate(() => window.scrollBy(0, 380));
}, dur("persist"));

await scene("learning", async () => {
  await page.goto(BASE + "/learning", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2800);
  await page.evaluate(() => {
    const e = document.querySelector("#behaviour");
    if (e) e.scrollIntoView();
  });
  await page.waitForTimeout(Math.max(1500, dur("learning") * 1000 - 9000));
  await page.evaluate(() => {
    const e = document.querySelector("#provenance");
    if (e) e.scrollIntoView();
  });
}, dur("learning"));

await scene("close", async () => {
  await page.goto("data:text/html;charset=utf-8," + encodeURIComponent(END_HTML), { waitUntil: "load" });
}, dur("close"));

await ctx.close();
await browser.close();

fs.mkdirSync("artifacts/demo-audio", { recursive: true });
fs.writeFileSync("artifacts/demo-audio/scene-log.json", JSON.stringify(sceneLog, null, 1));
const total = sceneLog.reduce((a, s) => a + (s.duration || 0), 0);
console.log("TOTAL_SECONDS", total.toFixed(1));
console.log("VIDEO", fs.readdirSync(OUT).map((f) => `${f} ${fs.statSync(`${OUT}/${f}`).size}`).join(", "));
