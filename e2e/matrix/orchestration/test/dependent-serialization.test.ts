import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getLatestAttempt, type JournalStore } from "@crabgic/journal";
import type { WorkUnitAttemptStatus } from "@crabgic/contracts";
import {
  buildFakeEngineScript,
  buildTaskPacket,
  buildWorkerResult,
  buildWorkUnit,
  FakeEngineAdapter,
} from "@crabgic/testkit";
import type { CollisionVerdict } from "@crabgic/git-engine";
import {
  DEFAULT_CONCURRENCY_CAP,
  computeReadyUnits,
  dispatchAttempt,
  selectDispatchSet,
} from "@crabgic/scheduler";
import { allowAllAdjudicate, buildMinimalCompiledProfile } from "../src/compiledProfile.js";
import { emitScenarioEvidence } from "../src/evidence.js";
import { createTestJournal, type TestJournal } from "../src/testJournal.js";

/**
 * Scenario 2/8 — roadmap/23-release-hardening.md work item 4: "dependent
 * serialization (overlap forces order)." Two WorkUnits that pairwise
 * COLLIDE (07's overlap analysis — a shared path) are never selected into
 * the same dispatch round together, and dependency edges (`dependsOn`)
 * force a downstream unit to stay non-ready until its dependency succeeds —
 * both driving the REAL `@crabgic/scheduler` readiness/fanout logic, not a stub.
 */
describe("Orchestration matrix: dependent serialization (overlap + dependsOn both force order)", () => {
  let journal: TestJournal;
  let store: JournalStore;

  beforeEach(async () => {
    journal = await createTestJournal();
    store = journal.store;
  });

  afterEach(async () => {
    await journal.cleanup();
  });

  it("an overlapping pair is never selected into the same round; the loser dispatches only once the winner has succeeded", async () => {
    // NOTE: `buildWorkUnit()`'s default `id` is drawn from a fresh,
    // independently-seeded deterministic id provider PER CALL — two
    // sibling fixtures in the same test always need an explicit `id`
    // override (see `independent-parallel.test.ts`'s own doc comment for
    // the full explanation).
    const unitA = buildWorkUnit({ id: randomUUID(), dependsOn: [], attemptStatus: "pending" });
    const unitB = buildWorkUnit({ id: randomUUID(), dependsOn: [], attemptStatus: "pending" });
    const overlapVerdicts: CollisionVerdict[] = [
      {
        unitA: unitA.id,
        unitB: unitB.id,
        collides: true,
        collidingPaths: ["packages/example/src/shared.ts"],
        declaredResourceCollisions: [],
      },
    ];

    const round1Ready = computeReadyUnits({ workUnits: [unitA, unitB], overlapVerdicts });
    expect(new Set(round1Ready)).toEqual(new Set([unitA.id, unitB.id]));

    const round1Selected = selectDispatchSet(round1Ready, overlapVerdicts, DEFAULT_CONCURRENCY_CAP);
    // Only ONE of the colliding pair is selected this round — never both.
    expect(round1Selected).toHaveLength(1);
    const [winnerId] = round1Selected;
    const loserId = winnerId === unitA.id ? unitB.id : unitA.id;

    const winnerOutcome = await dispatchAttempt({
      adapter: new FakeEngineAdapter(
        buildFakeEngineScript({
          sessionId: randomUUID(),
          structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
        }),
      ),
      journal: store,
      packet: buildTaskPacket({ workUnitId: winnerId! }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });
    expect(winnerOutcome.kind).toBe("succeeded");

    // Round 2: the winner is no longer "pending" (its own attemptStatus is
    // stale in this in-memory fixture, so this scenario tracks status via
    // the journal — statusById reflects the just-succeeded winner directly).
    const statusById = new Map<string, WorkUnitAttemptStatus>([
      [unitA.id, unitA.id === winnerId ? "succeeded" : "pending"],
      [unitB.id, unitB.id === winnerId ? "succeeded" : "pending"],
    ]);
    const round2Ready = computeReadyUnits({
      workUnits: [unitA, unitB],
      statusById,
      overlapVerdicts,
      inFlightUnitIds: new Set(), // the winner has completed, no longer in flight
    });
    expect(round2Ready).toEqual([loserId]);

    const loserOutcome = await dispatchAttempt({
      adapter: new FakeEngineAdapter(
        buildFakeEngineScript({
          sessionId: randomUUID(),
          structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
        }),
      ),
      journal: store,
      packet: buildTaskPacket({ workUnitId: loserId }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });
    expect(loserOutcome.kind).toBe("succeeded");
    expect((await getLatestAttempt(store, loserId))?.status).toBe("succeeded");

    await emitScenarioEvidence({
      journal: store,
      changeSetId: unitA.changeSetId,
      command: "orchestration-matrix: dependent-serialization-overlap-forces-order",
      exitStatus: 0,
    });
  });

  it("a downstream WorkUnit with an unsatisfied dependsOn is never ready, regardless of overlap", () => {
    const upstream = buildWorkUnit({ id: randomUUID(), dependsOn: [], attemptStatus: "pending" });
    const downstream = buildWorkUnit({
      id: randomUUID(),
      dependsOn: [upstream.id],
      attemptStatus: "pending",
    });

    const ready = computeReadyUnits({ workUnits: [upstream, downstream], overlapVerdicts: [] });
    expect(ready).toEqual([upstream.id]);

    const readyAfterUpstreamSucceeds = computeReadyUnits({
      workUnits: [upstream, downstream],
      statusById: new Map<string, WorkUnitAttemptStatus>([
        [upstream.id, "succeeded"],
        [downstream.id, "pending"],
      ]),
      overlapVerdicts: [],
    });
    expect(readyAfterUpstreamSucceeds).toEqual([downstream.id]);
  });
});
