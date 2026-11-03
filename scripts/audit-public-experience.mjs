/**
 * Public-experience and accessibility sweep against the *deployed* site.
 *
 * This is an operational check, not a test: it drives the production URL as an
 * anonymous visitor and records what a judge would see. It asserts nothing that
 * would fail a build; it writes a JSON report under artifacts/evidence/ so the
 * result is auditable. Run with:
 *
 *   node scripts/audit-public-experience.mjs
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const BASE = process.env.AFTERMATH_PROD_URL ?? "https://aftermath-7tij.vercel.app";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AXE = readFileSync(
  path.join(ROOT, "node_modules/axe-core/axe.min.js"),
  "utf8",
);

const PUBLIC_ROUTES = [
  "/",
  "/records",
  "/learning",
  "/lab",
  "/incidents",
  "/safeguards",
  "/memory",
  "/evaluation",
];

const report = { target: BASE, capturedAt: new Date().toISOString(), routes: [] };

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  colorScheme: "dark",
});
const page = await context.newPage();

for (const route of PUBLIC_ROUTES) {
  const entry = { route, httpStatus: null, title: null, a11y: null, errors: [] };
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  try {
    const res = await page.goto(BASE + route, {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    entry.httpStatus = res ? res.status() : null;
    entry.title = await page.title();
    // Wait for the client view model to settle before sweeping.
    await page.waitForTimeout(1200);
    await page.addScriptTag({ content: AXE });
    const results = await page.evaluate(async () => {
      // @ts-expect-error injected
      return await window.axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      });
    });
    const blocking = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    entry.a11y = {
      violations: results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.length,
      })),
      blocking: blocking.map((v) => `${v.id}(${v.nodes.length})`),
      passes: results.passes.length,
    };
  } catch (err) {
    entry.errors.push(err instanceof Error ? err.message : String(err));
  }
  entry.errors.push(...pageErrors);
  report.routes.push(entry);
  const blocking = entry.a11y ? entry.a11y.blocking : ["(not scanned)"];
  console.log(
    `${route.padEnd(12)} HTTP ${entry.httpStatus}  blocking=${JSON.stringify(blocking)}`,
  );
}

await browser.close();
const out = path.join(ROOT, "artifacts/evidence/public-experience-audit.json");
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\nwrote ${path.relative(ROOT, out)}`);
