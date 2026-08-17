import { assertValidPct, type CoverageSummary, type FileLineCoverage } from "./types.js";

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
 *
 * OWNER RULING R6 — it now also returns per-line detail, because each record
 * names a LINE RANGE. Every line from `startLine` to `endLine` inclusive is
 * attributed the block's execution count. That is coarser than LCOV's per-line
 * records and it is the finest this format offers: Go counts statement BLOCKS,
 * so a block's lines share one verdict. The consequence is stated rather than
 * hidden — a changed line inside an executed block reads as covered even if it
 * is a continuation line, which errs toward PASSING and is therefore the one
 * direction worth naming. It is a property of the format, not of this adapter.
 */
const RECORD_RE = /^(\S+):(\d+)\.\d+,(\d+)\.\d+\s+(\d+)\s+(\d+)$/;

/** A pathological range must not allocate unboundedly; a real Go block never spans this many lines. */
const MAX_BLOCK_LINES = 100_000;

export function parseGoCoverProfile(raw: string): CoverageSummary {
  let stmtsFound = 0;
  let stmtsHit = 0;
  const lines = new Map<string, Map<number, number>>();

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("mode:")) continue;
    const match = RECORD_RE.exec(line);
    if (match === null) continue;
    const path = match[1] ?? "";
    const startLine = Number.parseInt(match[2] ?? "0", 10);
    const endLine = Number.parseInt(match[3] ?? "0", 10);
    const numStmt = Number.parseInt(match[4] ?? "0", 10);
    const count = Number.parseInt(match[5] ?? "0", 10);
    stmtsFound += numStmt;
    if (count > 0) {
      stmtsHit += numStmt;
    }

    if (path.length === 0 || startLine <= 0 || endLine < startLine) continue;
    if (endLine - startLine > MAX_BLOCK_LINES) continue;
    let fileLines = lines.get(path);
    if (fileLines === undefined) {
      fileLines = new Map<number, number>();
      lines.set(path, fileLines);
    }
    for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
      // MAX on overlap, never overwrite. Go emits nested/overlapping blocks for
      // inlined expressions, and a later zero-count block must not erase an
      // earlier positive one — the same rule the LCOV adapter applies per record.
      fileLines.set(lineNumber, Math.max(fileLines.get(lineNumber) ?? 0, count));
    }
  }

  const pct = stmtsFound === 0 ? 100 : (stmtsHit / stmtsFound) * 100;
  assertValidPct(pct, "go-cover statement pct");
  return { linePct: pct, branchPct: pct, toolchain: "go-cover", lines: lines as FileLineCoverage };
}
