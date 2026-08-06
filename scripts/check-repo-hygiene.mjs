#!/usr/bin/env node
// Phase 01, work item 5 — asserts every required top-level repo-hygiene
// artifact exists and is non-empty, and (added 2026-08-06) that no tracked
// text-source file is classified BINARY by git. Run with:
//   node scripts/check-repo-hygiene.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const REQUIRED_FILES = [
  "LICENSE",
  "NOTICE",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "README.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/ISSUE_TEMPLATE/bug_report.md",
  ".github/ISSUE_TEMPLATE/feature_request.md",
];

/**
 * Extensions whose files a reader, a reviewer and every line-anchored tool in
 * this repository assume are TEXT. Deliberately an allowlist of extensions
 * rather than a path scope: the hazard below is not specific to
 * any one package's source tree, and a path scope written as a git pathspec is
 * the exact shape that silently returns a smaller answer: a wildmatch `*` does
 * not cross a slash, so a `packages/<star>/src` pathspec misses every nested
 * path under it and reports clean.
 *
 * Genuinely-binary tracked assets (`assets/**` PNGs, a stray `.pyc`) do not
 * carry these extensions and are therefore out of scope by construction, not
 * by an allowlist someone can grow.
 */
const TEXT_SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".md",
  ".mjs",
  ".mts",
  ".sh",
  ".snap",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

export function isTextSourcePath(rel) {
  return TEXT_SOURCE_EXTENSIONS.has(path.extname(rel).toLowerCase());
}

/**
 * Paths git classifies as BINARY, asked of git itself rather than reimplemented.
 *
 * `git diff <tree> ` (no second tree) diffs that tree against the WORKING TREE
 * for every path in the index, so this needs no commit and sees exactly what a
 * reviewer's `git diff` would. Against the empty tree every tracked file is an
 * addition, and `--numstat` renders a binary addition as `-\t-\tpath`.
 *
 * Because it is git's own classifier, `.gitattributes` overrides are honoured
 * for free: a file that genuinely must carry a NUL can be marked `diff` (git's
 * documented "treat as text even so" attribute) and this check will stop
 * reporting it — visibly, in a committed file, rather than via a private
 * allowlist in here.
 */
export function gitBinaryTrackedPaths(cwd) {
  const emptyTree = execFileSync("git", ["hash-object", "-t", "tree", "/dev/null"], {
    cwd,
    encoding: "utf8",
  }).trim();
  const numstat = execFileSync("git", ["diff", "--numstat", "-z", emptyTree], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  // `-z` numstat: `added\tdeleted\t` then the NUL-terminated path. Splitting on
  // NUL is what makes this safe for paths a shell-quoted form would mangle —
  // and, pointedly, is why this parser cannot itself be defeated by the class
  // of byte it exists to find.
  const fields = numstat.split("\0");
  const binary = [];
  for (let i = 0; i < fields.length; i += 1) {
    const head = fields[i];
    if (!head) continue;
    const parts = head.split("\t");
    if (parts.length < 3) continue;
    const [added, deleted] = parts;
    // A rename entry ends after the two counts and takes its paths from the
    // next two NUL-separated fields; against the empty tree there are none.
    const rel = parts.slice(2).join("\t");
    if (added === "-" && deleted === "-" && rel) binary.push(rel);
  }
  return binary;
}

/** First offset+line of a NUL byte in `abs`, or null. Purely for the message. */
function firstNulLocation(abs) {
  let buf;
  try {
    buf = readFileSync(abs);
  } catch {
    return null;
  }
  const offset = buf.indexOf(0);
  if (offset < 0) return null;
  let line = 1;
  for (let i = 0; i < offset; i += 1) if (buf[i] === 0x0a) line += 1;
  return { offset, line };
}

export function checkNoBinaryTextSources(cwd) {
  const offenders = gitBinaryTrackedPaths(cwd).filter(isTextSourcePath);
  for (const rel of offenders) {
    const at = firstNulLocation(path.join(cwd, rel));
    const where = at ? ` — first NUL (0x00) at line ${at.line}, byte offset ${at.offset}` : "";
    console.error(`check-repo-hygiene: BINARY TEXT SOURCE — ${rel}${where}`);
  }
  return offenders;
}

export function runHygieneChecks(cwd) {
  let failed = false;

  for (const rel of REQUIRED_FILES) {
    const abs = path.join(cwd, rel);
    let stat;
    try {
      stat = statSync(abs);
    } catch {
      console.error(`check-repo-hygiene: MISSING — ${rel}`);
      failed = true;
      continue;
    }
    if (!stat.isFile()) {
      console.error(`check-repo-hygiene: NOT A FILE — ${rel}`);
      failed = true;
      continue;
    }
    if (stat.size === 0) {
      console.error(`check-repo-hygiene: EMPTY — ${rel}`);
      failed = true;
      continue;
    }
    console.log(`check-repo-hygiene: OK — ${rel} (${stat.size} bytes)`);
  }

  if (failed) {
    console.error("check-repo-hygiene: FAIL — one or more required files missing/empty.");
    return 1;
  }

  console.log("check-repo-hygiene: PASS — all required top-level files exist and are non-empty.");

  // ---------------------------------------------------------------------
  // No tracked text source may be BINARY to git.
  //
  // Earned 2026-08-06. `packages/learning/src/eval/eval-pair.ts` carried a raw
  // 0x00 byte inside a string literal where the two-character escape `\0` was
  // meant — a typo invisible in every editor and to every per-push check:
  // tsc, eslint, prettier and vitest all passed, because the file is perfectly
  // valid TypeScript and the runtime value is identical.
  //
  // What it broke is the INSTRUMENT, not the program. Git classifies a file
  // with a NUL in its first 8000 bytes as binary, so `git diff` renders
  // "Binary files … differ" (the file's 97 lines were unreviewable in the PR
  // that introduced it and on GitHub), `git grep -n` returns "Binary file …
  // matches" with no line numbers, and `git grep -I` drops it SILENTLY. In a
  // repository whose entire verification method is line-anchored citation and
  // transcript sweeps, that is a permanent hole in the tooling with no
  // symptom. Three sibling files carried the same typo and nobody had noticed.
  // ---------------------------------------------------------------------
  const offenders = checkNoBinaryTextSources(cwd);
  if (offenders.length > 0) {
    console.error(
      `check-repo-hygiene: FAIL — ${offenders.length} tracked text source(s) are binary to git. ` +
        `Use the escape sequence (\\0, \\x00) instead of a raw NUL byte, ` +
        `or mark a file that truly needs one with the git \`diff\` attribute in .gitattributes.`,
    );
    return 1;
  }
  console.log("check-repo-hygiene: PASS — no tracked text source is classified binary by git.");
  return 0;
}

/* c8 ignore start — entry point; the checks above are what the suite drives. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runHygieneChecks(root));
}
/* c8 ignore stop */
