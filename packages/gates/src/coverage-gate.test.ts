import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestJournal, type TestJournal } from "./test-support/test-journal.js";
import { createGateRegistry } from "./registry.js";
import { createCoverageGate } from "./coverage-gate.js";
import type { GateContext } from "./types.js";

let tj: TestJournal;
let baseContext: Omit<GateContext, "objectId" | "stage">;

const PROJECT_ID = "project-under-test";

beforeEach(async () => {
  tj = await createTestJournal();
  baseContext = { changeSetId: randomUUID(), journal: tj.store };
});

afterEach(async () => {
  await tj.cleanup();
});

describe("coverage gate", () => {
  it("passes a greenfield project at/above the 80% minimum on both axes", async () => {
    const registry = createGateRegistry();
    registry.register(
      "coverage",
      "coverage",
      createCoverageGate({
        projectId: PROJECT_ID,
        summary: { linePct: 85, branchPct: 81, toolchain: "istanbul" },
      }),
    );
    const [result] = await registry.fireByTag("coverage", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj",
    });
    expect(result?.verdict.passed).toBe(true);
  });

  it("fails a greenfield project below the 80% minimum", async () => {
    const registry = createGateRegistry();
    registry.register(
      "coverage",
      "coverage",
      createCoverageGate({
        projectId: PROJECT_ID,
        summary: { linePct: 70, branchPct: 90, toolchain: "istanbul" },
      }),
    );
    const [result] = await registry.fireByTag("coverage", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj",
    });
    expect(result?.verdict.passed).toBe(false);
    expect(result?.verdict.detail).toMatch(/greenfield|effective/i);
  });

  it("MINOR-2 (adversarial-validation round): a project that fails greenfield once must NOT then be able to pass in the 50-79% band indefinitely", async () => {
    // Run 1: 50% — correctly fails the greenfield 80% minimum. But this
    // observation is STILL RECORDED (ratchet history is append-only), so
    // the raw ratchet floor becomes 50 afterward.
    const registryFirst = createGateRegistry();
    registryFirst.register(
      "coverage",
      "coverage",
      createCoverageGate({
        projectId: PROJECT_ID,
        summary: { linePct: 50, branchPct: 50, toolchain: "istanbul" },
      }),
    );
    const [first] = await registryFirst.fireByTag("coverage", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj-1",
    });
    expect(first?.verdict.passed).toBe(false);

    // Run 2: 60% — NOT a regression relative to the raw 50% floor, so a
    // ratchet-only check would wrongly PASS here, despite still being well
    // below the 80% greenfield minimum this project has never yet met.
    const registrySecond = createGateRegistry();
    registrySecond.register(
      "coverage",
      "coverage",
      createCoverageGate({
        projectId: PROJECT_ID,
        summary: { linePct: 60, branchPct: 60, toolchain: "istanbul" },
      }),
    );
    const [second] = await registrySecond.fireByTag("coverage", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj-2",
    });
    expect(second?.verdict.passed).toBe(false);

    // Run 3: once the project genuinely reaches >=80%, ordinary ratchet
    // behavior resumes (the effective-floor clamp becomes a no-op).
    const registryThird = createGateRegistry();
    registryThird.register(
      "coverage",
      "coverage",
      createCoverageGate({
        projectId: PROJECT_ID,
        summary: { linePct: 85, branchPct: 85, toolchain: "istanbul" },
      }),
    );
    const [third] = await registryThird.fireByTag("coverage", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj-3",
    });
    expect(third?.verdict.passed).toBe(true);
  });

  it("ratchet-regression fixture: a recorded floor of 82% then a new run of 79% BLOCKS", async () => {
    const registryFirst = createGateRegistry();
    registryFirst.register(
      "coverage",
      "coverage",
      createCoverageGate({
        projectId: PROJECT_ID,
        summary: { linePct: 82, branchPct: 82, toolchain: "istanbul" },
      }),
    );
    const [first] = await registryFirst.fireByTag("coverage", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj-1",
    });
    expect(first?.verdict.passed).toBe(true);

    const registrySecond = createGateRegistry();
    registrySecond.register(
      "coverage",
      "coverage",
      createCoverageGate({
        projectId: PROJECT_ID,
        summary: { linePct: 79, branchPct: 85, toolchain: "istanbul" },
      }),
    );
    const [second] = await registrySecond.fireByTag("coverage", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj-2",
    });
    expect(second?.verdict.passed).toBe(false);
    expect(second?.verdict.detail).toMatch(/regressed/i);
  });

  it("MINOR-3 (adversarial-validation round): two different projects sharing one journal never contaminate each other's coverage gate outcome", async () => {
    const registryProjectA = createGateRegistry();
    registryProjectA.register(
      "coverage",
      "coverage",
      createCoverageGate({
        projectId: "project-a",
        summary: { linePct: 95, branchPct: 95, toolchain: "istanbul" },
      }),
    );
    const [projectAResult] = await registryProjectA.fireByTag("coverage", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj-a",
    });
    expect(projectAResult?.verdict.passed).toBe(true);

    // Project B's first-ever run, on the SAME shared journal, is well below
    // project A's floor but still >= the 80% greenfield minimum — it must
    // pass on its own merits, never be treated as a regression against
    // project A's unrelated 95% floor.
    const registryProjectB = createGateRegistry();
    registryProjectB.register(
      "coverage",
      "coverage",
      createCoverageGate({
        projectId: "project-b",
        summary: { linePct: 82, branchPct: 82, toolchain: "istanbul" },
      }),
    );
    const [projectBResult] = await registryProjectB.fireByTag("coverage", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj-b",
    });
    expect(projectBResult?.verdict.passed).toBe(true);
  });
});

/**
 * Owner ruling R6 — the third check. The two above it ask a question about the
 * REPOSITORY; this one asks about the change set, and it is the only one a
 * worker verifying a two-file change can actually move.
 *
 * Every case here keeps the AGGREGATE comfortably passing (95/95), so a failure
 * can only come from the changed-line check. That is deliberate: without it a
 * "fails" assertion would be satisfied by either check and would not pin this one.
 */
describe("coverage gate — changed-line coverage (owner ruling R6)", () => {
  const PASSING_AGGREGATE = { linePct: 95, branchPct: 95 } as const;

  function lines(
    entries: Record<string, Record<number, number>>,
  ): Map<string, Map<number, number>> {
    return new Map(
      Object.entries(entries).map(([path, byLine]) => [
        path,
        new Map(Object.entries(byLine).map(([line, hits]) => [Number.parseInt(line, 10), hits])),
      ]),
    );
  }

  /** A real unified diff adding `count` lines to `path`, starting at line 1. */
  function diffAdding(path: string, count: number): string {
    return [
      `diff --git a/${path} b/${path}`,
      `--- /dev/null`,
      `+++ b/${path}`,
      `@@ -0,0 +1,${String(count)} @@`,
      ...Array.from({ length: count }, (_, i) => `+line ${String(i + 1)}`),
    ].join("\n");
  }

  async function fire(input: Parameters<typeof createCoverageGate>[0]) {
    const registry = createGateRegistry();
    registry.register("coverage", "coverage", createCoverageGate(input));
    const [result] = await registry.fireByTag("coverage", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj",
    });
    if (result === undefined) throw new Error("the gate did not fire");
    return result.verdict;
  }

  it("passes when the changed instrumentable lines are covered", async () => {
    const verdict = await fire({
      projectId: randomUUID(),
      summary: {
        ...PASSING_AGGREGATE,
        toolchain: "lcov",
        lines: lines({ "src/a.ts": { 1: 1, 2: 1, 3: 1, 4: 1 } }),
      },
      diffText: diffAdding("src/a.ts", 4),
    });
    expect(verdict.passed).toBe(true);
    expect(verdict.detail).toContain("changed-line coverage 100.00%");
  });

  /**
   * ⚠️ The case the whole ruling is for. The repository is at 95% and the change
   * set is not tested. Before R6 this published; the aggregate cannot see it,
   * because four uncovered lines do not move a repository-wide percentage.
   */
  it("FAILS a well-covered repository whose change set is not covered", async () => {
    const verdict = await fire({
      projectId: randomUUID(),
      summary: {
        ...PASSING_AGGREGATE,
        toolchain: "lcov",
        lines: lines({ "src/a.ts": { 1: 0, 2: 0, 3: 0, 4: 1 } }),
      },
      diffText: diffAdding("src/a.ts", 4),
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.exitStatus).toBe(1);
    expect(verdict.detail).toContain("changed-line coverage 25.00%");
    // Actionable: which file, which lines. A percentage alone tells an author
    // nothing about where to write the test.
    expect(verdict.detail).toContain("src/a.ts:1-3");
  });

  /**
   * ⚠️ The vacuity refusal. A brand-new file no test imports is ABSENT from a v8
   * report rather than present at 0%, so every one of its lines reads
   * "not instrumentable" and it would otherwise score a perfect 100% for having
   * no tests at all.
   */
  it("FAILS when a changed source file is absent from the coverage report entirely", async () => {
    const verdict = await fire({
      projectId: randomUUID(),
      summary: {
        ...PASSING_AGGREGATE,
        toolchain: "lcov",
        lines: lines({ "src/other.ts": { 1: 1 } }),
      },
      diffText: diffAdding("src/brand-new.ts", 3),
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.detail).toContain("do not appear in the coverage report at all");
    expect(verdict.detail).toContain("src/brand-new.ts");
  });

  /**
   * ⚠️ Otherwise a project exempts itself from this ruling by choosing a
   * reporter: istanbul's `coverage-summary.json` and coverage.py's `totals` are
   * aggregates with no line detail to recover.
   */
  it("FAILS when a diff was supplied but the report format carries no per-line data", async () => {
    const verdict = await fire({
      projectId: randomUUID(),
      summary: { ...PASSING_AGGREGATE, toolchain: "istanbul" },
      diffText: diffAdding("src/a.ts", 2),
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.detail).toContain("carries no per-line data");
    expect(verdict.detail).toContain("istanbul");
  });

  it("passes, and says so distinctly, when the changed lines are all comments or blanks", async () => {
    const verdict = await fire({
      projectId: randomUUID(),
      summary: {
        ...PASSING_AGGREGATE,
        toolchain: "lcov",
        // The file IS in the report; the changed lines are not instrumented.
        lines: lines({ "src/a.ts": { 40: 1 } }),
      },
      diffText: diffAdding("src/a.ts", 3),
    });
    expect(verdict.passed).toBe(true);
    expect(verdict.detail).toContain("no instrumentable lines changed");
  });

  /**
   * "Not asked" and "passed" must never share a rendering, or an `EvidenceRecord`
   * read back later would claim a check that never ran.
   */
  it("says the check was NOT EVALUATED when no diff is supplied, rather than reporting a pass", async () => {
    const verdict = await fire({
      projectId: randomUUID(),
      summary: { ...PASSING_AGGREGATE, toolchain: "istanbul" },
    });
    expect(verdict.passed).toBe(true);
    expect(verdict.detail).toContain("not evaluated (no diff supplied)");
  });

  /** The three checks are independent — a change set can be fully covered and still regress the repository. */
  it("still fails on the aggregate floor even when the changed lines are perfectly covered", async () => {
    const verdict = await fire({
      projectId: randomUUID(),
      summary: {
        linePct: 40,
        branchPct: 40,
        toolchain: "lcov",
        lines: lines({ "src/a.ts": { 1: 1, 2: 1 } }),
      },
      diffText: diffAdding("src/a.ts", 2),
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.detail).toContain("greenfield minimum never yet met");
  });

  /**
   * Range collapsing, on a shape that needs BOTH branches of the loop: two
   * separated runs of consecutive uncovered lines. A single run only exercises
   * the loop's tail, and a refusal that printed `1,2,3,4,9,10` instead of
   * `1-4,9-10` gets unreadable exactly when a change set is large.
   */
  it("collapses uncovered line numbers into ranges", async () => {
    const path = "src/a.ts";
    const verdict = await fire({
      projectId: randomUUID(),
      summary: {
        ...PASSING_AGGREGATE,
        toolchain: "lcov",
        lines: lines({
          [path]: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1, 6: 1, 7: 1, 8: 1, 9: 0, 10: 0 },
        }),
      },
      diffText: diffAdding(path, 10),
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.detail).toContain("src/a.ts:1-4,9-10");
  });

  it("bounds a refusal's size rather than emitting one entry per changed file", async () => {
    const manyFiles = Array.from({ length: 12 }, (_, i) => `src/f${String(i)}.ts`);
    const verdict = await fire({
      projectId: randomUUID(),
      summary: {
        ...PASSING_AGGREGATE,
        toolchain: "lcov",
        lines: lines(Object.fromEntries(manyFiles.map((path) => [path, { 1: 0, 2: 0 }]))),
      },
      diffText: manyFiles.map((path) => diffAdding(path, 2)).join("\n"),
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.detail).toContain("+7 more file(s)");
    expect(verdict.detail.length).toBeLessThan(600);
  });
});
