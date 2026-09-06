import { describe, expect, it } from "vitest";
import { createUnitBaseRegistry } from "./unit-base-registry.js";

const CHANGE_SET = "22222222-2222-4222-8222-222222222222";
const RUN = "33333333-3333-4333-8333-333333333333";
const OTHER_RUN = "55555555-5555-4555-8555-555555555555";
const UNIT_A = "44444444-4444-4444-8444-444444444444";
const UNIT_B = "66666666-6666-4666-8666-666666666666";
const FREEZE = "a".repeat(40);
const CHAINED = "b".repeat(40);
const CONTROL = "/var/state/control";

describe("createUnitBaseRegistry", () => {
  it("answers nothing for a change set this daemon does not hold", () => {
    expect(createUnitBaseRegistry().resolve(CHANGE_SET, UNIT_A)).toBeUndefined();
  });

  it("answers the run's frozen base for a unit with no chained base", () => {
    const registry = createUnitBaseRegistry();
    registry.openRun(CHANGE_SET, { runId: RUN, baseObjectId: FREEZE, controlDir: CONTROL });
    expect(registry.resolve(CHANGE_SET, UNIT_A)).toEqual({
      baseObjectId: FREEZE,
      controlDir: CONTROL,
    });
  });

  /**
   * ⚠️ THE WHOLE POINT OF THE MODULE — owner ruling 2026-09-06, "chain the
   * base". Answering the freeze here is what the gates would be told if the
   * per-unit lookup were dropped: `git diff <freeze> <candidate>` for a chained
   * unit carries its PREDECESSORS' lines, and the changed-line coverage check
   * would score this unit against work it did not do.
   */
  it("answers a chained unit's OWN base, not the run's freeze", () => {
    const registry = createUnitBaseRegistry();
    registry.openRun(CHANGE_SET, { runId: RUN, baseObjectId: FREEZE, controlDir: CONTROL });
    registry.chainedBasesFor(RUN).set(UNIT_B, CHAINED);

    expect(registry.resolve(CHANGE_SET, UNIT_B)).toEqual({
      baseObjectId: CHAINED,
      controlDir: CONTROL,
    });
    // ...and its sibling, which chained nothing, still gets the freeze.
    expect(registry.resolve(CHANGE_SET, UNIT_A)?.baseObjectId).toBe(FREEZE);
  });

  it("hands back the SAME map on a re-drive, so a resolved base is never folded twice", () => {
    const registry = createUnitBaseRegistry();
    registry.chainedBasesFor(RUN).set(UNIT_B, CHAINED);
    expect(registry.chainedBasesFor(RUN).get(UNIT_B)).toBe(CHAINED);
  });

  /**
   * ⚠️ WORK-UNIT IDS ARE STABLE ACROSS RUNS of the same change set — a retry is
   * a fresh run over the same registry-stored units. Keying the chained bases
   * by change set would answer the NEW run's gate firing with the CANCELLED
   * run's commit; the control clone is per project, so that object still
   * resolves and the diff is silently wrong rather than absent.
   */
  it("does not leak an earlier run's chained base into the run that replaces it", () => {
    const registry = createUnitBaseRegistry();
    registry.openRun(CHANGE_SET, { runId: RUN, baseObjectId: FREEZE, controlDir: CONTROL });
    registry.chainedBasesFor(RUN).set(UNIT_B, CHAINED);

    registry.openRun(CHANGE_SET, { runId: OTHER_RUN, baseObjectId: FREEZE, controlDir: CONTROL });
    expect(registry.resolve(CHANGE_SET, UNIT_B)?.baseObjectId).toBe(FREEZE);
  });

  it("forgets a closed run's chained bases and falls back to the freeze", () => {
    const registry = createUnitBaseRegistry();
    registry.openRun(CHANGE_SET, { runId: RUN, baseObjectId: FREEZE, controlDir: CONTROL });
    registry.chainedBasesFor(RUN).set(UNIT_B, CHAINED);

    registry.closeRun(RUN);
    expect(registry.resolve(CHANGE_SET, UNIT_B)?.baseObjectId).toBe(FREEZE);
  });
});
