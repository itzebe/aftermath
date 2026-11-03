/**
 * Record the final production demo.
 *
 * Drives the live deployment at https://aftermath-7tij.vercel.app as an
 * anonymous visitor (no admin token, no seed data) and captures video with
 * Playwright. Each scene is held for the length of its narration so the
 * synthesized audio track lines up; scene boundaries are written to
 * artifacts/demo-audio/scene-log.json for the audio builder.
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
<div class="q">An investigation can find out why something failed. But what happens when the same mistake happens again?</div>
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
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: OUT, size: { width: 1280, height: 800 } },
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

t0 = Date.now();

await scene("problem", async () => {
  await page.goto("data:text/html;charset=utf-8," + encodeURIComponent(TITLE_HTML), { waitUntil: "load" });
}, dur("problem"));

await scene("investigate", async () => {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.scrollTo(0, 880));
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: "Use a sample incident" }).click({ timeout: 15000 });
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: "Investigate incident" }).click({ timeout: 15000 });
  await page.getByText("Investigation complete").first().waitFor({ timeout: 90000 });
  await page.waitForTimeout(800);
}, dur("investigate"));

await scene("record", async () => {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.30));
  await page.waitForTimeout(5200);
  await page.evaluate(() => window.scrollBy(0, 760));
  await page.waitForTimeout(5600);
  await page.evaluate(() => window.scrollBy(0, 760));
}, dur("record"));

await scene("walrus", async () => {
  await page.getByRole("button", { name: "System" }).first().click({ timeout: 15000 });
  await page.waitForTimeout(700);
  await page.getByRole("link", { name: "Memory Ledger" }).first().click({ timeout: 15000 });
  await page.waitForTimeout(3200);
  await page.evaluate(() => window.scrollBy(0, 460));
}, dur("walrus"));

await scene("recall", async () => {
  await page.getByRole("button", { name: "System" }).first().click({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);
  await page.getByRole("link", { name: "Learning Loop" }).first().click({ timeout: 15000 });
  await page.waitForTimeout(1800);
  await page.evaluate(() => { const e = document.querySelector("#behaviour"); if (e) e.scrollIntoView(); });
  await page.waitForTimeout(11000);
  await page.evaluate(() => window.scrollBy(0, 700));
  await page.waitForTimeout(7000);
  await page.evaluate(() => { const e = document.querySelector("#provenance"); if (e) e.scrollIntoView(); });
}, dur("recall"));

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
