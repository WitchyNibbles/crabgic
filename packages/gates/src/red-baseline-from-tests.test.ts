import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureRedBaselineForChangedTests } from "./red-baseline-from-tests.js";
import { hasRedBaseline } from "./tdd-gate.js";
import { createTestJournal, type TestJournal } from "./test-support/test-journal.js";

/**
 * ⚠️ RED-BEFORE-GREEN, AS THE CHECK THAT ACTUALLY MEANS SOMETHING — owner ruling
 * 2026-08-18.
 *
 * The first shipped version asked "was the suite red at base". A healthy
 * repository is green at base, so it captured nothing and the gate refused every
 * run. This asks the question the prior art enforces instead: run THE TESTS THIS
 * CHANGE SET ADDED against the code as it stood BEFORE the change, and require
 * them to fail.
 *
 * That is a real discrimination check. A test that passes against the old code
 * tests nothing the change set introduced — it is the "assert true" of a
 * test-first claim, and this is where it gets caught.
 *
 * NO INJECTED RUNNER. Every arm executes the real command in a real directory
 * through the real child-process path, for the same reason the producer's own
 * suite does: a seam here would let all of it pass against a module that spawns
 * nothing.
 */

const CHANGE_SET_ID = "9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const WORK_UNIT_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const REQ_A = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";
const BASE_OBJECT_ID = "fedcba9876543210fedcba9876543210fedcba98";

let tj: TestJournal;
let dir: string | undefined;

beforeEach(async () => {
  tj = await createTestJournal();
});

afterEach(async () => {
  await tj.cleanup();
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

/**
 * A base tree whose declared test command fails for exactly the named paths and
 * succeeds otherwise — the shape "the new tests fail against the old code" has
 * when the old code lacks the feature.
 */
async function baseTreeWhereTestsFail(failing: boolean): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "crabgic-red-from-tests-"));
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: "fixture",
      private: true,
      // `"$@"` so the paths the capture appends are what decides the exit.
      scripts: { test: failing ? "exit 1" : "exit 0" },
    }),
    "utf8",
  );
  return dir;
}

function baseInput(worktreePath: string) {
  return {
    journal: tj.store,
    changeSetId: CHANGE_SET_ID,
    workUnitId: WORK_UNIT_ID,
    requirementIds: [REQ_A],
    baseObjectId: BASE_OBJECT_ID,
    worktreePath,
    grantedCommands: ["npm run test"],
    testPaths: ["src/feature.test.ts"],
    now: () => new Date("2026-08-18T20:00:00.000Z"),
  };
}

describe("captureRedBaselineForChangedTests", () => {
  /** The pass path: the added tests fail against base, so the baseline is real. */
  it("captures a baseline when the new tests FAIL against base code", async () => {
    const worktree = await baseTreeWhereTestsFail(true);

    const outcome = await captureRedBaselineForChangedTests(baseInput(worktree));

    expect(outcome.kind).toBe("captured");
    expect(await hasRedBaseline(tj.store, REQ_A)).toBe(true);
  }, 60_000);

  /**
   * ⚠️ THE DISCRIMINATION ARM, and the whole reason this check replaced the
   * old one. A new test that PASSES against the old code proves nothing was
   * introduced — it would have passed before the change set existed. No
   * baseline, and the gate stays unproven.
   */
  it("captures NOTHING when the new tests already pass against base code", async () => {
    const worktree = await baseTreeWhereTestsFail(false);

    const outcome = await captureRedBaselineForChangedTests(baseInput(worktree));

    expect(outcome.kind).toBe("notRed");
    expect(await hasRedBaseline(tj.store, REQ_A)).toBe(false);
  }, 60_000);

  /**
   * ⚠️ NO TEST FILES IS NOT RED. A change set that added no test at all has
   * nothing to prove red, and running the whole suite instead would resurrect
   * exactly the bug this replaced. Reported as its own outcome so the gate can
   * say "no tests were added" rather than "the check failed".
   */
  it("reports noTestFiles when the change set added no test", async () => {
    const worktree = await baseTreeWhereTestsFail(true);

    const outcome = await captureRedBaselineForChangedTests({
      ...baseInput(worktree),
      testPaths: [],
    });

    expect(outcome.kind).toBe("noTestFiles");
    expect(await hasRedBaseline(tj.store, REQ_A)).toBe(false);
  }, 60_000);

  /** The envelope still decides what may run — no grant, no command, no baseline. */
  it("REFUSES when the envelope grants no acceptance command", async () => {
    const worktree = await baseTreeWhereTestsFail(true);

    const outcome = await captureRedBaselineForChangedTests({
      ...baseInput(worktree),
      grantedCommands: ["git status"],
    });

    expect(outcome.kind).toBe("noAcceptanceCommand");
    expect(await hasRedBaseline(tj.store, REQ_A)).toBe(false);
  }, 60_000);

  /** A command that could not start is not a failing test — the producer's own distinction, kept. */
  it("does NOT mint a baseline when the command could not start", async () => {
    const worktree = await baseTreeWhereTestsFail(true);

    const outcome = await captureRedBaselineForChangedTests({
      ...baseInput(worktree),
      worktreePath: join(worktree, "does-not-exist"),
    });

    expect(outcome.kind).toBe("didNotRun");
    expect(await hasRedBaseline(tj.store, REQ_A)).toBe(false);
  }, 60_000);

  /** One baseline per declared requirement, because the gate is requirement-scoped. */
  it("captures one baseline per declared requirement", async () => {
    const worktree = await baseTreeWhereTestsFail(true);
    const other = "4d5e6f7a-8b9c-4d0e-8f1a-2b3c4d5e6f7a";

    await captureRedBaselineForChangedTests({
      ...baseInput(worktree),
      requirementIds: [REQ_A, other],
    });

    expect(await hasRedBaseline(tj.store, REQ_A)).toBe(true);
    expect(await hasRedBaseline(tj.store, other)).toBe(true);
  }, 60_000);
});

/**
 * ⚠️ A GATE FIRING IS NOT A BASELINE, and telling them apart structurally is
 * what lets the dispatch-boundary cut be relaxed.
 *
 * The boundary existed because a red baseline and the TDD gate's own failing
 * verdict were INDISTINGUISHABLE in the journal: both carry `gateTag: "tdd"` and
 * a non-zero exit. Requiring the baseline to precede the attempt's dispatch was
 * the only thing separating them.
 *
 * The new protocol cannot keep that cut. A baseline derived from the change
 * set's diff does not exist until the worker has finished, so it is journaled
 * AFTER dispatch by construction. Something else has to do the separating.
 *
 * MEASURED, and it is why this is written down: owner ruling 2026-08-18's
 * `inconclusive` state made the collision WORSE. An inconclusive firing carries
 * `gateTag: "tdd"`, `exitStatus: 1` and — because the record deliberately omits
 * a verdict — nothing at all to distinguish it from a genuine baseline. Under
 * the old cut the boundary still hid it; relaxing the boundary without this
 * would have let the gate manufacture its own precondition.
 *
 * The discriminator is STRUCTURAL: `captureRedBaseline` records against the
 * FROZEN BASE object id, while every gate firing records against the CANDIDATE's
 * object id (`emitEvidence` takes it from the `GateContext`). A gate cannot mint
 * a record against the base without running against the base, which is the
 * thing being attested.
 */
describe("hasRedBaseline — scoped to the base object id", () => {
  it("does NOT accept a record written against the candidate object id", async () => {
    const worktree = await baseTreeWhereTestsFail(true);
    await captureRedBaselineForChangedTests(baseInput(worktree));

    // The genuine baseline, scoped to the base it was measured against.
    expect(await hasRedBaseline(tj.store, REQ_A, { baseObjectId: BASE_OBJECT_ID })).toBe(true);
    // The same records, asked for against a DIFFERENT object id, answer no.
    expect(
      await hasRedBaseline(tj.store, REQ_A, { baseObjectId: "0".repeat(40) }),
      "a baseline measured against one base satisfied a different one",
    ).toBe(false);
  }, 60_000);
});
