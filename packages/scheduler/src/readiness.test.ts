import { describe, expect, it } from "vitest";
import { buildWorkUnit } from "@eo/testkit";
import type { CollisionVerdict } from "@eo/git-engine";
import { buildOverlapAdjacency, computeReadyUnits } from "./readiness.js";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";

describe("computeReadyUnits", () => {
  it("a unit with no dependencies and pending status is ready", () => {
    const unit = buildWorkUnit({ id: A, dependsOn: [], attemptStatus: "pending" });
    expect(computeReadyUnits({ workUnits: [unit] })).toEqual([A]);
  });

  it("a unit is NOT ready while its dependency has not yet succeeded", () => {
    const dep = buildWorkUnit({ id: A, attemptStatus: "dispatched" });
    const unit = buildWorkUnit({ id: B, dependsOn: [A], attemptStatus: "pending" });
    expect(computeReadyUnits({ workUnits: [dep, unit] })).toEqual([]);
  });

  it("a unit becomes ready once every dependency has succeeded", () => {
    const dep = buildWorkUnit({ id: A, attemptStatus: "succeeded" });
    const unit = buildWorkUnit({ id: B, dependsOn: [A], attemptStatus: "pending" });
    expect(computeReadyUnits({ workUnits: [dep, unit] })).toEqual([B]);
  });

  it("a non-pending unit (already dispatched/succeeded/failed) is never re-listed as ready", () => {
    for (const status of [
      "dispatched",
      "succeeded",
      "failed",
      "cancelled",
      "parked:rate_limit",
    ] as const) {
      const unit = buildWorkUnit({ id: A, attemptStatus: status });
      expect(computeReadyUnits({ workUnits: [unit] })).toEqual([]);
    }
  });

  it("a unit colliding with a currently in-flight unit is blocked (serialization)", () => {
    const inFlight = buildWorkUnit({ id: A, attemptStatus: "dispatched" });
    const candidate = buildWorkUnit({ id: B, attemptStatus: "pending" });
    const verdicts: CollisionVerdict[] = [
      {
        unitA: A,
        unitB: B,
        collides: true,
        collidingPaths: ["shared.ts"],
        declaredResourceCollisions: [],
      },
    ];
    expect(
      computeReadyUnits({
        workUnits: [inFlight, candidate],
        overlapVerdicts: verdicts,
        inFlightUnitIds: new Set([A]),
      }),
    ).toEqual([]);
  });

  it("a unit NOT colliding with any in-flight unit remains ready (independent proceeds)", () => {
    const inFlight = buildWorkUnit({ id: A, attemptStatus: "dispatched" });
    const independent = buildWorkUnit({ id: C, attemptStatus: "pending" });
    const verdicts: CollisionVerdict[] = [
      { unitA: A, unitB: C, collides: false, collidingPaths: [], declaredResourceCollisions: [] },
    ];
    expect(
      computeReadyUnits({
        workUnits: [inFlight, independent],
        overlapVerdicts: verdicts,
        inFlightUnitIds: new Set([A]),
      }),
    ).toEqual([C]);
  });

  it("statusById overrides a unit's own stale attemptStatus field", () => {
    const unit = buildWorkUnit({ id: A, attemptStatus: "pending" });
    const statusById = new Map([[A, "succeeded" as const]]);
    expect(computeReadyUnits({ workUnits: [unit], statusById })).toEqual([]);
  });
});

describe("buildOverlapAdjacency", () => {
  it("is symmetric and includes only colliding pairs", () => {
    const verdicts: CollisionVerdict[] = [
      { unitA: A, unitB: B, collides: true, collidingPaths: ["x"], declaredResourceCollisions: [] },
      { unitA: A, unitB: C, collides: false, collidingPaths: [], declaredResourceCollisions: [] },
    ];
    const adjacency = buildOverlapAdjacency(verdicts);
    expect(adjacency.get(A)).toEqual(new Set([B]));
    expect(adjacency.get(B)).toEqual(new Set([A]));
    expect(adjacency.get(C)).toBeUndefined();
  });
});
