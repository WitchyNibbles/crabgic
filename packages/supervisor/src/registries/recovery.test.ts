import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import { recoverRun, RunRecoveryDataError } from "./recovery.js";
import { createRunsRegistry } from "./runs-registry.js";
import { createWorkersRegistry } from "./workers-registry.js";

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

describe("recoverRun — wired against @eo/journal's real recover(runId)", () => {
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
});
