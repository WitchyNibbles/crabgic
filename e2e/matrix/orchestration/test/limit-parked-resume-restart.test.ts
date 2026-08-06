import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { JournalStore } from "@crabgic/journal";
import type { SessionRef } from "@crabgic/engine-core";
import {
  buildFakeEngineScript,
  buildTaskPacket,
  buildWorkerResult,
  FakeEngineAdapter,
  RATE_LIMIT_ALLOWED_WARNING_96,
} from "@crabgic/testkit";
import { dispatchAttempt, getParkStatus, resumeAttempt } from "@crabgic/scheduler";
import {
  createRunsRegistry,
  recoverRun,
  createWorkersRegistry,
  transitionRun,
} from "@crabgic/supervisor";
import { allowAllAdjudicate, buildMinimalCompiledProfile } from "../src/compiledProfile.js";
import { emitScenarioEvidence } from "../src/evidence.js";
import { createTestJournal, reopenJournal, type TestJournal } from "../src/testJournal.js";
import { UNSEALED_CRITERIA_SEAL } from "../src/criteriaSeal.js";

/**
 * ⭐ MARQUEE VECTOR ⭐ — roadmap/23-release-hardening.md work item 4's exit
 * criterion: "limit-parked resume (`WorkUnitAttemptStatus: parked:rate_limit`)
 * surviving a supervisor restart." Also the Orchestration-matrix bullet's own
 * explicit named scenario, and the phase's overall exit criterion:
 * "Crash-recovery and concurrent change-set E2E scenarios pass live,
 * including limit-parked resume across a supervisor restart (05/13)."
 *
 * This goes ONE LEVEL BEYOND `packages/scheduler/src/executor.e2e.test.ts`'s
 * own already-existing park/resume-across-a-fresh-JournalStore test (which
 * proves the SCHEDULER half in isolation): this scenario ALSO drives
 * `@crabgic/supervisor`'s REAL `transitionRun`/`recoverRun` for the RUN's own
 * lifecycle state across the identical simulated restart, so both the 05
 * (manager/run) and 13 (scheduler/work-unit) halves of the SAME restart are
 * proven together — the genuine 05+13 ORCHESTRATION arc, not a
 * scheduler-only repeat. (`recoverRun`'s WorkersRegistry reconstruction
 * itself is NOT exercised here — see `manager-crash-recovery.test.ts` for
 * that dedicated scenario, now proving `@crabgic/journal`'s `recordAttempt`
 * correctly threads `runId` onto `work_unit_transition` entries so
 * `recoverRun` sees a real `dispatchAttempt`-driven attempt's true terminal
 * status. This scenario instead reads the parked work unit's own state via
 * `getParkStatus`/`getLatestAttempt` (workUnitId-scoped) — the CORRECT,
 * currently-working read path for THIS vector, exactly matching 13's own
 * designed restart-safety contract.)
 *
 * PARK TIMERS ARE JOURNAL-DERIVED, RESTART-SAFE (roadmap/13's own words) —
 * this scenario NEVER real-sleeps; the simulated clock is a plain injected
 * `nowSeconds` epoch-seconds integer compared against the fixed, verbatim
 * `RATE_LIMIT_ALLOWED_WARNING_96.resetsAt` fixture value.
 */
describe("⭐ MARQUEE: limit-parked resume surviving a simulated supervisor restart", () => {
  let journal: TestJournal;
  let store: JournalStore;

  beforeEach(async () => {
    journal = await createTestJournal();
    store = journal.store;
  });

  afterEach(async () => {
    await journal.cleanup();
  });

  it("parks on limitSignal, survives a FULL simulated supervisor restart (fresh journal + fresh run/worker registries), and resumes the SAME session past the reset to success", async () => {
    const runId = randomUUID();
    const changeSetId = randomUUID();
    const workUnitId = randomUUID();
    const sessionId = randomUUID();
    const runs = createRunsRegistry();

    await transitionRun({ journal: store, runs, runId, changeSetId, to: "awaiting_approval" });
    await transitionRun({ journal: store, runs, runId, changeSetId, to: "ready" });
    await transitionRun({ journal: store, runs, runId, changeSetId, to: "running" });

    const resumeScript = buildFakeEngineScript({
      sessionId,
      structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
    });
    const parkScript = buildFakeEngineScript({
      sessionId,
      failure: { kind: "limitSignal", payload: RATE_LIMIT_ALLOWED_WARNING_96 },
      onResume: resumeScript,
    });
    const adapter = new FakeEngineAdapter(parkScript);

    const parkOutcome = await dispatchAttempt({
      criteriaSeal: UNSEALED_CRITERIA_SEAL,
      adapter,
      journal: store,
      packet: buildTaskPacket({ workUnitId }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
      runId,
    });
    expect(parkOutcome).toMatchObject({ kind: "parked" });

    // ============================================================
    // SIMULATED FULL SUPERVISOR RESTART — the marquee moment: a brand-new
    // JournalStore instance over the SAME on-disk directory, plus
    // brand-new, EMPTY in-memory RunsRegistry/WorkersRegistry. Zero
    // in-memory state survives — exactly what a real process restart
    // looks like, never a partial/simulated-in-place reset.
    // ============================================================
    const restartedStore = reopenJournal(journal.journalDir);
    const restartedRuns = createRunsRegistry();
    const restartedWorkers = createWorkersRegistry();

    // The 05 half: the RUN's own lifecycle state recovers correctly across
    // the restart — still "running" (the run itself never terminated; only
    // one of its work units parked).
    await recoverRun(runId, {
      journal: restartedStore,
      runs: restartedRuns,
      workers: restartedWorkers,
    });
    expect(restartedRuns.get(runId)?.runState).toBe("running");

    // The 13 half: the parked work unit's own status, read from the
    // FRESHLY-REOPENED store — restart-safe by construction (journal-
    // derived, per 13's own design), not carried over in any in-memory
    // field.
    const beforeReset = await getParkStatus(
      restartedStore,
      workUnitId,
      RATE_LIMIT_ALLOWED_WARNING_96.resetsAt - 1,
    );
    expect(beforeReset).toMatchObject({ parked: true, readyToResume: false });

    const afterReset = await getParkStatus(
      restartedStore,
      workUnitId,
      RATE_LIMIT_ALLOWED_WARNING_96.resetsAt + 1,
    );
    expect(afterReset).toMatchObject({ parked: true, readyToResume: true, sessionId });

    // Resume — against the RESTARTED store, the SAME session_id, no
    // evidence required (a rate-limit park-resume is never a repair).
    const sessionRef: SessionRef = {
      sessionId,
      projectDirectory: "/fake/project",
      worktreePath: "/fake/project/worktree",
      configDir: "/fake/project/.claude-config",
    };
    const resumeOutcome = await resumeAttempt({
      criteriaSeal: UNSEALED_CRITERIA_SEAL,
      adapter,
      journal: restartedStore,
      sessionRef,
      workUnitId,
      adjudicate: allowAllAdjudicate,
      trigger: { kind: "parkResume" },
    });
    expect(resumeOutcome).toMatchObject({ kind: "succeeded", sessionId });

    const finalStatus = await getParkStatus(
      restartedStore,
      workUnitId,
      RATE_LIMIT_ALLOWED_WARNING_96.resetsAt + 100,
    );
    expect(finalStatus.parked).toBe(false);

    // A SECOND independent restart, purely to prove the post-resume state
    // itself is ALSO restart-safe (not an artifact of the one instance that
    // happened to perform the resume).
    const restartedAgain = reopenJournal(journal.journalDir);
    const statusAfterSecondRestart = await getParkStatus(
      restartedAgain,
      workUnitId,
      RATE_LIMIT_ALLOWED_WARNING_96.resetsAt + 100,
    );
    expect(statusAfterSecondRestart.parked).toBe(false);

    await emitScenarioEvidence({
      journal: restartedAgain,
      changeSetId,
      workUnitId,
      command: "orchestration-matrix: MARQUEE-limit-parked-resume-across-supervisor-restart",
      exitStatus: 0,
    });
  });

  it("an account-wide (accountWide) limit signal pauses globally, surviving the restart, blocking a DIFFERENT work unit's fresh dispatch until past reset", async () => {
    const pausedWorkUnitId = randomUUID();
    const otherWorkUnitId = randomUUID();
    const sessionId = randomUUID();

    await dispatchAttempt({
      criteriaSeal: UNSEALED_CRITERIA_SEAL,
      adapter: new FakeEngineAdapter(
        buildFakeEngineScript({
          sessionId,
          failure: {
            kind: "limitSignal",
            payload: { ...RATE_LIMIT_ALLOWED_WARNING_96, status: "rejected" },
          },
        }),
      ),
      journal: store,
      packet: buildTaskPacket({ workUnitId: pausedWorkUnitId }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });

    const restartedStore = reopenJournal(journal.journalDir);

    // A completely different work unit's FRESH dispatch is blocked by the
    // account-wide pause, even after a simulated restart — the pause itself
    // is journal-derived, not in-memory. Asserted by `.name` (rather than
    // `instanceof GlobalPauseActiveError`) purely for symmetry with this
    // file's other assertions; `GlobalPauseActiveError` IS now re-exported
    // from `@crabgic/scheduler`'s public barrel (`packages/scheduler/src/
    // index.ts`), a formerly-missing export fixed alongside this file's own
    // crash-recovery correctness fix.
    await expect(
      dispatchAttempt({
        criteriaSeal: UNSEALED_CRITERIA_SEAL,
        adapter: new FakeEngineAdapter(
          buildFakeEngineScript({
            structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
          }),
        ),
        journal: restartedStore,
        packet: buildTaskPacket({ workUnitId: otherWorkUnitId }),
        profile: buildMinimalCompiledProfile(),
        adjudicate: allowAllAdjudicate,
        evidenceKind: "none",
        nowSeconds: () => RATE_LIMIT_ALLOWED_WARNING_96.resetsAt - 1,
      }),
    ).rejects.toMatchObject({ name: "GlobalPauseActiveError" });

    // Past the reset, the SAME other work unit dispatches normally.
    const laterOutcome = await dispatchAttempt({
      criteriaSeal: UNSEALED_CRITERIA_SEAL,
      adapter: new FakeEngineAdapter(
        buildFakeEngineScript({
          structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
        }),
      ),
      journal: restartedStore,
      packet: buildTaskPacket({ workUnitId: otherWorkUnitId }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
      nowSeconds: () => RATE_LIMIT_ALLOWED_WARNING_96.resetsAt + 1,
    });
    expect(laterOutcome.kind).toBe("succeeded");

    await emitScenarioEvidence({
      journal: restartedStore,
      changeSetId: randomUUID(),
      command: "orchestration-matrix: MARQUEE-account-wide-pause-survives-restart",
      exitStatus: 0,
    });
  });
});
