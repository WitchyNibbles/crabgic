/**
 * Startup orphan reaping — roadmap/05-supervisor-daemon.md §Worker
 * management: "orphan reaping at startup." Consumes the hand-off
 * `../registries/recovery.ts`'s `recoverRun` already produced: any
 * `WorkerRecord` left non-terminal after journal replay is synthesized (or
 * updated) there as `status: "crashed"`. This module's own job is
 * strictly narrower — formalize each of those into the journal (a
 * `work_unit_transition` "failed" attempt record, via 04's own
 * `recordAttempt`) and fire the recovery-hook call site for each: resume/
 * fork POLICY belongs to 06/13 (roadmap/05 §Out of scope), this phase
 * supplies only detection + the journaled record + the hook's call site,
 * never the policy answering it. The default hook is a no-op.
 */
import { recordAttempt, type JournalStore } from "@crabgic/journal";
import type { WorkerRecord } from "../router/operations.js";
import type { WorkersRegistry } from "../registries/workers-registry.js";

export type OrphanRecoveryHook = (worker: WorkerRecord) => void | Promise<void>;

export interface OrphanReaperOptions {
  readonly journal: JournalStore;
  readonly workers: WorkersRegistry;
  /** Resume/fork policy call site — 06/13 supply the real policy; defaults to a no-op. */
  readonly onOrphanDetected?: OrphanRecoveryHook;
  /**
   * Which run each recovered session belongs to, from the replay that
   * produced these orphans (`../registries/recovery.ts`'s
   * `collectReplayedSessionIds`).
   *
   * THE GHOST SPLIT-BRAIN THIS CLOSES. `recordAttempt` threads `runId` onto
   * the entry envelope, and both `recover(runId)` and `getLatestAttemptForRun`
   * filter on an EXACT match — so an attempt written without one is invisible
   * to every run-scoped reader while staying visible to unscoped ones. This
   * reaper wrote exactly that: it declared a work unit failed, and the very
   * next thing to read that unit's state (13's driver, seeding a re-drive from
   * `getLatestAttemptForRun`) could not see the declaration and seeded from
   * whatever the run's own last scoped entry said. Two answers to one
   * question, both from the same journal.
   *
   * `WorkerRecord` cannot carry the run id itself — it is a `.strict()` wire
   * schema served by `registry.workers.list` — so the attribution is passed in
   * beside the registry instead. Absent (or missing an entry) the record is
   * still journaled, just unattributed, exactly as before.
   */
  readonly runIdBySessionId?: ReadonlyMap<string, string>;
}

const NON_TERMINAL_WORKER_STATUSES = new Set(["starting", "running", "terminating", "crashed"]);

/**
 * Sweeps the `WorkersRegistry` for every non-terminal entry (including
 * ones `recoverRun` already marked `crashed`) and formally journals a
 * failed attempt record for each, before invoking the recovery-hook slot.
 * Returns the reaped worker ids. Idempotent per worker: a worker already
 * `terminated` is left untouched.
 */
export async function reapOrphansAtStartup(
  options: OrphanReaperOptions,
): Promise<readonly string[]> {
  const orphans = options.workers.query((w) => NON_TERMINAL_WORKER_STATUSES.has(w.status));
  const reapedIds: string[] = [];

  for (const worker of orphans) {
    await recordAttempt(
      options.journal,
      worker.workUnitId,
      worker.sessionId,
      "failed",
      options.runIdBySessionId?.get(worker.sessionId),
    );
    const reapedAt = worker.terminatedAt ?? new Date().toISOString();
    options.workers.upsert({ ...worker, status: "crashed", terminatedAt: reapedAt });
    await options.onOrphanDetected?.({ ...worker, status: "crashed", terminatedAt: reapedAt });
    reapedIds.push(worker.workerId);
  }

  return reapedIds;
}
