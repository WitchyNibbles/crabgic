import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestJournal, type TestJournal } from "../test-support/test-journal.js";
import { getCoverageRatchetFloor, recordCoverageObservation } from "./ratchet-store.js";

let tj: TestJournal;

const PROJECT_A = "project-a";
const PROJECT_B = "project-b";

beforeEach(async () => {
  tj = await createTestJournal();
});

afterEach(async () => {
  await tj.cleanup();
});

describe("coverage ratchet store", () => {
  it("has no floor before any observation is recorded", async () => {
    expect(await getCoverageRatchetFloor(tj.store, PROJECT_A)).toBeUndefined();
  });

  it("the first observation becomes the floor, unregressed", async () => {
    const result = await recordCoverageObservation(tj.store, PROJECT_A, {
      linePct: 82,
      branchPct: 82,
    });
    expect(result.floorBefore).toBeUndefined();
    expect(result.regressed).toBe(false);
    expect(result.floorAfter).toEqual({ linePct: 82, branchPct: 82 });
  });

  it("ratchet-regression fixture: a recorded floor of 82% followed by a new run of 79% blocks (regressed=true) and the floor does not drop", async () => {
    await recordCoverageObservation(tj.store, PROJECT_A, { linePct: 82, branchPct: 82 });
    const second = await recordCoverageObservation(tj.store, PROJECT_A, {
      linePct: 79,
      branchPct: 82,
    });
    expect(second.regressed).toBe(true);
    expect(second.floorAfter.linePct).toBe(82); // never drops below the prior floor
  });

  it("an improving observation ratchets the floor UP", async () => {
    await recordCoverageObservation(tj.store, PROJECT_A, { linePct: 82, branchPct: 82 });
    const second = await recordCoverageObservation(tj.store, PROJECT_A, {
      linePct: 90,
      branchPct: 85,
    });
    expect(second.regressed).toBe(false);
    expect(second.floorAfter).toEqual({ linePct: 90, branchPct: 85 });
  });

  it("regresses on branch coverage alone even when line coverage improves", async () => {
    await recordCoverageObservation(tj.store, PROJECT_A, { linePct: 82, branchPct: 82 });
    const second = await recordCoverageObservation(tj.store, PROJECT_A, {
      linePct: 95,
      branchPct: 70,
    });
    expect(second.regressed).toBe(true);
    // line floor still ratchets up even though branch regressed independently.
    expect(second.floorAfter).toEqual({ linePct: 95, branchPct: 82 });
  });

  it("MINOR-3 (adversarial-validation round): two projects sharing one journal must NOT contaminate each other's ratchet floor", async () => {
    // Project A establishes a high floor.
    await recordCoverageObservation(tj.store, PROJECT_A, { linePct: 90, branchPct: 90 });
    // Project B's FIRST-EVER observation, on the SAME shared journal, is
    // much lower — this must be treated as project B's own greenfield case
    // (floorBefore undefined), never as a "regression" against project A's
    // unrelated floor.
    const projectBFirst = await recordCoverageObservation(tj.store, PROJECT_B, {
      linePct: 40,
      branchPct: 40,
    });
    expect(projectBFirst.floorBefore).toBeUndefined();
    expect(projectBFirst.regressed).toBe(false);

    // Project A's own floor is completely unaffected by project B's history.
    expect(await getCoverageRatchetFloor(tj.store, PROJECT_A)).toEqual({
      linePct: 90,
      branchPct: 90,
    });
    expect(await getCoverageRatchetFloor(tj.store, PROJECT_B)).toEqual({
      linePct: 40,
      branchPct: 40,
    });
  });

  it("ignores malformed adjudication_decision entries sharing the ratchet decision string", async () => {
    await tj.store.appendEntry({
      type: "adjudication_decision",
      payload: { decision: "coverage_ratchet_observation", rationale: "not json" },
    });
    expect(await getCoverageRatchetFloor(tj.store, PROJECT_A)).toBeUndefined();
    const result = await recordCoverageObservation(tj.store, PROJECT_A, {
      linePct: 80,
      branchPct: 80,
    });
    expect(result.floorBefore).toBeUndefined();
  });

  it("ignores an observation recorded for a DIFFERENT projectId (not merely malformed content)", async () => {
    await recordCoverageObservation(tj.store, PROJECT_A, { linePct: 82, branchPct: 82 });
    expect(await getCoverageRatchetFloor(tj.store, PROJECT_B)).toBeUndefined();
  });
});
