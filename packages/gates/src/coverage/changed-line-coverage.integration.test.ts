import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseLcovReport } from "./lcov-adapter.js";
import { parseChangedLines } from "./changed-lines.js";
import { scoreChangedLineCoverage } from "./changed-line-coverage.js";

/**
 * The three R6 pieces against REAL v8 output — the check that a unit suite
 * cannot make, because every unit fixture in this directory was written by the
 * same hand that wrote the parser it feeds.
 *
 * `./test-support/real-vitest-lcov.info` is two sections lifted VERBATIM from
 * this repository's own `coverage/lcov.info`, produced by `vitest --coverage`
 * with the `v8` provider. Nothing in it was typed by hand, which is the point:
 * the one assumption that no amount of unit testing can validate is the SHAPE
 * and PATH FORMAT a real reporter emits, and getting that wrong would make the
 * whole check silently score nothing while every unit test stayed green.
 *
 * WHAT IT ESTABLISHED, and it changed the design rather than confirming it:
 *
 *  1. v8's `SF:` paths are REPOSITORY-RELATIVE and identical in spelling to a
 *     `git diff` path, so the two meet without normalization. The suffix rule in
 *     `./changed-line-coverage.ts` exists for the reporters that do NOT do this.
 *  2. ⚠️ vitest's coverage report carries NO test files at all. So excluding
 *     `.test.`/`.spec.` from the absent-file refusal is REQUIRED, not a nicety —
 *     without it every change set that touched a test file would be refused for
 *     a file the reporter was never going to carry. Measured, not assumed: a
 *     scan of the real report found zero test-file sections.
 */

const FIXTURE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "test-support", "real-vitest-lcov.info"),
  "utf8",
);

/** A real-shaped diff over the paths the fixture actually carries. */
function diffFor(path: string, lines: readonly number[]): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    ...lines.map((line) => [`@@ -${String(line)},0 +${String(line)},1 @@`, "+changed"].join("\n")),
  ].join("\n");
}

describe("R6 end to end, over real vitest v8 lcov output", () => {
  it("parses the real report into per-line data keyed by repository-relative paths", () => {
    const summary = parseLcovReport(FIXTURE);
    expect(summary.toolchain).toBe("lcov");
    // The exact spelling a `git diff` produces — no leading slash, no `b/`.
    expect(summary.lines?.has("packages/gates/src/risk-tags.ts")).toBe(true);
    expect(summary.lines?.get("packages/gates/src/risk-tags.ts")?.get(28)).toBe(17);
  });

  it("scores a change to a covered line as covered", () => {
    const summary = parseLcovReport(FIXTURE);
    const outcome = scoreChangedLineCoverage(
      parseChangedLines(diffFor("packages/gates/src/risk-tags.ts", [28])),
      summary.lines,
    );
    expect(outcome.kind).toBe("scored");
    if (outcome.kind !== "scored") return;
    expect(outcome.score).toMatchObject({ instrumentable: 1, covered: 1 });
    expect(outcome.score.pct).toBe(100);
    expect(outcome.score.filesAbsentFromReport).toStrictEqual([]);
  });

  it("treats a changed line the real report does not instrument as not-instrumentable, never as uncovered", () => {
    const summary = parseLcovReport(FIXTURE);
    // Line 1 of that file is its import statement region — v8 emits no `DA:` for
    // it, and it must not be counted against the change set.
    const outcome = scoreChangedLineCoverage(
      parseChangedLines(diffFor("packages/gates/src/risk-tags.ts", [1])),
      summary.lines,
    );
    if (outcome.kind !== "scored") throw new Error("expected a score");
    expect(outcome.score.instrumentable).toBe(0);
    expect(outcome.score.notInstrumentable).toBe(1);
    expect(outcome.score.pct).toBeUndefined();
  });

  /**
   * ⚠️ The measured property this suite exists to pin. A brand-new source file
   * is absent from a real v8 report — not present at 0% — so the refusal has to
   * come from the absent-file branch or it comes from nowhere.
   */
  it("refuses a brand-new source file that the real report does not carry", () => {
    const summary = parseLcovReport(FIXTURE);
    const outcome = scoreChangedLineCoverage(
      parseChangedLines(diffFor("packages/gates/src/brand-new-module.ts", [1, 2, 3])),
      summary.lines,
    );
    if (outcome.kind !== "scored") throw new Error("expected a score");
    expect(outcome.score.filesAbsentFromReport).toStrictEqual([
      "packages/gates/src/brand-new-module.ts",
    ]);
  });

  /**
   * ⚠️ The measured property that FORCED a design decision. The real report
   * carries no test files, so a change set touching one would be refused for a
   * file no reporter was going to emit.
   */
  it("carries no test-file sections at all, which is why test files are exempt from the absent-file refusal", () => {
    const summary = parseLcovReport(FIXTURE);
    const testSections = [...(summary.lines?.keys() ?? [])].filter((path) =>
      path.includes(".test."),
    );
    expect(testSections).toStrictEqual([]);

    const outcome = scoreChangedLineCoverage(
      parseChangedLines(diffFor("packages/gates/src/coverage/lcov-adapter.test.ts", [1])),
      summary.lines,
    );
    if (outcome.kind !== "scored") throw new Error("expected a score");
    expect(outcome.score.filesAbsentFromReport).toStrictEqual([]);
  });
});
