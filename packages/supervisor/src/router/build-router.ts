/**
 * Wires every `SUPERVISOR_OPERATIONS` name (`./operations.ts`) to a real
 * handler backed by this package's own registries/run-lifecycle/worker-
 * lifecycle modules — "one handler set, two transports" (roadmap/05
 * §Interfaces produced): `../socket/uds-server.ts` dispatches both the CLI
 * (09) and the gateway's (16) forwarded `run.status`/`run.cancel` calls
 * through this SAME router instance.
 */
import type { ChangeSet, WorkUnit } from "@eo/contracts";
import type { JournalStore } from "@eo/journal";
import { transitionRun } from "../run-lifecycle/run-transition.js";
import { reapOrphansAtStartup } from "../worker-lifecycle/orphan-reaper.js";
import type { RunsRegistry } from "../registries/runs-registry.js";
import type { WorkersRegistry } from "../registries/workers-registry.js";
import type { Registry } from "../registries/registry.js";
import {
  RegistryArtifactIndexListParamsSchema,
  RegistryArtifactIndexListResultSchema,
  RegistryChangeSetGetParamsSchema,
  RegistryChangeSetGetResultSchema,
  RegistryChangeSetListParamsSchema,
  RegistryChangeSetListResultSchema,
  RegistryRunsListParamsSchema,
  RegistryRunsListResultSchema,
  RunDispatchParamsSchema,
  RunDispatchResultSchema,
  RegistryWorkUnitGetParamsSchema,
  RegistryWorkUnitGetResultSchema,
  RegistryWorkUnitListParamsSchema,
  RegistryWorkUnitListResultSchema,
  RegistryWorkersListParamsSchema,
  RegistryWorkersListResultSchema,
  RunCancelParamsSchema,
  RunCancelResultSchema,
  RunStatusParamsSchema,
  RunStatusResultSchema,
  WorkerReapOrphansParamsSchema,
  WorkerReapOrphansResultSchema,
  WorkerTerminateParamsSchema,
  WorkerTerminateResultSchema,
  type ArtifactIndexEntry,
} from "./operations.js";
import { SupervisorRouter } from "./router.js";
import type { RunDispatcher } from "./run-dispatcher.js";

/** A live, in-memory terminable worker handle — distinct from `WorkersRegistry`'s own data-only records; not every process holds one for every registry entry (e.g. right after a restart, before any worker is re-spawned). */
export interface TerminableWorker {
  terminate(graceMs: number): Promise<{ readonly outcome: string }>;
}

export interface SupervisorDependencies {
  readonly journal: JournalStore;
  readonly runs: RunsRegistry;
  readonly changeSets: Registry<ChangeSet>;
  readonly workUnits: Registry<WorkUnit>;
  readonly workers: WorkersRegistry;
  readonly artifactIndex: Registry<ArtifactIndexEntry>;
  readonly liveWorkers: ReadonlyMap<string, TerminableWorker>;
  /**
   * Drives approved DAGs (roadmap/13's `driveRun`). OPTIONAL because this
   * package cannot construct one — the real implementation needs
   * `@eo/engine-claude`, which already depends on this package — so the
   * daemon entry point in `packages/cli` injects it. A daemon booted
   * without one still serves every other operation; `run.dispatch` simply
   * refuses. See `./run-dispatcher.ts`.
   */
  readonly runDispatcher?: RunDispatcher;
}

const NON_CANCELLABLE_STATES = new Set(["published_local", "failed", "blocked", "cancelled"]);

export function buildSupervisorRouter(deps: SupervisorDependencies): SupervisorRouter {
  const router = new SupervisorRouter();

  router.register("run.status", RunStatusParamsSchema, RunStatusResultSchema, ({ runId }) => {
    const run = deps.runs.get(runId);
    return Promise.resolve({ ...(run !== undefined ? { run } : {}) });
  });

  router.register("run.cancel", RunCancelParamsSchema, RunCancelResultSchema, async ({ runId }) => {
    const current = deps.runs.get(runId);
    if (current === undefined || NON_CANCELLABLE_STATES.has(current.runState)) {
      return { accepted: false, ...(current !== undefined ? { runState: current.runState } : {}) };
    }
    const record = await transitionRun({
      journal: deps.journal,
      runs: deps.runs,
      runId,
      changeSetId: current.changeSetId,
      to: "cancelled",
    });
    return { accepted: true, runState: record.runState };
  });

  router.register(
    "registry.changeSets.get",
    RegistryChangeSetGetParamsSchema,
    RegistryChangeSetGetResultSchema,
    ({ changeSetId }) => {
      const changeSet = deps.changeSets.get(changeSetId);
      return Promise.resolve({ ...(changeSet !== undefined ? { changeSet } : {}) });
    },
  );

  router.register(
    "run.dispatch",
    RunDispatchParamsSchema,
    RunDispatchResultSchema,
    async ({ runId }) => {
      // Refusing is a normal answer, not an error: a daemon composed
      // without a dispatcher still serves the whole control plane.
      if (deps.runDispatcher === undefined) {
        return { accepted: false, reason: "no run dispatcher is configured on this daemon" };
      }
      // Resolves when OWNERSHIP is decided, never when the run finishes —
      // see `./run-dispatcher.ts`. Awaiting the run here would hold the
      // control socket for its full duration, making `status`/`cancel`
      // unanswerable exactly while they matter most.
      return deps.runDispatcher.dispatch(runId);
    },
  );

  router.register(
    "registry.runs.list",
    RegistryRunsListParamsSchema,
    RegistryRunsListResultSchema,
    () => Promise.resolve({ runs: deps.runs.list() }),
  );

  router.register(
    "registry.changeSets.list",
    RegistryChangeSetListParamsSchema,
    RegistryChangeSetListResultSchema,
    () => Promise.resolve({ changeSets: deps.changeSets.list() }),
  );

  router.register(
    "registry.workUnits.list",
    RegistryWorkUnitListParamsSchema,
    RegistryWorkUnitListResultSchema,
    ({ changeSetId }) =>
      Promise.resolve({
        workUnits:
          changeSetId !== undefined
            ? deps.workUnits.query((w) => w.changeSetId === changeSetId)
            : deps.workUnits.list(),
      }),
  );

  router.register(
    "registry.workUnits.get",
    RegistryWorkUnitGetParamsSchema,
    RegistryWorkUnitGetResultSchema,
    ({ workUnitId }) => {
      const workUnit = deps.workUnits.get(workUnitId);
      return Promise.resolve({ ...(workUnit !== undefined ? { workUnit } : {}) });
    },
  );

  router.register(
    "registry.workers.list",
    RegistryWorkersListParamsSchema,
    RegistryWorkersListResultSchema,
    ({ workUnitId }) =>
      Promise.resolve({
        workers:
          workUnitId !== undefined
            ? deps.workers.query((w) => w.workUnitId === workUnitId)
            : deps.workers.list(),
      }),
  );

  router.register(
    "registry.artifactIndex.list",
    RegistryArtifactIndexListParamsSchema,
    RegistryArtifactIndexListResultSchema,
    ({ changeSetId }) =>
      Promise.resolve({
        artifacts:
          changeSetId !== undefined
            ? deps.artifactIndex.query((a) => a.changeSetId === changeSetId)
            : deps.artifactIndex.list(),
      }),
  );

  router.register(
    "worker.terminate",
    WorkerTerminateParamsSchema,
    WorkerTerminateResultSchema,
    async ({ workerId, graceMs }) => {
      const live = deps.liveWorkers.get(workerId);
      if (live === undefined) return { accepted: false };
      await live.terminate(graceMs ?? 5_000);
      const status = deps.workers.get(workerId)?.status;
      return { accepted: true, ...(status !== undefined ? { status } : {}) };
    },
  );

  router.register(
    "worker.reapOrphans",
    WorkerReapOrphansParamsSchema,
    WorkerReapOrphansResultSchema,
    async () => {
      const reapedWorkerIds = await reapOrphansAtStartup({
        journal: deps.journal,
        workers: deps.workers,
      });
      return { reapedWorkerIds };
    },
  );

  return router;
}
