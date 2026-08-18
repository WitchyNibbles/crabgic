import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGateRegistry } from "./registry.js";
import type { GateContext } from "./types.js";
import type { CoverageSummary } from "./coverage/types.js";
import { COVERAGE_GATE_NAME, registerCoverageGate } from "./coverage-gate-registration.js";
import { createTestJournal, type TestJournal } from "./test-support/test-journal.js";

/**
 * ⚠️ THE COVERAGE GATE'S REGISTRATION, and why `createCoverageGate` could not be
 * it — the same shape mismatch `createTddGate` had.
 *
 * `createCoverageGate` takes `projectId`, `summary` and `diffText` as
 * CONSTRUCTOR arguments. All three are per-attempt: the summary is the report
 * this candidate's own test run produced, and the diff is this change set's.
 * `packages/cli/src/daemon/compose-gate-registry.ts` builds ONE registry at
 * startup, before any of them exist, which is why that factory has never had a
 * production call site.
 *
 * This registrar runs the same checks with the same thresholds, resolving its
 * inputs from the `GateContext` when it fires.
 */

const CHANGE_SET_ID = "9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const WORK_UNIT_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const OBJECT_ID = "0123456789abcdef0123456789abcdef01234567";

let tj: TestJournal;

beforeEach(async () => {
  tj = await createTestJournal();
});

afterEach(async () => {
  await tj.cleanup();
});

function contextFor(): GateContext {
  return {
    stage: "verifying",
    changeSetId: CHANGE_SET_ID,
    objectId: OBJECT_ID,
    workUnitId: WORK_UNIT_ID,
    journal: tj.store,
    now: () => new Date("2026-08-18T18:00:00.000Z"),
  };
}

/** A summary well above every floor, with per-line data for one changed file. */
function healthySummary(hits: number): CoverageSummary {
  return {
    linePct: 95,
    branchPct: 95,
    toolchain: "lcov",
    lines: new Map([["src/a.ts", new Map([[3, hits]])]]),
  };
}

/** A diff touching exactly `src/a.ts` line 3 — the line `healthySummary` reports on. */
const DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,3 @@",
  " const x = 1;",
  " const y = 2;",
  "+export const z = x + y;",
  "",
].join("\n");

async function fireWith(
  load: () => Promise<{ summary: CoverageSummary; diffText?: string } | undefined>,
) {
  const registry = createGateRegistry();
  registerCoverageGate(registry, { projectId: () => "fixture-project", loadCoverage: load });
  const results = await registry.fireByTag("coverage", contextFor(), { requireAtLeastOne: true });
  return results[0];
}

describe("registerCoverageGate — resolved at firing time, scored per work unit", () => {
  it("registers under `coverage`, marked per-work-unit so fireAll skips it", () => {
    const registry = createGateRegistry();
    registerCoverageGate(registry, {
      projectId: () => "p",
      loadCoverage: () => Promise.resolve(undefined),
    });

    expect(registry.list("coverage").map((gate) => gate.name)).toStrictEqual([COVERAGE_GATE_NAME]);
    expect(registry.list("coverage")[0]?.perWorkUnit).toBe(true);
  });

  /**
   * ⚠️ THE ARM THAT DECIDES WHAT THIS GATE IS FOR. A candidate whose test command
   * produced no coverage report has not been measured, and an unmeasured
   * candidate must not publish. Passing here would make the whole gate optional
   * in practice: any project could exempt itself by not configuring a reporter,
   * which is precisely the "choose a reporter and skip the ruling" escape
   * `coverage-gate.ts` already refuses for aggregate-only formats.
   */
  it("REFUSES when no coverage could be measured at all", async () => {
    const result = await fireWith(() => Promise.resolve(undefined));

    expect(result?.verdict.passed).toBe(false);
    expect(result?.verdict.detail).toMatch(/no coverage report/i);
    expect(result?.evidence.gateVerdict).toBe("failed");
  });

  it("PASSES when the report is healthy and every changed line is covered", async () => {
    const result = await fireWith(() =>
      Promise.resolve({ summary: healthySummary(4), diffText: DIFF }),
    );

    expect(result?.verdict.passed).toBe(true);
    expect(result?.evidence.gateVerdict).toBe("passed");
  });

  /**
   * The changed-line half is genuinely load-bearing. Same aggregate percentages,
   * same diff — only the hit count on the changed line differs. Without this arm
   * the gate would be satisfied by repository-wide numbers, which is exactly what
   * owner ruling R6 exists to stop.
   */
  it("FAILS when the changed line itself is uncovered, despite healthy aggregates", async () => {
    const result = await fireWith(() =>
      Promise.resolve({ summary: healthySummary(0), diffText: DIFF }),
    );

    expect(result?.verdict.passed).toBe(false);
    expect(result?.verdict.detail).toMatch(/changed-line coverage/i);
  });

  /**
   * Resolved WHEN IT FIRES, not when it is registered. Asserted by returning a
   * different measurement on each call: a registrar that captured its input
   * would score the first one twice, which is the window a stale report lives
   * in.
   */
  it("re-resolves the measurement on every firing", async () => {
    const measurements = [
      { summary: healthySummary(4), diffText: DIFF },
      { summary: healthySummary(0), diffText: DIFF },
    ];
    let call = 0;
    const registry = createGateRegistry();
    registerCoverageGate(registry, {
      projectId: () => "fixture-project",
      loadCoverage: () => Promise.resolve(measurements[call++]),
    });

    const first = await registry.fireByTag("coverage", contextFor(), { requireAtLeastOne: true });
    const second = await registry.fireByTag("coverage", contextFor(), { requireAtLeastOne: true });

    expect(first[0]?.verdict.passed).toBe(true);
    expect(second[0]?.verdict.passed, "the second firing reused the first measurement").toBe(false);
  });
});
