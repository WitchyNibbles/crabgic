import { describe, expect, it } from "vitest";
import {
  CHANGED_LINE_COVERAGE_MINIMUM_PCT,
  INSTRUMENTABLE_EXTENSIONS,
  isInstrumentablePath,
  scoreChangedLineCoverage,
} from "./changed-line-coverage.js";
import type { ChangedLines } from "./changed-lines.js";
import type { FileLineCoverage } from "./types.js";

function changed(entries: Record<string, readonly number[]>): ChangedLines {
  return new Map(Object.entries(entries).map(([path, lines]) => [path, new Set(lines)]));
}

function coverage(entries: Record<string, Record<number, number>>): FileLineCoverage {
  return new Map(
    Object.entries(entries).map(([path, lines]) => [
      path,
      new Map(Object.entries(lines).map(([line, hits]) => [Number.parseInt(line, 10), hits])),
    ]),
  );
}

/** Narrows to the scored branch, so a test asserting a score cannot silently pass on a refusal. */
function score(...args: Parameters<typeof scoreChangedLineCoverage>) {
  const outcome = scoreChangedLineCoverage(...args);
  if (outcome.kind !== "scored") throw new Error(`expected a score, got ${outcome.kind}`);
  return outcome.score;
}

describe("scoreChangedLineCoverage", () => {
  it("scores changed lines the report shows executed", () => {
    const result = score(
      changed({ "src/a.ts": [10, 11, 12, 13] }),
      coverage({ "src/a.ts": { 10: 3, 11: 1, 12: 0, 13: 5 } }),
    );
    expect(result).toMatchObject({ instrumentable: 4, covered: 3, notInstrumentable: 0 });
    expect(result.pct).toBe(75);
    expect(result.uncoveredByFile.get("src/a.ts")).toStrictEqual([12]);
  });

  /**
   * "Changed INSTRUMENTABLE code", not "changed lines". A comment or a blank line
   * has no entry in the report, and counting it as uncovered would make a
   * well-documented change set fail a coverage gate for being documented.
   */
  it("excludes changed lines the report has no entry for from both numerator and denominator", () => {
    const result = score(
      changed({ "src/a.ts": [1, 2, 3, 4] }),
      coverage({ "src/a.ts": { 3: 1, 4: 1 } }),
    );
    expect(result).toMatchObject({ instrumentable: 2, covered: 2, notInstrumentable: 2 });
    expect(result.pct).toBe(100);
  });

  /**
   * ⚠️ THE VACUITY TRAP THIS WHOLE MODULE EXISTS FOR. A brand-new source file
   * that no test imports is simply ABSENT from a v8 or istanbul report. Every one
   * of its lines would read "not instrumentable" and it would score a perfect
   * 100% for having no tests at all — the exact inversion of what the gate is
   * for. It must be reported, not scored.
   */
  it("reports a changed source file that is absent from the coverage report entirely", () => {
    const result = score(
      changed({ "src/brand-new.ts": [1, 2, 3], "src/known.ts": [5] }),
      coverage({ "src/known.ts": { 5: 1 } }),
    );
    expect(result.filesAbsentFromReport).toStrictEqual(["src/brand-new.ts"]);
    // Its lines contribute to NOTHING — not to the numerator, not to the
    // denominator, and not to `notInstrumentable`, which would read as benign.
    expect(result).toMatchObject({ instrumentable: 1, covered: 1, notInstrumentable: 0 });
  });

  /** A changed README is not the coverage gate's business and must not refuse the gate. */
  it("does not report a changed non-source file as absent", () => {
    const result = score(
      changed({ "docs/guide.md": [1, 2], "package.json": [3] }),
      coverage({ "src/a.ts": { 1: 1 } }),
    );
    expect(result.filesAbsentFromReport).toStrictEqual([]);
  });

  /**
   * A test file that runs is trivially covered by itself, so counting one would
   * inflate the score of exactly the change sets that wrote the least production
   * coverage.
   */
  it("does not report a changed test file as absent", () => {
    const result = score(changed({ "src/a.test.ts": [1] }), coverage({ "src/b.ts": { 1: 1 } }));
    expect(result.filesAbsentFromReport).toStrictEqual([]);
  });

  it("matches a report path that is absolute against a repository-relative diff path", () => {
    const result = score(
      changed({ "packages/gates/src/a.ts": [7] }),
      coverage({ "/home/runner/work/crabgic/packages/gates/src/a.ts": { 7: 2 } }),
    );
    expect(result).toMatchObject({ instrumentable: 1, covered: 1 });
    expect(result.filesAbsentFromReport).toStrictEqual([]);
  });

  /** Anchored on a separator, so a suffix match cannot cross a filename boundary. */
  it("does not match a report path whose suffix merely ends with the diff path's characters", () => {
    const result = score(changed({ "src/a.ts": [1] }), coverage({ "/repo/src/lib-a.ts": { 1: 1 } }));
    expect(result.filesAbsentFromReport).toStrictEqual(["src/a.ts"]);
  });

  /**
   * ⚠️ A monorepo really can hold two files whose paths share a suffix. Picking
   * either would score a change against a file it was not made to — so an
   * ambiguous match routes into the absent population, which refuses.
   */
  it("refuses an ambiguous suffix match rather than picking one", () => {
    const result = score(
      changed({ "src/a.ts": [1] }),
      coverage({ "/repo/one/src/a.ts": { 1: 1 }, "/repo/two/src/a.ts": { 1: 0 } }),
    );
    expect(result.filesAbsentFromReport).toStrictEqual(["src/a.ts"]);
    expect(result.instrumentable).toBe(0);
  });

  it("reports an undefined percentage — never 100 — when no changed line is instrumentable", () => {
    const result = score(changed({ "src/a.ts": [1, 2] }), coverage({ "src/a.ts": { 9: 1 } }));
    expect(result.pct).toBeUndefined();
    expect(result.notInstrumentable).toBe(2);
  });

  /**
   * ⚠️ An aggregate-only report format must not be scored as a pass. Otherwise
   * any project exempts itself from this ruling by choosing a reporter.
   */
  it("returns no-line-data — not a score — when the report carries no per-line detail", () => {
    expect(scoreChangedLineCoverage(changed({ "src/a.ts": [1] }), undefined)).toStrictEqual({
      kind: "no-line-data",
    });
  });

  it("sorts uncovered line numbers and absent files, so a refusal reads the same way twice", () => {
    const result = score(
      changed({ "src/z.ts": [3, 1, 2], "src/b.ts": [9], "src/a.ts": [9] }),
      coverage({ "src/z.ts": { 1: 0, 2: 0, 3: 0 } }),
    );
    expect(result.uncoveredByFile.get("src/z.ts")).toStrictEqual([1, 2, 3]);
    expect(result.filesAbsentFromReport).toStrictEqual(["src/a.ts", "src/b.ts"]);
  });

  it("normalizes backslash separators before matching", () => {
    const result = score(
      changed({ "src/a.ts": [1] }),
      coverage({ "C:\\repo\\src\\a.ts": { 1: 1 } }),
    );
    expect(result).toMatchObject({ instrumentable: 1, covered: 1 });
  });
});

describe("isInstrumentablePath", () => {
  it("accepts every extension the adapters can report on", () => {
    for (const extension of INSTRUMENTABLE_EXTENSIONS) {
      expect(isInstrumentablePath(`src/file${extension}`)).toBe(true);
    }
  });

  it("rejects declaration files, build output, dependencies, tests and non-source files", () => {
    expect(isInstrumentablePath("src/a.d.ts")).toBe(false);
    expect(isInstrumentablePath("packages/x/dist/a.js")).toBe(false);
    // Repo-relative spellings, with the directory at the ROOT of the path — the
    // form a diff actually produces, and the one a `/dist/` substring test misses.
    expect(isInstrumentablePath("node_modules/x/a.js")).toBe(false);
    expect(isInstrumentablePath("dist/a.js")).toBe(false);
    expect(isInstrumentablePath("src/a.test.ts")).toBe(false);
    expect(isInstrumentablePath("src/a.spec.ts")).toBe(false);
    expect(isInstrumentablePath("README.md")).toBe(false);
    expect(isInstrumentablePath("package.json")).toBe(false);
  });
});

describe("the changed-line floor", () => {
  /** The roadmap's own number, not a second one invented here. */
  it("is the roadmap's 80%", () => {
    expect(CHANGED_LINE_COVERAGE_MINIMUM_PCT).toBe(80);
  });
});

describe("isExcludedFromCoverage", () => {
  /**
   * ⚠️ Found by running this gate against crabgic itself: `vitest.config.ts`
   * scopes `coverage.include` to `packages/*​/src/**`, so `scripts/*.mjs` is
   * genuinely absent from every report this repository produces. Without this,
   * a change set touching a build script would be refused — a false refusal
   * indistinguishable from the true one.
   */
  it("suppresses the absent-file refusal for a path the project excludes from coverage", () => {
    const withoutExclusion = score(
      changed({ "scripts/check-thing.mjs": [1, 2] }),
      coverage({ "packages/a/src/x.ts": { 1: 1 } }),
    );
    expect(withoutExclusion.filesAbsentFromReport).toStrictEqual(["scripts/check-thing.mjs"]);

    const withExclusion = score(
      changed({ "scripts/check-thing.mjs": [1, 2] }),
      coverage({ "packages/a/src/x.ts": { 1: 1 } }),
      ["scripts"],
    );
    expect(withExclusion.filesAbsentFromReport).toStrictEqual([]);
  });

  /** Segment-aware, matching `EnvelopePolicy.allowedPathPrefixes` — never a bare substring. */
  it("does not let a prefix match a sibling directory that merely starts with it", () => {
    const result = score(
      changed({ "scripts-of-mine/x.ts": [1] }),
      coverage({ "packages/a/src/x.ts": { 1: 1 } }),
      ["scripts"],
    );
    expect(result.filesAbsentFromReport).toStrictEqual(["scripts-of-mine/x.ts"]);
  });

  it("tolerates a trailing slash on a declared prefix", () => {
    const result = score(changed({ "scripts/x.mjs": [1] }), coverage({}), ["scripts/"]);
    expect(result.filesAbsentFromReport).toStrictEqual([]);
  });

  /** An empty exclusion list must not exclude everything — the fail-closed default. */
  it("excludes nothing when no prefixes are declared", () => {
    const result = score(changed({ "src/a.ts": [1] }), coverage({}), []);
    expect(result.filesAbsentFromReport).toStrictEqual(["src/a.ts"]);
  });
});
