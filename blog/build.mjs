/**
 * Build the AFTERMATH technical blog into a single static HTML page.
 *
 * The canonical source is ../docs/BLOG.md — this script never edits it. The
 * output is written to ./_site, which is what the GitHub Pages workflow
 * uploads. Nothing here touches the Next.js application.
 *
 * The build is deterministic and fails loudly rather than shipping a page with
 * missing content: after rendering it re-parses both the Markdown source and
 * the generated HTML and asserts the counts match.
 */
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { marked } from "marked";

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(here, "..", "docs", "BLOG.md");
const OUT_DIR = join(here, "_site");
const OUT_FILE = join(OUT_DIR, "index.html");

const REPO_URL = "https://github.com/itzebe/aftermath";
const AUTHOR = "itzebe";

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

function fail(msg) {
  console.error(`\nblog build FAILED: ${msg}\n`);
  process.exit(1);
}

const md = await readFile(SOURCE, "utf8");

// --- render -----------------------------------------------------------------
const headings = [];
marked.use({
  gfm: true,
  renderer: {
    heading({ tokens, depth }) {
      const inner = this.parser.parseInline(tokens);
      const text = inner.replace(/<[^>]+>/g, "");
      const id = slug(text);
      headings.push({ depth, text, id });
      return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
    },
  },
});
const bodyHtml = marked.parse(md);

// --- derive metadata from the source ---------------------------------------
const titleLine = md.split("\n").find((l) => /^#\s+/.test(l));
if (!titleLine) fail("no H1 title found in docs/BLOG.md");
const pageTitle = titleLine.replace(/^#\s+/, "").trim();

// --- integrity: compare source structure with rendered output ---------------
const srcHeadings = [...md.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((m) => m[2].trim());
const srcTableRows = (md.match(/^\|.*$/gm) || []).filter(
  (line) => !/^\|[\s:|-]+\|?\s*$/.test(line),
).length;
const srcFences = Math.floor((md.match(/^```/gm) || []).length / 2);
const srcListItems = (md.match(/^\s*(?:[-*]|\d+\.)\s+/gm) || []).length;
const srcLinks = (md.match(/\]\(https?:\/\/[^)]+\)|<https?:\/\/[^>]+>/g) || []).length;

const htmlTableRows = (bodyHtml.match(/<tr>/g) || []).length;
const htmlCodeBlocks = (bodyHtml.match(/<pre><code/g) || []).length;
const htmlListItems = (bodyHtml.match(/<li>/g) || []).length;
const htmlLinks = (bodyHtml.match(/href="https?:\/\//g) || []).length;

if (headings.length !== srcHeadings.length)
  fail(`heading count mismatch: source ${srcHeadings.length}, rendered ${headings.length}`);

// Every source heading's text must appear verbatim in the rendered output.
for (const h of srcHeadings) {
  const bare = h.replace(/[`*]/g, "");
  if (!bodyHtml.includes(bare.split(" ").slice(0, 3).join(" ")))
    fail(`heading missing from output: "${h}"`);
}

if (htmlTableRows !== srcTableRows)
  fail(`table row mismatch: source ${srcTableRows}, rendered ${htmlTableRows}`);
if (htmlCodeBlocks !== srcFences)
  fail(`code block mismatch: source ${srcFences}, rendered ${htmlCodeBlocks}`);
if (htmlListItems < srcListItems)
  fail(`list item mismatch: source ${srcListItems}, rendered ${htmlListItems}`);
if (htmlLinks < srcLinks)
  fail(`link mismatch: source ${srcLinks}, rendered ${htmlLinks}`);

// The article must end where the source ends — guards against silent truncation.
const lastProse = md.trim().split("\n").filter(Boolean).pop();
const lastWords = lastProse.replace(/[*_`]/g, "").split(/\s+/).slice(-4).join(" ");
if (!bodyHtml.includes(lastWords))
  fail(`final line of the article is missing from output (expected: "...${lastWords}")`);

// A wrapped prose line that begins with a bullet marker (`- `, `* `, `+ `) is
// parsed by GFM as a new list, silently splitting a sentence. That is a real
// rendering bug, so refuse to publish it rather than ship the mangled page.
const lines = md.split("\n");
for (let i = 1; i < lines.length; i++) {
  if (/^[+*-]\s/.test(lines[i]) && lines[i - 1] !== "" && !/^\s/.test(lines[i - 1]) &&
      !/^[+*-]\s|^\s+/.test(lines[i - 1]) && !/^\|/.test(lines[i - 1])) {
    fail(`line ${i + 1} starts with a list marker mid-paragraph: "${lines[i].slice(0, 60)}"`);
  }
}

// --- build the page ---------------------------------------------------------
const toc = headings
  .filter((h) => h.depth === 2)
  .map((h) => `        <li><a href="#${h.id}">${h.text}</a></li>`)
  .join("\n");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${pageTitle}</title>
<meta name="description" content="AFTERMATH — an evidence-backed failure-prevention engine for AI agents, built with Walrus Memory and Tatum. A Total Recall (Tatum × Walrus) submission.">
<meta name="author" content="${AUTHOR}">
<meta name="color-scheme" content="light dark">
<meta property="og:type" content="article">
<meta property="og:title" content="${pageTitle}">
<meta property="og:description" content="Evidence-backed failure prevention for AI agents: Walrus Memory (Mainnet) + Tatum Sui verification.">
<meta property="og:url" content="${REPO_URL}">
<link rel="canonical" href="${REPO_URL}">
<style>
  :root {
    --bg: #fbfbf9;
    --surface: #ffffff;
    --ink: #1a1c1a;
    --ink-soft: #4a4f4a;
    --rule: #e2e4df;
    --accent: #0f6f5c;
    --accent-ink: #ffffff;
    --code-bg: #f2f3ef;
    --quote-bar: #c8cdc4;
    --max: 46rem;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14161a;
      --surface: #1b1e23;
      --ink: #e8eae6;
      --ink-soft: #a9b0a8;
      --rule: #2c3138;
      --accent: #5fd0b0;
      --accent-ink: #06231c;
      --code-bg: #23272d;
      --quote-bar: #3a4149;
    }
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font: 17px/1.68 ui-serif, Georgia, "Times New Roman", serif;
    padding: 0 1.1rem 5rem;
  }
  .wrap { max-width: var(--max); margin: 0 auto; }
  .topbar {
    display: flex; flex-wrap: wrap; gap: .5rem 1.1rem;
    align-items: center; justify-content: space-between;
    padding: 1rem 0; border-bottom: 1px solid var(--rule);
    margin-bottom: 2rem;
    font: 600 14px/1.3 ui-sans-serif, system-ui, sans-serif;
  }
  .topbar a { color: var(--accent); text-decoration: none; }
  .topbar a:hover, .topbar a:focus { text-decoration: underline; }
  .badge {
    display: inline-block; padding: .2rem .55rem; border-radius: 999px;
    background: var(--accent); color: var(--accent-ink);
    font: 600 12px/1.4 ui-sans-serif, system-ui, sans-serif;
  }
  article h1 {
    font-size: clamp(1.65rem, 4.6vw, 2.5rem);
    line-height: 1.18; letter-spacing: -.015em; margin: .2rem 0 .5rem;
  }
  article h2 {
    font-size: clamp(1.28rem, 3vw, 1.62rem); line-height: 1.25;
    margin: 2.6rem 0 .7rem; padding-top: 1.1rem;
    border-top: 1px solid var(--rule);
  }
  article h3 { font-size: 1.14rem; line-height: 1.3; margin: 1.9rem 0 .5rem; }
  article h4, article h5, article h6 { font-size: 1rem; margin: 1.5rem 0 .4rem; }
  article p { margin: .85rem 0; }
  article em { color: var(--ink-soft); }
  article a { color: var(--accent); text-underline-offset: 2px; word-break: break-word; }
  article ul, article ol { padding-left: 1.35rem; }
  article li { margin: .32rem 0; }
  article strong { font-weight: 700; }
  blockquote {
    margin: 1.2rem 0; padding: .35rem 0 .35rem 1.1rem;
    border-left: 3px solid var(--quote-bar); color: var(--ink-soft);
  }
  blockquote p { margin: .35rem 0; }
  code {
    font: 90%/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background: var(--code-bg); padding: .12em .38em; border-radius: 4px;
  }
  pre {
    background: var(--code-bg); border: 1px solid var(--rule); border-radius: 8px;
    padding: .9rem 1rem; overflow-x: auto; -webkit-overflow-scrolling: touch;
  }
  pre code { background: none; padding: 0; font-size: 13.5px; }
  table {
    width: 100%; border-collapse: collapse; margin: 1.2rem 0;
    font: 15px/1.5 ui-sans-serif, system-ui, sans-serif;
    display: block; overflow-x: auto; -webkit-overflow-scrolling: touch;
  }
  th, td { border: 1px solid var(--rule); padding: .5rem .65rem; text-align: left; vertical-align: top; }
  th { background: var(--code-bg); font-weight: 700; }
  hr { border: 0; border-top: 1px solid var(--rule); margin: 2.4rem 0; }
  .toc {
    background: var(--surface); border: 1px solid var(--rule); border-radius: 10px;
    padding: 1rem 1.2rem 1.1rem; margin: 1.6rem 0 2rem;
    font: 15px/1.6 ui-sans-serif, system-ui, sans-serif;
  }
  .toc h2 { margin: 0 0 .5rem; font-size: .82rem; text-transform: uppercase;
    letter-spacing: .09em; color: var(--ink-soft); border: 0; padding: 0; }
  .toc ul { list-style: none; padding: 0; margin: 0; columns: 2; column-gap: 1.6rem; }
  .toc li { margin: .22rem 0; break-inside: avoid; }
  .toc a { color: var(--accent); text-decoration: none; }
  .toc a:hover, .toc a:focus { text-decoration: underline; }
  @media (max-width: 30rem) { .toc ul { columns: 1; } }
  footer {
    margin-top: 3.2rem; padding-top: 1.3rem; border-top: 1px solid var(--rule);
    color: var(--ink-soft); font: 14px/1.6 ui-sans-serif, system-ui, sans-serif;
  }
  a:focus-visible, [tabindex]:focus-visible {
    outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 3px;
  }
</style>
</head>
<body>
<div class="wrap">
  <nav class="topbar">
    <span><span class="badge">Total Recall</span> &nbsp;Tatum × Walrus</span>
    <span><a href="${REPO_URL}">Repository</a> &nbsp;·&nbsp; <a href="${REPO_URL}/blob/master/docs/BLOG.md">Markdown source</a></span>
  </nav>
  <div class="toc" aria-label="Contents">
    <h2>Contents</h2>
    <ul>
${toc}
    </ul>
  </div>
  <main>
    <article>
${bodyHtml}
    </article>
  </main>
  <footer>
    <p>Written by <a href="https://github.com/${AUTHOR}">@${AUTHOR}</a> with an AI agent (OpenHands) on behalf of the project owner.
    Source and code: <a href="${REPO_URL}">${REPO_URL}</a>. Licensed and attributed as in the repository.</p>
  </footer>
</div>
</body>
</html>
`;

// --- emit -------------------------------------------------------------------
await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT_FILE, html, "utf8");

const kb = (Buffer.byteLength(html, "utf8") / 1024).toFixed(1);
console.log(`blog build OK`);
console.log(`  source : docs/BLOG.md (${md.length} chars)`);
console.log(`  output : blog/_site/index.html (${kb} KB)`);
console.log(`  title  : ${pageTitle}`);
console.log(`  checked: ${headings.length} headings, ${htmlTableRows} table rows, ${htmlCodeBlocks} code blocks, ${htmlListItems} list items, ${htmlLinks} links`);
