/**
 * Capture product screenshots from the live production deployment.
 * Read-only: never submits an incident, so no Mainnet write is caused.
 *   node scripts/capture-screenshots.mjs
 */
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "https://aftermath-7tij.vercel.app";
const OUT = "artifacts/screenshots";
fs.mkdirSync(OUT, { recursive: true });

const shots = [
  ["home", "/", 0],
  ["home-form", "/", 900],
  ["incidents", "/incidents", 0],
  ["safeguards", "/safeguards", 0],
  ["learning-top", "/learning", 0],
  ["learning-impact", "/learning", 900],
  ["learning-behaviour", "/learning", 1900],
  ["learning-provenance", "/learning", 3000],
  ["memory", "/memory", 0],
  ["memory-writes", "/memory", 900],
  ["evaluation", "/evaluation", 0],
  ["lab", "/lab", 0],
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
for (const [name, path, scroll] of shots) {
  await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1800);
  if (scroll) { await page.evaluate((y) => window.scrollTo(0, y), scroll); await page.waitForTimeout(900); }
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("shot", name);
}
await browser.close();
