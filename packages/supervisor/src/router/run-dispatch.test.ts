/**
 * `run.dispatch` — the UDS operation that makes an approved DAG actually
 * execute.
 *
 * Until this existed, `driveRun` (13's dispatch loop) had ZERO production
 * callers: `run` performed intake only — approve the envelope, persist the
 * ChangeSet and WorkUnits — and then nothing ever dispatched them. The
 * driver runs HERE, in the daemon, rather than in the CLI process, because
 * `driveRun` registers each in-flight attempt into `liveWorkers`, which is
 * the exact map this router's own `worker.terminate` reads. A CLI-side
 * driver would leave `worker.terminate` unable to reach the workers of a
 * run started by a different, already-exited process — and roadmap/05 owns
 * worker lifecycle regardless.
 *
 * The daemon cannot construct the driver itself (`@crabgic/engine-claude`
 * depends on THIS package, so composing the real adapter here would be a
 * cycle), so the dispatcher is injected — same seam discipline as
 * `driveRun`'s own `createAdapter`.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@crabgic/journal";
import { createRunsRegistry } from "../registries/runs-registry.js";
import { createChangeSetsRegistry } from "../registries/change-sets-registry.js";
import { createWorkUnitsRegistry } from "../registries/work-units-registry.js";
import { createWorkersRegistry } from "../registries/workers-registry.js";
import { createArtifactIndexRegistry } from "../registries/artifact-index-registry.js";
import { buildSupervisorRouter, type SupervisorDependencies } from "./build-router.js";
import { DISPATCHER_DRAINING_REASON, type RunDispatcher } from "./run-dispatcher.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const CHANGE_SET_ID = "99999999-9999-4999-8999-999999999999";

let journalDir: string;
let journal: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-run-dispatch-"));
  journal = createJournalStore({ journalDir });
});
afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

/**
 * Takes a PARTIAL dispatcher and fills the rest in: these cases are about the
 * router's own delegation, not about any one method, so a case exercising
 * `run.dispatch` should not have to restate `resume` and `drain` to compile.
 */
function baseDeps(runDispatcher?: Partial<RunDispatcher>): SupervisorDependencies {
  return {
    journal,
    runs: createRunsRegistry(),
    changeSets: createChangeSetsRegistry(),
    workUnits: createWorkUnitsRegistry(),
    workers: createWorkersRegistry(),
    artifactIndex: createArtifactIndexRegistry(),
    liveWorkers: new Map(),
    ...(runDispatcher !== undefined
      ? {
          runDispatcher: {
            dispatch: () => Promise.resolve({ accepted: false, reason: "not under test" }),
            resume: () => Promise.resolve({ accepted: false, reason: "not under test" }),
            drain: () =>
              Promise.resolve({ settledRunIds: [], cancelledRunIds: [], unsettledRunIds: [] }),
            ...runDispatcher,
          },
        }
      : {}),
  };
}

describe("run.dispatch", () => {
  it("delegates to the injected dispatcher and reports acceptance", async () => {
    const dispatched: string[] = [];
    const router = buildSupervisorRouter(
      baseDeps({
        dispatch: (changeSetId) => {
          dispatched.push(changeSetId);
          return Promise.resolve({ accepted: true, runId: RUN_ID });
        },
        resume: () => Promise.resolve({ accepted: true }),
      }),
    );

    const result = await router.dispatch("run.dispatch", { changeSetId: CHANGE_SET_ID });

    // The runId is an OUTPUT: dispatch is where a run comes into existence,
    // so the caller cannot have supplied one (ledger Gap 18).
    expect(result).toEqual({ accepted: true, runId: RUN_ID });
    expect(dispatched).toEqual([CHANGE_SET_ID]);
  });

  /**
   * The whole point of dispatching over UDS rather than driving in the CLI:
   * a run can take minutes or hours. If the operation awaited completion it
   * would hold the control socket open for the entire run, so `status` and
   * `cancel` — the two things an operator reaches for DURING a long run —
   * would be unanswerable.
   */
  it("returns without waiting for the run to finish", async () => {
    let releaseRun: () => void = () => undefined;
    const runFinished = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    let runCompleted = false;
    void runFinished.then(() => {
      runCompleted = true;
    });

    const router = buildSupervisorRouter(
      baseDeps({
        // Models a real driver: kicks the (still-unfinished) run off in the
        // background and resolves its own promise immediately.
        dispatch: () => Promise.resolve({ accepted: true, runId: RUN_ID }),
        resume: () => Promise.resolve({ accepted: true }),
      }),
    );

    const result = await router.dispatch("run.dispatch", { changeSetId: CHANGE_SET_ID });
    expect(result).toEqual({ accepted: true, runId: RUN_ID });
    expect(runCompleted).toBe(false); // the run is still going

    releaseRun();
    await runFinished;
  });

  it("refuses a run the dispatcher reports as already in flight, with a reason", async () => {
    const router = buildSupervisorRouter(
      baseDeps({
        dispatch: () => Promise.resolve({ accepted: false, reason: "run is already dispatching" }),
        resume: () => Promise.resolve({ accepted: true }),
      }),
    );

    expect(await router.dispatch("run.dispatch", { changeSetId: CHANGE_SET_ID })).toEqual({
      accepted: false,
      reason: "run is already dispatching",
    });
  });

  /**
   * A draining daemon's refusal has to survive the wire, not just the call.
   * `RunDispatchResultSchema` is `.strict()` with `reason:
   * NonEmptyStringSchema.optional()`, so the shared constant reaching the
   * operator intact — rather than tripping result validation on the way out
   * during the one window where the daemon most needs to explain itself — is
   * a property worth pinning at this layer.
   */
  it("passes the draining refusal through to the caller unchanged, on both operations", async () => {
    const draining = {
      dispatch: () => Promise.resolve({ accepted: false, reason: DISPATCHER_DRAINING_REASON }),
      resume: () => Promise.resolve({ accepted: false, reason: DISPATCHER_DRAINING_REASON }),
    };

    expect(
      await buildSupervisorRouter(baseDeps(draining)).dispatch("run.dispatch", {
        changeSetId: CHANGE_SET_ID,
      }),
    ).toEqual({ accepted: false, reason: DISPATCHER_DRAINING_REASON });
    expect(
      await buildSupervisorRouter(baseDeps(draining)).dispatch("run.resume", { runId: RUN_ID }),
    ).toEqual({ accepted: false, reason: DISPATCHER_DRAINING_REASON });
  });

  /**
   * A daemon booted without a dispatcher (every pre-existing test, and any
   * embedding that only wants the control plane) must not crash on the new
   * operation — it refuses in exactly the same typed shape.
   */
  it("refuses cleanly when no dispatcher is configured, rather than throwing", async () => {
    const router = buildSupervisorRouter(baseDeps());

    const result = (await router.dispatch("run.dispatch", { changeSetId: CHANGE_SET_ID })) as {
      accepted: boolean;
      reason?: string;
    };
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/dispatcher/i);
  });
});

/**
 * `run.resume` was split out of `run.dispatch` on 2026-07-28. They used to be
 * one operation keyed on a runId, which is why the case that actually
 * mattered — starting an approved change set — had no reachable form at all:
 * every caller needed an id that nothing in the system ever minted.
 */
describe("run.resume", () => {
  it("re-drives an existing run without minting a new id", async () => {
    const resumed: string[] = [];
    const router = buildSupervisorRouter(
      baseDeps({
        dispatch: () => Promise.resolve({ accepted: true, runId: RUN_ID }),
        resume: (runId) => {
          resumed.push(runId);
          return Promise.resolve({ accepted: true });
        },
      }),
    );

    expect(await router.dispatch("run.resume", { runId: RUN_ID })).toEqual({ accepted: true });
    expect(resumed).toEqual([RUN_ID]);
  });

  it("refuses cleanly when no dispatcher is configured", async () => {
    const router = buildSupervisorRouter(baseDeps());

    const result = (await router.dispatch("run.resume", { runId: RUN_ID })) as {
      accepted: boolean;
      reason?: string;
    };
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/dispatcher/i);
  });

  /** A resume never returns a runId — it did not create one. Pins the two shapes apart. */
  it("never reports a runId, even on success", async () => {
    const router = buildSupervisorRouter(
      baseDeps({
        dispatch: () => Promise.resolve({ accepted: true, runId: RUN_ID }),
        resume: () => Promise.resolve({ accepted: true, runId: RUN_ID }),
      }),
    );

    expect(await router.dispatch("run.resume", { runId: RUN_ID })).toEqual({ accepted: true });
  });
});
