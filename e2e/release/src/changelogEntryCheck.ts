import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * "`CHANGELOG.md` entry present" — one of the seven clauses of
 * roadmap/23-release-hardening.md's reproducible-build exit criterion
 * (`:136`), restated verbatim in `e2e/report/src/checklist.ts`'s own
 * `reproducible-build` item description. Until now the gate asserted that
 * clause and verified nothing about it: the harness PREPARED a changelog
 * draft in memory and never looked at the repository at all.
 *
 * This check is deliberately read-only. Writing a real `CHANGELOG.md` is
 * an owner release action (PREPARE-DON'T-PUBLISH); this module only
 * reports whether one exists and carries a section for the release
 * version.
 */

export const CHANGELOG_FILENAME = "CHANGELOG.md";

export interface ChangelogEntryCheckResult {
  /** Absolute path this check looked at. */
  readonly path: string;
  readonly fileExists: boolean;
  readonly hasVersionEntry: boolean;
  /** Quotable release-blocking reasons — empty iff the clause is genuinely met. */
  readonly reasons: readonly string[];
}

export interface CheckChangelogEntryOptions {
  readonly repoRoot: string;
  /** The release version, e.g. `"1.0.0"` — matched as a whole version, so `1.0.0-rc.1` is not mistaken for it. */
  readonly version: string;
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matches the section-heading dialects real changelogs use for a release —
 * `## 1.0.0`, `## v1.0.0`, `## [1.0.0]`, `### [v1.0.0] - 2026-07-25` — and
 * nothing else. The trailing `(?![\w.-])` is what stops `## 1.0.0-rc.1`
 * from counting as the `1.0.0` entry.
 */
function versionHeadingPattern(version: string): RegExp {
  return new RegExp(`^#{1,3}\\s+\\[?v?${escapeRegExp(version)}\\]?(?![\\w.-])`, "m");
}

export function checkChangelogEntry(
  options: CheckChangelogEntryOptions,
): ChangelogEntryCheckResult {
  const path = join(options.repoRoot, CHANGELOG_FILENAME);
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return {
      path,
      fileExists: false,
      hasVersionEntry: false,
      reasons: [
        `no ${CHANGELOG_FILENAME} exists at the repository root (${path}) — the exit criterion's ` +
          `"CHANGELOG.md entry present" clause is UNMET. The harness prepares a draft in memory ` +
          `and deliberately never writes this file; cutting it is an owner release action.`,
      ],
    };
  }

  const hasVersionEntry = versionHeadingPattern(options.version).test(contents);
  return {
    path,
    fileExists: true,
    hasVersionEntry,
    reasons: hasVersionEntry
      ? []
      : [
          `${CHANGELOG_FILENAME} exists but carries no section heading for version ` +
            `${options.version} — the exit criterion's "CHANGELOG.md entry present" clause is UNMET.`,
        ],
  };
}
