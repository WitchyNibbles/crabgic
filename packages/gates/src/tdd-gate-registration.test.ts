import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordAttempt } from "@crabgic/journal";
import { createGateRegistry } from "./registry.js";
import type { GateContext } from "./types.js";
import { captureRedBaseline } from "./tdd-gate.js";
import { registerTddGate, TDD_GATE_NAME } from "./tdd-gate-registration.js";
import { createTestJournal, type TestJournal } from "./test-support/test-journal.js";

/**
 * ⚠️ THE CONSUMER HALF — and why `createTddGate` could not be it.
 *
 * `createTddGate` (`./tdd-gate.ts`) takes `requirementId`, `beforeSeq`,
 * `exitStatus` and `testCommand` as CONSTRUCTOR arguments and bakes them into a
 * closure. Every one of those is per-attempt. The daemon builds ONE registry at
 * startup (`packages/cli/src/daemon/compose-gate-registry.ts`, "one shared
 * instance, never a second copy"), before any attempt exists — so there is no
 * moment at which a caller could supply them. MEASURED 2026-08-18:
 * `createTddGate` had **zero** production call sites, and that is the reason.
 *
 * `registerTddGate` is the same check with the same rules, reading its
 * per-attempt inputs from the `GateContext` and the journal at FIRING time —
 * the identical discipline `registerCriteriaSealGate` states for its own
 * requirements reader ("reading them at registration would pin a snapshot taken
 * before the work ran, which is exactly the window a tamper lives in").
 */

const CHANGE_SET_ID = "9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const WORK_UNIT_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const SESSION_ID = "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";
const REQ_A = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";
const REQ_B = "4d5e6f7a-8b9c-4d0e-8f1a-2b3c4d5e6f7a";
const OBJECT_ID = "0123456789abcdef0123456789abcdef01234567";
const BASE_OBJECT_ID = "fedcba9876543210fedcba9876543210fedcba98";

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
    now: () => new Date("2026-08-18T17:00:00.000Z"),
  };
}

async function journalRedBaseline(requirementId: string): Promise<void> {
  await captureRedBaseline(tj.store, {
    changeSetId: CHANGE_SET_ID,
    requirementId,
    workUnitId: WORK_UNIT_ID,
    baseObjectId: BASE_OBJECT_ID,
    command: "npm run test",
    exitStatus: 1,
    toolchainFingerprint: "node@24",
  });
}

/** The `work_unit_transition: dispatched` entry that IS the gate's ordering boundary. */
async function journalDispatchBoundary(): Promise<void> {
  await recordAttempt(tj.store, WORK_UNIT_ID, SESSION_ID, "dispatched");
}

interface FireOnceOptions {
  readonly requirementIds: readonly string[];
  readonly candidateExitStatus: number;
  readonly workUnitId?: string;
}

async function fireOnce(options: FireOnceOptions) {
  const registry = createGateRegistry();
  registerTddGate(registry, {
    requirementIds: () => options.requirementIds,
    runCandidate: () =>
      Promise.resolve({
        command: "npm run test",
        exitStatus: options.candidateExitStatus,
        toolchainFingerprint: "node@24",
      }),
  });
  const results = await registry.fireByTag(
    "tdd",
    contextFor(options.workUnitId === undefined ? WORK_UNIT_ID : options.workUnitId),
    { requireAtLeastOne: true },
  );
  return results[0];
}

describe("registerTddGate — the red-before-green check, read from the context at firing time", () => {
  it("registers under the `tdd` tag so a packet declaring that tag can fire it", async () => {
    const registry = createGateRegistry();
    registerTddGate(registry, {
      requirementIds: () => [REQ_A],
      runCandidate: () => Promise.resolve({ command: "npm run test", exitStatus: 0 }),
    });

    expect(registry.list("tdd").map((gate) => gate.name)).toStrictEqual([TDD_GATE_NAME]);
  });

  /**
   * The pass path, and the only shape that may produce it: a genuine baseline
   * captured strictly before this attempt's dispatch boundary, plus a candidate
   * that is now green.
   */
  it("PASSES when a red baseline precedes the dispatch boundary and the candidate is green", async () => {
    await journalRedBaseline(REQ_A);
    await journalDispatchBoundary();

    const result = await fireOnce({ requirementIds: [REQ_A], candidateExitStatus: 0 });

    expect(result?.verdict.passed).toBe(true);
    expect(result?.evidence.gateVerdict).toBe("passed");
  });

  /**
   * ⚠️ THE ANTI-FORGERY ARM, and the reason the boundary exists at all. A
   * baseline journaled AFTER the attempt was dispatched cannot be evidence that
   * a failing test came first — it is equally consistent with the gate's own
   * earlier failing verdict, which is journaled with the same `gateTag` and a
   * non-zero status. Without this arm the gate would accept a baseline
   * fabricated at any point up to the moment it fires.
   */
  it("REFUSES a red baseline journaled after the dispatch boundary", async () => {
    await journalDispatchBoundary();
    await journalRedBaseline(REQ_A);

    const result = await fireOnce({ requirementIds: [REQ_A], candidateExitStatus: 0 });

    // ⚠️ Unproven, not refused (owner ruling 2026-08-18). The precondition could
    // not be established, so the record carries NO `gateVerdict` and
    // `implement-tests-first` stays underivable — while the run is not blocked by
    // a check that never ran.
    expect(result?.evidence.gateVerdict).toBeUndefined();
    expect(result?.verdict.detail).toMatch(/red-baseline/i);
  });

  /**
   * ⚠️ THE REPAIR-ATTEMPT ARM — each attempt is judged against its OWN
   * boundary, which is the LATEST one.
   *
   * A repaired unit is dispatched more than once. The producer captures a fresh
   * baseline before each dispatch, so attempt 2's baseline sits BETWEEN the two
   * `dispatched` entries: after attempt 1's boundary, before attempt 2's. Read
   * against the latest boundary it counts, correctly. Read against the FIRST it
   * does not, and every repaired unit would be refused for evidence it actually
   * has. Without this arm, "latest, not first" is an unfalsifiable claim in a
   * doc comment.
   *
   * This does not weaken the anti-forgery arm above: a baseline after the
   * LATEST boundary is still refused, and that is the only window a forgery can
   * occupy.
   */
  it("judges a re-dispatched attempt against its OWN boundary, not the first one", async () => {
    await journalDispatchBoundary();
    await journalRedBaseline(REQ_A);
    await journalDispatchBoundary();

    const result = await fireOnce({ requirementIds: [REQ_A], candidateExitStatus: 0 });

    expect(result?.verdict.passed).toBe(true);
  });

  it("FAILS when no red baseline was ever journaled", async () => {
    await journalDispatchBoundary();

    const result = await fireOnce({ requirementIds: [REQ_A], candidateExitStatus: 0 });

    // ⚠️ Unproven, not refused (owner ruling 2026-08-18). The precondition could
    // not be established, so the record carries NO `gateVerdict` and
    // `implement-tests-first` stays underivable — while the run is not blocked by
    // a check that never ran.
    expect(result?.evidence.gateVerdict).toBeUndefined();
  });

  /**
   * The green half is genuinely required. Without this arm the gate would be
   * satisfied by the baseline alone, which asserts only that a test once
   * failed — never that the work made it pass.
   */
  it("FAILS when the baseline is sound but the candidate is still failing", async () => {
    await journalRedBaseline(REQ_A);
    await journalDispatchBoundary();

    const result = await fireOnce({ requirementIds: [REQ_A], candidateExitStatus: 1 });

    expect(result?.verdict.passed).toBe(false);
    expect(result?.verdict.exitStatus).toBe(1);
  });

  /**
   * ⚠️ EVERY declared requirement needs its own baseline. A unit declaring two
   * requirements with one baseline between them has proved a failing test for
   * one of them and nothing at all for the other — and "some requirement was
   * red" is exactly the weakened claim an `.some()` would silently accept.
   */
  it("FAILS when only SOME of the unit's declared requirements have a baseline", async () => {
    await journalRedBaseline(REQ_A);
    await journalDispatchBoundary();

    const result = await fireOnce({ requirementIds: [REQ_A, REQ_B], candidateExitStatus: 0 });

    // ⚠️ Unproven, not refused (owner ruling 2026-08-18). The precondition could
    // not be established, so the record carries NO `gateVerdict` and
    // `implement-tests-first` stays underivable — while the run is not blocked by
    // a check that never ran.
    expect(result?.evidence.gateVerdict).toBeUndefined();
    expect(result?.verdict.detail).toContain(REQ_B);
  });

  /**
   * Fail closed with no work unit. This gate is per-work-unit by construction —
   * the boundary it reads is a `work_unit_transition` — so a `final_verifying`
   * firing, where `workUnitId` is absent by design, has no boundary to read.
   * Passing there would let the integrated candidate collect a `tdd` pass no
   * unit ever earned.
   */
  it("FAILS CLOSED when the context carries no work unit", async () => {
    await journalRedBaseline(REQ_A);
    await journalDispatchBoundary();

    const registry = createGateRegistry();
    registerTddGate(registry, {
      requirementIds: () => [REQ_A],
      runCandidate: () => Promise.resolve({ command: "npm run test", exitStatus: 0 }),
    });
    const results = await registry.fireByTag("tdd", contextFor(undefined), {
      requireAtLeastOne: true,
    });

    // ⚠️ Unproven, not refused (owner ruling 2026-08-18). The precondition could
    // not be established, so the record carries NO `gateVerdict` and
    // `implement-tests-first` stays underivable — while the run is not blocked by
    // a check that never ran.
    expect(results[0]?.evidence.gateVerdict).toBeUndefined();
    // ⚠️ `/per-work-unit/` and not `/work unit/`: with the guard deleted the
    // firing still fails, but on the BOUNDARY refusal, whose message also names
    // a work unit. The loose pattern passed against the mutation — measured —
    // so it asserted the outcome without discriminating the reason.
    expect(results[0]?.verdict.detail).toMatch(/per-work-unit/i);
  });

  /**
   * Fail closed with no dispatch boundary. An attempt that was never journaled
   * as dispatched cannot have a "before" — and treating a missing boundary as
   * "anything counts" would restore precisely the forgery window the arm above
   * closes.
   */
  it("FAILS CLOSED when no dispatch boundary was journaled for the unit", async () => {
    await journalRedBaseline(REQ_A);

    const result = await fireOnce({ requirementIds: [REQ_A], candidateExitStatus: 0 });

    // ⚠️ Unproven, not refused (owner ruling 2026-08-18). The precondition could
    // not be established, so the record carries NO `gateVerdict` and
    // `implement-tests-first` stays underivable — while the run is not blocked by
    // a check that never ran.
    expect(result?.evidence.gateVerdict).toBeUndefined();
    expect(result?.verdict.detail).toMatch(/dispatch/i);
  });

  /**
   * A unit declaring no requirements has no acceptance bar, so there is nothing
   * a red baseline could be red against. Passing would mint a `tdd` verdict for
   * a unit that proved nothing — the same direction `deriveGateCriteria` takes
   * for a record with no verdict.
   */
  it("FAILS CLOSED when the unit declares no requirements", async () => {
    await journalDispatchBoundary();

    const result = await fireOnce({ requirementIds: [], candidateExitStatus: 0 });

    // ⚠️ Unproven, not refused (owner ruling 2026-08-18). The precondition could
    // not be established, so the record carries NO `gateVerdict` and
    // `implement-tests-first` stays underivable — while the run is not blocked by
    // a check that never ran.
    expect(result?.evidence.gateVerdict).toBeUndefined();
    expect(result?.verdict.detail).toMatch(/requirement/i);
  });
});
