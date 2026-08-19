#!/usr/bin/env node
// The corpus must be at least as wide as the claim's quantifier. Run with:
//   node scripts/check-claim-scope.mjs [path ...]     # defaults to docs/evidence
//
// WHY THIS EXISTS (2026-08-19). `scripts/repo-census.mjs` answers "what regions
// exist and which enumeration claims them". It does not stop the specific
// mistake that motivated it: a UNIVERSAL claim backed by a SCOPED search.
//
// Measured. A research record's Q2 asserted "nothing already detects it" — a
// universal negative over the whole repository — and cited two directory-scoped
// searches, `packages/cli/src/doctor/checks/` and `check:all`. Meanwhile
// `scripts/bundle-types.mjs:70` implemented exactly the thing it said nothing
// implemented. TEN review rounds inherited the mismatch, because the searches
// were individually correct; only their SCOPE was wrong for the claim they were
// offered as evidence for. One unscoped `grep -ln mtime` over tracked files
// returns eight hits and would have settled it in round 1.
//
// WHAT THIS CAN AND CANNOT DO, stated rather than implied. It is a static check
// over prose and the commands quoted beside it. It CANNOT know whether a search
// was well-chosen, and it cannot re-run anything — executing commands parsed out
// of a document would be arbitrary code execution from a text file. What it CAN
// see is a repo-wide claim resting on a directory-scoped command, which is the
// one thing nobody noticed for ten rounds.
//
// Reports rather than fails by default: this is a lint over prose, and a check
// that cries wolf gets ignored, which is worse than not having it. `--strict`
// exits non-zero for CI use once a corpus is clean.
//
// Dependency-free, like `scripts/repo-census.mjs` and
// `scripts/citation-content/file-index.mjs`: `meta-checks` runs `npm ci` with no
// build step.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Commands whose job is to search a corpus. Anything else is not a claim's evidence. */
const SEARCH_COMMANDS = ["grep", "rg", "ripgrep", "ag", "ack", "find", "fd"];

/** Flags that take a VALUE, so the value is not a path operand. */
const VALUE_FLAGS = new Set([
  "-e",
  "-f",
  "--include",
  "--exclude",
  "--glob",
  "-g",
  "--type",
  "-t",
  "-m",
  "--max-count",
]);

/**
 * Splits on whitespace while keeping quoted runs together, so a pattern with a
 * slash in it is never mistaken for a path operand.
 */
function tokenize(command) {
  const tokens = [];
  const pattern = /"[^"]*"|'[^']*'|\S+/g;
  for (const match of String(command).matchAll(pattern)) tokens.push(match[0]);
  return tokens;
}

const isQuoted = (token) =>
  (token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"));

/**
 * `repo-wide` | `scoped` | `not-a-search`.
 *
 * A search with no path operand walks the whole tree from cwd, which for these
 * records is the repository root. An explicit `.` is the same thing said aloud.
 * A `git ls-files` pipeline enumerates every tracked file, so it is repo-wide
 * however the downstream filter is written.
 */
export function classifySearchCorpus(command) {
  const text = String(command);
  if (/\bgit\s+ls-files\b/.test(text)) return "repo-wide";

  const segments = text.split(/\||&&|;/);
  let sawSearch = false;
  let sawOperand = false;
  let sawRepoRoot = false;

  for (const segment of segments) {
    const tokens = tokenize(segment.trim());
    if (tokens.length === 0) continue;
    let head = tokens[0];
    let rest = tokens.slice(1);
    // `xargs grep ...` and `git grep ...` — the search is the second word.
    if ((head === "xargs" || head === "git") && rest.length > 0) {
      head = rest[0];
      rest = rest.slice(1);
    }
    if (!SEARCH_COMMANDS.includes(head)) continue;
    sawSearch = true;

    let firstNonFlagSeen = false;
    for (let index = 0; index < rest.length; index += 1) {
      const token = rest[index];
      if (token.startsWith("-")) {
        if (VALUE_FLAGS.has(token)) index += 1;
        continue;
      }
      // The first bare token is the PATTERN, not the corpus.
      if (!firstNonFlagSeen && !isQuoted(token)) {
        firstNonFlagSeen = true;
        continue;
      }
      if (isQuoted(token) && !firstNonFlagSeen) {
        firstNonFlagSeen = true;
        continue;
      }
      if (token === "." || token === "./") {
        sawRepoRoot = true;
        continue;
      }
      sawOperand = true;
    }
  }

  if (!sawSearch) return "not-a-search";
  if (sawOperand) return "scoped";
  return sawRepoRoot || !sawOperand ? "repo-wide" : "scoped";
}

/**
 * Phrases that range over the WHOLE repository. Deliberately short and
 * unambiguous: a lint that fires on ordinary prose gets switched off, and a
 * check nobody runs protects nothing.
 */
const QUANTIFIERS = [
  "nothing in this repository",
  "nothing in the repository",
  "nothing in the repo",
  "nothing anywhere",
  "nowhere in this repository",
  "nowhere in the repo",
  "no file in this repository",
  "no file in the repo",
  "nothing already",
  "does anything already",
  "zero matches",
  "no matches anywhere",
];

/** A claim and its evidence belong together only inside the same section. */
const SECTION_BREAK = /^#{1,6}\s/;

/** Inline `code` spans — where this repository's records actually cite a corpus. */
const INLINE_CODE = /`([^`]+)`/g;

/**
 * How far from a claim its evidence may sit, in lines, either side.
 *
 * MEASURED, not chosen for neatness. The first run over `docs/evidence`
 * reported 5 mismatches and 3 were wrong — each pairing a claim with a scoped
 * path far away in the same section, named as a SUBJECT rather than offered as
 * a corpus. The gaps were 125, 48 and 14 lines; the one true positive's gap was
 * 4. A paragraph's worth of lines separates them, and a lint that cries wolf
 * gets switched off, which protects nothing.
 */
const EVIDENCE_PROXIMITY_LINES = 8;

/**
 * A repo-relative LOCATION: it must contain a `/`, so a bare filename or a
 * symbol name does not qualify. `checksum-drift.ts` names a file under
 * discussion; `packages/cli/src/doctor/checks/` names a corpus that was
 * searched. Only the second bounds a claim, and firing on the first would make
 * this lint go off on ordinary prose — at which point it gets switched off,
 * which protects nothing.
 */
function scopedLocation(token) {
  const text = token.trim();
  if (!text.includes("/")) return undefined;
  if (/\s/.test(text)) return undefined;
  if (text === "." || text === "./" || text === "/") return undefined;
  return text;
}

export function findScopeMismatches(markdown) {
  const lines = String(markdown).split("\n");
  const mismatches = [];

  /** Everything gathered for the section currently being read. */
  let section = { claim: undefined, scopedEvidence: [], sawRepoWide: false };
  const reset = () => {
    section = { claim: undefined, scopedEvidence: [], sawRepoWide: false };
  };

  const settle = () => {
    if (section.claim === undefined) return;
    if (section.sawRepoWide) return;
    const evidence = section.scopedEvidence.find(
      (candidate) => Math.abs(candidate.line - section.claim.line) <= EVIDENCE_PROXIMITY_LINES,
    );
    if (evidence === undefined) return;
    mismatches.push({
      // 1-indexed, as an editor counts. Storing 0-indexed and adding one only
      // at print time left every other consumer of `.line` off by one — which
      // is the shape of defect this whole check exists to catch.
      line: section.claim.line,
      quantifier: section.claim.quantifier,
      claim: section.claim.text,
      evidence: evidence.text,
      evidenceKind: evidence.kind,
      evidenceLine: evidence.line,
    });
  };

  let inFence = false;
  let fenceStart = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      if (inFence) fenceStart = index + 1;
      continue;
    }

    if (inFence) {
      if (line.trim() === "") continue;
      const corpus = classifySearchCorpus(line);
      if (corpus === "repo-wide") section.sawRepoWide = true;
      else if (corpus === "scoped") {
        section.scopedEvidence.push({ text: line.trim(), kind: "command", line: fenceStart });
      }
      continue;
    }

    if (SECTION_BREAK.test(line)) {
      settle();
      reset();
      continue;
    }

    // Inline evidence: a quoted command, or a bare scoped location.
    for (const match of line.matchAll(INLINE_CODE)) {
      const token = match[1];
      const corpus = classifySearchCorpus(token);
      if (corpus === "repo-wide") {
        section.sawRepoWide = true;
        continue;
      }
      if (corpus === "scoped") {
        section.scopedEvidence.push({ text: token.trim(), kind: "command", line: index + 1 });
        continue;
      }
      const location = scopedLocation(token);
      if (location !== undefined) {
        section.scopedEvidence.push({ text: location, kind: "path", line: index + 1 });
      }
    }

    const lowered = line.toLowerCase();
    const quantifier = QUANTIFIERS.find((phrase) => lowered.includes(phrase));
    if (quantifier !== undefined && section.claim === undefined) {
      section.claim = { line: index + 1, quantifier, text: line.trim() };
    }
  }

  settle();
  return mismatches;
}

/* ----------------------------- CLI ----------------------------- */

function markdownFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...markdownFiles(full));
    } else if (entry.name.endsWith(".md")) {
      found.push(full);
    }
  }
  return found;
}

const isMain =
  process.argv[1] && statSync(process.argv[1]).ino === statSync(fileURLToPath(import.meta.url)).ino;

if (isMain) {
  const strict = process.argv.includes("--strict");
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const roots = args.length > 0 ? args : ["docs/evidence"];

  const files = [];
  for (const root of roots) {
    // An absolute argument is used as given. Blindly joining it to REPO_ROOT
    // produced `/home/.../crabgic/tmp/...` and an ENOENT — caught the first time
    // this was pointed at a file outside the tree.
    const full = isAbsolute(root) ? root : join(REPO_ROOT, root);
    files.push(...(statSync(full).isDirectory() ? markdownFiles(full) : [full]));
  }

  let total = 0;
  for (const file of files) {
    const found = findScopeMismatches(readFileSync(file, "utf8"));
    if (found.length === 0) continue;
    total += found.length;
    const rel = relative(REPO_ROOT, file).split(sep).join("/");
    for (const row of found) {
      process.stdout.write(
        `${rel}:${row.line}  quantifier "${row.quantifier}" rests on a SCOPED ${row.evidenceKind}\n` +
          `    claim:    ${row.claim}\n` +
          `    evidence: ${row.evidence}   (line ${row.evidenceLine})\n`,
      );
    }
  }

  process.stdout.write(
    total === 0
      ? `check-claim-scope: PASS — no universal claim rests on a scoped search across ${files.length} file(s).\n`
      : `check-claim-scope: ${total} scope mismatch(es) across ${files.length} file(s).\n`,
  );
  process.exit(total > 0 && strict ? 1 : 0);
}
