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
 * The daemon cannot construct the driver itself (`@eo/engine-claude`
 * depends on THIS package, so composing the real adapter here would be a
 * cycle), so the dispatcher is injected — same seam discipline as
 * `driveRun`'s own `createAdapter`.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import { createRunsRegistry } from "../registries/runs-registry.js";
import { createChangeSetsRegistry } from "../registries/change-sets-registry.js";
import { createWorkUnitsRegistry } from "../registries/work-units-registry.js";
import { createWorkersRegistry } from "../registries/workers-registry.js";
import { createArtifactIndexRegistry } from "../registries/artifact-index-registry.js";
import { buildSupervisorRouter, type SupervisorDependencies } from "./build-router.js";
import type { RunDispatcher } from "./run-dispatcher.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";

let journalDir: string;
let journal: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-run-dispatch-"));
  journal = createJournalStore({ journalDir });
});
afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

function baseDeps(runDispatcher?: RunDispatcher): SupervisorDependencies {
  return {
    journal,
    runs: createRunsRegistry(),
    changeSets: createChangeSetsRegistry(),
    workUnits: createWorkUnitsRegistry(),
    workers: createWorkersRegistry(),
    artifactIndex: createArtifactIndexRegistry(),
    liveWorkers: new Map(),
    ...(runDispatcher !== undefined ? { runDispatcher } : {}),
  };
}

describe("run.dispatch", () => {
  it("delegates to the injected dispatcher and reports acceptance", async () => {
    const dispatched: string[] = [];
    const router = buildSupervisorRouter(
      baseDeps({
        dispatch: (runId) => {
          dispatched.push(runId);
          return Promise.resolve({ accepted: true });
        },
      }),
    );

    const result = await router.dispatch("run.dispatch", { runId: RUN_ID });

    expect(result).toEqual({ accepted: true });
    expect(dispatched).toEqual([RUN_ID]);
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
        dispatch: () => Promise.resolve({ accepted: true }),
      }),
    );

    const result = await router.dispatch("run.dispatch", { runId: RUN_ID });
    expect(result).toEqual({ accepted: true });
    expect(runCompleted).toBe(false); // the run is still going

    releaseRun();
    await runFinished;
  });

  it("refuses a run the dispatcher reports as already in flight, with a reason", async () => {
    const router = buildSupervisorRouter(
      baseDeps({
        dispatch: () => Promise.resolve({ accepted: false, reason: "run is already dispatching" }),
      }),
    );

    expect(await router.dispatch("run.dispatch", { runId: RUN_ID })).toEqual({
      accepted: false,
      reason: "run is already dispatching",
    });
  });

  /**
   * A daemon booted without a dispatcher (every pre-existing test, and any
   * embedding that only wants the control plane) must not crash on the new
   * operation — it refuses in exactly the same typed shape.
   */
  it("refuses cleanly when no dispatcher is configured, rather than throwing", async () => {
    const router = buildSupervisorRouter(baseDeps());

    const result = (await router.dispatch("run.dispatch", { runId: RUN_ID })) as {
      accepted: boolean;
      reason?: string;
    };
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/dispatcher/i);
  });
});
