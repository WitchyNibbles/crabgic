/**
 * The DAG run driver — roadmap/13-scheduler-packets-context.md §Goal: "the
 * DAG approved in 11 executes to completion without further human
 * intervention: a default-serial, evidence-gated dispatch loop turns each
 * ready WorkUnit into a bounded attempt via 06's EngineAdapter, fans out
 * only when independence is proven".
 *
 * Before this module, every piece of that sentence existed and was tested
 * in isolation (`computeReadyUnits`, `selectDispatchSet`, `dispatchAttempt`,
 * `parkWorkUnit`) but NOTHING composed them into a loop — `dispatchAttempt`
 * had no production caller at all, so an approved DAG could never actually
 * run. `driveRun` is that loop.
 *
 * Every engine-touching seam is injected (`createAdapter`, `buildPacket`,
 * `compileProfile`), so these tests drive real `dispatchAttempt` calls
 * against `FakeEngineAdapter` scripts and a real on-disk journal — never a
 * mocked executor.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@crabgic/journal";
import {
  buildFakeEngineScript,
  buildTaskPacket,
  buildWorkerResult,
  buildWorkUnit,
  FakeEngineAdapter,
  RATE_LIMIT_ALLOWED_WARNING_96,
} from "@crabgic/testkit";
import type { WorkUnit } from "@crabgic/contracts";
import type { EngineAdapter } from "@crabgic/engine-core";
import {
  allowAllAdjudicate,
  buildMinimalCompiledProfile,
} from "./test-support/minimal-compiled-profile.js";
import { parkWorkUnit } from "./parking.js";
import { driveRun, type RunDriverDependencies } from "./run-driver.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const RUN_ID = "44444444-4444-4444-8444-444444444444";
const CHANGE_SET_ID = "55555555-5555-4555-8555-555555555555";

let journalDir: string;
let journal: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-run-driver-"));
  journal = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

interface Observed {
  readonly dispatchOrder: string[];
  readonly cancelled: string[];
}

type LiveWorker = { terminate(graceMs: number): Promise<{ outcome: string }> };

/** A live-worker map that also records every registration, so a test can assert a worker WAS registered mid-attempt even though the map is (correctly) empty again by the time the run returns. */
class RecordingLiveWorkers extends Map<string, LiveWorker> {
  readonly registered: string[] = [];
  readonly handles: LiveWorker[] = [];

  override set(key: string, value: LiveWorker): this {
    this.registered.push(key);
    this.handles.push(value);
    return super.set(key, value);
  }
}

type LiveWorkerMap = Map<string, LiveWorker>;

/** A per-unit outcome map -> the injected seams `driveRun` needs. Records dispatch order and live-worker observations as it goes. */
function buildDeps(
  outcomeByUnit: ReadonlyMap<string, "succeeded" | "failed" | "limit">,
  observed: Observed,
  liveWorkers: LiveWorkerMap,
): RunDriverDependencies {
  return {
    journal,
    liveWorkers,
    adjudicate: allowAllAdjudicate,
    compileProfile: () => Promise.resolve(buildMinimalCompiledProfile()),
    // No requirements of its own, so nothing to verify — the correct default
    // for driver tests that are not about roadmap/24's seal.
    resolveCriteriaSeal: () => Promise.resolve({ requirements: [], approvalSeal: undefined }),
    buildPacket: (ctx) => Promise.resolve(buildTaskPacket({ workUnitId: ctx.workUnit.id })),
    createAdapter: (ctx) => {
      observed.dispatchOrder.push(ctx.workUnit.id);
      const want = outcomeByUnit.get(ctx.workUnit.id) ?? "succeeded";
      const script =
        want === "limit"
          ? buildFakeEngineScript({
              failure: { kind: "limitSignal", payload: RATE_LIMIT_ALLOWED_WARNING_96 },
            })
          : buildFakeEngineScript({ structuredOutput: buildWorkerResult({ outcome: want }) });

      // Instrumented at `cancel` so a test can prove the registered
      // terminate handle genuinely reaches the engine, rather than merely
      // existing as a callable.
      const adapter = new FakeEngineAdapter(script);
      return Promise.resolve(
        Object.assign(adapter, {
          cancel: (..._args: Parameters<EngineAdapter["cancel"]>) => {
            observed.cancelled.push(ctx.workUnit.id);
            return Promise.resolve();
          },
        }),
      );
    },
  };
}

function newObserved(): Observed {
  return { dispatchOrder: [], cancelled: [] };
}

function chain(): readonly WorkUnit[] {
  return [
    buildWorkUnit({ id: A, changeSetId: CHANGE_SET_ID, dependsOn: [], attemptStatus: "pending" }),
    buildWorkUnit({ id: B, changeSetId: CHANGE_SET_ID, dependsOn: [A], attemptStatus: "pending" }),
  ];
}

describe("driveRun — the DAG dispatch loop", () => {
  it("drives a dependency chain to completion in dependency order", async () => {
    const observed = newObserved();
    const result = await driveRun(
      { runId: RUN_ID, changeSetId: CHANGE_SET_ID, workUnits: chain() },
      buildDeps(new Map(), observed, new Map()),
    );

    expect(observed.dispatchOrder).toEqual([A, B]);
    expect(result.stopped).toBe("completed");
    expect(result.statusById.get(A)).toBe("succeeded");
    expect(result.statusById.get(B)).toBe("succeeded");
  });

  it("never dispatches a unit whose dependency failed, and reports the run as blocked", async () => {
    const observed = newObserved();
    const result = await driveRun(
      { runId: RUN_ID, changeSetId: CHANGE_SET_ID, workUnits: chain() },
      buildDeps(new Map([[A, "failed" as const]]), observed, new Map()),
    );

    expect(observed.dispatchOrder).toEqual([A]);
    expect(result.statusById.get(A)).toBe("failed");
    // B stays pending forever — its dependency never reached "succeeded".
    expect(result.statusById.get(B)).toBe("pending");
    expect(result.stopped).toBe("blocked");
  });

  it("fans out independent units within the concurrency cap, journaling the rationale", async () => {
    const observed = newObserved();
    const units = [
      buildWorkUnit({ id: A, changeSetId: CHANGE_SET_ID, dependsOn: [], attemptStatus: "pending" }),
      buildWorkUnit({ id: B, changeSetId: CHANGE_SET_ID, dependsOn: [], attemptStatus: "pending" }),
      buildWorkUnit({ id: C, changeSetId: CHANGE_SET_ID, dependsOn: [], attemptStatus: "pending" }),
    ];

    const result = await driveRun(
      { runId: RUN_ID, changeSetId: CHANGE_SET_ID, workUnits: units, concurrencyCap: 2 },
      buildDeps(new Map(), observed, new Map()),
    );

    expect(result.stopped).toBe("completed");
    expect(result.rounds).toBe(2); // 2 units, then the remaining 1
    expect(new Set(observed.dispatchOrder)).toEqual(new Set([A, B, C]));

    const rationales: unknown[] = [];
    for await (const entry of journal.queryEntries({ type: "fanout_rationale" }))
      rationales.push(entry);
    expect(rationales).toHaveLength(1); // only the 2-unit round fans out
  });

  it("registers a live, terminable worker for the duration of each attempt and retires it after", async () => {
    const observed = newObserved();
    const liveWorkers = new RecordingLiveWorkers();

    const result = await driveRun(
      { runId: RUN_ID, changeSetId: CHANGE_SET_ID, workUnits: chain() },
      buildDeps(new Map(), observed, liveWorkers),
    );

    expect(result.stopped).toBe("completed");
    // A live worker was registered for each attempt while it was running...
    expect(liveWorkers.registered).toEqual([A, B]);
    // ...and every one was retired once its attempt settled, so the control
    // plane never holds a handle to a worker that is already gone.
    expect(liveWorkers.size).toBe(0);
  });

  it("registers a handle whose terminate() actually cancels the running engine worker", async () => {
    const observed = newObserved();
    const liveWorkers = new RecordingLiveWorkers();

    await driveRun(
      { runId: RUN_ID, changeSetId: CHANGE_SET_ID, workUnits: chain() },
      buildDeps(new Map(), observed, liveWorkers),
    );

    // The handle registered for A is not a stub: driving it reaches the
    // engine adapter's own cancel, which is what 05's `worker.terminate`
    // operation ultimately needs in order to stop a live worker.
    const handleForA = liveWorkers.handles[0];
    expect(handleForA).toBeDefined();
    await expect(handleForA?.terminate(5_000)).resolves.toEqual({ outcome: "terminated" });
    expect(observed.cancelled).toEqual([A]);
  });

  it("parks a rate-limited unit and reports the run parked, without failing it or blocking independent units", async () => {
    const observed = newObserved();
    const units = [
      buildWorkUnit({ id: A, changeSetId: CHANGE_SET_ID, dependsOn: [], attemptStatus: "pending" }),
      buildWorkUnit({ id: B, changeSetId: CHANGE_SET_ID, dependsOn: [], attemptStatus: "pending" }),
    ];

    const result = await driveRun(
      { runId: RUN_ID, changeSetId: CHANGE_SET_ID, workUnits: units, concurrencyCap: 1 },
      buildDeps(new Map([[A, "limit" as const]]), observed, new Map()),
    );

    // A parked (retained, resumable) — never recorded as a failure.
    expect(result.statusById.get(A)).toBe("parked:rate_limit");
    // A unit-scoped limit is NOT account-wide, so B still got its turn.
    expect(result.statusById.get(B)).toBe("succeeded");
    expect(observed.dispatchOrder).toEqual([A, B]);
    // The run as a whole is parked, not "completed" — a parked unit is not
    // a terminal status and the run is resumable once the window resets.
    expect(result.stopped).toBe("parked");
  });

  it("resumes a parked-ready unit via the resume seam and completes, instead of sitting parked", async () => {
    const SESSION = "77777777-7777-4777-8777-777777777777";
    // Park A in THIS run with a reset window already in the past.
    await parkWorkUnit({
      journal,
      workUnitId: A,
      sessionId: SESSION,
      resetsAt: 500,
      runId: RUN_ID,
    });

    const observed = newObserved();
    const resumed: { readonly unitId: string; readonly sessionId: string }[] = [];
    const deps: RunDriverDependencies = {
      ...buildDeps(new Map(), observed, new Map()),
      nowSeconds: () => 1000, // past the park's resetsAt → readyToResume
      resumeParkedUnit: (ctx, sessionId) => {
        resumed.push({ unitId: ctx.workUnit.id, sessionId });
        return Promise.resolve({
          kind: "succeeded",
          sessionId,
          result: buildWorkerResult({ outcome: "succeeded" }),
        });
      },
    };

    const result = await driveRun(
      {
        runId: RUN_ID,
        changeSetId: CHANGE_SET_ID,
        workUnits: [
          buildWorkUnit({
            id: A,
            changeSetId: CHANGE_SET_ID,
            dependsOn: [],
            attemptStatus: "pending",
          }),
        ],
      },
      deps,
    );

    // The parked-ready unit was RESUMED (its retained session id), never
    // freshly dispatched, and the run then completes.
    expect(resumed).toEqual([{ unitId: A, sessionId: SESSION }]);
    expect(observed.dispatchOrder).toEqual([]);
    expect(result.statusById.get(A)).toBe("succeeded");
    expect(result.stopped).toBe("completed");
  });

  it("completes a chain where each unit parks on dispatch then resumes — no false roundLimit", async () => {
    // A→B chain: A parks on dispatch, resumes → succeeds → B becomes ready, B
    // parks on dispatch, resumes → succeeds. That is FOUR rounds (dispatch A,
    // resume A, dispatch B, resume B) — one more than the old `length + 1`
    // backstop allowed, which would have tripped a false `roundLimit`.
    const observed = newObserved();
    const resumedOrder: string[] = [];
    const deps: RunDriverDependencies = {
      // Both units hit a rate limit on their first dispatch.
      ...buildDeps(
        new Map([
          [A, "limit" as const],
          [B, "limit" as const],
        ]),
        observed,
        new Map(),
      ),
      // Past the fixture park's resetsAt (1784135400) → ready to resume.
      nowSeconds: () => 2_000_000_000,
      resumeParkedUnit: (ctx, sessionId) => {
        resumedOrder.push(ctx.workUnit.id);
        return Promise.resolve({
          kind: "succeeded",
          sessionId,
          result: buildWorkerResult({ outcome: "succeeded" }),
        });
      },
    };

    const result = await driveRun(
      { runId: RUN_ID, changeSetId: CHANGE_SET_ID, workUnits: chain(), concurrencyCap: 1 },
      deps,
    );

    expect(result.stopped).toBe("completed");
    expect(result.statusById.get(A)).toBe("succeeded");
    expect(result.statusById.get(B)).toBe("succeeded");
    // Each was dispatched (parking) then resumed, A's chain fully before B's.
    expect(observed.dispatchOrder).toEqual([A, B]);
    expect(resumedOrder).toEqual([A, B]);
    // Four rounds — would have been a false roundLimit under the old N+1 cap.
    expect(result.rounds).toBe(4);
  });

  it("leaves a parked unit whose reset window has NOT passed parked, never resuming it", async () => {
    const SESSION = "77777777-7777-4777-8777-777777777777";
    // Reset window is in the FUTURE relative to nowSeconds → not ready.
    await parkWorkUnit({
      journal,
      workUnitId: A,
      sessionId: SESSION,
      resetsAt: 5000,
      runId: RUN_ID,
    });

    const observed = newObserved();
    const resumed: string[] = [];
    const deps: RunDriverDependencies = {
      ...buildDeps(new Map(), observed, new Map()),
      nowSeconds: () => 1000, // BEFORE resetsAt
      resumeParkedUnit: (ctx) => {
        resumed.push(ctx.workUnit.id);
        return Promise.resolve({
          kind: "succeeded",
          sessionId: SESSION,
          result: buildWorkerResult({ outcome: "succeeded" }),
        });
      },
    };

    const result = await driveRun(
      {
        runId: RUN_ID,
        changeSetId: CHANGE_SET_ID,
        workUnits: [
          buildWorkUnit({
            id: A,
            changeSetId: CHANGE_SET_ID,
            dependsOn: [],
            attemptStatus: "pending",
          }),
        ],
      },
      deps,
    );

    expect(resumed).toEqual([]); // reset window not passed → not resumed
    expect(result.statusById.get(A)).toBe("parked:rate_limit");
    expect(result.stopped).toBe("parked");
  });

  it("leaves a parked-ready unit parked when the seam declines (undefined) — the daemon-restart case", async () => {
    const SESSION = "77777777-7777-4777-8777-777777777777";
    await parkWorkUnit({
      journal,
      workUnitId: A,
      sessionId: SESSION,
      resetsAt: 500,
      runId: RUN_ID,
    });
    const observed = newObserved();
    const result = await driveRun(
      {
        runId: RUN_ID,
        changeSetId: CHANGE_SET_ID,
        workUnits: [
          buildWorkUnit({
            id: A,
            changeSetId: CHANGE_SET_ID,
            dependsOn: [],
            attemptStatus: "pending",
          }),
        ],
      },
      {
        ...buildDeps(new Map(), observed, new Map()),
        nowSeconds: () => 1000,
        // The dispatcher has no retained adapter for this unit (restart) →
        // declines rather than resume into a read-only session.
        resumeParkedUnit: () => Promise.resolve(undefined),
      },
    );
    expect(result.statusById.get(A)).toBe("parked:rate_limit");
    expect(result.stopped).toBe("parked");
  });

  it("without a resume seam, a parked-ready unit stays parked (pre-feature behaviour unchanged)", async () => {
    const SESSION = "77777777-7777-4777-8777-777777777777";
    await parkWorkUnit({
      journal,
      workUnitId: A,
      sessionId: SESSION,
      resetsAt: 500,
      runId: RUN_ID,
    });
    const observed = newObserved();
    const result = await driveRun(
      {
        runId: RUN_ID,
        changeSetId: CHANGE_SET_ID,
        workUnits: [
          buildWorkUnit({
            id: A,
            changeSetId: CHANGE_SET_ID,
            dependsOn: [],
            attemptStatus: "pending",
          }),
        ],
      },
      { ...buildDeps(new Map(), observed, new Map()), nowSeconds: () => 1000 }, // no resumeParkedUnit
    );
    expect(result.statusById.get(A)).toBe("parked:rate_limit");
    expect(result.stopped).toBe("parked");
  });

  it("stops gracefully when an account-wide pause is already in force, dispatching nothing", async () => {
    // Established the way `executor.test.ts` does — via parkWorkUnit's own
    // accountWide flag on an unrelated unit, never by inventing an
    // unobserved engine payload (docs/engine-baseline.md §8 records the
    // "rejected" status as UNRESOLVED).
    await parkWorkUnit({
      journal,
      workUnitId: "99999999-9999-4999-8999-999999999999",
      sessionId: "88888888-8888-4888-8888-888888888888",
      resetsAt: Number.MAX_SAFE_INTEGER,
      accountWide: true,
    });

    const observed = newObserved();
    const result = await driveRun(
      { runId: RUN_ID, changeSetId: CHANGE_SET_ID, workUnits: chain() },
      buildDeps(new Map(), observed, new Map()),
    );

    // The executor's own global-pause gate refuses the dispatch; the driver
    // must surface that as a resumable park, not crash the whole daemon.
    expect(result.stopped).toBe("parked");
    expect(observed.dispatchOrder).toEqual([]);
    expect(result.statusById.get(A)).toBe("pending");
  });
});

describe("driveRun — re-drive/resume seeds status from the journal (supersedes the removed attempt cache)", () => {
  /**
   * The measured gap this closes: nothing updates a stored WorkUnit's
   * `attemptStatus` after intake, so `resume` (crash recovery, limit-park
   * re-dispatch) re-seeded every unit `pending` and a second drive re-executed
   * units that already SUCCEEDED — real engine spend and a fresh worktree for
   * work whose result already exists, and (once a dispatch was journaled) a
   * CRASH at the repair-evidence gate. `driveRun` now seeds each unit's status
   * from the DURABLE journal, so a re-drive sees the units that already
   * succeeded, does not re-select them, and completes cleanly with no second
   * dispatch — restart-safe, and without the in-memory cache this replaced.
   */
  it("a re-drive of a succeeded DAG re-executes nothing and does not crash (journal-seeded)", async () => {
    const first = newObserved();
    const firstResult = await driveRun(
      { runId: RUN_ID, changeSetId: CHANGE_SET_ID, workUnits: chain() },
      buildDeps(new Map(), first, new Map()),
    );
    expect(firstResult.stopped).toBe("completed");
    expect(first.dispatchOrder).toEqual([A, B]);

    const second = newObserved();
    const secondResult = await driveRun(
      { runId: RUN_ID, changeSetId: CHANGE_SET_ID, workUnits: chain() },
      buildDeps(new Map(), second, new Map()),
    );
    expect(secondResult.stopped).toBe("completed");
    expect(secondResult.statusById.get(A)).toBe("succeeded");
    expect(secondResult.statusById.get(B)).toBe("succeeded");
    // Nothing re-dispatched, and crucially no throw.
    expect(second.dispatchOrder).toEqual([]);
  });

  /**
   * A re-drive of a DAG whose first unit FAILED does not crash either: the
   * failed unit is seeded `failed`, so it is not re-selected (repair is 13's
   * deliberate evidence-gated path), and its dependent stays blocked. The
   * run classifies `blocked`, never throwing at the repair gate.
   */
  it("a re-drive of a failed DAG classifies blocked without crashing", async () => {
    const first = newObserved();
    await driveRun(
      { runId: RUN_ID, changeSetId: CHANGE_SET_ID, workUnits: chain() },
      buildDeps(new Map([[A, "failed"]]), first, new Map()),
    );
    expect(first.dispatchOrder).toEqual([A]);

    const second = newObserved();
    const result = await driveRun(
      { runId: RUN_ID, changeSetId: CHANGE_SET_ID, workUnits: chain() },
      buildDeps(new Map(), second, new Map()),
    );
    expect(result.stopped).toBe("blocked");
    expect(result.statusById.get(A)).toBe("failed");
    expect(second.dispatchOrder).toEqual([]);
  });

  /**
   * A retry as a genuinely NEW run over the same units runs to completion —
   * it neither inherits the prior run's outcomes (seed is run-scoped) nor its
   * exhausted repair budget (`countPriorDispatches` is run-scoped too). Both
   * halves of the cross-run isolation are now in place: the prior run drove
   * both units to completion; a fresh runId re-dispatches both from scratch.
   */
  it("a different run over the same units re-dispatches to completion — no cross-run inheritance", async () => {
    const OTHER_RUN = "99999999-9999-4999-8999-999999999999";
    const first = newObserved();
    await driveRun(
      { runId: RUN_ID, changeSetId: CHANGE_SET_ID, workUnits: chain() },
      buildDeps(new Map(), first, new Map()),
    );
    expect(first.dispatchOrder).toEqual([A, B]);

    const second = newObserved();
    const result = await driveRun(
      { runId: OTHER_RUN, changeSetId: CHANGE_SET_ID, workUnits: chain() },
      buildDeps(new Map(), second, new Map()),
    );
    expect(result.stopped).toBe("completed");
    // Genuinely re-ran both units under its own runId — not skipped as
    // "already succeeded", not refused at the repair gate.
    expect(second.dispatchOrder).toEqual([A, B]);
  });
});
