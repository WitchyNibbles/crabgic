import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getLatestAttempt, type JournalStore } from "@crabgic/journal";
import { IllegalTransitionError } from "@crabgic/contracts";
import {
  buildFakeEngineScript,
  buildTaskPacket,
  buildWorkerResult,
  FakeEngineAdapter,
} from "@crabgic/testkit";
import { dispatchAttempt } from "@crabgic/scheduler";
import { createRunsRegistry, transitionRun } from "@crabgic/supervisor";
import { allowAllAdjudicate, buildMinimalCompiledProfile } from "../src/compiledProfile.js";
import { emitScenarioEvidence } from "../src/evidence.js";
import { createTestJournal, type TestJournal } from "../src/testJournal.js";

/**
 * Scenario 3/8 — roadmap/23-release-hardening.md work item 4: "cancellation."
 * Exercised at BOTH levels this harness's two subsystems own:
 *  - work-unit/attempt level (13's executor): a worker's own reported
 *    `outcome: "cancelled"` WorkerResult drives `dispatchAttempt` to a
 *    `cancelled` outcome, journaled via the real `WorkUnitAttemptStatus`
 *    transition.
 *  - run level (05's run-lifecycle transition surface): a real
 *    `transitionRun` call moves a run to `cancelled` — and the transition
 *    table genuinely REFUSES an illegal direct jump (`draft -> running`)
 *    BEFORE any journal write, never merely documented as refused.
 */
describe("Orchestration matrix: cancellation", () => {
  let journal: TestJournal;
  let store: JournalStore;

  beforeEach(async () => {
    journal = await createTestJournal();
    store = journal.store;
  });

  afterEach(async () => {
    await journal.cleanup();
  });

  it("a worker-reported 'cancelled' outcome drives dispatchAttempt to a cancelled WorkUnitAttemptStatus", async () => {
    const workUnitId = randomUUID();
    const outcome = await dispatchAttempt({
      adapter: new FakeEngineAdapter(
        buildFakeEngineScript({
          sessionId: randomUUID(),
          structuredOutput: buildWorkerResult({ outcome: "cancelled" }),
        }),
      ),
      journal: store,
      packet: buildTaskPacket({ workUnitId }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });

    expect(outcome.kind).toBe("cancelled");
    expect((await getLatestAttempt(store, workUnitId))?.status).toBe("cancelled");
  });

  it("transitionRun cancels a run in-flight — journaled, registry-reflected — and REFUSES an illegal direct jump before any journal write", async () => {
    const runId = randomUUID();
    const changeSetId = randomUUID();
    const runs = createRunsRegistry();

    await transitionRun({ journal: store, runs, runId, changeSetId, to: "awaiting_approval" });
    await transitionRun({ journal: store, runs, runId, changeSetId, to: "ready" });
    await transitionRun({ journal: store, runs, runId, changeSetId, to: "running" });
    const cancelled = await transitionRun({
      journal: store,
      runs,
      runId,
      changeSetId,
      to: "cancelled",
    });
    expect(cancelled.runState).toBe("cancelled");
    expect(runs.get(runId)?.runState).toBe("cancelled");

    const transitionsBefore: unknown[] = [];
    for await (const entry of store.queryEntries({ type: "run_transition", runId })) {
      transitionsBefore.push(entry);
    }
    expect(transitionsBefore).toHaveLength(4);

    // A second run, deliberately illegal jump: draft -> running skips
    // awaiting_approval/ready entirely. The gate must refuse it BEFORE any
    // journal write — not merely document the refusal.
    const illegalRunId = randomUUID();
    await expect(
      transitionRun({
        journal: store,
        runs,
        runId: illegalRunId,
        changeSetId: randomUUID(),
        to: "running",
      }),
    ).rejects.toBeInstanceOf(IllegalTransitionError);

    const illegalEntries: unknown[] = [];
    for await (const entry of store.queryEntries({ type: "run_transition", runId: illegalRunId })) {
      illegalEntries.push(entry);
    }
    expect(illegalEntries).toHaveLength(0);
    expect(runs.get(illegalRunId)).toBeUndefined();

    await emitScenarioEvidence({
      journal: store,
      changeSetId,
      command: "orchestration-matrix: cancellation",
      exitStatus: 0,
    });
  });
});
