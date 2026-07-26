import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCheckResult, type AttestationCheckResult } from "./checkResult.js";

/**
 * `release-docs-committed` — roadmap/23-release-hardening.md Exit criteria:
 * "`docs/compatibility-matrix.md`, `operator-guide.md`,
 * `security-posture.md`, and `upgrade-guide.md` are committed, and every
 * claim in them cites a passing CI run or `EvidenceRecord` from the release
 * candidate — no aspirational text."
 *
 * Three separable, mechanically checkable obligations come out of that
 * sentence, and this module checks exactly those three — no more (an
 * emitter that tried to judge prose quality would be unfalsifiable, and a
 * FAIL it produced would not be actionable):
 *
 *   1. COMMITTED. All four docs exist AND are git-tracked. "Committed" is
 *      not "present on disk": an untracked file is absent from the release
 *      candidate's object ID entirely, so a claim it makes cannot be cited
 *      by anything downstream.
 *   2. CITED, AND THE CITATION RESOLVES. Every doc must cite at least one
 *      source, and every repo-rooted path it cites must actually exist. A
 *      dangling citation is precisely an unverifiable claim — the failure
 *      mode this exit criterion exists to catch.
 *   3. NO PLACEHOLDER TEXT. `TODO`/`TBD`/`FIXME`/`XXX` are literal
 *      unfinished-work markers — "aspirational text" in its least
 *      arguable form.
 *
 * DELIBERATELY NOT CHECKED: whether an `EVIDENCE-PENDING` marker is
 * present. `docs/compatibility-matrix.md`'s own preamble establishes that
 * marking a claim `EVIDENCE-PENDING` explicitly is how this repo satisfies
 * "no aspirational text", not how it violates it — an honest disclosure of
 * a gap is the opposite of an aspirational claim. Failing a doc for
 * disclosing a gap would incentivise deleting the disclosure.
 */
export const REQUIRED_RELEASE_DOCS = [
  "docs/compatibility-matrix.md",
  "docs/operator-guide.md",
  "docs/security-posture.md",
  "docs/upgrade-guide.md",
] as const;

/** Placeholder markers that constitute unfinished, aspirational text wherever they appear. */
const PLACEHOLDER_MARKER = /\b(TODO|TBD|FIXME|XXX)\b/;

/**
 * Repo-root prefixes a backticked token must start with to be judged as a
 * citation. This narrowing is what keeps the check precise: a doc mentions
 * plenty of backticked things that are not repo paths (`0.3.218`,
 * `@crabgic/journal`, `parked:rate_limit`, or an `src/index.ts` written relative
 * to some other package). Only a token that claims a location relative to
 * the repository root can be checked for existence, so only those are.
 */
const CITATION_ROOTS = [
  "docs/",
  "packages/",
  "scripts/",
  "docker/",
  "e2e/",
  "roadmap/",
  "spikes/",
  ".github/",
] as const;

/** A backticked token is a candidate path only if it is plain, rooted, and not a glob. */
const PLAIN_PATH = /^[A-Za-z0-9_.\-/]+$/;

/**
 * Extracts the distinct repo-rooted paths a document cites, in first-seen
 * order. Globs are excluded: they name a set, not a file, so "does it
 * exist" is not a well-posed question for them.
 */
export function extractCitedPaths(content: string): readonly string[] {
  const found = new Set<string>();
  for (const match of content.matchAll(/`([^`\n]+)`/g)) {
    const raw = match[1];
    if (raw === undefined) continue;
    const token = raw.replace(/\/+$/, "");
    if (token.includes("*") || !PLAIN_PATH.test(token)) continue;
    if (!CITATION_ROOTS.some((root) => token.startsWith(root))) continue;
    found.add(token);
  }
  return [...found];
}

function placeholderLines(content: string): readonly number[] {
  const lines: number[] = [];
  content.split("\n").forEach((line, index) => {
    if (PLACEHOLDER_MARKER.test(line)) lines.push(index + 1);
  });
  return lines;
}

export interface ReleaseDocInput {
  /** Repo-relative path, e.g. `docs/upgrade-guide.md`. */
  readonly path: string;
  /** Whether git tracks this path at the release candidate — NOT merely whether it exists on disk. */
  readonly tracked: boolean;
  readonly content: string;
}

export interface CheckReleaseDocsCommittedInput {
  readonly docs: readonly ReleaseDocInput[];
  /** Resolves a repo-relative cited path to whether it exists in the release candidate. */
  readonly pathExists: (repoRelativePath: string) => boolean;
}

/** Pure core — every input injected, so each failing condition is directly testable against a seeded fixture. */
export function checkReleaseDocsCommitted(
  input: CheckReleaseDocsCommittedInput,
): AttestationCheckResult {
  const reasons: string[] = [];
  const details: string[] = [];

  for (const required of REQUIRED_RELEASE_DOCS) {
    const doc = input.docs.find((candidate) => candidate.path === required);
    if (doc === undefined) {
      reasons.push(`${required} is absent from the release candidate.`);
      continue;
    }
    if (!doc.tracked) {
      reasons.push(`${required} exists on disk but is NOT git-tracked — it is not committed.`);
    }
    if (doc.content.trim() === "") {
      reasons.push(`${required} is empty.`);
      continue;
    }

    const placeholders = placeholderLines(doc.content);
    if (placeholders.length > 0) {
      reasons.push(
        `${required} carries unfinished placeholder text (TODO/TBD/FIXME/XXX) at line(s) ${placeholders.join(", ")}.`,
      );
    }

    const cited = extractCitedPaths(doc.content);
    if (cited.length === 0) {
      reasons.push(`${required} cites no repo-rooted source for any of its claims.`);
      continue;
    }
    const dangling = cited.filter((path) => !input.pathExists(path));
    if (dangling.length > 0) {
      reasons.push(
        `${required} cites ${dangling.length} source(s) that do not exist in the release candidate — ` +
          `an unverifiable claim: ${dangling.join(", ")}.`,
      );
    }
    details.push(
      `${required}: tracked=${String(doc.tracked)}, citations=${cited.length}, dangling=${dangling.length}.`,
    );
  }

  return buildCheckResult(reasons, details);
}

/** `true` iff git tracks `repoRelativePath` — the real "is it committed" test, not an `existsSync`. */
export function isTrackedByGit(repoRoot: string, repoRelativePath: string): boolean {
  const output = execFileSync("git", ["ls-files", "--", repoRelativePath], {
    cwd: repoRoot,
    encoding: "utf-8",
  });
  return output.trim() !== "";
}

/** Reads the four real docs out of `repoRoot` — the only I/O-touching function in this module. */
export function readReleaseDocsInput(repoRoot: string): CheckReleaseDocsCommittedInput {
  const docs: ReleaseDocInput[] = [];
  for (const required of REQUIRED_RELEASE_DOCS) {
    const absolute = join(repoRoot, required);
    if (!existsSync(absolute)) continue;
    docs.push({
      path: required,
      tracked: isTrackedByGit(repoRoot, required),
      content: readFileSync(absolute, "utf-8"),
    });
  }
  return {
    docs,
    // GIT-TRACKED, NOT `existsSync` — the same standard this module already
    // applies to the docs themselves ("'Committed' is not 'present on disk'",
    // above), now applied to what they cite.
    //
    // Resolving citations against the working directory made this check
    // ENVIRONMENT-DEPENDENT, and it silently passed on a local-only truth for
    // as long as it has existed. `docs/compatibility-matrix.md` and
    // `docs/operator-guide.md` both cite `e2e/release-gate-report.json`, which
    // is gitignored by design; it is present on any machine that has run the
    // generator, and absent from every fresh checkout. So the check passed
    // locally and failed on its first real CI run — the same class of defect
    // as the `.gitignore` P0 in e431710, where a tree built locally and only
    // locally.
    //
    // A regenerable, uncommitted artifact is not a verifiable citation: a
    // reader of the release tag cannot open it. Whether a given document
    // SHOULD cite it is a documentation question; whether this check can
    // report the same verdict everywhere is not.
    pathExists: (repoRelativePath) => isTrackedByGit(repoRoot, repoRelativePath),
  };
}
