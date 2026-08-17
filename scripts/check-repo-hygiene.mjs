#!/usr/bin/env node
// Phase 01, work item 5 — asserts every required top-level repo-hygiene
// artifact exists and is non-empty, and (added 2026-08-06) that no tracked
// text-source file holds a raw NUL byte anywhere in it. Run with:
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
 * WIDENED 2026-08-06, after adversarial review measured the first version
 * missing 43 tracked text files across five classes — every one of which git
 * classifies as binary the moment a NUL lands in it, and none of which the
 * guard reported. The worst was `.wiki`: 33 files under
 * `packages/connectors-jira/fixtures/wiki-golden/`, the phase-17 lint-corpus
 * goldens that merged PR #108 cites as its oracle, i.e. the most
 * citation-sensitive fixtures in the repository. `.jsonl` is the learning
 * system's own declared eval-case format.
 *
 * The lesson recorded rather than just the fix: a hand-kept allowlist that
 * nothing checks against the actual tree is a promise. `uncoveredExtensions`
 * below turns it into a mechanical check, and `check-repo-hygiene.test.mjs`
 * asserts the uncovered set is exactly the two genuinely-binary classes — so
 * the next file type to enter the repo has to be classified deliberately
 * instead of defaulting to unpoliced.
 */
const TEXT_SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  // LCOV coverage reports. Committed as a test fixture (`packages/gates/src/
  // coverage/test-support/real-vitest-lcov.info`, real v8 output for owner
  // ruling R6's changed-line coverage), and a plain-text line-oriented format —
  // so it is policed like every other text source rather than joining the
  // unpoliced set by default, which is exactly what this list exists to prevent.
  ".info",
  ".js",
  ".json",
  ".jsonc",
  ".jsonl",
  ".md",
  ".mjs",
  ".mts",
  ".py",
  ".sh",
  ".snap",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".wiki",
  ".yaml",
  ".yml",
]);

/**
 * Extensions this guard deliberately does NOT police, because their files are
 * genuinely binary and correctly so. Named explicitly rather than left as
 * "whatever is not in the allowlist" — that silence is what let 43 files sit
 * unpoliced. `uncoveredExtensions` is asserted equal to this set by the suite.
 */
export const KNOWN_BINARY_EXTENSIONS = Object.freeze([".png", ".pyc"]);

/**
 * A tracked file is in scope when its extension is a known text one, OR when
 * it has NO extension at all.
 *
 * The extensionless arm was added for LICENSE, NOTICE, `.gitignore`, `.npmrc`
 * and `.prettierignore` — and it is the arm with the sharpest edge, because
 * without it a NUL in LICENSE passed the very same script whose other leg
 * asserts LICENSE exists and is non-empty. Defaulting extensionless to TEXT
 * (rather than allowlisting those five basenames) is the direction that fails
 * loudly: a future committed extensionless binary reddens this check and gets
 * a visible `.gitattributes` `diff` line, instead of silently joining the
 * unpoliced set.
 *
 * Note `path.extname(".gitignore") === ""` — a leading-dot dotfile is
 * extensionless by Node's rule, which is the behaviour wanted here.
 */
export function isTextSourcePath(rel) {
  const ext = path.extname(rel).toLowerCase();
  return ext === "" || TEXT_SOURCE_EXTENSIONS.has(ext);
}

/**
 * `process.env` with every `GIT_*` name dropped.
 *
 * `cwd` alone does NOT decide which repository git operates on: GIT_DIR,
 * GIT_WORK_TREE, GIT_INDEX_FILE and friends are consulted first, and git
 * exports them into every hook it runs — including a pre-push hook that
 * invokes this check. Without this scrub a `cwd` argument is decoration and
 * these functions silently inspect the AMBIENT repository.
 *
 * Dropping every `GIT_*` name is a strict superset of git's own
 * `--local-env-vars` list and stays correct when a future release invents
 * another; `packages/testkit/src/git-env.ts` carries the full rationale and
 * the three real corruptions that earned it. Reimplemented here rather than
 * imported because this script must run on `npm ci` alone, with nothing built
 * — see the `meta-checks` job in `.github/workflows/ci.yml`.
 */
function scrubbedGitEnv() {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined || name.startsWith("GIT_")) continue;
    env[name] = value;
  }
  return env;
}

/** Every tracked path, NUL-separated so no path shape can mangle the parse. */
export function gitTrackedPaths(cwd) {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd,
    env: scrubbedGitEnv(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\0").filter((p) => p !== "");
}

/**
 * Distinct extensions among tracked files that {@link isTextSourcePath}
 * rejects — i.e. everything this guard does not police. Sorted, deduped.
 *
 * This is the structural half of the F1 fix. The allowlist above is still a
 * hand-kept list, but it is no longer an unchecked one: the suite asserts this
 * returns exactly {@link KNOWN_BINARY_EXTENSIONS}, so a new file class cannot
 * enter the repository and quietly fall outside the check the way `.wiki`,
 * `.jsonl`, `.py` and `.svg` did.
 */
export function uncoveredExtensions(cwd) {
  const found = new Set();
  for (const rel of gitTrackedPaths(cwd)) {
    if (isTextSourcePath(rel)) continue;
    found.add(path.extname(rel).toLowerCase());
  }
  return [...found].sort();
}

/**
 * Paths git currently classifies as BINARY, asked of git itself rather than
 * reimplemented.
 *
 * `git diff <tree>` (no second tree) diffs that tree against the WORKING TREE
 * for every path in the index, so this needs no commit and sees exactly what a
 * reviewer's `git diff` would. Against the empty tree every tracked file is an
 * addition, and `--numstat` renders a binary addition as `-\t-\tpath`.
 *
 * Used by {@link nulBearingTextSources} to grade SEVERITY, not to decide what
 * to report: git only sniffs the first 8000 bytes, and a NUL past that is a
 * latent failure rather than no failure. See that function for the measurement
 * behind the distinction.
 */
export function gitBinaryTrackedPaths(cwd) {
  const env = scrubbedGitEnv();
  const emptyTree = execFileSync("git", ["hash-object", "-t", "tree", "/dev/null"], {
    cwd,
    env,
    encoding: "utf8",
  }).trim();
  const numstat = execFileSync("git", ["diff", "--numstat", "-z", emptyTree], {
    cwd,
    env,
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

/**
 * Paths carrying an explicit git `diff` attribute — the documented, visible
 * escape hatch for a file that genuinely must hold a NUL. Kept because the
 * scan below no longer goes through git's own classifier and so no longer
 * inherits `.gitattributes` handling for free.
 */
function gitDiffAttrPaths(cwd, paths) {
  if (paths.length === 0) return new Set();
  const out = execFileSync("git", ["check-attr", "diff", "-z", "--stdin"], {
    cwd,
    env: scrubbedGitEnv(),
    input: `${paths.join("\0")}\0`,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  // `-z` emits flat `path\0attr\0value\0` triplets.
  const fields = out.split("\0");
  const set = new Set();
  for (let i = 0; i + 2 < fields.length; i += 3) {
    if (fields[i + 2] === "set") set.add(fields[i]);
  }
  return set;
}

/**
 * Every tracked text source holding a raw NUL byte ANYWHERE, with the first
 * one's location and whether git currently classifies the file as binary.
 *
 * WIDENED 2026-08-06 BEYOND GIT'S CLASSIFIER, and the earlier ruling here was
 * mine to correct. The first version deliberately matched git exactly and
 * pinned "a NUL past the 8000-byte sniff window is not detected" as an
 * accepted residual, reasoning that past the window the instruments still
 * work so there is nothing to report.
 *
 * That reasoning was measured wrong within the hour. While writing this very
 * PR's digest assertion, the editor wrote a raw 0x00 into
 * `grader-drift.redteam.test.ts` at byte 12575 — the identical typo this
 * check exists to catch, in the test that pins it — and the guard passed,
 * EXIT=0, because 12575 > 8000.
 *
 * The residual was not benign, it was a time bomb: the file reads as text
 * only until something above the NUL shrinks by 4576 bytes, at which point it
 * silently becomes binary with no edit to the NUL itself. A latent instrument
 * failure is still an instrument failure, and one whose trigger is an
 * unrelated future edit is worse than one that shows up immediately.
 *
 * So the scan is now the whole file. `.gitattributes` `diff` remains the
 * escape hatch, applied explicitly here since the scan no longer routes
 * through git's classifier.
 */
export function nulBearingTextSources(cwd) {
  const candidates = gitTrackedPaths(cwd).filter(isTextSourcePath);
  const exempt = gitDiffAttrPaths(cwd, candidates);
  const gitBinary = new Set(gitBinaryTrackedPaths(cwd));
  const findings = [];
  for (const rel of candidates) {
    if (exempt.has(rel)) continue;
    const at = firstNulLocation(path.join(cwd, rel));
    if (at === null) continue;
    findings.push({ path: rel, ...at, gitBinary: gitBinary.has(rel) });
  }
  return findings.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function checkNoBinaryTextSources(cwd) {
  const findings = nulBearingTextSources(cwd);
  for (const f of findings) {
    // The two cases are genuinely different and the message says which:
    // in-window means the instruments are broken RIGHT NOW; beyond-window
    // means they break the moment anything above the NUL shrinks.
    const severity = f.gitBinary
      ? "BINARY TEXT SOURCE"
      : "LATENT BINARY TEXT SOURCE (outside git's 8000-byte sniff window — binary the moment the bytes above it shrink)";
    console.error(
      `check-repo-hygiene: ${severity} — ${f.path} — first NUL (0x00) at line ${f.line}, byte offset ${f.offset}`,
    );
  }
  return findings.map((f) => f.path);
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
  // No tracked text source may hold a raw NUL byte.
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
  //
  // The scan is the WHOLE file, not just git's 8000-byte sniff window: see
  // `nulBearingTextSources` for the measurement that reversed that ruling.
  // ---------------------------------------------------------------------
  const offenders = checkNoBinaryTextSources(cwd);
  if (offenders.length > 0) {
    console.error(
      `check-repo-hygiene: FAIL — ${offenders.length} tracked text source(s) hold a raw NUL byte. ` +
        `Use the escape sequence (\\0, \\x00) instead of a raw NUL byte, ` +
        `or mark a file that truly needs one with the git \`diff\` attribute in .gitattributes.`,
    );
    return 1;
  }
  console.log(
    "check-repo-hygiene: PASS — no tracked text source holds a raw NUL byte (whole-file scan).",
  );
  return 0;
}

/* c8 ignore start — entry point; the checks above are what the suite drives. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runHygieneChecks(root));
}
/* c8 ignore stop */
