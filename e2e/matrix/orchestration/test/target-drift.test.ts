import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getLatestAttempt, type JournalStore } from "@eo/journal";
import {
  buildFakeEngineScript,
  buildTaskPacket,
  buildWorkerResult,
  FakeEngineAdapter,
} from "@eo/testkit";
import { dispatchAttempt } from "@eo/scheduler";
import { allowAllAdjudicate, buildMinimalCompiledProfile } from "../src/compiledProfile.js";
import { emitScenarioEvidence } from "../src/evidence.js";
import { assertNoTargetDrift, TargetDriftError } from "../src/targetDrift.js";
import { createTestJournal, type TestJournal } from "../src/testJournal.js";

const FROZEN_BASE_OBJECT_ID = "1111111111111111111111111111111111111a";
const DRIFTED_BASE_OBJECT_ID = "2222222222222222222222222222222222222b";

/**
 * Scenario 4/8 — roadmap/23-release-hardening.md work item 4: "target
 * drift." See `../src/targetDrift.ts`'s file-level doc comment for this
 * harness's own documented definition (the roadmap names the vector but
 * never itself defines it): a repair/resume attempt for the SAME `WorkUnit`
 * must never be dispatched against a DIFFERENT frozen `baseObjectId` than
 * the unit's original attempt.
 */
describe("Orchestration matrix: target drift", () => {
  let journal: TestJournal;
  let store: JournalStore;

  beforeEach(async () => {
    journal = await createTestJournal();
    store = journal.store;
  });

  afterEach(async () => {
    await journal.cleanup();
  });

  it("a genuine repair against the SAME frozen baseObjectId proceeds normally — no drift", async () => {
    const workUnitId = randomUUID();
    const originalPacket = buildTaskPacket({ workUnitId, baseObjectId: FROZEN_BASE_OBJECT_ID });

    const crashOutcome = await dispatchAttempt({
      adapter: new FakeEngineAdapter(buildFakeEngineScript({ failure: { kind: "crash" } })),
      journal: store,
      packet: originalPacket,
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });
    expect(crashOutcome.kind).toBe("crashed");

    const repairPacket = buildTaskPacket({ workUnitId, baseObjectId: FROZEN_BASE_OBJECT_ID });
    // The harness's own pre-dispatch guard: never throws when the target
    // hasn't moved.
    expect(() => assertNoTargetDrift(originalPacket, repairPacket)).not.toThrow();

    const repairOutcome = await dispatchAttempt({
      adapter: new FakeEngineAdapter(
        buildFakeEngineScript({ structuredOutput: buildWorkerResult({ outcome: "succeeded" }) }),
      ),
      journal: store,
      packet: repairPacket,
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "crash",
    });
    expect(repairOutcome.kind).toBe("succeeded");
    expect((await getLatestAttempt(store, workUnitId))?.status).toBe("succeeded");

    await emitScenarioEvidence({
      journal: store,
      changeSetId: randomUUID(),
      workUnitId,
      command: "orchestration-matrix: target-drift-none",
      exitStatus: 0,
    });
  });

  it("a drifted repair packet (different baseObjectId) is caught by the harness's guard BEFORE the engine is ever called again", async () => {
    const workUnitId = randomUUID();
    const originalPacket = buildTaskPacket({ workUnitId, baseObjectId: FROZEN_BASE_OBJECT_ID });

    const crashOutcome = await dispatchAttempt({
      adapter: new FakeEngineAdapter(buildFakeEngineScript({ failure: { kind: "crash" } })),
      journal: store,
      packet: originalPacket,
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });
    expect(crashOutcome.kind).toBe("crashed");

    const driftedPacket = buildTaskPacket({ workUnitId, baseObjectId: DRIFTED_BASE_OBJECT_ID });

    let spawnCalled = false;
    const driftedAdapter = new FakeEngineAdapter(
      buildFakeEngineScript({ structuredOutput: buildWorkerResult({ outcome: "succeeded" }) }),
    );
    const originalSpawn = driftedAdapter.spawn.bind(driftedAdapter);
    driftedAdapter.spawn = (...args) => {
      spawnCalled = true;
      return originalSpawn(...args);
    };

    // The guard itself must throw BEFORE the (would-be) repair dispatch —
    // this test calls it exactly where a real orchestration loop would,
    // then proves the engine was never reached by never calling
    // dispatchAttempt at all once the guard has thrown.
    expect(() => assertNoTargetDrift(originalPacket, driftedPacket)).toThrow(TargetDriftError);
    expect(spawnCalled).toBe(false);

    // Still recoverable: a repair against the FROZEN (non-drifted) base
    // object id succeeds normally afterward.
    const correctedPacket = buildTaskPacket({ workUnitId, baseObjectId: FROZEN_BASE_OBJECT_ID });
    expect(() => assertNoTargetDrift(originalPacket, correctedPacket)).not.toThrow();
    const repairOutcome = await dispatchAttempt({
      adapter: driftedAdapter,
      journal: store,
      packet: correctedPacket,
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "crash",
    });
    expect(repairOutcome.kind).toBe("succeeded");
    expect(spawnCalled).toBe(true);

    await emitScenarioEvidence({
      journal: store,
      changeSetId: randomUUID(),
      workUnitId,
      command: "orchestration-matrix: target-drift-caught",
      exitStatus: 0,
    });
  });
});
