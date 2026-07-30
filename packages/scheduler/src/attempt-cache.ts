/**
 * Attempt-cache keying: the content hash that lets `driveRun` reuse a
 * SUCCEEDED attempt's result on a same-daemon re-drive instead of paying for
 * a second engine worker to redo work that already exists.
 *
 * WHY THIS EXISTS (measured 2026-07-30). Nothing ever updates a stored
 * `WorkUnit.attemptStatus` after intake — the journal alone records
 * transitions — so `RunDispatcher.resume` (crash recovery, limit-park
 * re-dispatch) seeds every unit `pending` and re-executes units that already
 * succeeded: real engine spend, a fresh worktree, and duplicate work product
 * for a result the first attempt already committed. Phase 13 shipped
 * `SchedulerCache` for exactly this and nothing ever called it; this module
 * plus `run-driver.ts`'s `attemptCache` seam is the production caller.
 *
 * WHAT THE KEY SEES. Every field of the packet EXCEPT `id`, which is minted
 * `randomUUID()` per attempt — hashing it would make every key unique and
 * the cache a control that looks installed and is not. Object keys are
 * deep-sorted before hashing so structurally-equal packets hash equally
 * regardless of construction order.
 */
import { createHash } from "node:crypto";
import type { TaskPacket } from "@crabgic/contracts";

/** Recursively key-sorts plain objects so JSON serialization is insertion-order independent. Arrays keep their order — element order IS content. */
function deepSorted(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(deepSorted);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = deepSorted(record[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Content hash of one attempt's work: the RUN it belongs to plus everything
 * on the packet except the per-attempt `id`.
 *
 * THE RUN ID IS PART OF THE KEY, DELIBERATELY (adversarial review,
 * 2026-07-30). Without it, a retry run of the same change set on an
 * untouched repo hashes identically to the cancelled/failed run before it,
 * and silently absorbs that run's attempt — a unit `status <new-run>` can
 * never show (transitions live under the old runId), whose work product
 * lives in the old run's worktree namespace, and which an owner who
 * cancelled the old run precisely because the work was wrong cannot force
 * to re-execute (the cache has no invalidation API). Scoped to the run, a
 * hit can only ever return work the SAME run already did — the worktree
 * namespace and the journal's runId both match by construction — and a new
 * run always re-executes.
 */
export function hashAttemptContent(runId: string, packet: TaskPacket): string {
  const { id: _id, ...content } = packet;
  const digest = createHash("sha256")
    .update(JSON.stringify([runId, deepSorted(content)]))
    .digest("hex");
  return `sha256:${digest}`;
}
