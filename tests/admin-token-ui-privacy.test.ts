import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression guard for the admin-token UI privacy fix.
 *
 * The administrator credential input used to live in the shared app frame
 * (`components/shell.tsx`), so a password field for a server secret was rendered
 * on the homepage and every public page. These tests pin the fix at the source
 * level: no public route renders a credential input, the shared frame carries
 * none, and the admin console keeps exactly one.
 *
 * A source-level check is used deliberately: it needs no running server, and it
 * fails loudly if someone re-introduces the control anywhere in the public tree.
 */

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** Every route file under src/app that is NOT inside the /admin subtree. */
function publicPageSources(): Array<{ path: string; source: string }> {
  const out: Array<{ path: string; source: string }> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (full.includes(`${join("app", "admin")}`)) continue;
        walk(full);
      } else if (/page\.tsx?$/.test(entry)) {
        out.push({ path: full, source: readFileSync(full, "utf8") });
      }
    }
  };
  walk(join(ROOT, "src", "app"));
  return out;
}

/** A password input, the only correct way to render a secret field. */
const PASSWORD_INPUT = /type=\{?["']password["']\}?/;

describe("public pages do not expose an admin credential input", () => {
  it("renders no password input in any non-admin page", () => {
    const offenders = publicPageSources().filter((p) =>
      PASSWORD_INPUT.test(p.source),
    );
    expect(offenders.map((p) => p.path)).toEqual([]);
  });

  it("does not mount the admin console's sign-in control on a public page", () => {
    const offenders = publicPageSources().filter((p) =>
      /AdminTokenControl|admin-password|admin-token-panel/.test(p.source),
    );
    expect(offenders.map((p) => p.path)).toEqual([]);
  });

  it("the shared application shell renders no credential control", () => {
    const shell = read("src/components/shell.tsx");
    expect(shell).not.toMatch(/AdminTokenControl/);
    expect(shell).not.toMatch(/admin-token-panel/);
    expect(shell).not.toMatch(PASSWORD_INPUT);
    expect(shell).not.toMatch(/sessionStorage|localStorage/);
  });

  it("the admin console keeps exactly one password field", () => {
    const page = read("src/app/admin/page.tsx");
    const matches = page.match(/type="password"/g) ?? [];
    expect(matches.length).toBe(1);
    expect(page).toContain('id="admin-password"');
  });

  it("no source file persists the admin token to browser storage", () => {
    // Match storage *usage* (a property access such as `.setItem`/`.getItem`),
    // not the words in a comment or docstring.
    const hits = execSync(
      "grep -rnE '(sessionStorage|localStorage)\\\\s*\\\\.' src || true",
      { cwd: ROOT, encoding: "utf8" },
    ).trim();
    expect(hits).toBe("");
  });
});
