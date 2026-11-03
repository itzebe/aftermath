/**
 * Record the production demo.
 *
 * Drives the live deployment at https://aftermath-7tij.vercel.app as an
 * ordinary visitor — no admin token, no seed data — and captures the video
 * through Playwright. A caption bar is injected into the page so the narration
 * is burned into the frames; the same captions are written to
 * artifacts/mission9/demo-capture-log.json with their timestamps, which
 * scripts/... derives the .srt from.
 *
 *   node scripts/record-demo.mjs
 *   # then transcode the newest webm under /tmp/demorec/video:
 *   ffmpeg -y -i <webm> -c:v libx264 -preset medium -crf 21 -pix_fmt yuv420p \
 *     -movflags +faststart -an artifacts/mission9/aftermath-demo-m9.mp4
 */
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "https://aftermath-7tij.vercel.app";
const OUT = "/tmp/demorec/video";
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const CAPTION_JS = `(() => {
  const d = document.createElement('div');
  d.id = '__capbar';
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;'
    + 'background:rgba(10,10,12,0.94);color:#f5f2ea;'
    + 'font:500 17px/1.45 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;'
    + 'padding:14px 28px;letter-spacing:.2px;border-top:2px solid #d7a24a;'
    + 'box-shadow:0 -8px 30px rgba(0,0,0,.45);';
  d.textContent = '';
  document.documentElement.appendChild(d);
})();`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: OUT, size: { width: 1280, height: 800 } },
  deviceScaleFactor: 1,
});
await ctx.addInitScript(CAPTION_JS);
const page = await ctx.newPage();
const log = [];
const t0 = Date.now();
const elapsed = () => ((Date.now() - t0) / 1000);
const cap = async (t) => { await page.evaluate((x) => { const d = document.getElementById('__capbar'); if (d) d.textContent = x; }, t); log.push({ at: +elapsed().toFixed(1), caption: t }); };
const wait = (ms) => page.waitForTimeout(ms);

async function step(name, fn) {
  const s = Date.now();
  try { await fn(); log.push({ step: name, ok: true, ms: Date.now() - s }); }
  catch (e) { log.push({ step: name, ok: false, err: String(e).slice(0, 160), ms: Date.now() - s }); }
}

const TITLE_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#0b0b0e;color:#f5f2ea;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
.wrap{height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 90px}
.k{font:600 15px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:3px;color:#d7a24a;text-transform:uppercase}
h1{font-size:52px;line-height:1.12;margin:18px 0 0;font-weight:650;letter-spacing:-.5px}
p{margin:22px 0 0;font-size:19px;color:#b9b4a8;max-width:900px;line-height:1.5}
.t{margin-top:38px;font:500 14px/1.4 ui-monospace,monospace;color:#7d786c;letter-spacing:1px}
</style></head><body><div class="wrap">
<div class="k">Total Recall · Tatum &times; Walrus</div>
<h1>AFTERMATH</h1>
<p>Every failure should leave a safeguard. An investigation workspace that turns incident evidence into a testable rule, persists it to Walrus Memory Mainnet, and recalls it when a later decision needs it.</p>
<div class="t">Recorded live from aftermath-7tij.vercel.app</div>
</div></body></html>`;

const END_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#0b0b0e;color:#f5f2ea;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
.wrap{height:100%;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;padding:0 90px}
h1{font-size:46px;margin:0;font-weight:650;letter-spacing:-.5px}
p{margin:20px 0 0;font-size:19px;color:#b9b4a8;max-width:880px;line-height:1.5}
.t{margin-top:36px;font:500 14px/1.4 ui-monospace,monospace;color:#7d786c;letter-spacing:1px}
</style></head><body><div class="wrap">
<h1>Every failure should leave a safeguard.</h1>
<p>Investigate &rarr; learn &rarr; persist to Walrus Memory Mainnet &rarr; recall &rarr; change a later decision &rarr; verify the change.</p>
<div class="t">aftermath-7tij.vercel.app &nbsp;·&nbsp; github.com/itzebe/aftermath</div>
</div></body></html>`;

await step("title-card", async () => {
  await page.goto("data:text/html;charset=utf-8," + encodeURIComponent(TITLE_HTML), { waitUntil: "load" });
});
await wait(7000);

await step("home", () => page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 }));
await wait(2000);
await cap("AFTERMATH — Every failure should leave a safeguard. Recorded live from aftermath-7tij.vercel.app.");
await wait(7500);
await cap("A claim is not evidence. When an agent says the work succeeded, AFTERMATH asks for the proof.");
await wait(5500);
await page.evaluate(() => window.scrollTo(0, 720));
await wait(3200);
await cap("The investigation workspace is public: a visitor submits an incident with no credential.");
await page.evaluate(() => window.scrollTo(0, 1260));
await wait(4500);

await cap("Paste the incident. The material is parsed as data — never executed, never interpolated into a command.");
await step("use-sample", () => page.getByRole("button", { name: "Use a sample incident" }).click({ timeout: 15000 }));
await wait(1200);
await step("submit", () => page.getByRole("button", { name: "Investigate incident" }).click({ timeout: 15000 }));
await cap("Investigating: parse the evidence, form a hypothesis, propose a safeguard, then verify it against the decision engine.");
await wait(2000);
await step("await-result", () => page.getByText("Investigation complete").first().waitFor({ timeout: 90000 }));
await wait(1200);

await cap("The result is a Safeguard Record: evidence with verbatim spans, hypotheses with confidence, and a proposed safeguard.");
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.34));
await wait(5500);
await cap("Every link carries an honest state — observed, confirmed, unknown. A lookup that cannot run resolves to unknown, never to success.");
await page.evaluate(() => window.scrollBy(0, 760));
await wait(5200);
await page.evaluate(() => window.scrollBy(0, 760));
await wait(4500);

await cap("Safeguard Records: every investigation, newest first — a connected chain from incident to memory.");
await step("records", () => page.getByRole("link", { name: "Safeguard Records" }).first().click({ timeout: 15000 }));
await wait(5500);

await cap("The Memory Ledger reads live Walrus Memory Mainnet state from the relayer, namespace aftermath.");
await step("system-menu", () => page.getByRole("button", { name: "System" }).first().click({ timeout: 15000 }));
await wait(900);
await step("memory", () => page.getByRole("link", { name: "Memory Ledger" }).first().click({ timeout: 15000 }));
await wait(5000);
await cap("Completed and recall-verified writes are counted from durable records; simulated writes are excluded. The figures on screen are read live from this ledger.");
await page.evaluate(() => window.scrollBy(0, 520));
await wait(5000);

await cap("The learning loop: investigate, learn, persist to Walrus Memory, recall during a later investigation, and change a decision.");
await step("learning", () => page.getByRole("link", { name: "Learning Loop" }).first().click({ timeout: 15000 }));
await wait(6000);
await cap("Behaviour change is a real counterfactual: the same engine run with the recalled safeguard held out, then enforced.");
await page.evaluate(() => window.scrollBy(0, 640));
await wait(5500);
await cap("Provenance closes the loop: the safeguard links back to the incident that produced it and every later investigation it reached.");
await page.evaluate(() => window.scrollBy(0, 720));
await wait(5500);

await cap("Every failure should leave a safeguard.");
await wait(2600);
await step("end-card", async () => {
  await page.goto("data:text/html;charset=utf-8," + encodeURIComponent(END_HTML), { waitUntil: "load" });
});
await wait(7500);

await ctx.close();
await browser.close();
fs.writeFileSync("artifacts/mission9/demo-capture-log.json", JSON.stringify(log, null, 1));
console.log(JSON.stringify(log, null, 1));
console.log("TOTAL_SECONDS", elapsed().toFixed(1));
for (const f of fs.readdirSync(OUT)) console.log("VIDEO", f, fs.statSync(`${OUT}/${f}`).size);
