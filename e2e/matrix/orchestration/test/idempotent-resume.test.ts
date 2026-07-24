import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getLatestAttempt, type JournalStore } from "@eo/journal";
import type { SessionRef } from "@eo/engine-core";
import {
  buildFakeEngineScript,
  buildTaskPacket,
  buildWorkerResult,
  FakeEngineAdapter,
  FakeEngineNoResumeScriptError,
} from "@eo/testkit";
import { countPriorDispatches, dispatchAttempt, resumeAttempt } from "@eo/scheduler";
import { allowAllAdjudicate, buildMinimalCompiledProfile } from "../src/compiledProfile.js";
import { emitScenarioEvidence } from "../src/evidence.js";
import { createTestJournal, reopenJournal, type TestJournal } from "../src/testJournal.js";

/**
 * Scenario 7/8 — roadmap/23-release-hardening.md work item 4: "idempotent
 * resume." Two independent idempotency properties, both driven against the
 * REAL `@eo/scheduler` executor across a SIMULATED supervisor restart
 * (fresh `JournalStore` instance over the same on-disk journal, zero
 * in-memory state carried over):
 *
 *  1. Journal-derived read-back (`getLatestAttempt`/`countPriorDispatches`)
 *     is restart-safe — a brand-new `JournalStore` instance reports the
 *     IDENTICAL attempt history/count as the instance that lived through
 *     the whole arc, and this holds across MULTIPLE independent restarts.
 *  2. A resume attempt against an already-CONCLUDED session (no further
 *     `onResume` continuation scripted) is refused by the engine adapter
 *     itself — a redundant/duplicate resume call (e.g. a supervisor retry
 *     racing its own prior successful resume) can never silently
 *     re-execute a session that has already reached a terminal outcome.
 */
describe("Orchestration matrix: idempotent resume", () => {
  let journal: TestJournal;
  let store: JournalStore;

  beforeEach(async () => {
    journal = await createTestJournal();
    store = journal.store;
  });

  afterEach(async () => {
    await journal.cleanup();
  });

  it("attempt history read back identically from 3 independently-reopened JournalStore instances after a crash + repair arc", async () => {
    const workUnitId = randomUUID();
    const sessionId = randomUUID();
    const repairScript = buildFakeEngineScript({
      sessionId,
      structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
    });
    const crashScript = buildFakeEngineScript({
      sessionId,
      failure: { kind: "crash" },
      onResume: repairScript,
    });
    const adapter = new FakeEngineAdapter(crashScript);

    const crashOutcome = await dispatchAttempt({
      adapter,
      journal: store,
      packet: buildTaskPacket({ workUnitId }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });
    expect(crashOutcome.kind).toBe("crashed");

    // Simulated restart BEFORE the repair — a fresh instance already agrees
    // with the live one on the crash-so-far history.
    const restartedBeforeRepair = reopenJournal(journal.journalDir);
    expect(await countPriorDispatches(restartedBeforeRepair, workUnitId)).toBe(1);

    const sessionRef: SessionRef = {
      sessionId,
      projectDirectory: "/fake/project",
      worktreePath: "/fake/project/worktree",
      configDir: "/fake/project/.claude-config",
    };
    const repairOutcome = await resumeAttempt({
      adapter,
      journal: store,
      sessionRef,
      workUnitId,
      adjudicate: allowAllAdjudicate,
      trigger: { kind: "crashRepair", evidenceKind: "crash" },
    });
    expect(repairOutcome.kind).toBe("succeeded");

    // Two MORE independent restarts, both after the repair, both agreeing
    // with each other and with the live store — restart-safe, no drift.
    const restartedAfterRepair1 = reopenJournal(journal.journalDir);
    const restartedAfterRepair2 = reopenJournal(journal.journalDir);
    const liveLatest = await getLatestAttempt(store, workUnitId);
    const r1Latest = await getLatestAttempt(restartedAfterRepair1, workUnitId);
    const r2Latest = await getLatestAttempt(restartedAfterRepair2, workUnitId);

    expect(r1Latest).toEqual(liveLatest);
    expect(r2Latest).toEqual(liveLatest);
    expect(liveLatest?.status).toBe("succeeded");
    expect(await countPriorDispatches(restartedAfterRepair1, workUnitId)).toBe(2);
    expect(await countPriorDispatches(restartedAfterRepair2, workUnitId)).toBe(2);

    await emitScenarioEvidence({
      journal: store,
      changeSetId: randomUUID(),
      workUnitId,
      command: "orchestration-matrix: idempotent-resume-restart-safe-readback",
      exitStatus: 0,
    });
  });

  it("a duplicate/redundant resume call against an already-concluded session is refused, never silently re-executed", async () => {
    const workUnitId = randomUUID();
    const sessionId = randomUUID();
    // No onResume on the SUCCESS script — this session has no scripted
    // continuation once it concludes, exactly the shape of "this session's
    // story is over."
    const crashScript = buildFakeEngineScript({
      sessionId,
      failure: { kind: "crash" },
      onResume: buildFakeEngineScript({
        sessionId,
        structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
      }),
    });
    const adapter = new FakeEngineAdapter(crashScript);

    await dispatchAttempt({
      adapter,
      journal: store,
      packet: buildTaskPacket({ workUnitId }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });

    const sessionRef: SessionRef = {
      sessionId,
      projectDirectory: "/fake/project",
      worktreePath: "/fake/project/worktree",
      configDir: "/fake/project/.claude-config",
    };
    const first = await resumeAttempt({
      adapter,
      journal: store,
      sessionRef,
      workUnitId,
      adjudicate: allowAllAdjudicate,
      trigger: { kind: "crashRepair", evidenceKind: "crash" },
    });
    expect(first.kind).toBe("succeeded");

    // A redundant SECOND resume call for the SAME session — the engine
    // adapter itself refuses (no further onResume was ever scripted for
    // the concluded session), never silently re-running the worker.
    await expect(
      resumeAttempt({
        adapter,
        journal: store,
        sessionRef,
        workUnitId,
        adjudicate: allowAllAdjudicate,
        trigger: { kind: "crashRepair", evidenceKind: "crash" },
      }),
    ).rejects.toBeInstanceOf(FakeEngineNoResumeScriptError);

    // The journal itself is unaffected by the refused duplicate call: still
    // exactly the 2 dispatches (initial + the one real repair), never 3.
    expect(await countPriorDispatches(store, workUnitId)).toBe(2);

    await emitScenarioEvidence({
      journal: store,
      changeSetId: randomUUID(),
      workUnitId,
      command: "orchestration-matrix: idempotent-resume-duplicate-call-refused",
      exitStatus: 0,
    });
  });
});
