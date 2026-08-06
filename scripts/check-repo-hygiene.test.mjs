/**
 * Unit tests for the repo-hygiene checks — chiefly the binary-text-source leg
 * added 2026-08-06.
 *
 * Why this leg exists: `packages/learning/src/eval/eval-pair.ts` carried a raw
 * 0x00 byte inside a string literal where the two-character escape `\0` was
 * intended, and three sibling files carried the same typo. Every per-push check
 * passed — the files are valid TypeScript and the runtime value is identical —
 * while git classified all four as BINARY, so their diffs rendered as "Binary
 * files … differ", `git grep -n` gave no line numbers, and `git grep -I` skipped
 * them silently. In a repository verified by line-anchored citation that is an
 * instrument failure with no symptom.
 *
 * These tests drive the check against REAL throwaway git repositories rather
 * than a stubbed classifier, because the thing being asserted is agreement with
 * git's own notion of "binary" — a stub would only assert agreement with my
 * belief about it. `gitBinaryTrackedPaths` diffs the empty tree against the
 * WORKING tree, so `git add` is enough and no commit (and therefore no identity
 * configuration) is ever needed.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkNoBinaryTextSources,
  gitBinaryTrackedPaths,
  isTextSourcePath,
  runHygieneChecks,
} from "./check-repo-hygiene.mjs";

const NUL = String.fromCharCode(0);

const scratch = [];

function makeRepo(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "hygiene-nul-"));
  scratch.push(dir);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  execFileSync("git", ["add", "-A"], { cwd: dir });
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (scratch.length > 0) rmSync(scratch.pop(), { recursive: true, force: true });
});

describe("isTextSourcePath", () => {
  it("covers the extensions a reviewer reads as text", () => {
    for (const rel of [
      "packages/learning/src/eval/eval-pair.ts",
      "packages/cli/src/x.tsx",
      "scripts/check-repo-hygiene.mjs",
      "docs/evidence/phase-09/probe.txt",
      ".github/workflows/ci.yml",
      "packages/cli/src/commands/__snapshots__/cli.snapshots.test.ts.snap",
      "package.json",
      "README.md",
    ]) {
      expect(isTextSourcePath(rel), rel).toBe(true);
    }
  });

  it("leaves genuinely-binary tracked assets out of scope", () => {
    for (const rel of [
      "assets/brand/crabgic-logo.png",
      "assets/brand/source/__pycache__/png.cpython-312.pyc",
      "some/archive.tar.gz",
      "no-extension",
    ]) {
      expect(isTextSourcePath(rel), rel).toBe(false);
    }
  });
});

describe("checkNoBinaryTextSources", () => {
  it("reports a .ts file whose string literal holds a raw NUL byte", () => {
    // Byte-for-byte the shape of the real defect: a `join()` separator written
    // as the byte rather than the escape.
    const dir = makeRepo({
      "src/eval-pair.ts": `export const sep = "${NUL}";\n`,
    });
    expect(gitBinaryTrackedPaths(dir)).toEqual(["src/eval-pair.ts"]);
    expect(checkNoBinaryTextSources(dir)).toEqual(["src/eval-pair.ts"]);
  });

  it("does NOT report the same file once the escape sequence is used", () => {
    // The control that rules out a check which flags everything. The two
    // fixtures differ only in raw-byte vs escape, and the runtime string is the
    // same in both.
    const dir = makeRepo({ "src/eval-pair.ts": 'export const sep = "\\0";\n' });
    expect(gitBinaryTrackedPaths(dir)).toEqual([]);
    expect(checkNoBinaryTextSources(dir)).toEqual([]);
  });

  it("does not report a tracked asset that is legitimately binary", () => {
    const dir = makeRepo({ "assets/logo.png": `\x89PNG\r\n\x1a\n${NUL}${NUL}${NUL}\r` });
    // git DOES see it as binary — the check declines it on extension, which is
    // what keeps the rule from needing a growable allowlist.
    expect(gitBinaryTrackedPaths(dir)).toEqual(["assets/logo.png"]);
    expect(checkNoBinaryTextSources(dir)).toEqual([]);
  });

  it("honours .gitattributes `diff` as the escape hatch for a file that must carry a NUL", () => {
    const dir = makeRepo({
      ".gitattributes": "fixtures/nul-corpus.txt diff\n",
      "fixtures/nul-corpus.txt": `a${NUL}b\n`,
    });
    expect(gitBinaryTrackedPaths(dir)).toEqual([]);
    expect(checkNoBinaryTextSources(dir)).toEqual([]);
  });

  it("reports every offender, not just the first", () => {
    const dir = makeRepo({
      "a.ts": `"${NUL}"\n`,
      "b.ts": `"${NUL}"\n`,
      "c.ts": '"ok"\n',
    });
    expect(checkNoBinaryTextSources(dir).sort()).toEqual(["a.ts", "b.ts"]);
  });

  it("names the offender's line and byte offset so the message is actionable", () => {
    const dir = makeRepo({ "src/x.ts": `line one\nline two\nconst s = "${NUL}";\n` });
    const errors = [];
    vi.spyOn(console, "error").mockImplementation((m) => errors.push(String(m)));
    checkNoBinaryTextSources(dir);
    expect(errors.join("\n")).toContain("BINARY TEXT SOURCE — src/x.ts");
    // 9 ("line one\n") + 9 ("line two\n") + 11 (`const s = "`) = 29.
    expect(errors.join("\n")).toContain("first NUL (0x00) at line 3, byte offset 29");
  });

  it("PINNED RESIDUAL: a NUL beyond git's 8000-byte sniff window is not detected", () => {
    // Asserted rather than merely described, so it cannot change silently.
    // The guard deliberately matches git's classifier exactly, because the harm
    // it exists to prevent IS git's classification: past the sniff window git
    // still diffs and greps the file as text, so the instruments keep working
    // and there is nothing to report. If git ever widens the window this
    // reddens, which is the correct notification.
    const dir = makeRepo({ "src/late.ts": `${"// pad\n".repeat(2000)}const s = "${NUL}";\n` });
    expect(gitBinaryTrackedPaths(dir)).toEqual([]);
    expect(checkNoBinaryTextSources(dir)).toEqual([]);
  });
});

describe("runHygieneChecks", () => {
  it("fails a tree missing a required top-level file", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runHygieneChecks(makeRepo({ "README.md": "x\n" }))).toBe(1);
  });

  it("fails a tree whose required files are all present but whose sources are binary", () => {
    const required = {
      LICENSE: "x\n",
      NOTICE: "x\n",
      "SECURITY.md": "x\n",
      "CONTRIBUTING.md": "x\n",
      "CODE_OF_CONDUCT.md": "x\n",
      "README.md": "x\n",
      ".github/PULL_REQUEST_TEMPLATE.md": "x\n",
      ".github/ISSUE_TEMPLATE/bug_report.md": "x\n",
      ".github/ISSUE_TEMPLATE/feature_request.md": "x\n",
    };
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runHygieneChecks(makeRepo({ ...required, "src/x.ts": `"${NUL}"\n` }))).toBe(1);
    expect(runHygieneChecks(makeRepo({ ...required, "src/x.ts": '"\\0"\n' }))).toBe(0);
  });
});
