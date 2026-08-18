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
  buildEvidenceRecord,
  buildWorkerResult,
  buildWorkUnit,
  FakeEngineAdapter,
  RATE_LIMIT_REJECTED,
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

/** What a scripted unit does: report one of the three terminal `WorkerResult` outcomes, or hit a rate limit. */
type ScriptedOutcome = "succeeded" | "failed" | "cancelled" | "limit";

/** A per-unit outcome map -> the injected seams `driveRun` needs. Records dispatch order and live-worker observations as it goes. */
function buildDeps(
  outcomeByUnit: ReadonlyMap<string, ScriptedOutcome>,
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
    // No-op by default: these tests are about the loop, not about the
    // baseline. The three arms that ARE about it override this.
    captureBaseline: () => Promise.resolve(),
    buildPacket: (ctx) => Promise.resolve(buildTaskPacket({ workUnitId: ctx.workUnit.id })),
    createAdapter: (ctx) => {
      observed.dispatchOrder.push(ctx.workUnit.id);
      const want = outcomeByUnit.get(ctx.workUnit.id) ?? "succeeded";
      const script =
        want === "limit"
          ? buildFakeEngineScript({
              failure: { kind: "limitSignal", payload: RATE_LIMIT_REJECTED },
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

/** Independent units, no edges — every one of them is ready in the first round. */
function independent(...ids: readonly string[]): readonly WorkUnit[] {
  return ids.map((id) =>
    buildWorkUnit({ id, changeSetId: CHANGE_SET_ID, dependsOn: [], attemptStatus: "pending" }),
  );
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
  /**
   * The same shape as the wedge below, seen from the scheduler: a re-drive of
   * an all-FAILED run has nothing left to dispatch, and must report that as
   * `failed` rather than as a completion. (Its blocked sibling is pinned
   * directly above; that one keeps a pending unit and so classifies
   * `blocked`.)
   */
  it("a futile re-drive of an all-failed single-unit run reports failed, dispatching nothing", async () => {
    const units = independent(A);
    const first = newObserved();
    const firstResult = await driveRun(
      { runId: RUN_ID, changeSetId: CHANGE_SET_ID, workUnits: units },
      buildDeps(new Map([[A, "failed"]]), first, new Map()),
    );
    expect(firstResult.stopped).toBe("failed");
    expect(first.dispatchOrder).toEqual([A]);

    const second = newObserved();
    const result = await driveRun(
      { runId: RUN_ID, changeSetId: CHANGE_SET_ID, workUnits: units },
      buildDeps(new Map(), second, new Map()),
    );
    // Journal-seeded `failed`, so nothing is re-selected — and the drive says
    // so honestly instead of reporting a completion that never happened.
    expect(result.stopped).toBe("failed");
    expect(result.statusById.get(A)).toBe("failed");
    expect(second.dispatchOrder).toEqual([]);
  });

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

/**
 * THE IDLE-RUN WEDGE, at its source. `classifyIdleRun` used to answer
 * `"completed"` for ANY all-terminal status set — it checked only for parked
 * and pending units, never whether the terminals were `succeeded`. So an
 * ordinary single-unit failure reported a completion, its one production
 * consumer (`packages/cli`'s dispatcher) mapped `completed` to "no run
 * transition — the verifying successor is not wired yet", and the run sat in
 * `running` with every unit terminal: un-finishable, its change set
 * un-dispatchable, and `resume` answering `accepted: true` to a re-drive that
 * could not dispatch anything. Only `run.cancel` escaped.
 *
 * The stop reason is the only place that knows the DAG's real shape, so it is
 * where the truth belongs: `completed` now means every unit SUCCEEDED, and a
 * set carrying a failure or a cancellation says so.
 */
describe("driveRun — an all-terminal DAG reports how it actually ended", () => {
  it("reports failed when its only unit failed, never completed", async () => {
    const observed = newObserved();
    const result = await driveRun(
      { runId: RUN_ID, changeSetId: CHANGE_SET_ID, workUnits: independent(A) },
      buildDeps(new Map([[A, "failed"]]), observed, new Map()),
    );

    expect(result.statusById.get(A)).toBe("failed");
    expect(result.stopped).toBe("failed");
  });

  /**
   * The blast radius beyond the single-unit case: independent units whose
   * failure strands no dependent still leave the DAG all-terminal, so the old
   * classification called a half-failed run complete.
   */
  it("reports failed for a mixed succeeded+failed set — a partial failure is not a completion", async () => {
    const observed = newObserved();
    const result = await driveRun(
      {
        runId: RUN_ID,
        changeSetId: CHANGE_SET_ID,
        workUnits: independent(A, B),
        concurrencyCap: 2,
      },
      buildDeps(new Map([[B, "failed"]]), observed, new Map()),
    );

    expect(result.statusById.get(A)).toBe("succeeded");
    expect(result.statusById.get(B)).toBe("failed");
    expect(result.stopped).toBe("failed");
  });

  /**
   * A unit `worker.terminate`d out from under a run (or one whose worker
   * self-reports `cancelled`) is terminal too. It gets its own stop reason
   * rather than being folded into `failed`, because the run-level transition
   * the dispatcher writes from it is an audit record: `running → cancelled`
   * is a legal edge and the honest one, and calling it a failure would
   * misattribute how the run ended.
   */
  it("reports cancelled when every terminal unit ended cancelled", async () => {
    const observed = newObserved();
    const result = await driveRun(
      { runId: RUN_ID, changeSetId: CHANGE_SET_ID, workUnits: independent(A) },
      buildDeps(new Map([[A, "cancelled"]]), observed, new Map()),
    );

    expect(result.statusById.get(A)).toBe("cancelled");
    expect(result.stopped).toBe("cancelled");
  });

  /** A failure anywhere outranks a cancellation: the run did not merely stop, some of its work broke. */
  it("reports failed when a cancelled unit sits beside a failed one", async () => {
    const observed = newObserved();
    const result = await driveRun(
      {
        runId: RUN_ID,
        changeSetId: CHANGE_SET_ID,
        workUnits: independent(A, B),
        concurrencyCap: 2,
      },
      buildDeps(
        new Map([
          [A, "cancelled" as const],
          [B, "failed" as const],
        ]),
        observed,
        new Map(),
      ),
    );

    expect(result.stopped).toBe("failed");
  });

  /**
   * The precedence the old classification already had, kept exactly: a parked
   * unit is retained and resumable, so a run holding one is `parked` even
   * when everything else failed; a pending-but-never-ready unit is `blocked`.
   * Neither is a dead end, and neither may be reclassified as one.
   */
  it("keeps parked ahead of failed — a retained, resumable unit is not a dead end", async () => {
    const observed = newObserved();
    const result = await driveRun(
      {
        runId: RUN_ID,
        changeSetId: CHANGE_SET_ID,
        workUnits: independent(A, B),
        concurrencyCap: 2,
      },
      buildDeps(
        new Map([
          [A, "limit" as const],
          [B, "failed" as const],
        ]),
        observed,
        new Map(),
      ),
    );

    expect(result.statusById.get(A)).toBe("parked:rate_limit");
    expect(result.stopped).toBe("parked");
  });

  /** And `completed` now MEANS all-succeeded — the guarantee the rest of the system reads it as. */
  it("still reports completed when — and only when — every unit succeeded", async () => {
    const observed = newObserved();
    const result = await driveRun(
      {
        runId: RUN_ID,
        changeSetId: CHANGE_SET_ID,
        workUnits: independent(A, B),
        concurrencyCap: 2,
      },
      buildDeps(new Map(), observed, new Map()),
    );

    expect([...result.statusById.values()]).toEqual(["succeeded", "succeeded"]);
    expect(result.stopped).toBe("completed");
  });
});

/**
 * ⚠️ THE PRE-DISPATCH BASELINE SEAM — owner decision 2026-08-18, "harness runs
 * it pre-dispatch".
 *
 * `@crabgic/gates`' `createTddGate` accepts a red baseline only if it was
 * journaled STRICTLY BEFORE the candidate attempt's own dispatch boundary — the
 * `work_unit_transition: dispatched` entry this loop writes. That ordering is
 * the whole anti-forgery property (`tdd-gate.ts`'s `beforeSeq` doc comment:
 * without it, the gate's own earlier failing verdict is indistinguishable in
 * the journal from a genuine baseline). So a seam that merely runs "somewhere
 * around" the dispatch is worthless; it has to run before that entry exists,
 * and these tests assert the SEQ relation rather than the call order.
 *
 * The seam is REQUIRED, not optional, for the same reason `resolveCriteriaSeal`
 * is: an optional one is satisfied by every caller that forgot it, and the
 * daemon is the caller that must not.
 */
describe("driveRun — pre-dispatch TDD baseline capture", () => {
  async function seqOf(
    predicate: (entry: { readonly type: string; readonly payload: unknown }) => boolean,
  ): Promise<number | undefined> {
    for await (const entry of journal.queryEntries({})) {
      if (predicate(entry)) return entry.seq;
    }
    return undefined;
  }

  it("journals the baseline STRICTLY BEFORE the attempt's dispatched transition", async () => {
    const observed: Observed = { dispatchOrder: [], cancelled: [] };
    const liveWorkers: LiveWorkerMap = new Map();
    const deps: RunDriverDependencies = {
      ...buildDeps(new Map(), observed, liveWorkers),
      captureBaseline: async (ctx) => {
        await journal.appendEntry({
          type: "evidence_pointer",
          changeSetId: CHANGE_SET_ID,
          workUnitId: ctx.workUnit.id,
          payload: buildEvidenceRecord({ changeSetId: CHANGE_SET_ID, workUnitId: ctx.workUnit.id }),
        });
      },
    };

    await driveRun(
      {
        runId: RUN_ID,
        changeSetId: CHANGE_SET_ID,
        workUnits: [buildWorkUnit({ id: A, changeSetId: CHANGE_SET_ID })],
      },
      deps,
    );

    const baselineSeq = await seqOf((entry) => entry.type === "evidence_pointer");
    const dispatchedSeq = await seqOf(
      (entry) =>
        entry.type === "work_unit_transition" &&
        (entry.payload as { status?: string }).status === "dispatched",
    );
    expect(baselineSeq, "no baseline entry was journaled at all").toBeDefined();
    expect(dispatchedSeq, "no dispatched transition was journaled at all").toBeDefined();
    expect(baselineSeq!).toBeLessThan(dispatchedSeq!);
  });

  /**
   * The seam receives the PACKET, not just the context. It has to: the packet
   * is what declares the gates this attempt owes and carries the frozen
   * `baseObjectId` the baseline is red against. A ctx-only seam would force the
   * implementation to re-derive both, and re-derivation is where the two copies
   * drift.
   */
  it("hands the seam the very packet that will be dispatched", async () => {
    const observed: Observed = { dispatchOrder: [], cancelled: [] };
    const liveWorkers: LiveWorkerMap = new Map();
    const seen: { workUnitId?: string; packetWorkUnitId?: string } = {};
    const deps: RunDriverDependencies = {
      ...buildDeps(new Map(), observed, liveWorkers),
      captureBaseline: (ctx, packet) => {
        seen.workUnitId = ctx.workUnit.id;
        seen.packetWorkUnitId = packet.workUnitId;
        return Promise.resolve();
      },
    };

    await driveRun(
      {
        runId: RUN_ID,
        changeSetId: CHANGE_SET_ID,
        workUnits: [buildWorkUnit({ id: A, changeSetId: CHANGE_SET_ID })],
      },
      deps,
    );

    expect(seen.workUnitId).toBe(A);
    expect(seen.packetWorkUnitId).toBe(A);
  });

  /**
   * ⚠️ Fail closed. A baseline capture that throws means the harness could not
   * establish what it is about to judge against, so the attempt must NOT be
   * dispatched — the alternative is a worker running with no evidence basis and
   * a gate that later has nothing to read. Asserting "no dispatched transition
   * exists" is what makes this stronger than asserting the run merely reported
   * a failure.
   */
  it("does NOT dispatch the attempt when baseline capture throws", async () => {
    const observed: Observed = { dispatchOrder: [], cancelled: [] };
    const liveWorkers: LiveWorkerMap = new Map();
    const deps: RunDriverDependencies = {
      ...buildDeps(new Map(), observed, liveWorkers),
      captureBaseline: () => Promise.reject(new Error("baseline capture failed")),
    };

    await expect(
      driveRun(
        {
          runId: RUN_ID,
          changeSetId: CHANGE_SET_ID,
          workUnits: [buildWorkUnit({ id: A, changeSetId: CHANGE_SET_ID })],
        },
        deps,
      ),
    ).rejects.toThrow(/baseline capture failed/);

    const dispatchedSeq = await seqOf(
      (entry) =>
        entry.type === "work_unit_transition" &&
        (entry.payload as { status?: string }).status === "dispatched",
    );
    expect(dispatchedSeq, "an attempt was dispatched despite the baseline failing").toBeUndefined();
  });
});
