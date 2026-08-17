import { assertValidPct, type CoverageSummary, type FileLineCoverage } from "./types.js";

/**
 * LCOV adapter — parses the standard `lcov`/`.info` text format (the
 * output `c8`/`nyc`/many Node coverage tools emit): `DA:<line>,<hits>` for
 * line coverage, `BRDA:<line>,<block>,<branch>,<taken>` for branch coverage
 * (`taken` is `-` for "never reached" or a hit count). Multiple
 * `end_of_record`-delimited per-file sections are summed across the whole
 * report to produce the project-wide aggregate.
 *
 * OWNER RULING R6 — it now ALSO returns the per-file, per-line detail it used to
 * discard. `docs/evidence/phase-14/README.md` named that discard as one of the
 * three things missing for changed-line coverage: "LCOV's own `DA:<line>,<hits>`
 * records already carry this — `coverage/lcov-adapter.ts` currently discards the
 * per-line detail after aggregating". The aggregate is unchanged, byte for byte,
 * so nothing that depended on it moves.
 *
 * PATHS ARE REPORTED AS THE REPORT WRITES THEM (`SF:` verbatim). Normalizing
 * here would guess at a repository root this adapter has no way to know;
 * `./changed-line-coverage.ts` owns matching them against diff paths, and does
 * it by suffix so an absolute `SF:` and a repo-relative diff path still meet.
 */
export function parseLcovReport(raw: string): CoverageSummary {
  let linesFound = 0;
  let linesHit = 0;
  let branchesFound = 0;
  let branchesHit = 0;
  const lines = new Map<string, Map<number, number>>();
  /**
   * The section a `DA:` belongs to. LCOV is stateful — records apply to the most
   * recent `SF:` — so a `DA:` arriving before any `SF:` belongs to no file and
   * is counted in the AGGREGATE (which is what it always was) while contributing
   * no per-line entry. Attributing it to whichever file happened to be parsed
   * last is the one wrong answer available here.
   */
  let currentFile: Map<number, number> | undefined;

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("SF:")) {
      const path = line.slice(3).trim();
      if (path.length === 0) {
        currentFile = undefined;
        continue;
      }
      // A path repeated across sections MERGES rather than replacing: some tools
      // emit one section per test file. Replacing would keep only the last
      // section's hits and read lines as uncovered that a different section ran.
      let existing = lines.get(path);
      if (existing === undefined) {
        existing = new Map<number, number>();
        lines.set(path, existing);
      }
      currentFile = existing;
      continue;
    }
    if (line === "end_of_record") {
      currentFile = undefined;
      continue;
    }
    if (line.startsWith("DA:")) {
      const [lineStr, hitsStr] = line.slice(3).split(",");
      const hits = hitsStr === undefined ? 0 : Number.parseInt(hitsStr, 10);
      linesFound += 1;
      if (Number.isFinite(hits) && hits > 0) {
        linesHit += 1;
      }
      const lineNumber = lineStr === undefined ? Number.NaN : Number.parseInt(lineStr, 10);
      if (currentFile !== undefined && Number.isInteger(lineNumber) && lineNumber > 0) {
        // SUM on repeat, never overwrite — the same merge reasoning as `SF:`
        // above, one record finer. A `0` hit count from one section must not
        // erase a positive count from another.
        const previous = currentFile.get(lineNumber) ?? 0;
        currentFile.set(lineNumber, previous + (Number.isFinite(hits) ? Math.max(hits, 0) : 0));
      }
      continue;
    }
    if (line.startsWith("BRDA:")) {
      const parts = line.slice(5).split(",");
      const taken = parts[3];
      branchesFound += 1;
      if (taken !== undefined && taken !== "-" && Number.parseInt(taken, 10) > 0) {
        branchesHit += 1;
      }
    }
  }

  const linePct = linesFound === 0 ? 100 : (linesHit / linesFound) * 100;
  const branchPct = branchesFound === 0 ? 100 : (branchesHit / branchesFound) * 100;
  assertValidPct(linePct, "lcov linePct");
  assertValidPct(branchPct, "lcov branchPct");
  return { linePct, branchPct, toolchain: "lcov", lines: lines as FileLineCoverage };
}
