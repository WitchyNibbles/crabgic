import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import { buildChangeSet, buildWorkUnit } from "@eo/testkit";
import { buildSupervisorRouter, type TerminableWorker } from "./build-router.js";
import { createRunsRegistry } from "../registries/runs-registry.js";
import { createChangeSetsRegistry } from "../registries/change-sets-registry.js";
import { createWorkUnitsRegistry } from "../registries/work-units-registry.js";
import { createWorkersRegistry } from "../registries/workers-registry.js";
import { createArtifactIndexRegistry } from "../registries/artifact-index-registry.js";
import { transitionRun } from "../run-lifecycle/run-transition.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-supervisor-build-router-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

function buildDeps() {
  return {
    journal: store,
    runs: createRunsRegistry(),
    changeSets: createChangeSetsRegistry(),
    workUnits: createWorkUnitsRegistry(),
    workers: createWorkersRegistry(),
    artifactIndex: createArtifactIndexRegistry(),
    liveWorkers: new Map(),
  };
}

describe("buildSupervisorRouter", () => {
  it("run.status returns undefined run for an unknown runId, never a throw", async () => {
    const router = buildSupervisorRouter(buildDeps());
    const result = await router.dispatch("run.status", { runId: RUN_ID });
    expect(result).toEqual({});
  });

  it("run.status reflects the RunsRegistry after a transitionRun call", async () => {
    const deps = buildDeps();
    const changeSet = buildChangeSet();
    await transitionRun({
      journal: store,
      runs: deps.runs,
      runId: RUN_ID,
      changeSetId: changeSet.id,
      to: "awaiting_approval",
    });
    const router = buildSupervisorRouter(deps);
    const result = (await router.dispatch("run.status", { runId: RUN_ID })) as {
      run?: { runState: string };
    };
    expect(result.run?.runState).toBe("awaiting_approval");
  });

  it("run.cancel transitions a cancellable run and returns accepted: true", async () => {
    const deps = buildDeps();
    const changeSet = buildChangeSet();
    await transitionRun({
      journal: store,
      runs: deps.runs,
      runId: RUN_ID,
      changeSetId: changeSet.id,
      to: "awaiting_approval",
    });
    const router = buildSupervisorRouter(deps);
    const result = (await router.dispatch("run.cancel", { runId: RUN_ID })) as {
      accepted: boolean;
      runState?: string;
    };
    expect(result.accepted).toBe(true);
    expect(result.runState).toBe("cancelled");
  });

  it("run.cancel returns accepted: false for an unknown run", async () => {
    const router = buildSupervisorRouter(buildDeps());
    const result = await router.dispatch("run.cancel", { runId: RUN_ID });
    expect(result).toEqual({ accepted: false });
  });

  it("registry.changeSets.list returns [] for an empty registry, not a throw", async () => {
    const router = buildSupervisorRouter(buildDeps());
    const result = await router.dispatch("registry.changeSets.list", {});
    expect(result).toEqual({ changeSets: [] });
  });

  it("registry.changeSets.get round-trips a put() change set", async () => {
    const deps = buildDeps();
    const changeSet = buildChangeSet();
    deps.changeSets.put(changeSet);
    const router = buildSupervisorRouter(deps);
    const result = await router.dispatch("registry.changeSets.get", { changeSetId: changeSet.id });
    expect(result).toEqual({ changeSet });
  });

  it("worker.reapOrphans returns [] for an empty WorkersRegistry", async () => {
    const router = buildSupervisorRouter(buildDeps());
    const result = await router.dispatch("worker.reapOrphans", {});
    expect(result).toEqual({ reapedWorkerIds: [] });
  });

  it("worker.terminate returns accepted: false for an unknown workerId", async () => {
    const router = buildSupervisorRouter(buildDeps());
    const result = await router.dispatch("worker.terminate", { workerId: RUN_ID });
    expect(result).toEqual({ accepted: false });
  });

  it("worker.terminate calls the live worker's terminate() and returns its resulting status", async () => {
    const deps = buildDeps();
    const workerId = "44444444-4444-4444-8444-444444444444";
    deps.workers.upsert({
      workerId,
      workUnitId: "55555555-5555-4555-8555-555555555555",
      sessionId: "66666666-6666-4666-8666-666666666666",
      status: "terminated",
      startedAt: "2026-07-18T00:00:00.000Z",
    });
    let terminateCalledWithGraceMs: number | undefined;
    const liveWorker: TerminableWorker = {
      terminate: (graceMs) => {
        terminateCalledWithGraceMs = graceMs;
        return Promise.resolve({ outcome: "graceful" });
      },
    };
    const liveWorkers = new Map<string, TerminableWorker>([[workerId, liveWorker]]);
    const router = buildSupervisorRouter({ ...deps, liveWorkers });

    const result = await router.dispatch("worker.terminate", { workerId, graceMs: 1234 });
    expect(result).toEqual({ accepted: true, status: "terminated" });
    expect(terminateCalledWithGraceMs).toBe(1234);
  });

  it("worker.terminate defaults graceMs to 5000ms when omitted", async () => {
    const deps = buildDeps();
    const workerId = "44444444-4444-4444-8444-444444444444";
    let terminateCalledWithGraceMs: number | undefined;
    const liveWorkers = new Map<string, TerminableWorker>([
      [
        workerId,
        {
          terminate: (graceMs) => {
            terminateCalledWithGraceMs = graceMs;
            return Promise.resolve({ outcome: "graceful" });
          },
        },
      ],
    ]);
    const router = buildSupervisorRouter({ ...deps, liveWorkers });
    await router.dispatch("worker.terminate", { workerId });
    expect(terminateCalledWithGraceMs).toBe(5_000);
  });

  it("registry.workUnits.list returns [] for an empty registry, and filters by changeSetId when provided", async () => {
    const deps = buildDeps();
    const workUnit = buildWorkUnit();
    deps.workUnits.put(workUnit);
    const router = buildSupervisorRouter(deps);

    const all = await router.dispatch("registry.workUnits.list", {});
    expect(all).toEqual({ workUnits: [workUnit] });

    const filtered = await router.dispatch("registry.workUnits.list", {
      changeSetId: workUnit.changeSetId,
    });
    expect(filtered).toEqual({ workUnits: [workUnit] });

    const filteredOut = await router.dispatch("registry.workUnits.list", {
      changeSetId: "99999999-9999-4999-8999-999999999999",
    });
    expect(filteredOut).toEqual({ workUnits: [] });
  });

  it("registry.workUnits.get round-trips a put() work unit, and returns undefined for an unknown id", async () => {
    const deps = buildDeps();
    const workUnit = buildWorkUnit();
    deps.workUnits.put(workUnit);
    const router = buildSupervisorRouter(deps);

    const found = await router.dispatch("registry.workUnits.get", { workUnitId: workUnit.id });
    expect(found).toEqual({ workUnit });

    const missing = await router.dispatch("registry.workUnits.get", {
      workUnitId: "99999999-9999-4999-8999-999999999999",
    });
    expect(missing).toEqual({});
  });

  it("registry.workers.list returns [] for an empty registry, and filters by workUnitId when provided", async () => {
    const deps = buildDeps();
    const worker = {
      workerId: "44444444-4444-4444-8444-444444444444",
      workUnitId: "55555555-5555-4555-8555-555555555555",
      sessionId: "66666666-6666-4666-8666-666666666666",
      status: "running" as const,
      startedAt: "2026-07-18T00:00:00.000Z",
    };
    deps.workers.upsert(worker);
    const router = buildSupervisorRouter(deps);

    const all = await router.dispatch("registry.workers.list", {});
    expect(all).toEqual({ workers: [worker] });

    const filtered = await router.dispatch("registry.workers.list", {
      workUnitId: worker.workUnitId,
    });
    expect(filtered).toEqual({ workers: [worker] });

    const filteredOut = await router.dispatch("registry.workers.list", {
      workUnitId: "99999999-9999-4999-8999-999999999999",
    });
    expect(filteredOut).toEqual({ workers: [] });
  });

  it("registry.artifactIndex.list returns [] for an empty registry, and filters by changeSetId when provided", async () => {
    const deps = buildDeps();
    const artifact = {
      id: "77777777-7777-4777-8777-777777777777",
      changeSetId: "88888888-8888-4888-8888-888888888888",
      evidenceRecordId: "99999999-9999-4999-8999-999999999999",
      digest: "sha256:abcdef",
    };
    deps.artifactIndex.put(artifact);
    const router = buildSupervisorRouter(deps);

    const all = await router.dispatch("registry.artifactIndex.list", {});
    expect(all).toEqual({ artifacts: [artifact] });

    const filtered = await router.dispatch("registry.artifactIndex.list", {
      changeSetId: artifact.changeSetId,
    });
    expect(filtered).toEqual({ artifacts: [artifact] });

    const filteredOut = await router.dispatch("registry.artifactIndex.list", {
      changeSetId: "11111111-1111-4111-8111-111111111111",
    });
    expect(filteredOut).toEqual({ artifacts: [] });
  });

  it("run.cancel refuses a run already in a non-cancellable terminal state", async () => {
    const deps = buildDeps();
    const changeSet = buildChangeSet();
    await transitionRun({
      journal: store,
      runs: deps.runs,
      runId: RUN_ID,
      changeSetId: changeSet.id,
      to: "awaiting_approval",
    });
    await transitionRun({
      journal: store,
      runs: deps.runs,
      runId: RUN_ID,
      changeSetId: changeSet.id,
      to: "blocked",
    });
    const router = buildSupervisorRouter(deps);
    const result = await router.dispatch("run.cancel", { runId: RUN_ID });
    expect(result).toEqual({ accepted: false, runState: "blocked" });
  });
});
