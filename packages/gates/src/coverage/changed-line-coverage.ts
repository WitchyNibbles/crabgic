import type { ChangedLines } from "./changed-lines.js";
import type { FileLineCoverage } from "./types.js";

/**
 * Scores the lines a change set ADDED against the coverage report — owner ruling
 * R6's third ingredient, and the check `roadmap/14-quality-security-gates.md:37`
 * has promised since it was written: "changed instrumentable code reaches 80%".
 *
 * WHY THIS IS THE RIGHT SHAPE OF ANSWER. The aggregate floor beside it asks a
 * question about the REPOSITORY, and a worker verifying a two-file change cannot
 * move it: run the suite filtered and the aggregate collapses over files the
 * change never touched (measured at 0.48% —
 * `docs/evidence/phase-25/published-unverified.md`), run it whole and a bounded
 * turn budget is spent on a suite that is almost entirely unrelated. This asks a
 * question about the CHANGE, which is the only question a change set can answer.
 *
 * ⚠️ THE VACUITY TRAP THIS FILE EXISTS TO AVOID. "Of the changed instrumentable
 * lines, 80% are covered" is a ratio, and a ratio with an empty denominator is
 * 100% for free. There are three distinct ways the denominator empties, and
 * exactly one of them is benign:
 *
 *   1. the diff added no lines at all — benign, there is nothing to cover;
 *   2. the added lines are comments, blanks or type-only declarations that no
 *      coverage tool instruments — benign, and the reason this scores
 *      INSTRUMENTABLE lines rather than all of them;
 *   3. ⚠️ the changed FILE does not appear in the coverage report at all.
 *
 * The third is not benign and is the likeliest of the three in practice: a brand
 * new source file that no test ever imports is simply absent from a v8 or
 * istanbul report unless the run was configured to include untested files. Every
 * one of its lines would read as "not instrumentable" and it would score a
 * perfect 100% for having no tests whatsoever — the exact inversion this gate
 * exists to prevent. So absent files are counted and reported separately, and
 * `../coverage-gate.ts` refuses on them.
 */

/** The threshold changed instrumentable code must reach — the roadmap's own number. */
export const CHANGED_LINE_COVERAGE_MINIMUM_PCT = 80;

/**
 * Extensions whose files a coverage report is expected to carry.
 *
 * Bounds the "absent file" refusal to files a coverage tool could plausibly have
 * instrumented, so a diff touching a README does not refuse the gate. Derived
 * from the languages this package's four adapters actually parse — LCOV and
 * istanbul for JS/TS, go-cover for Go, coverage.py for Python — rather than from
 * a general list of programming languages, because a language no adapter reads
 * produces no report to be absent from.
 *
 * Deliberately an ALLOWLIST. A denylist would silently adopt every future file
 * type into the refusal, and the failure would look like the gate being broken
 * rather than like a list needing an entry.
 */
export const INSTRUMENTABLE_EXTENSIONS: readonly string[] = Object.freeze([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".go",
  ".py",
]);

/**
 * Paths a coverage report is not expected to carry even though the extension
 * matches — the same two categories every `coverage.exclude` in this repository
 * already names, applied here so the gate agrees with the tooling that produced
 * its input.
 *
 * A TEST FILE IS EXCLUDED DELIBERATELY, and it is worth being explicit about
 * why, because the opposite is defensible: a test file that runs is trivially
 * covered by itself, so including them inflates the score of exactly the change
 * sets that wrote the fewest tests for their production code.
 */
const NON_INSTRUMENTABLE_MARKERS: readonly string[] = Object.freeze([
  ".test.",
  ".spec.",
  ".d.ts",
  "/dist/",
  "/node_modules/",
]);

/**
 * Paths a project's own coverage configuration deliberately leaves out of the
 * denominator — supplied by the caller, because only the project knows.
 *
 * ⚠️ REQUIRED FOR CORRECTNESS, not a convenience knob, and found by running this
 * gate against crabgic itself. `vitest.config.ts` here scopes `coverage.include`
 * to `packages/*​/src/**` (plus two named files), so `scripts/*.mjs` is genuinely
 * absent from every report this repository produces. Without a way to say so,
 * the absent-file branch would refuse any change set touching a build script —
 * a false refusal, and one that looks exactly like the true refusal it exists
 * to raise.
 *
 * Segment-aware prefixes, matching the containment convention
 * `EnvelopePolicy.allowedPathPrefixes` already uses: `scripts` excludes
 * `scripts/x.mjs` and does not exclude `scripts-of-mine/x.mjs`.
 */
export function isExcludedFromCoverage(
  path: string,
  excludedPrefixes: readonly string[],
): boolean {
  const normalized = normalizePath(path);
  return excludedPrefixes.some((prefix) => {
    const clean = normalizePath(prefix).replace(/\/+$/, "");
    return clean.length > 0 && (normalized === clean || normalized.startsWith(`${clean}/`));
  });
}

export function isInstrumentablePath(path: string): boolean {
  const normalized = normalizePath(path);
  /**
   * Prefixed with `/` before the segment markers are tested, so a directory at
   * the ROOT of a repository-relative path matches too. Without it
   * `node_modules/x/a.js` and `dist/a.js` — the spellings a repo-relative diff
   * actually produces — slipped past `/node_modules/` and `/dist/`, which is
   * precisely where those paths appear.
   */
  const anchored = `/${normalized}`;
  if (NON_INSTRUMENTABLE_MARKERS.some((marker) => anchored.includes(marker))) return false;
  return INSTRUMENTABLE_EXTENSIONS.some((extension) => normalized.endsWith(extension));
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * Finds the coverage entry for one diff path.
 *
 * Diff paths are repository-relative; a report's paths may be absolute, relative
 * to a different root, or identical. So a report path matches when it IS the
 * diff path or ENDS WITH `/` + the diff path — a suffix rule, anchored on a
 * separator so `src/a.ts` cannot match `src/lib-a.ts`.
 *
 * ⚠️ AMBIGUITY IS NOT RESOLVED, IT IS REFUSED. A monorepo can genuinely hold two
 * files whose paths share a suffix, and picking either one would score a change
 * against a file it was not made to. Returning `undefined` routes the file into
 * the absent-from-report population, which refuses — the fail-closed direction.
 */
function findFileCoverage(
  coverage: FileLineCoverage,
  diffPath: string,
): ReadonlyMap<number, number> | undefined {
  const target = normalizePath(diffPath);
  let found: ReadonlyMap<number, number> | undefined;
  for (const [reportPath, lines] of coverage) {
    const candidate = normalizePath(reportPath);
    if (candidate !== target && !candidate.endsWith(`/${target}`)) continue;
    if (found !== undefined) return undefined; // ambiguous — see the doc comment
    found = lines;
  }
  return found;
}

export interface ChangedLineCoverageScore {
  /** Changed lines the report knows about — the denominator. */
  readonly instrumentable: number;
  /** Of those, how many the report shows executed at least once. */
  readonly covered: number;
  /** `covered / instrumentable`, or `undefined` when the denominator is empty. */
  readonly pct: number | undefined;
  /** Changed lines the report has no entry for — comments, blanks, type-only code. Benign. */
  readonly notInstrumentable: number;
  /**
   * ⚠️ Changed files whose extension says a coverage report should carry them
   * and which the report does not carry at all. NOT benign — see the file
   * header. Sorted, so a refusal reads the same way twice.
   */
  readonly filesAbsentFromReport: readonly string[];
  /** Changed instrumentable lines that the report shows were never executed, by file — the actionable half of a refusal. */
  readonly uncoveredByFile: ReadonlyMap<string, readonly number[]>;
}

export type ChangedLineCoverageOutcome =
  /** The report format carries no per-line data, so this question cannot be answered at all. */
  | { readonly kind: "no-line-data" }
  | { readonly kind: "scored"; readonly score: ChangedLineCoverageScore };

/**
 * Scores `changed` against `coverage`.
 *
 * `coverage` being `undefined` — an aggregate-only report format — is NOT scored
 * as zero and NOT scored as a pass. It returns `no-line-data`, and the gate
 * turns that into a refusal that names the toolchain, because "this adapter
 * cannot answer" and "the answer is fine" must never share an outcome.
 *
 * `excludedFromCoverage` names the path prefixes the project's own coverage
 * configuration leaves out of the denominator — see `isExcludedFromCoverage`
 * for why an empty default is the fail-CLOSED choice: with no exclusions
 * declared, an absent file refuses.
 */
export function scoreChangedLineCoverage(
  changed: ChangedLines,
  coverage: FileLineCoverage | undefined,
  excludedFromCoverage: readonly string[] = [],
): ChangedLineCoverageOutcome {
  if (coverage === undefined) return { kind: "no-line-data" };

  let instrumentable = 0;
  let covered = 0;
  let notInstrumentable = 0;
  const filesAbsentFromReport: string[] = [];
  const uncoveredByFile = new Map<string, readonly number[]>();

  for (const [path, lines] of changed) {
    const fileCoverage = findFileCoverage(coverage, path);
    if (fileCoverage === undefined) {
      // Absent from the report. Only a refusal when the file is one a report
      // was expected to carry; a changed `.md` or `.json` is simply not this
      // gate's business and contributes to nothing.
      if (isInstrumentablePath(path) && !isExcludedFromCoverage(path, excludedFromCoverage)) {
        filesAbsentFromReport.push(path);
      }
      continue;
    }
    const uncovered: number[] = [];
    for (const line of lines) {
      const hits = fileCoverage.get(line);
      if (hits === undefined) {
        notInstrumentable += 1;
        continue;
      }
      instrumentable += 1;
      if (hits > 0) covered += 1;
      else uncovered.push(line);
    }
    if (uncovered.length > 0) {
      uncoveredByFile.set(
        path,
        uncovered.sort((a, b) => a - b),
      );
    }
  }

  return {
    kind: "scored",
    score: {
      instrumentable,
      covered,
      pct: instrumentable === 0 ? undefined : (covered / instrumentable) * 100,
      notInstrumentable,
      filesAbsentFromReport: filesAbsentFromReport.sort(),
      uncoveredByFile,
    },
  };
}
