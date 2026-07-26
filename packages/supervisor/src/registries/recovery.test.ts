import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@crabgic/journal";
import {
  buildFakeEngineScript,
  buildTaskPacket,
  buildWorkerResult,
  FakeEngineAdapter,
} from "@crabgic/testkit";
import { recoverRun, RunRecoveryDataError } from "./recovery.js";
import { createRunsRegistry } from "./runs-registry.js";
import { createWorkersRegistry } from "./workers-registry.js";
import { spawnManagedWorker } from "../worker-lifecycle/worker-lifecycle-manager.js";
import {
  allowAllAdjudicate,
  buildMinimalCompiledProfile,
} from "../worker-lifecycle/test-support/minimal-compiled-profile.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const CHANGE_SET_ID = "22222222-2222-4222-8222-222222222222";
const WORK_UNIT_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-supervisor-recovery-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

describe("recoverRun — wired against @crabgic/journal's real recover(runId)", () => {
  it("rebuilds RunsRegistry state from replayed run_transition entries", async () => {
    await store.appendEntry({
      type: "run_transition",
      runId: RUN_ID,
      changeSetId: CHANGE_SET_ID,
      payload: { from: "draft", to: "awaiting_approval" },
    });
    await store.appendEntry({
      type: "run_transition",
      runId: RUN_ID,
      changeSetId: CHANGE_SET_ID,
      payload: { from: "awaiting_approval", to: "ready" },
    });

    const runs = createRunsRegistry();
    const workers = createWorkersRegistry();
    const result = await recoverRun(RUN_ID, { journal: store, runs, workers });

    expect(result.replayed).toHaveLength(2);
    expect(runs.get(RUN_ID)).toMatchObject({
      runId: RUN_ID,
      changeSetId: CHANGE_SET_ID,
      runState: "ready",
    });
  });

  it("marks a worker still non-terminal after replay as crashed — the orphan-reaper hand-off", async () => {
    await store.appendEntry({
      type: "session_assignment",
      runId: RUN_ID,
      workUnitId: WORK_UNIT_ID,
      payload: { sessionId: SESSION_ID },
    });

    const runs = createRunsRegistry();
    const workers = createWorkersRegistry();
    workers.upsert({
      workerId: "worker-1",
      workUnitId: WORK_UNIT_ID,
      sessionId: SESSION_ID,
      status: "running",
      startedAt: "2026-07-18T00:00:00.000Z",
    });

    await recoverRun(RUN_ID, { journal: store, runs, workers });

    expect(workers.get("worker-1")?.status).toBe("crashed");
    expect(workers.get("worker-1")?.terminatedAt).toBeDefined();
  });

  it("reconstructs an orphaned worker from a bare journal replay, with NO pre-existing WorkersRegistry entry — the genuine-restart case", async () => {
    await store.appendEntry({
      type: "session_assignment",
      runId: RUN_ID,
      workUnitId: WORK_UNIT_ID,
      payload: { sessionId: SESSION_ID },
    });
    await store.appendEntry({
      type: "work_unit_transition",
      runId: RUN_ID,
      workUnitId: WORK_UNIT_ID,
      payload: { status: "dispatched", sessionId: SESSION_ID },
    });
    // No terminal (succeeded/failed/cancelled) work_unit_transition ever
    // follows — the process crashed mid-flight, exactly as if this were a
    // brand-new supervisor process with an empty in-memory WorkersRegistry.

    const runs = createRunsRegistry();
    const workers = createWorkersRegistry(); // deliberately empty — no upsert() before recovery
    await recoverRun(RUN_ID, { journal: store, runs, workers });

    const reconstructed = workers.query((w) => w.sessionId === SESSION_ID)[0];
    expect(reconstructed).toBeDefined();
    expect(reconstructed?.status).toBe("crashed");
    expect(reconstructed?.workUnitId).toBe(WORK_UNIT_ID);
  });

  it("does NOT mark a session as orphaned once its latest replayed status is terminal", async () => {
    await store.appendEntry({
      type: "session_assignment",
      runId: RUN_ID,
      workUnitId: WORK_UNIT_ID,
      payload: { sessionId: SESSION_ID },
    });
    await store.appendEntry({
      type: "work_unit_transition",
      runId: RUN_ID,
      workUnitId: WORK_UNIT_ID,
      payload: { status: "dispatched", sessionId: SESSION_ID },
    });
    await store.appendEntry({
      type: "work_unit_transition",
      runId: RUN_ID,
      workUnitId: WORK_UNIT_ID,
      payload: { status: "succeeded", sessionId: SESSION_ID, previousStatus: "dispatched" },
    });

    const runs = createRunsRegistry();
    const workers = createWorkersRegistry();
    await recoverRun(RUN_ID, { journal: store, runs, workers });

    expect(workers.query((w) => w.sessionId === SESSION_ID)).toEqual([]);
  });

  it("is idempotent: calling recoverRun twice converges to the same registry state, no duplicated side effect", async () => {
    await store.appendEntry({
      type: "run_transition",
      runId: RUN_ID,
      changeSetId: CHANGE_SET_ID,
      payload: { from: "draft", to: "awaiting_approval" },
    });

    const runs = createRunsRegistry();
    const workers = createWorkersRegistry();
    await recoverRun(RUN_ID, { journal: store, runs, workers });
    const firstState = runs.get(RUN_ID);
    await recoverRun(RUN_ID, { journal: store, runs, workers });
    const secondState = runs.get(RUN_ID);

    expect(secondState).toEqual(firstState);
  });

  it("throws RunRecoveryDataError for a run_transition with no changeSetId and no prior RunRecord", async () => {
    // Deliberately bypass the envelope's own optional changeSetId to
    // simulate a corrupted/incomplete journal.
    await store.appendEntry({
      type: "run_transition",
      runId: RUN_ID,
      payload: { from: "draft", to: "awaiting_approval" },
    });

    const runs = createRunsRegistry();
    const workers = createWorkersRegistry();
    await expect(recoverRun(RUN_ID, { journal: store, runs, workers })).rejects.toBeInstanceOf(
      RunRecoveryDataError,
    );
  });

  it("returns empty replayed[] for a run with no journal entries at all — no throw", async () => {
    const runs = createRunsRegistry();
    const workers = createWorkersRegistry();
    const result = await recoverRun("no-such-run-in-journal", { journal: store, runs, workers });
    expect(result.replayed).toEqual([]);
    expect(runs.get("no-such-run-in-journal")).toBeUndefined();
  });

  describe("CRASH-RECOVERY CORRECTNESS FIX: a genuinely SUCCEEDED worker dispatched via the REAL production recordAttempt path (spawnManagedWorker, not a hand-crafted fixture) recovers as succeeded, not crashed", () => {
    it("reports SUCCEEDED (never crashed) for a worker that cleanly succeeded before a simulated supervisor restart", async () => {
      const runId = randomUUID();
      const workUnitId = randomUUID();
      const sessionId = randomUUID();

      const script = buildFakeEngineScript({
        sessionId,
        structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
      });
      const adapter = new FakeEngineAdapter(script);
      const workers = createWorkersRegistry();

      // The REAL production path: @crabgic/supervisor's own worker-lifecycle
      // manager, exactly as the live supervisor daemon drives it — NOT a
      // hand-crafted `store.appendEntry` fixture (which is what every
      // other test in this file uses, and which is why they never caught
      // this defect: hand-set entries always set `runId` directly,
      // bypassing @crabgic/journal's `recordAttempt` entirely).
      const managed = await spawnManagedWorker({
        adapter,
        journal: store,
        workers,
        packet: buildTaskPacket({ workUnitId }),
        profile: buildMinimalCompiledProfile(),
        adjudicate: allowAllAdjudicate,
        runId,
      });
      const outcome = await managed.settled;
      expect(outcome).toBe("succeeded");
      expect(workers.get(managed.workerId)?.status).toBe("terminated");

      // Simulated FULL supervisor restart: a brand-new JournalStore
      // instance over the SAME on-disk directory, plus brand-new, EMPTY
      // in-memory RunsRegistry/WorkersRegistry — zero in-memory state
      // carried over, exactly what a real process restart looks like.
      const freshStore = createJournalStore({ journalDir });
      const freshRuns = createRunsRegistry();
      const freshWorkers = createWorkersRegistry();
      await recoverRun(runId, { journal: freshStore, runs: freshRuns, workers: freshWorkers });

      const recovered = freshWorkers.query((w) => w.sessionId === sessionId)[0];
      // THE FIX, made concrete: before it, this worker — which genuinely
      // succeeded — was reconstructed as "crashed" (or not reconstructed
      // as a worker record found by sessionId with the right status at
      // all), because `recover(runId)`'s runId-scoped replay could never
      // see the runId-less work_unit_transition entries recordAttempt used
      // to write. After the fix, no orphan is synthesized for this session
      // at all (its terminal status IS visible), so `recovered` is
      // `undefined` — not `"crashed"`.
      expect(recovered).toBeUndefined();
    });
  });
});
