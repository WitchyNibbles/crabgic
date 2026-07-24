import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { WorkUnit, WorkUnitAttemptStatus } from "@eo/contracts";
import { buildWorkUnit } from "@eo/testkit";
import type { CollisionVerdict } from "@eo/git-engine";
import { computeReadyUnits } from "./readiness.js";
import { DEFAULT_CONCURRENCY_CAP, selectDispatchSet } from "./fanout.js";

/**
 * Exit criterion #1 — roadmap/13-scheduler-packets-context.md: "Property
 * test over random DAGs + overlap sets: overlapping units never concurrent
 * (fast-check suite)."
 */

function idFor(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

describe("selectDispatchSet — property: never selects two colliding units together", () => {
  it("holds over random ready-id sets, random collision graphs, and random caps", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 12 }).chain((n) => {
          const ids = Array.from({ length: n }, (_, i) => idFor(i));
          const idxPairArb = fc.tuple(
            fc.integer({ min: 0, max: Math.max(n - 1, 0) }),
            fc.integer({ min: 0, max: Math.max(n - 1, 0) }),
          );
          return fc.record({
            ids: fc.constant(ids),
            verdictPairs: fc.array(idxPairArb, { maxLength: 20 }),
            cap: fc.integer({ min: 1, max: 6 }),
          });
        }),
        ({ ids, verdictPairs, cap }) => {
          const verdicts: CollisionVerdict[] = verdictPairs
            .filter(([a, b]) => a !== b)
            .map(([a, b]) => ({
              unitA: ids[a]!,
              unitB: ids[b]!,
              collides: true,
              collidingPaths: ["x"],
              declaredResourceCollisions: [],
            }));

          const selected = selectDispatchSet(ids, verdicts, cap);

          // Never exceeds the cap.
          expect(selected.length).toBeLessThanOrEqual(cap);

          // No two selected units collide with each other.
          const collidingSet = new Set(verdicts.map((v) => [v.unitA, v.unitB].sort().join("|")));
          for (let i = 0; i < selected.length; i++) {
            for (let j = i + 1; j < selected.length; j++) {
              const key = [selected[i]!, selected[j]!].sort().join("|");
              expect(collidingSet.has(key)).toBe(false);
            }
          }
        },
      ),
      { numRuns: 2000 },
    );
  });
});

/** Random acyclic dependsOn edges: unit `i` may depend only on units `j < i`. */
function buildRandomDag(n: number, edgeBits: readonly boolean[]): readonly WorkUnit[] {
  let bitIndex = 0;
  const units: WorkUnit[] = [];
  for (let i = 0; i < n; i++) {
    const dependsOn: string[] = [];
    for (let j = 0; j < i; j++) {
      if (edgeBits[bitIndex % edgeBits.length]) dependsOn.push(idFor(j));
      bitIndex++;
    }
    units.push(buildWorkUnit({ id: idFor(i), dependsOn, attemptStatus: "pending" }));
  }
  return units;
}

describe("readiness + fanout round-simulation — property: random DAGs + overlap sets never dispatch a colliding pair concurrently", () => {
  it("simulates full-DAG execution to completion; no round's dispatch set ever contains a colliding pair", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 7 }),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 64 }),
        fc.array(fc.tuple(fc.integer({ min: 0, max: 6 }), fc.integer({ min: 0, max: 6 })), {
          maxLength: 15,
        }),
        (n, edgeBits, overlapPairs) => {
          const units = buildRandomDag(n, edgeBits);
          const ids = units.map((u) => u.id);
          const overlapVerdicts: CollisionVerdict[] = overlapPairs
            .filter(([a, b]) => a !== b && a < n && b < n)
            .map(([a, b]) => ({
              unitA: idFor(a),
              unitB: idFor(b),
              collides: true,
              collidingPaths: ["shared"],
              declaredResourceCollisions: [],
            }));
          const collidingKeySet = new Set(
            overlapVerdicts.map((v) => [v.unitA, v.unitB].sort().join("|")),
          );

          const statusById = new Map<string, WorkUnitAttemptStatus>(
            units.map((u) => [u.id, "pending" as WorkUnitAttemptStatus]),
          );

          let rounds = 0;
          const maxRounds = n + 5; // ample headroom — a real DAG converges in <= n rounds
          for (;;) {
            rounds++;
            if (rounds > maxRounds) break; // defensive: should never trigger for a real DAG

            const ready = computeReadyUnits({ workUnits: units, statusById });
            if (ready.length === 0) break; // done (or a genuine cross-round deadlock, asserted below)

            const selected = selectDispatchSet(ready, overlapVerdicts, DEFAULT_CONCURRENCY_CAP);
            expect(selected.length).toBeGreaterThan(0);
            expect(selected.length).toBeLessThanOrEqual(DEFAULT_CONCURRENCY_CAP);

            // THE property: no two units selected THIS ROUND collide.
            for (let i = 0; i < selected.length; i++) {
              for (let j = i + 1; j < selected.length; j++) {
                const key = [selected[i]!, selected[j]!].sort().join("|");
                expect(collidingKeySet.has(key)).toBe(false);
              }
            }

            // Simulate instantaneous success so dependents become ready next round.
            for (const id of selected) statusById.set(id, "succeeded");
          }

          // Every unit eventually reaches a terminal ready-independent state
          // (succeeded here) — confirms the simulation actually converged
          // rather than silently stalling before covering the whole DAG.
          expect([...statusById.values()].every((s) => s === "succeeded")).toBe(true);
          expect(ids.every((id) => statusById.get(id) === "succeeded")).toBe(true);
        },
      ),
      { numRuns: 1500 },
    );
  });

  /**
   * Observation fix (adversarial-validation round): the simulation above
   * marks every selected unit "succeeded" INSTANTANEOUSLY within the same
   * round it was dispatched, so `computeReadyUnits`'s own `inFlightUnitIds`
   * parameter (`../readiness.ts`) — the guard that blocks a unit from being
   * considered ready while a unit it collides with is CURRENTLY in flight
   * across MULTIPLE rounds — was never actually exercised by this property
   * suite (only by hand-built fixtures in `readiness.test.ts`). This
   * simulation instead gives each dispatched unit a random 1-3 round
   * IN-FLIGHT LIFETIME (remaining "dispatched," not yet "succeeded") before
   * completing, and asserts the property over the FULL active set at every
   * round instant — already-in-flight units UNION newly-selected ones —
   * so a newly-selected unit that collides with a still-lingering
   * already-in-flight one would be caught here (via `computeReadyUnits`'s
   * own in-flight guard correctly excluding it from `ready` in the first
   * place — this test would fail if that guard were ever removed or
   * broken).
   */
  it("simulates OVERLAPPING multi-round in-flight windows; the full active set (already-in-flight ∪ newly-selected) never contains a colliding pair at any round instant", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 7 }),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 64 }),
        fc.array(fc.tuple(fc.integer({ min: 0, max: 6 }), fc.integer({ min: 0, max: 6 })), {
          maxLength: 15,
        }),
        fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 7, maxLength: 7 }),
        (n, edgeBits, overlapPairs, durationPool) => {
          const units = buildRandomDag(n, edgeBits);
          const ids = units.map((u) => u.id);
          const overlapVerdicts: CollisionVerdict[] = overlapPairs
            .filter(([a, b]) => a !== b && a < n && b < n)
            .map(([a, b]) => ({
              unitA: idFor(a),
              unitB: idFor(b),
              collides: true,
              collidingPaths: ["shared"],
              declaredResourceCollisions: [],
            }));
          const collidingKeySet = new Set(
            overlapVerdicts.map((v) => [v.unitA, v.unitB].sort().join("|")),
          );

          const statusById = new Map<string, WorkUnitAttemptStatus>(
            units.map((u) => [u.id, "pending" as WorkUnitAttemptStatus]),
          );
          // Rounds remaining in flight, keyed by unit id — populated the
          // round a unit is first selected, decremented every round after.
          const remainingRounds = new Map<string, number>();

          let rounds = 0;
          // More headroom than the instantaneous-success suite above: a
          // unit can now linger up to 3 rounds, so full-DAG convergence
          // can take proportionally longer.
          const maxRounds = n * 4 + 20;
          for (;;) {
            rounds++;
            if (rounds > maxRounds) break; // defensive: should never trigger for a real DAG

            const inFlightUnitIds = new Set(
              [...statusById.entries()].filter(([, s]) => s === "dispatched").map(([id]) => id),
            );

            const ready = computeReadyUnits({
              workUnits: units,
              statusById,
              overlapVerdicts,
              inFlightUnitIds,
            });
            const selected = selectDispatchSet(ready, overlapVerdicts, DEFAULT_CONCURRENCY_CAP);

            if (selected.length === 0 && inFlightUnitIds.size === 0) break; // done, or a genuine deadlock (asserted below)

            for (const id of selected) {
              const idx = ids.indexOf(id);
              remainingRounds.set(id, durationPool[idx % durationPool.length]!);
              statusById.set(id, "dispatched");
            }

            // THE property: the FULL active set this round instant —
            // units ALREADY in flight from a prior round, union the ones
            // just newly selected — never contains a colliding pair. This
            // is what proves `computeReadyUnits`'s `inFlightUnitIds` guard
            // is doing real work: a newly-selected unit could only ever
            // collide with an already-in-flight one if that guard failed
            // to exclude it from `ready` in the first place.
            const activeThisRound = [...new Set([...inFlightUnitIds, ...selected])];
            for (let i = 0; i < activeThisRound.length; i++) {
              for (let j = i + 1; j < activeThisRound.length; j++) {
                const key = [activeThisRound[i]!, activeThisRound[j]!].sort().join("|");
                expect(collidingKeySet.has(key)).toBe(false);
              }
            }

            // Advance simulated time: every currently-dispatched unit's
            // in-flight window ticks down by one round; anything reaching
            // zero completes (succeeds).
            for (const id of activeThisRound) {
              const remaining = (remainingRounds.get(id) ?? 1) - 1;
              if (remaining <= 0) {
                remainingRounds.delete(id);
                statusById.set(id, "succeeded");
              } else {
                remainingRounds.set(id, remaining);
              }
            }
          }

          expect(ids.every((id) => statusById.get(id) === "succeeded")).toBe(true);
        },
      ),
      { numRuns: 1500 },
    );
  });
});
