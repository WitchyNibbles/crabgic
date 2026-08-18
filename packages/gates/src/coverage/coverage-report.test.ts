import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONVENTIONAL_LCOV_PATH, readCoverageSummary } from "./coverage-report.js";

/**
 * ⚠️ THE COVERAGE GATE'S MISSING INPUT.
 *
 * `createCoverageGate` takes a `CoverageSummary` and has never had a production
 * caller, because producing one means running the project's test suite and
 * reading the report it emits — and until owner decision 2026-08-18 the daemon
 * was forbidden to run a stack command at all
 * (`packages/cli/src/daemon/compose-gate-registry.ts`, which records this gate
 * as "better and still absent, and the precondition is unchanged"). The
 * precondition is now met, so this is the reader that was missing.
 *
 * ABSENCE IS NOT ZERO, and this module says so by returning `undefined` rather
 * than an empty summary. An empty `CoverageSummary` scores 0% and reads as a
 * measured catastrophe; a missing report means nothing was measured. Those are
 * different facts with different repairs, and the gate above decides what to do
 * with each — this reader never decides for it.
 */

let dir: string | undefined;

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function worktreeWith(lcov: string | undefined): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "crabgic-coverage-report-"));
  if (lcov !== undefined) {
    await mkdir(join(dir, "coverage"), { recursive: true });
    await writeFile(join(dir, CONVENTIONAL_LCOV_PATH), lcov, "utf8");
  }
  return dir;
}

/**
 * Two files: `a.ts` fully covered, `b.ts` half covered. Aggregate 3 of 4 lines
 * and 3 of 4 branches.
 *
 * ⚠️ `DA:` and `BRDA:` records only. `./lcov-adapter.ts` counts individual `DA:`
 * lines and `BRDA:` entries; it does NOT read the `LF:`/`LH:`/`BRF:`/`BRH:`
 * summary records real tools also emit. A fixture built out of those summary
 * lines parses as a report with nothing in it, which is how this fixture was
 * first written and why the note is here.
 */
const LCOV = [
  "SF:src/a.ts",
  "DA:1,1",
  "DA:2,3",
  "BRDA:1,0,0,1",
  "BRDA:1,0,1,2",
  "end_of_record",
  "SF:src/b.ts",
  "DA:1,1",
  "DA:2,0",
  "BRDA:1,0,0,1",
  "BRDA:1,0,1,0",
  "end_of_record",
  "",
].join("\n");

describe("readCoverageSummary — the report the granted command left behind", () => {
  it("parses the conventional report and reports per-file line data", async () => {
    const worktree = await worktreeWith(LCOV);

    const result = await readCoverageSummary(worktree);

    expect(result).toBeDefined();
    expect(result?.reportPath).toBe(CONVENTIONAL_LCOV_PATH);
    // 3 of 4 lines hit, 3 of 4 branches — `CoverageSummary` carries
    // PERCENTAGES plus the per-file map, never raw found/hit counts.
    expect(result?.summary.linePct).toBe(75);
    expect(result?.summary.branchPct).toBe(75);
    expect(result?.summary.toolchain).toBe("lcov");
    // The per-file map is what R6's changed-line check scores against; an
    // aggregate alone cannot answer "is THIS line covered". It is a `Map` of
    // `Map`s, not a plain object — index access silently yields `undefined`.
    expect(result?.summary.lines?.get("src/b.ts")?.get(2)).toBe(0);
    expect(result?.summary.lines?.get("src/a.ts")?.get(2)).toBe(3);
  });

  /**
   * ⚠️ The arm that keeps absence honest. Returning an empty summary here would
   * score 0% and read as a measured catastrophe — a project whose command emits
   * no report would be indistinguishable from one whose every line is
   * uncovered. `undefined` says "nothing was measured" and leaves the verdict to
   * the gate.
   */
  it("returns UNDEFINED when no report exists, never an empty summary", async () => {
    const worktree = await worktreeWith(undefined);

    expect(await readCoverageSummary(worktree)).toBeUndefined();
  });

  /**
   * A report that exists but parses to nothing is a REAL zero, not an absence:
   * the command ran, produced a report, and that report records no instrumented
   * line. Distinguished from the arm above because the repairs differ — one is
   * "configure coverage", the other is "your report is empty".
   */
  it("distinguishes an EMPTY report from a missing one", async () => {
    const worktree = await worktreeWith("");

    const result = await readCoverageSummary(worktree);

    expect(result, "an existing report read as absent").toBeDefined();
    /**
     * ⚠️ 100, NOT 0, and that is the adapter's rule rather than this reader's:
     * `lcov-adapter.ts` reports an empty denominator as 100% ("nothing
     * instrumented, nothing missed"). Asserted explicitly because it is a
     * genuinely dangerous number to meet unexpectedly — it is the gate above,
     * through `scoreChangedLineCoverage`'s `no-line-data` outcome, that refuses
     * a report with no per-file data, never this percentage.
     */
    expect(result?.summary.linePct).toBe(100);
    expect(result?.summary.lines?.size ?? 0).toBe(0);
  });

  /**
   * A directory where the report should be is not a report. Reading it throws
   * EISDIR, and swallowing that as "absent" would let a misconfigured project
   * look merely uninstrumented.
   */
  it("PROPAGATES a read error rather than reporting the report as absent", async () => {
    dir = await mkdtemp(join(tmpdir(), "crabgic-coverage-report-"));
    await mkdir(join(dir, CONVENTIONAL_LCOV_PATH), { recursive: true });

    await expect(readCoverageSummary(dir)).rejects.toThrow();
  });
});
