import { afterAll, describe, expect, it } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveDataBaseDir } from "@/lib/config";

/**
 * Deployment-path regression guards.
 *
 * Production runs on a serverless host whose deployment bundle is read-only,
 * with only the OS temp directory writable. The application previously wrote
 * its SQLite index to a project-relative `./data`, which threw
 * `EACCES: permission denied, mkdir '.../data'` on the first request and
 * surfaced as a Next.js server-side exception (HTTP 500).
 *
 * These tests pin the fix: when the project directory is not writable, the
 * data base directory must move to the temp root; when it is writable, the
 * durable project path must be kept.
 */

const created: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "aftermath-test-"));
  created.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of created) {
    try {
      chmodSync(dir, 0o700);
    } catch {
      // best effort: only needed for directories we made read-only
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveDataBaseDir", () => {
  it("uses the project data directory when it is writable", () => {
    const projectDir = tempRoot();
    const tmpDir = tempRoot();

    expect(resolveDataBaseDir(projectDir, tmpDir)).toBe(
      path.join(projectDir, "data"),
    );
    expect(existsSync(path.join(projectDir, "data"))).toBe(true);
  });

  it("falls back to the temp root when the project directory is read-only", () => {
    const projectDir = tempRoot();
    const tmpDir = tempRoot();
    // Simulate the read-only deployment bundle: the project directory cannot
    // be written to, so creating `<project>/data` must fail.
    chmodSync(projectDir, 0o500);

    const resolved = resolveDataBaseDir(projectDir, tmpDir);

    expect(resolved).toBe(path.join(tmpDir, "aftermath"));
    expect(existsSync(resolved)).toBe(true);
    // The project directory must be left untouched.
    expect(existsSync(path.join(projectDir, "data"))).toBe(false);
  });

  it("always returns a directory that exists and accepts writes", () => {
    const projectDir = tempRoot();
    const tmpDir = tempRoot();
    chmodSync(projectDir, 0o500);

    const resolved = resolveDataBaseDir(projectDir, tmpDir);
    const probe = path.join(resolved, "probe.txt");

    // Writing proves the returned path is genuinely usable by the store.
    expect(() => {
      writeFileSync(probe, "ok");
      unlinkSync(probe);
    }).not.toThrow();
  });
});
