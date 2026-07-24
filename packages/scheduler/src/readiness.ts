/**
 * Readiness engine — roadmap/13-scheduler-packets-context.md §In scope,
 * "DAG executor": "readiness = dependencies + lease + overlap analysis
 * (07) + non-Git resource serialization; default one worker." This module
 * is the PURE decision function; leasing itself is `@eo/journal`'s `Lease`
 * (consumed, never reimplemented here — see `../executor.ts`), and overlap
 * analysis is `@eo/git-engine`'s `analyzeOverlap` (also consumed, never
 * reimplemented).
 *
 * A `WorkUnit` is READY iff:
 *  - its own `attemptStatus` is `pending` (not already dispatched/
 *    terminal/parked);
 *  - every `dependsOn` id has `attemptStatus === "succeeded"`;
 *  - it does not collide (per the supplied `CollisionVerdict`s) with any
 *    unit CURRENTLY in flight (`inFlightUnitIds`) — "overlapping units are
 *    serialized" (roadmap/13 §In scope).
 */

import type { WorkUnit, WorkUnitAttemptStatus } from "@eo/contracts";
import type { CollisionVerdict } from "@eo/git-engine";

export type WorkUnitStatusById = ReadonlyMap<string, WorkUnitAttemptStatus>;

export interface ComputeReadyUnitsOptions {
  readonly workUnits: readonly WorkUnit[];
  /** Latest known attempt status per unit id — defaults to each unit's own `attemptStatus` field when absent from this map. */
  readonly statusById?: WorkUnitStatusById;
  readonly overlapVerdicts?: readonly CollisionVerdict[];
  readonly inFlightUnitIds?: ReadonlySet<string>;
}

function statusOf(
  unit: WorkUnit,
  statusById: WorkUnitStatusById | undefined,
): WorkUnitAttemptStatus {
  return statusById?.get(unit.id) ?? unit.attemptStatus;
}

/** Builds a `unitId -> Set<collidingUnitId>` adjacency map from `analyzeOverlap`'s pairwise verdicts (only the `collides: true` pairs). */
export function buildOverlapAdjacency(
  verdicts: readonly CollisionVerdict[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const verdict of verdicts) {
    if (!verdict.collides) continue;
    const a = adjacency.get(verdict.unitA) ?? new Set<string>();
    a.add(verdict.unitB);
    adjacency.set(verdict.unitA, a);
    const b = adjacency.get(verdict.unitB) ?? new Set<string>();
    b.add(verdict.unitA);
    adjacency.set(verdict.unitB, b);
  }
  return adjacency;
}

/**
 * Computes the set of `WorkUnit` ids that are READY to dispatch this round
 * — dependencies satisfied, not already in flight, and not blocked by an
 * overlap collision with a unit CURRENTLY in flight. Does NOT itself
 * decide how many of these to actually dispatch concurrently (that is
 * `./fanout.ts`'s job, applying the concurrency cap and the pairwise
 * serialization-among-candidates rule).
 */
export function computeReadyUnits(options: ComputeReadyUnitsOptions): readonly string[] {
  const {
    workUnits,
    statusById,
    overlapVerdicts = [],
    inFlightUnitIds = new Set<string>(),
  } = options;
  const statusOfId = new Map(workUnits.map((u) => [u.id, statusOf(u, statusById)]));
  const adjacency = buildOverlapAdjacency(overlapVerdicts);

  const ready: string[] = [];
  for (const unit of workUnits) {
    if (statusOfId.get(unit.id) !== "pending") continue;

    const depsSatisfied = unit.dependsOn.every((depId) => statusOfId.get(depId) === "succeeded");
    if (!depsSatisfied) continue;

    const collidesWithInFlight = [...(adjacency.get(unit.id) ?? [])].some((otherId) =>
      inFlightUnitIds.has(otherId),
    );
    if (collidesWithInFlight) continue;

    ready.push(unit.id);
  }
  return ready;
}
