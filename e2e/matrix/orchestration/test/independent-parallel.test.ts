import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getLatestAttempt, type JournalStore } from "@crabgic/journal";
import {
  buildFakeEngineScript,
  buildTaskPacket,
  buildWorkerResult,
  buildWorkUnit,
  FakeEngineAdapter,
} from "@crabgic/testkit";
import {
  DEFAULT_CONCURRENCY_CAP,
  computeReadyUnits,
  dispatchAttempt,
  journalFanoutRationaleIfFannedOut,
  selectDispatchSet,
} from "@crabgic/scheduler";
import { allowAllAdjudicate, buildMinimalCompiledProfile } from "../src/compiledProfile.js";
import { emitScenarioEvidence } from "../src/evidence.js";
import { createTestJournal, type TestJournal } from "../src/testJournal.js";

/**
 * Scenario 1/8 — roadmap/23-release-hardening.md work item 4: "independent
 * parallel change sets." Three WorkUnits with ZERO pairwise overlap
 * collisions dispatch concurrently, up to the concurrency cap, and a
 * `fanout_rationale` entry is journaled for the fanned-out round — driving
 * the REAL `@crabgic/scheduler` readiness/fanout/executor logic against the fake
 * engine, never a stub.
 */
describe("Orchestration matrix: independent parallel change sets", () => {
  let journal: TestJournal;
  let store: JournalStore;

  beforeEach(async () => {
    journal = await createTestJournal();
    store = journal.store;
  });

  afterEach(async () => {
    await journal.cleanup();
  });

  it("dispatches three mutually-independent WorkUnits concurrently and journals exactly one fan-out rationale", async () => {
    // NOTE: `buildWorkUnit()`'s default `id` is drawn from a FRESH,
    // independently-seeded deterministic id provider PER CALL (see
    // `@crabgic/testkit`'s `createFixtureContext`) — two separate calls with no
    // override produce the IDENTICAL default `id`. Every fixture below that
    // coexists with siblings in the SAME test is therefore given an
    // explicit, distinct `id` override; this is this harness's own
    // established convention (mirroring `packages/scheduler/src/executor.
    // e2e.test.ts`'s own hand-picked-constant-id style) wherever more than
    // one sibling fixture is built in one test.
    const unitA = buildWorkUnit({ id: randomUUID(), dependsOn: [], attemptStatus: "pending" });
    const unitB = buildWorkUnit({ id: randomUUID(), dependsOn: [], attemptStatus: "pending" });
    const unitC = buildWorkUnit({ id: randomUUID(), dependsOn: [], attemptStatus: "pending" });
    const workUnits = [unitA, unitB, unitC];

    const ready = computeReadyUnits({ workUnits, overlapVerdicts: [] });
    expect(new Set(ready)).toEqual(new Set([unitA.id, unitB.id, unitC.id]));

    const selected = selectDispatchSet(ready, [], DEFAULT_CONCURRENCY_CAP);
    expect(selected).toHaveLength(3);

    // A per-test runId so the fan-out assertion below is scoped to THIS
    // round's own entry: under a shared journal
    // (`CRABGIC_RELEASE_GATE_JOURNAL_DIR`, see `../src/testJournal.ts`) sibling
    // scenarios' `fanout_rationale` entries land in the same journal, and
    // an unscoped "exactly one" count would break.
    const runId = randomUUID();
    await journalFanoutRationaleIfFannedOut({
      journal: store,
      runId,
      dispatchedUnitIds: selected,
    });

    const outcomes = await Promise.all(
      selected.map((workUnitId) =>
        dispatchAttempt({
          adapter: new FakeEngineAdapter(
            buildFakeEngineScript({
              sessionId: randomUUID(),
              structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
            }),
          ),
          journal: store,
          packet: buildTaskPacket({ workUnitId }),
          profile: buildMinimalCompiledProfile(),
          adjudicate: allowAllAdjudicate,
          evidenceKind: "none",
        }),
      ),
    );

    expect(outcomes.every((o) => o.kind === "succeeded")).toBe(true);
    for (const workUnitId of selected) {
      expect((await getLatestAttempt(store, workUnitId))?.status).toBe("succeeded");
    }

    const fanoutEntries: unknown[] = [];
    for await (const entry of store.queryEntries({ type: "fanout_rationale", runId })) {
      fanoutEntries.push(entry);
    }
    expect(fanoutEntries).toHaveLength(1);

    await emitScenarioEvidence({
      journal: store,
      changeSetId: unitA.changeSetId,
      command: "orchestration-matrix: independent-parallel-change-sets",
      exitStatus: 0,
    });
  });

  it("respects the concurrency cap: a 5-unit independent round selects only DEFAULT_CONCURRENCY_CAP (4) units", () => {
    const units = Array.from({ length: 5 }, () =>
      buildWorkUnit({ id: randomUUID(), dependsOn: [], attemptStatus: "pending" }),
    );
    const ready = computeReadyUnits({ workUnits: units, overlapVerdicts: [] });
    const selected = selectDispatchSet(ready, [], DEFAULT_CONCURRENCY_CAP);
    expect(selected).toHaveLength(DEFAULT_CONCURRENCY_CAP);
  });
});
