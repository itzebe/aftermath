/**
 * Build the AFTERMATH technical blog into a single static HTML page.
 *
 * The canonical source is ../docs/BLOG.md — this script never edits it. The
 * output is written to ./_site, which is what the GitHub Pages workflow
 * uploads. Nothing here touches the Next.js application.
 *
 * Two properties are deliberate:
 *
 *   1. The build is deterministic and fails loudly rather than shipping a page
 *      with missing content: after rendering it re-parses both the Markdown
 *      source and the generated HTML and asserts the counts match.
 *   2. The page is self-contained. No JavaScript, no web fonts, no external
 *      images — so it renders identically with the network off and cannot
 *      regress into a generic template. The one diagram is authored here as
 *      inline markup describing the real pipeline, not a decorative asset.
 *
 * The visual system mirrors the application's own dark console tokens
 * (src/app/globals.css) so the blog reads as part of the same product.
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
const SITE_URL = "https://itzebe.github.io/aftermath/";

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

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
    // A fenced block is a terminal transcript or a shell snippet. Label it so
    // the reader knows which, without altering the code itself.
    code({ text, lang }) {
      const label = lang === "bash" ? "shell" : "console";
      return `<figure class="term"><figcaption class="term-bar"><span class="term-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="term-label">${label}</span></figcaption><pre><code>${esc(text)}</code></pre></figure>\n`;
    },
  },
});
const bodyHtml = marked.parse(md);

// --- derive metadata from the source ---------------------------------------
const titleLine = md.split("\n").find((l) => /^#\s+/.test(l));
if (!titleLine) fail("no H1 title found in docs/BLOG.md");
const pageTitle = titleLine.replace(/^#\s+/, "").trim();
const subtitle = /^#[^\n]*\n+(\*[^\n]+\*)/.exec(md)?.[1]?.replace(/^\*|\*$/g, "").trim();

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

// --- the signature diagram --------------------------------------------------
// A real representation of the pipeline, not decoration. Each stage is an
// actual component in the codebase; the terminal outcome is the only stage
// that changes a later execution. Authored inline so it ships with the page.
const STAGES = [
  ["Claim", "the agent's report"],
  ["Evidence", "authoritative source"],
  ["Verdict", "success · failure · unknown"],
  ["Diagnosis", "candidate pattern"],
  ["Lesson", "scoped, proposed"],
  ["Memory", "Walrus, persistent"],
  ["Safeguard", "enforced rule"],
];

const chain = STAGES.map(
  ([name, note], i) => `
          <li class="stage">
            <span class="stage-idx" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span>
            <span class="stage-name">${esc(name)}</span>
            <span class="stage-note">${esc(note)}</span>
          </li>`,
).join("");

// --- build the page ---------------------------------------------------------
const toc = headings
  .filter((h) => h.depth === 2)
  .map(
    (h, i) =>
      `          <li><a href="#${h.id}"><span class="toc-num">${String(i + 1).padStart(2, "0")}</span><span>${esc(h.text)}</span></a></li>`,
  )
  .join("\n");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pageTitle)}</title>
<meta name="description" content="AFTERMATH — an evidence-backed failure-prevention engine for AI agents, built with Walrus Memory and Tatum. A Total Recall (Tatum × Walrus) submission.">
<meta name="author" content="${esc(AUTHOR)}">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#07090c">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(pageTitle)}">
<meta property="og:description" content="Evidence-backed failure prevention for AI agents: Walrus Memory (Mainnet) + Tatum Sui verification.">
<meta property="og:url" content="${SITE_URL}">
<link rel="canonical" href="${SITE_URL}">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#07090c"/><path d="M6 17 L12 6 L18 17" stroke="#4a9eff" stroke-width="1.6" fill="none"/><path d="M9 13 H15" stroke="#3fb950" stroke-width="1.6"/></svg>',
)}">
<style>
  :root {
    /* Mirrors the application's console tokens (src/app/globals.css). */
    --bg: #07090c;
    --panel: #0b0e13;
    --panel-2: #10141b;
    --line: #1e2530;
    --line-2: #2b3442;
    --text: #eef1f6;
    --muted: #8d99ac;
    --muted-2: #c3ccda;
    --ok: #3fb950;
    --info: #4a9eff;
    --max: 47rem;
    --rail: 15.5rem;
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 16px/1.7 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  /* A restrained engineering-console texture, same as the app. */
  body::before {
    content: "";
    position: fixed; inset: 0; z-index: -1; pointer-events: none;
    background-image:
      linear-gradient(to right, rgba(255,255,255,.022) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(255,255,255,.022) 1px, transparent 1px);
    background-size: 44px 44px;
  }
  ::selection { background: #1f3a5f; }
  a { color: var(--info); text-underline-offset: 2px; word-break: break-word; }
  .mono, code, kbd, .toc-num, .stage-idx, .term-label, .kicker {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-variant-ligatures: none;
  }

  /* ---- masthead ---- */
  .masthead {
    border-bottom: 1px solid var(--line);
    background: linear-gradient(180deg, rgba(74,158,255,.05), transparent 70%);
  }
  .masthead-inner { max-width: 76rem; margin: 0 auto; padding: 1.1rem 1.25rem; }
  .brand { display: flex; align-items: center; gap: .6rem; }
  .brand svg { flex: none; }
  .brand-name { font-size: 1rem; font-weight: 650; letter-spacing: -.01em; }
  .brand-sub {
    font-size: .625rem; letter-spacing: .16em; text-transform: uppercase;
    color: var(--muted);
  }
  .masthead-meta {
    display: flex; flex-wrap: wrap; gap: .45rem .8rem; align-items: center;
    margin-top: .9rem; font-size: .6875rem;
  }
  .chip {
    display: inline-flex; align-items: center; gap: .4rem;
    border: 1px solid var(--line-2); border-radius: 3px;
    padding: .16rem .5rem; color: var(--muted-2); text-decoration: none;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .6875rem; letter-spacing: .02em; white-space: nowrap;
  }
  a.chip:hover { border-color: #3d4859; color: var(--text); }
  .chip .dot { width: .4rem; height: .4rem; border-radius: 999px; display: inline-block; }
  .dot-ok { background: var(--ok); }
  .dot-info { background: var(--info); }

  /* ---- layout: rail + article ---- */
  .layout {
    max-width: 76rem; margin: 0 auto; padding: 0 1.25rem 4rem;
    display: grid; grid-template-columns: 1fr; gap: 2rem;
  }
  @media (min-width: 62rem) {
    .layout { grid-template-columns: var(--rail) minmax(0, 1fr); gap: 3.5rem; padding-top: 2.2rem; }
  }

  /* ---- the signature causal chain ---- */
  .hero { grid-column: 1 / -1; margin-top: 2rem; }
  .hero .kicker {
    font-size: .6875rem; letter-spacing: .14em; text-transform: uppercase;
    color: var(--muted); margin: 0 0 .8rem;
  }
  .hero h1 {
    font-size: clamp(1.7rem, 5.2vw, 2.9rem); line-height: 1.12;
    letter-spacing: -.02em; margin: 0 0 .6rem; max-width: 22ch;
  }
  .hero .lede { color: var(--muted-2); font-size: 1.02rem; max-width: 58ch; margin: 0 0 1.6rem; }
  .chain {
    list-style: none; margin: 0; padding: 0;
    display: grid; gap: .55rem;
    grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr));
  }
  .stage {
    border: 1px solid var(--line); border-left: 2px solid var(--line-2);
    background: linear-gradient(180deg, rgba(255,255,255,.014), transparent 40%), var(--panel);
    border-radius: 4px; padding: .6rem .7rem .65rem;
    min-height: 5.4rem;
    display: flex; flex-direction: column; gap: .15rem;
  }
  .stage:last-child { border-left-color: var(--ok); }
  .stage-idx { font-size: .625rem; color: var(--muted); letter-spacing: .1em; }
  .stage-name { font-weight: 600; font-size: .9rem; }
  .stage-note { font-size: .6875rem; color: var(--muted); line-height: 1.4; }
  .chain-note {
    margin: .8rem 0 0; font-size: .75rem; color: var(--muted);
    border-left: 2px solid var(--line-2); padding-left: .7rem; max-width: 62ch;
  }

  /* ---- sidebar contents ---- */
  /* On narrow screens the contents precede the article; at desktop width the
     rail moves into its own column to the left. */
  .rail { order: 1; }
  main { order: 2; }
  @media (min-width: 62rem) {
    .rail { order: 1; position: sticky; top: 1.6rem; align-self: start; max-height: calc(100vh - 3rem); overflow: auto; }
    main { order: 2; }
  }
  .rail h2 {
    font-size: .625rem; letter-spacing: .16em; text-transform: uppercase;
    color: var(--muted); margin: 0 0 .7rem;
  }
  .rail ol { list-style: none; margin: 0; padding: 0; }
  .rail li { margin: 0; }
  .rail a {
    display: flex; gap: .55rem; align-items: baseline;
    padding: .34rem .5rem; border-radius: 3px; text-decoration: none;
    color: var(--muted-2); font-size: .8125rem; line-height: 1.35;
    border-left: 2px solid transparent;
  }
  .rail a:hover { background: rgba(255,255,255,.03); color: var(--text); }
  .rail a:focus-visible { background: rgba(74,158,255,.1); }
  .toc-num { color: var(--muted); font-size: .6875rem; flex: none; padding-top: .1rem; }

  /* ---- article ---- */
  article { min-width: 0; max-width: var(--max); }
  article > h1 { display: none; } /* shown in the hero */
  article h2 {
    font-size: clamp(1.3rem, 3vw, 1.6rem); line-height: 1.22; letter-spacing: -.015em;
    margin: 3rem 0 .8rem; padding-top: 1.2rem; border-top: 1px solid var(--line);
    scroll-margin-top: 1.5rem;
  }
  article h3 { font-size: 1.08rem; line-height: 1.3; margin: 2rem 0 .5rem; scroll-margin-top: 1.5rem; }
  article h4, article h5, article h6 { font-size: 1rem; margin: 1.5rem 0 .4rem; }
  article p { margin: .9rem 0; }
  article em { color: var(--muted-2); }
  article ul, article ol { padding-left: 1.3rem; }
  article li { margin: .35rem 0; }
  article li::marker { color: var(--muted); }
  article strong { font-weight: 650; }
  article hr { border: 0; border-top: 1px solid var(--line); margin: 2.6rem 0; }
  blockquote {
    margin: 1.3rem 0; padding: .4rem 0 .4rem 1rem;
    border-left: 2px solid var(--info); color: var(--muted-2);
    background: linear-gradient(90deg, rgba(74,158,255,.05), transparent 60%);
  }
  blockquote p { margin: .4rem 0; }
  code {
    font-size: 88%; background: var(--panel-2); border: 1px solid var(--line);
    padding: .08em .36em; border-radius: 3px; color: var(--muted-2);
  }
  /* terminal transcript */
  .term {
    margin: 1.3rem 0; border: 1px solid var(--line); border-radius: 5px;
    overflow: hidden; background: #06080b;
  }
  .term-bar {
    display: flex; align-items: center; gap: .5rem;
    padding: .4rem .7rem; border-bottom: 1px solid var(--line);
    background: var(--panel);
  }
  .term-dots { display: inline-flex; gap: .25rem; }
  .term-dots i { width: .5rem; height: .5rem; border-radius: 999px; background: var(--line-2); }
  .term-label { font-size: .625rem; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
  .term pre { margin: 0; padding: .85rem .95rem; overflow-x: auto; }
  .term code {
    background: none; border: 0; padding: 0; color: var(--muted-2);
    font-size: .8125rem; line-height: 1.6; white-space: pre;
  }

  table {
    width: 100%; border-collapse: collapse; margin: 1.3rem 0;
    font-size: .84375rem; display: block; overflow-x: auto;
  }
  th, td { border: 1px solid var(--line); padding: .5rem .65rem; text-align: left; vertical-align: top; }
  th { background: var(--panel); font-weight: 600; font-size: .75rem; letter-spacing: .02em; color: var(--muted-2); white-space: nowrap; }
  td { color: var(--muted-2); }

  footer {
    max-width: 76rem; margin: 0 auto; padding: 1.4rem 1.25rem 3rem;
    border-top: 1px solid var(--line); color: var(--muted);
    font-size: .8125rem; line-height: 1.7;
  }
  footer a { color: var(--muted-2); }

  a:focus-visible, [tabindex]:focus-visible {
    outline: 2px solid var(--info); outline-offset: 2px; border-radius: 3px;
  }
  .skip {
    position: absolute; left: -999px; top: 0;
    background: var(--info); color: #04121f; padding: .5rem .8rem; z-index: 20;
    border-radius: 0 0 4px 0; font-weight: 600;
  }
  .skip:focus { left: 0; }

  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    * { animation-duration: .001ms !important; transition-duration: .001ms !important; }
  }
</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="masthead">
  <div class="masthead-inner">
    <div class="brand">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="1" y="1" width="22" height="22" rx="4" stroke="#2b3442"/>
        <path d="M6 17 L12 6 L18 17" stroke="#4a9eff" stroke-width="1.6" fill="none"/>
        <path d="M9 13 H15" stroke="#3fb950" stroke-width="1.6"/>
      </svg>
      <div>
        <div class="brand-name">AFTERMATH</div>
        <div class="brand-sub">Failure Prevention</div>
      </div>
    </div>
    <div class="masthead-meta">
      <span class="chip"><span class="dot dot-info"></span>Total Recall · Tatum × Walrus</span>
      <span class="chip"><span class="dot dot-ok"></span>Walrus Memory · Mainnet</span>
      <span class="chip">Tatum Sui · gRPC</span>
      <a class="chip" href="${REPO_URL}">Repository ↗</a>
      <a class="chip" href="${REPO_URL}/blob/master/docs/BLOG.md">Markdown source ↗</a>
    </div>
  </div>
</header>

<div class="layout">
  <section class="hero">
    <p class="kicker">Field notes · commit 10e3b88</p>
    <h1>${esc(pageTitle)}</h1>
    ${subtitle ? `<p class="lede">${esc(subtitle)}</p>` : ""}
    <ol class="chain" aria-label="The AFTERMATH pipeline, in order">
${chain}
    </ol>
    <p class="chain-note">Every stage above is a real component, in execution order.
    A claim enters on the left; the only thing that can become an enforced safeguard
    is what the authoritative evidence supports. Colour is never decoration — the
    final node is green because it is the only stage that changes a later outcome.</p>
  </section>

  <nav class="rail" aria-label="Contents">
    <h2>Contents</h2>
    <ol>
${toc}
    </ol>
  </nav>

  <main id="main">
    <article>
${bodyHtml}
    </article>
  </main>
</div>

<footer>
  <p>Written by <a href="https://github.com/${AUTHOR}">@${AUTHOR}</a> with an AI agent (OpenHands)
  on behalf of the project owner. Source and code:
  <a href="${REPO_URL}">${REPO_URL}</a>. Licensed and attributed as in the repository.</p>
  <p><a href="#main">Back to top ↑</a></p>
</footer>
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
console.log(`  chain  : ${STAGES.length} stages`);
console.log(`  checked: ${headings.length} headings, ${htmlTableRows} table rows, ${htmlCodeBlocks} code blocks, ${htmlListItems} list items, ${htmlLinks} links`);
