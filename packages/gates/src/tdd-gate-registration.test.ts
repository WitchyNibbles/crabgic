import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGateRegistry } from "./registry.js";
import type { GateContext } from "./types.js";
import type { ChangedTestsBaselineOutcome } from "./red-baseline-from-tests.js";
import { registerTddGate, TDD_GATE_NAME } from "./tdd-gate-registration.js";
import { createTestJournal, type TestJournal } from "./test-support/test-journal.js";

/**
 * ⚠️ THE TDD GATE, AFTER OWNER RULING 2026-08-18 — and the two things that
 * changed about what it asks.
 *
 * `createTddGate` could never be the registration: `requirementId`, `beforeSeq`,
 * `exitStatus` and `testCommand` are all per-attempt, and the daemon builds ONE
 * registry at startup before any of them exist. That is why it had zero
 * production call sites.
 *
 * What the gate ASKS changed too. It used to ask "was the suite red at base",
 * which a healthy repository answers no to — so the gate refused every real run,
 * satisfiable only when the repository was already broken. It now asks the
 * question that discriminates: do the tests THIS change set added fail against
 * the code that preceded it?
 *
 * ⚠️ AND BOTH HALVES ARE NOW ONE FIRING. The old shape had a producer running
 * before dispatch and a consumer re-reading the journal afterwards, which forced
 * an ordering cut to tell a genuine baseline from the gate's own earlier
 * verdict. A diff-derived baseline cannot satisfy that cut, so the halves were
 * collapsed and the ordering question disappeared rather than being answered.
 */

const CHANGE_SET_ID = "9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const WORK_UNIT_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const REQ_A = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";
const OBJECT_ID = "0123456789abcdef0123456789abcdef01234567";

let tj: TestJournal;

beforeEach(async () => {
  tj = await createTestJournal();
});

afterEach(async () => {
  await tj.cleanup();
});

function contextFor(workUnitId: string | undefined): GateContext {
  return {
    stage: "verifying",
    changeSetId: CHANGE_SET_ID,
    objectId: OBJECT_ID,
    ...(workUnitId !== undefined ? { workUnitId } : {}),
    journal: tj.store,
    now: () => new Date("2026-08-18T20:00:00.000Z"),
  };
}

const RED_ESTABLISHED: ChangedTestsBaselineOutcome = {
  kind: "captured",
  command: "npm run test -- src/a.test.ts",
  exitStatus: 1,
  records: [],
};

interface FireOptions {
  readonly red: ChangedTestsBaselineOutcome;
  readonly candidateExitStatus?: number;
  readonly workUnitId?: string | undefined;
  readonly requirementIds?: readonly string[];
}

async function fireOnce(options: FireOptions) {
  const registry = createGateRegistry();
  registerTddGate(registry, {
    requirementIds: () => options.requirementIds ?? [REQ_A],
    measureRedAtBase: () => Promise.resolve(options.red),
    runCandidate: () =>
      Promise.resolve({
        command: "npm run test",
        exitStatus: options.candidateExitStatus ?? 0,
        toolchainFingerprint: "node@24",
      }),
  });
  const results = await registry.fireByTag(
    "tdd",
    contextFor("workUnitId" in options ? options.workUnitId : WORK_UNIT_ID),
    { requireAtLeastOne: true },
  );
  return results[0];
}

describe("registerTddGate — red is measured, not read back", () => {
  it("registers under `tdd`, marked per-work-unit so fireAll skips it", () => {
    const registry = createGateRegistry();
    registerTddGate(registry, {
      requirementIds: () => [REQ_A],
      measureRedAtBase: () => Promise.resolve(RED_ESTABLISHED),
      runCandidate: () => Promise.resolve({ command: "c", exitStatus: 0 }),
    });

    expect(registry.list("tdd").map((gate) => gate.name)).toStrictEqual([TDD_GATE_NAME]);
    expect(registry.list("tdd")[0]?.perWorkUnit).toBe(true);
  });

  /** The only shape that mints a real verdict: red against base, green against the candidate. */
  it("PASSES when the added tests fail at base and pass on the candidate", async () => {
    const result = await fireOnce({ red: RED_ESTABLISHED, candidateExitStatus: 0 });

    expect(result?.verdict.passed).toBe(true);
    expect(result?.evidence.gateVerdict).toBe("passed");
  });

  /**
   * The green half is genuinely required. Without this arm the gate would be
   * satisfied by the red measurement alone, which asserts only that a test once
   * failed — never that the work made it pass.
   */
  it("FAILS when red is established but the candidate is still failing", async () => {
    const result = await fireOnce({ red: RED_ESTABLISHED, candidateExitStatus: 1 });

    expect(result?.verdict.passed).toBe(false);
    expect(result?.evidence.gateVerdict).toBe("failed");
  });

  /**
   * ⚠️ THE DISCRIMINATION ARM. Tests that already pass against the base code
   * prove nothing this change set introduced — they would have passed before it
   * existed. Unproven, and deliberately NOT a block: a refactor that legitimately
   * adds no discriminating test is not a defect.
   */
  it("is UNPROVEN when the added tests already pass against base", async () => {
    const result = await fireOnce({
      red: { kind: "notRed", command: "npm run test -- a", exitStatus: 0 },
    });

    expect(result?.evidence.gateVerdict).toBeUndefined();
    expect(result?.verdict.passed, "an undiscriminating test set blocked the run").toBe(true);
    expect(result?.verdict.detail).toMatch(/discriminate/i);
  });

  it("is UNPROVEN when the change set added no test file", async () => {
    const result = await fireOnce({ red: { kind: "noTestFiles" } });

    expect(result?.evidence.gateVerdict).toBeUndefined();
    expect(result?.verdict.detail).toMatch(/no test file/i);
  });

  /**
   * ⚠️ Each unestablished reason says its OWN thing. They have different repairs
   * — grant a command, write a discriminating test, declare a requirement — and
   * collapsing them to "no baseline" would tell an operator nothing actionable.
   */
  it("names the reason the red half could not be established", async () => {
    const noGrant = await fireOnce({ red: { kind: "noAcceptanceCommand" } });
    const brokenRun = await fireOnce({
      red: { kind: "didNotRun", command: "npm run test", reason: "could not start: ENOENT" },
    });

    expect(noGrant?.verdict.detail).toMatch(/envelope grants no/i);
    expect(brokenRun?.verdict.detail).toMatch(/ENOENT/);
    expect(noGrant?.verdict.detail).not.toBe(brokenRun?.verdict.detail);
  });

  /**
   * Fail closed with no work unit. This gate is per-work-unit by construction, so
   * a `final_verifying` firing — where `workUnitId` is absent by design — has
   * nothing to judge.
   */
  it("is UNPROVEN when the context carries no work unit", async () => {
    const result = await fireOnce({ red: RED_ESTABLISHED, workUnitId: undefined });

    expect(result?.evidence.gateVerdict).toBeUndefined();
    expect(result?.verdict.detail).toMatch(/per-work-unit/i);
  });

  /** A unit declaring no requirement has no bar for a baseline to be red against. */
  it("is UNPROVEN when the unit declares no requirements", async () => {
    const result = await fireOnce({ red: RED_ESTABLISHED, requirementIds: [] });

    expect(result?.evidence.gateVerdict).toBeUndefined();
    expect(result?.verdict.detail).toMatch(/requirement/i);
  });

  /**
   * ⚠️ The candidate is not run until red is established. Measuring green for a
   * change set whose tests never discriminated is pure cost for a number nobody
   * may act on — and on a real project that is a full suite run per attempt.
   */
  it("does NOT run the candidate when the red half was not established", async () => {
    let candidateRan = false;
    const registry = createGateRegistry();
    registerTddGate(registry, {
      requirementIds: () => [REQ_A],
      measureRedAtBase: () => Promise.resolve({ kind: "noTestFiles" }),
      runCandidate: () => {
        candidateRan = true;
        return Promise.resolve({ command: "npm run test", exitStatus: 0 });
      },
    });

    await registry.fireByTag("tdd", contextFor(WORK_UNIT_ID), { requireAtLeastOne: true });

    expect(candidateRan, "the candidate suite ran for a gate that had nothing to prove").toBe(
      false,
    );
  });
});
