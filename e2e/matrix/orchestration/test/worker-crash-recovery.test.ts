import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getLatestAttempt, type JournalStore } from "@crabgic/journal";
import type { SessionRef } from "@crabgic/engine-core";
import {
  buildFakeEngineScript,
  buildTaskPacket,
  buildWorkerResult,
  FakeEngineAdapter,
} from "@crabgic/testkit";
import { countPriorDispatches, dispatchAttempt, resumeAttempt } from "@crabgic/scheduler";
import { allowAllAdjudicate, buildMinimalCompiledProfile } from "../src/compiledProfile.js";
import { emitScenarioEvidence } from "../src/evidence.js";
import { createTestJournal, type TestJournal } from "../src/testJournal.js";

/**
 * Scenario 5/8 — roadmap/23-release-hardening.md work item 4: "worker crash
 * -> journaled attempt -> recovery." Drives the REAL `@crabgic/scheduler`
 * executor's crash-detection path (`dispatchAttempt` returning
 * `kind: "crashed"` when the fake engine's stream ends with no terminal
 * event) followed by a genuine repair via `resumeAttempt`'s
 * `trigger: {kind: "crashRepair"}` — the SAME session, resumed, not a fresh
 * dispatch, matching "same recovery machinery" (roadmap/13).
 */
describe("Orchestration matrix: worker crash -> journaled attempt -> recovery", () => {
  let journal: TestJournal;
  let store: JournalStore;

  beforeEach(async () => {
    journal = await createTestJournal();
    store = journal.store;
  });

  afterEach(async () => {
    await journal.cleanup();
  });

  it("a mid-attempt crash is journaled as a failed attempt, and a repair resumes the SAME session to success", async () => {
    const workUnitId = randomUUID();
    const sessionId = randomUUID();

    const repairScript = buildFakeEngineScript({
      sessionId,
      structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
    });
    const crashScript = buildFakeEngineScript({
      sessionId,
      toolCalls: [{ toolName: "Bash", toolInput: { command: "echo pre-crash-work" } }],
      failure: { kind: "crash", atStepIndex: 1 },
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
    expect(crashOutcome).toMatchObject({ kind: "crashed", evidenceKind: "crash" });
    // dispatchAttempt's own crash path journals a terminal "failed" transition
    // (never leaves a dangling "dispatched" with no resolution) — the exact
    // seam a repair's evidence check reads back.
    expect((await getLatestAttempt(store, workUnitId))?.status).toBe("failed");
    expect(await countPriorDispatches(store, workUnitId)).toBe(1);

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
    expect(repairOutcome).toMatchObject({ kind: "succeeded", sessionId });
    expect((await getLatestAttempt(store, workUnitId))?.status).toBe("succeeded");
    expect(await countPriorDispatches(store, workUnitId)).toBe(2);

    await emitScenarioEvidence({
      journal: store,
      changeSetId: randomUUID(),
      workUnitId,
      command: "orchestration-matrix: worker-crash-journaled-attempt-recovery",
      exitStatus: 0,
    });
  });
});
