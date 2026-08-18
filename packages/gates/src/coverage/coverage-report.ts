import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseLcovReport } from "./lcov-adapter.js";
import type { CoverageSummary } from "./types.js";

/**
 * `readCoverageSummary` — the coverage gate's missing INPUT.
 *
 * ⚠️ WHY THIS DID NOT EXIST. `createCoverageGate` takes a `CoverageSummary` and
 * has never had a production caller, because producing one means running the
 * project's own test suite and reading the report it emits — and until owner
 * decision 2026-08-18 the daemon was forbidden to run a stack command at all.
 * `packages/cli/src/daemon/compose-gate-registry.ts` records exactly that:
 * owner ruling R6 made the gate better (it scores the CHANGE rather than the
 * repository) and left it absent, because "registering it today would mean a
 * handler with nothing to measure". The precondition is now met.
 *
 * ⚠️ ABSENCE IS NOT ZERO, and this module refuses to conflate them. A missing
 * report returns `undefined`; an empty report returns a real summary with
 * `linesFound: 0`. An empty `CoverageSummary` scores 0% and reads as a measured
 * catastrophe, so returning one for a project that simply emits no report would
 * make "coverage is not configured" indistinguishable from "every line is
 * uncovered" — different facts, different repairs. Which one blocks is the
 * gate's decision, never this reader's.
 *
 * A READ ERROR PROPAGATES. Swallowing `EISDIR` or a permission failure as
 * "absent" would let a misconfigured project look merely uninstrumented, which
 * is the softer and wronger of the two readings.
 */

/**
 * Where an lcov report is looked for, worktree-relative.
 *
 * ONE conventional path rather than a search: a search that accepted whichever
 * report it found first would let a stale report in an unexpected directory
 * decide a publication. This is the path `vitest`, `jest` and `nyc` all write by
 * default, so a project that emits coverage at all almost certainly emits it
 * here — and one that does not is telling the gate something true.
 */
export const CONVENTIONAL_LCOV_PATH = "coverage/lcov.info";

export interface CoverageReportRead {
  readonly summary: CoverageSummary;
  /** Worktree-relative path the summary came from, so a verdict can name its own source. */
  readonly reportPath: string;
}

/** Reads and parses `worktreePath/coverage/lcov.info`, or `undefined` when no such file exists. */
export async function readCoverageSummary(
  worktreePath: string,
): Promise<CoverageReportRead | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(worktreePath, CONVENTIONAL_LCOV_PATH), "utf8");
  } catch (err) {
    // ONLY "no such file" means absent. Everything else — a directory in the
    // report's place, a permission failure — is a real error the caller must
    // see, because each has a repair that "absent" would hide.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  return { summary: parseLcovReport(raw), reportPath: CONVENTIONAL_LCOV_PATH };
}
