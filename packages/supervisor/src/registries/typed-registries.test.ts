import { describe, expect, it } from "vitest";
import { buildChangeSet, buildWorkUnit } from "@eo/testkit";
import { createChangeSetsRegistry } from "./change-sets-registry.js";
import { createWorkUnitsRegistry } from "./work-units-registry.js";
import { createArtifactIndexRegistry } from "./artifact-index-registry.js";
import { createRunsRegistry } from "./runs-registry.js";
import { createWorkersRegistry } from "./workers-registry.js";

describe("typed registries — each starts empty and round-trips its own contract shape", () => {
  it("change-sets registry", () => {
    const registry = createChangeSetsRegistry();
    expect(registry.list()).toEqual([]);
    const changeSet = buildChangeSet();
    registry.put(changeSet);
    expect(registry.get(changeSet.id)).toEqual(changeSet);
  });

  it("work-units registry", () => {
    const registry = createWorkUnitsRegistry();
    expect(registry.list()).toEqual([]);
    const workUnit = buildWorkUnit();
    registry.put(workUnit);
    expect(registry.get(workUnit.id)).toEqual(workUnit);
    expect(registry.query((w) => w.changeSetId === workUnit.changeSetId)).toEqual([workUnit]);
  });

  it("artifact-index registry", () => {
    const registry = createArtifactIndexRegistry();
    expect(registry.list()).toEqual([]);
    const entry = {
      id: "11111111-1111-4111-8111-111111111111",
      changeSetId: "22222222-2222-4222-8222-222222222222",
      evidenceRecordId: "33333333-3333-4333-8333-333333333333",
      digest: "sha256:abcdef",
    };
    registry.put(entry);
    expect(registry.list()).toEqual([entry]);
  });

  it("runs registry — keyed by runId, empty query returns [], not a throw", () => {
    const registry = createRunsRegistry();
    expect(registry.list()).toEqual([]);
    expect(registry.get("no-such-run")).toBeUndefined();
    const record = {
      runId: "44444444-4444-4444-8444-444444444444",
      changeSetId: "22222222-2222-4222-8222-222222222222",
      runState: "running" as const,
      updatedAt: "2026-07-18T00:00:00.000Z",
    };
    registry.upsert(record);
    expect(registry.get(record.runId)).toEqual(record);
  });

  it("workers registry — keyed by workerId, carries the engine session_id", () => {
    const registry = createWorkersRegistry();
    expect(registry.list()).toEqual([]);
    const worker = {
      workerId: "55555555-5555-4555-8555-555555555555",
      workUnitId: "66666666-6666-4666-8666-666666666666",
      sessionId: "77777777-7777-4777-8777-777777777777",
      status: "running" as const,
      startedAt: "2026-07-18T00:00:00.000Z",
    };
    registry.upsert(worker);
    expect(registry.get(worker.workerId)).toEqual(worker);
    expect(registry.query((w) => w.status === "running")).toEqual([worker]);
  });
});
