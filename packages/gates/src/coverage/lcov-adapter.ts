import { assertValidPct, type CoverageSummary } from "./types.js";

/**
 * LCOV adapter — parses the standard `lcov`/`.info` text format (the
 * output `c8`/`nyc`/many Node coverage tools emit): `DA:<line>,<hits>` for
 * line coverage, `BRDA:<line>,<block>,<branch>,<taken>` for branch coverage
 * (`taken` is `-` for "never reached" or a hit count). Multiple
 * `end_of_record`-delimited per-file sections are summed across the whole
 * report — this adapter reports one project-wide `CoverageSummary`, not a
 * per-file breakdown (no cited source material asks for per-file granularity
 * at the gate level).
 */
export function parseLcovReport(raw: string): CoverageSummary {
  let linesFound = 0;
  let linesHit = 0;
  let branchesFound = 0;
  let branchesHit = 0;

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("DA:")) {
      const [, hitsStr] = line.slice(3).split(",");
      linesFound += 1;
      if (hitsStr !== undefined && Number.parseInt(hitsStr, 10) > 0) {
        linesHit += 1;
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
  return { linePct, branchPct, toolchain: "lcov" };
}
