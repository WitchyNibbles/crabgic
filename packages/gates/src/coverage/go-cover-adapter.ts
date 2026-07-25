import { assertValidPct, type CoverageSummary } from "./types.js";

/**
 * Go-cover adapter — parses `go tool cover -func`-style profile text: a
 * `mode: <atomic|count|set>` header line followed by
 * `<file>:<startLine>.<startCol>,<endLine>.<endCol> <numStmt> <count>`
 * records. Statement coverage is the finest grain Go's standard cover
 * profile format reports — there is no separate branch-decision record the
 * way LCOV's `BRDA:` or istanbul's `branches` metric carry, so `branchPct`
 * is reported EQUAL to the statement-coverage percentage (a documented
 * minimal-sufficient choice: no branch-level data exists in this format to
 * compute a distinct value from — see the phase-14 evidence doc's
 * deviations section).
 */
const RECORD_RE = /^\S+:\d+\.\d+,\d+\.\d+\s+(\d+)\s+(\d+)$/;

export function parseGoCoverProfile(raw: string): CoverageSummary {
  let stmtsFound = 0;
  let stmtsHit = 0;

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("mode:")) continue;
    const match = RECORD_RE.exec(line);
    if (match === null) continue;
    const numStmt = Number.parseInt(match[1] ?? "0", 10);
    const count = Number.parseInt(match[2] ?? "0", 10);
    stmtsFound += numStmt;
    if (count > 0) {
      stmtsHit += numStmt;
    }
  }

  const pct = stmtsFound === 0 ? 100 : (stmtsHit / stmtsFound) * 100;
  assertValidPct(pct, "go-cover statement pct");
  return { linePct: pct, branchPct: pct, toolchain: "go-cover" };
}
