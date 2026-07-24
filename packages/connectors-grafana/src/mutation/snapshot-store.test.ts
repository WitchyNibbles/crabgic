import { describe, expect, it } from "vitest";
import { GrafanaRollbackSnapshotStore } from "./snapshot-store.js";
import type { GrafanaParsedResource } from "../resources/resource-definitions.js";

function fixtureSnapshot(overrides: Partial<GrafanaParsedResource> = {}): GrafanaParsedResource {
  return {
    kind: "folder",
    externalId: "fold-1",
    revision: "etag-1",
    fields: { title: "Team Dashboards", parentUid: null },
    ...overrides,
  };
}

describe("GrafanaRollbackSnapshotStore", () => {
  it("captures and retrieves a snapshot keyed by plan id", () => {
    const store = new GrafanaRollbackSnapshotStore();
    const snapshot = fixtureSnapshot();
    store.capture("plan-1", snapshot);
    expect(store.get("plan-1")).toEqual(snapshot);
    expect(store.size).toBe(1);
  });

  it("returns undefined for an uncaptured plan id", () => {
    const store = new GrafanaRollbackSnapshotStore();
    expect(store.get("nope")).toBeUndefined();
  });

  it("clear removes a captured snapshot", () => {
    const store = new GrafanaRollbackSnapshotStore();
    store.capture("plan-1", fixtureSnapshot());
    store.clear("plan-1");
    expect(store.get("plan-1")).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it("captures independently per plan id, never cross-contaminating", () => {
    const store = new GrafanaRollbackSnapshotStore();
    store.capture("plan-1", fixtureSnapshot({ externalId: "fold-1" }));
    store.capture("plan-2", fixtureSnapshot({ externalId: "fold-2" }));
    expect(store.get("plan-1")?.externalId).toBe("fold-1");
    expect(store.get("plan-2")?.externalId).toBe("fold-2");
  });
});
