import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * "`npm view engineering-orchestrator` re-check passes" — the last clause
 * of roadmap/23-release-hardening.md's reproducible-build exit criterion
 * (`:136`). roadmap/01 (`:47`) defines the mechanism precisely: phase 01
 * RECORDS a timestamped name-availability verdict in
 * `docs/release-notes-prep.md`, and "phase 23 re-checks the same name
 * against this record at publication."
 *
 * What existed before this module: `scripts/check-release-notes.mjs`, a
 * regex asserting the doc contains SOME timestamp and SOME verdict word.
 * It passes forever against phase 01's original 2026-07-15 record, so the
 * phase-23 "re-check" clause was satisfied by a check that cannot tell a
 * release-time re-check from a year-old one.
 *
 * This module deliberately does NOT shell out to `npm view`: the offline
 * `npm run test:e2e` leg has no network, and a check that silently passes
 * when the registry is unreachable would be worse than none. It asserts
 * the auditable fact instead — that the RECORDED verdict is recent enough
 * to stand for this release, and says "available". Re-running `npm view`
 * and re-recording the verdict is the owner's release action; this check
 * is what makes skipping it visible.
 *
 * The RECORD FORMAT this depends on is therefore load-bearing, and is
 * asserted rather than assumed: a re-check is a `Verdict: available|taken
 * … as of <ISO-8601>` on ONE line. A timestamp that is not attached to a
 * verdict is not a re-check, and neither is a verdict with no timestamp of
 * its own — see `TIMESTAMPED_VERDICT_PATTERN` below for why reading the
 * two independently is a false-green generator.
 *
 * (Publication itself — the criterion's separate "package published"
 * clause — IS checked against the live registry, by `publicationCheck.ts`.
 * It can be, because it fails CLOSED: no answer there is a blocking
 * reason, never a pass. That is the distinction, not a network taboo.)
 */

export const RELEASE_NOTES_PREP_REL_PATH = join("docs", "release-notes-prep.md");

/** How old a recorded verdict may be and still count as "re-checked at release time". */
export const NPM_NAME_RECHECK_MAX_AGE_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Verdict and timestamp are matched as ONE unit, deliberately.
 *
 * Scanning for a verdict and for a timestamp independently is a false-green
 * generator, because the doc convention is to APPEND each re-check: the
 * FIRST verdict in the file is the OLDEST, while the newest timestamp
 * anywhere in the file may belong to a different verdict — or to no verdict
 * at all (a "doc last reviewed <ts>" line from a typo fix). Pairing those
 * two independent scans lets a record saying the name is TAKEN, or a
 * cosmetic edit that ran no `npm view`, score as a fresh passing re-check.
 * Binding them in one pattern makes that structurally impossible: a
 * timestamp only ever counts as a re-check when it is attached to the
 * verdict it dates.
 */
const TIMESTAMPED_VERDICT_PATTERN =
  /\bVerdict:\s*(available|taken)\b[^.\n]*?\bas of\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/gi;

interface TimestampedVerdict {
  readonly available: boolean;
  readonly recordedAt: string;
}

export interface NpmNameRecheckResult {
  readonly path: string;
  readonly recordExists: boolean;
  /** The timestamp of the NEWEST verdict that carries its own `as of <ISO-8601>` stamp — never a timestamp read off some other line. */
  readonly recordedAt?: string;
  readonly ageDays?: number;
  readonly verdictAvailable: boolean;
  readonly fresh: boolean;
  /** Quotable release-blocking reasons — empty iff the clause is genuinely met. */
  readonly reasons: readonly string[];
}

export interface CheckNpmNameRecheckOptions {
  readonly repoRoot: string;
  /** The exact package name being published, e.g. `"engineering-orchestrator"`. */
  readonly packageName: string;
  /** Injectable for deterministic tests; defaults to the real current time. */
  readonly now?: () => Date;
  readonly maxAgeDays?: number;
}

/**
 * Every `Verdict: available|taken ... as of <ISO-8601>` pair in the record,
 * newest LAST. ISO-8601 UTC timestamps of fixed width sort lexicographically
 * in chronological order, so a string sort is a date sort here.
 */
function newestTimestampedVerdict(contents: string): TimestampedVerdict | undefined {
  const found: TimestampedVerdict[] = [];
  for (const match of contents.matchAll(TIMESTAMPED_VERDICT_PATTERN)) {
    const word = match[1];
    const recordedAt = match[2];
    // Both groups are mandatory in the pattern; the guard exists only to
    // satisfy `noUncheckedIndexedAccess` and cannot be reached.
    if (word === undefined || recordedAt === undefined) continue;
    found.push({ available: word.toLowerCase() === "available", recordedAt });
  }
  return [...found].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt)).at(-1);
}

function unmet(detail: string): string {
  return `${detail} — the exit criterion's "npm view <name> re-check passes" clause is UNMET.`;
}

export function checkNpmNameRecheck(options: CheckNpmNameRecheckOptions): NpmNameRecheckResult {
  const path = join(options.repoRoot, RELEASE_NOTES_PREP_REL_PATH);
  const maxAgeDays = options.maxAgeDays ?? NPM_NAME_RECHECK_MAX_AGE_DAYS;

  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return {
      path,
      recordExists: false,
      verdictAvailable: false,
      fresh: false,
      reasons: [unmet(`${RELEASE_NOTES_PREP_REL_PATH} does not exist, so no verdict was recorded`)],
    };
  }

  if (!contents.includes(options.packageName)) {
    return {
      path,
      recordExists: true,
      verdictAvailable: false,
      fresh: false,
      reasons: [
        unmet(
          `${RELEASE_NOTES_PREP_REL_PATH} never mentions "${options.packageName}", the package ` +
            `name being published, so it records no verdict for it`,
        ),
      ],
    };
  }

  const newest = newestTimestampedVerdict(contents);
  if (newest === undefined) {
    return {
      path,
      recordExists: true,
      verdictAvailable: false,
      fresh: false,
      reasons: [
        unmet(
          `${RELEASE_NOTES_PREP_REL_PATH} carries no timestamped "Verdict: available|taken ` +
            `as of <ISO-8601>" record (a bare timestamp with no verdict attached to it, or a ` +
            `verdict with no timestamp of its own, is not evidence that a re-check was run)`,
        ),
      ],
    };
  }

  const { available: verdictAvailable, recordedAt } = newest;
  const ageDays = Math.floor(
    ((options.now ?? ((): Date => new Date()))().getTime() - Date.parse(recordedAt)) / MS_PER_DAY,
  );
  const fresh = ageDays <= maxAgeDays;

  if (!verdictAvailable) {
    return {
      path,
      recordExists: true,
      recordedAt,
      ageDays,
      verdictAvailable,
      fresh,
      reasons: [
        unmet(
          `the recorded verdict for "${options.packageName}" is taken (as of ${recordedAt}) — ` +
            `claiming the name is a product decision for the owner, not a retry`,
        ),
      ],
    };
  }

  return {
    path,
    recordExists: true,
    recordedAt,
    ageDays,
    verdictAvailable,
    fresh,
    reasons: fresh
      ? []
      : [
          unmet(
            `the newest recorded "npm view ${options.packageName}" verdict is from ${recordedAt}, ` +
              `${String(ageDays)} days old — older than the ${String(maxAgeDays)}-day release-time ` +
              `re-check window, so nothing here evidences a re-check for THIS release`,
          ),
        ],
  };
}
