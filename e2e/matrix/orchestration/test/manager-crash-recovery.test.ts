import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { JournalStore } from "@crabgic/journal";
import {
  buildFakeEngineScript,
  buildTaskPacket,
  buildWorkerResult,
  FakeEngineAdapter,
} from "@crabgic/testkit";
import { dispatchAttempt } from "@crabgic/scheduler";
import {
  createRunsRegistry,
  createWorkersRegistry,
  recoverRun,
  transitionRun,
} from "@crabgic/supervisor";
import { allowAllAdjudicate, buildMinimalCompiledProfile } from "../src/compiledProfile.js";
import { emitScenarioEvidence } from "../src/evidence.js";
import { createTestJournal, reopenJournal, type TestJournal } from "../src/testJournal.js";
import { UNSEALED_CRITERIA_SEAL } from "../src/criteriaSeal.js";

/**
 * Scenario 6/8 — roadmap/23-release-hardening.md work item 4: "manager
 * (supervisor) crash -> recover(runId)." Drives `@crabgic/supervisor`'s REAL
 * `recoverRun` against a simulated FULL supervisor restart (fresh
 * `JournalStore` instance over the same on-disk journal + brand-new,
 * empty in-memory `RunsRegistry`/`WorkersRegistry` — zero in-memory state
 * carried over, exactly what a real process restart looks like).
 */
describe("Orchestration matrix: manager (supervisor) crash -> recover(runId)", () => {
  let journal: TestJournal;
  let store: JournalStore;

  beforeEach(async () => {
    journal = await createTestJournal();
    store = journal.store;
  });

  afterEach(async () => {
    await journal.cleanup();
  });

  it("recovers RunsRegistry state correctly across a simulated restart, and idempotently across a repeated recovery", async () => {
    const runId = randomUUID();
    const changeSetId = randomUUID();
    const runs = createRunsRegistry();

    await transitionRun({ journal: store, runs, runId, changeSetId, to: "awaiting_approval" });
    await transitionRun({ journal: store, runs, runId, changeSetId, to: "ready" });
    await transitionRun({ journal: store, runs, runId, changeSetId, to: "running" });

    // ---- Simulated FULL supervisor restart: fresh JournalStore instance
    // (reopened over the SAME on-disk dir) + brand-new, empty in-memory
    // registries — zero in-memory state carried over.
    const freshStore1 = reopenJournal(journal.journalDir);
    const freshRuns1 = createRunsRegistry();
    const freshWorkers1 = createWorkersRegistry();
    const result1 = await recoverRun(runId, {
      journal: freshStore1,
      runs: freshRuns1,
      workers: freshWorkers1,
    });
    expect(freshRuns1.get(runId)).toMatchObject({ runId, changeSetId, runState: "running" });

    // Idempotency: a SECOND fresh restart converges to the identical state.
    const freshStore2 = reopenJournal(journal.journalDir);
    const freshRuns2 = createRunsRegistry();
    const result2 = await recoverRun(runId, {
      journal: freshStore2,
      runs: freshRuns2,
      workers: createWorkersRegistry(),
    });
    expect(result2.replayed).toHaveLength(result1.replayed.length);
    expect(freshRuns2.get(runId)).toEqual(freshRuns1.get(runId));

    // And calling recoverRun TWICE against the SAME registries also
    // converges — no duplicated side effect, matching 05's own exit
    // criterion for this exact call.
    const resultRepeat = await recoverRun(runId, {
      journal: freshStore1,
      runs: freshRuns1,
      workers: freshWorkers1,
    });
    expect(resultRepeat.replayed).toHaveLength(result1.replayed.length);
    expect(freshRuns1.get(runId)).toEqual(freshRuns2.get(runId));

    await emitScenarioEvidence({
      journal: freshStore1,
      changeSetId,
      command: "orchestration-matrix: manager-supervisor-crash-recover-run-id",
      exitStatus: 0,
    });
  });

  it("reconstructs a genuine kill -9 mid-flight worker as crashed, using the entry SHAPE recoverRun's own contract expects (runId-tagged work_unit_transition)", async () => {
    const runId = randomUUID();
    const changeSetId = randomUUID();
    const workUnitId = randomUUID();
    const sessionId = randomUUID();
    const runs = createRunsRegistry();

    await transitionRun({ journal: store, runs, runId, changeSetId, to: "awaiting_approval" });
    await transitionRun({ journal: store, runs, runId, changeSetId, to: "ready" });
    await transitionRun({ journal: store, runs, runId, changeSetId, to: "running" });

    // A genuine kill -9 mid-flight: only session_assignment + a
    // "dispatched" transition ever landed before the worker's own process
    // died — modeled directly at the journal level with runId explicitly
    // set on BOTH entries, mirroring `packages/supervisor/src/registries/
    // recovery.test.ts`'s own "genuine-restart case" test (the documented
    // technique `recoverRun`'s contract is actually designed against — see
    // this file's next test for why a REAL dispatchAttempt-driven entry
    // does NOT match this shape today).
    await store.appendEntry({
      type: "session_assignment",
      runId,
      workUnitId,
      payload: { sessionId },
    });
    await store.appendEntry({
      type: "work_unit_transition",
      runId,
      workUnitId,
      payload: { status: "dispatched", sessionId },
    });

    const freshStore = reopenJournal(journal.journalDir);
    const freshRuns = createRunsRegistry();
    const freshWorkers = createWorkersRegistry();
    await recoverRun(runId, { journal: freshStore, runs: freshRuns, workers: freshWorkers });

    const orphaned = freshWorkers.query((w) => w.sessionId === sessionId)[0];
    expect(orphaned?.status).toBe("crashed");
    expect(orphaned?.workUnitId).toBe(workUnitId);

    await emitScenarioEvidence({
      journal: freshStore,
      changeSetId,
      workUnitId,
      command: "orchestration-matrix: manager-crash-orphan-worker-reconstruction",
      exitStatus: 0,
    });
  });

  it(
    "FIXED (05/13/04 integration): recoverRun correctly reports a work unit that ACTUALLY " +
      "SUCCEEDED via the real @crabgic/scheduler executor as 'succeeded' (no orphan synthesized), " +
      "now that @crabgic/journal's recordAttempt threads runId onto work_unit_transition entries",
    async () => {
      // FORMERLY A DOCUMENTED GAP (verified directly against the built
      // packages): `@crabgic/journal`'s `recordAttempt` used to append its
      // `work_unit_transition` entry with NO `runId` field at all. This was
      // NOT specific to `@crabgic/scheduler`'s `dispatchAttempt`/`resumeAttempt`
      // (which call it directly) — `@crabgic/supervisor`'s OWN production
      // worker-lifecycle manager (`packages/supervisor/src/worker-lifecycle/
      // worker-lifecycle-manager.ts`) called the exact same bare
      // `recordAttempt` for its own `work_unit_transition` writes, and
      // therefore had the identical gap. `recoverRun`'s
      // `reconstructOrphanedWorkers` (`packages/supervisor/src/registries/
      // recovery.ts`) operates ONLY over `journal.recover(runId)`'s
      // `replayed` array, which is `queryEntries({ runId })`-filtered
      // (`packages/journal/src/store/query-entries.ts`'s `matchesFilter`:
      // `entry.runId !== filter.runId` excludes any entry with no `runId`
      // at all) — so EVERY `work_unit_transition` entry written by either
      // package's real production dispatch path used to be invisible to
      // `recoverRun`'s orphan/terminal-status reconstruction, regardless of
      // whether the caller passed `runId` into `dispatchAttempt` itself
      // (verified below: it was, even before the fix).
      //
      // `packages/supervisor/src/registries/recovery.test.ts`'s own test
      // suite never exercised this path in isolation — every one of its
      // fixture entries hand-sets `runId` directly via a bare
      // `store.appendEntry` call (bypassing `recordAttempt` entirely),
      // which is why that suite's own tests passed while this real,
      // wired-together path did not — exactly the class of gap this
      // harness exists to catch (subsystems that each pass their own unit
      // tests in isolation, but disagree once driven together for real).
      //
      // THE FIX: `@crabgic/journal`'s `recordAttempt` (`packages/journal/src/
      // attempts.ts`) now takes an OPTIONAL 5th `runId` parameter, threaded
      // onto the entry's top-level envelope field exactly as
      // `session_assignment` already carries it. `@crabgic/scheduler`'s
      // executor (`packages/scheduler/src/executor.ts`) and
      // `@crabgic/supervisor`'s worker-lifecycle manager (`packages/supervisor/
      // src/worker-lifecycle/worker-lifecycle-manager.ts`) both now thread
      // their own already-in-scope `runId` through to every call site. This
      // scenario is the release-criteria proof that the fix closes the gap
      // end to end, through the REAL production dispatch path — not a
      // hand-crafted fixture.
      const runId = randomUUID();
      const changeSetId = randomUUID();
      const workUnitId = randomUUID();
      const sessionId = randomUUID();
      const runs = createRunsRegistry();

      await transitionRun({ journal: store, runs, runId, changeSetId, to: "awaiting_approval" });
      await transitionRun({ journal: store, runs, runId, changeSetId, to: "ready" });
      await transitionRun({ journal: store, runs, runId, changeSetId, to: "running" });

      const outcome = await dispatchAttempt({
        criteriaSeal: UNSEALED_CRITERIA_SEAL,
        adapter: new FakeEngineAdapter(
          buildFakeEngineScript({
            sessionId,
            structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
          }),
        ),
        journal: store,
        packet: buildTaskPacket({ workUnitId }),
        profile: buildMinimalCompiledProfile(),
        adjudicate: allowAllAdjudicate,
        evidenceKind: "none",
        runId,
      });
      expect(outcome.kind).toBe("succeeded");

      // Independently confirm (never trust the finding on faith) that the
      // work_unit_transition entry this real dispatch produced genuinely
      // carries the runId, and that the succeeded status is genuinely
      // there — the fix, made concrete.
      let sawSucceededWithRunId = false;
      for await (const entry of store.queryEntries({ type: "work_unit_transition", workUnitId })) {
        if (entry.type !== "work_unit_transition") continue;
        if (entry.payload.status === "succeeded" && entry.runId === runId) {
          sawSucceededWithRunId = true;
        }
      }
      expect(sawSucceededWithRunId).toBe(true);

      const freshStore = reopenJournal(journal.journalDir);
      const freshRuns = createRunsRegistry();
      const freshWorkers = createWorkersRegistry();
      await recoverRun(runId, { journal: freshStore, runs: freshRuns, workers: freshWorkers });

      // The fix, made concrete: recoverRun no longer synthesizes an orphan
      // for this session at all — its terminal ("succeeded") status is now
      // genuinely visible to the runId-scoped replay, so nothing non-
      // terminal remains to reconstruct as "crashed".
      const misreported = freshWorkers.query((w) => w.sessionId === sessionId)[0];
      expect(misreported).toBeUndefined();

      await emitScenarioEvidence({
        journal: freshStore,
        changeSetId,
        workUnitId,
        command:
          "orchestration-matrix: FIXED-recoverRun-correctly-reports-succeeded-worker-as-succeeded",
        exitStatus: 0,
      });
    },
  );
});
