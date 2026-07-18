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
import { recordAttempt, type JournalStore } from "@eo/journal";
import type { WorkerRecord } from "../router/operations.js";
import type { WorkersRegistry } from "../registries/workers-registry.js";

export type OrphanRecoveryHook = (worker: WorkerRecord) => void | Promise<void>;

export interface OrphanReaperOptions {
  readonly journal: JournalStore;
  readonly workers: WorkersRegistry;
  /** Resume/fork policy call site — 06/13 supply the real policy; defaults to a no-op. */
  readonly onOrphanDetected?: OrphanRecoveryHook;
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
    await recordAttempt(options.journal, worker.workUnitId, worker.sessionId, "failed");
    const reapedAt = worker.terminatedAt ?? new Date().toISOString();
    options.workers.upsert({ ...worker, status: "crashed", terminatedAt: reapedAt });
    await options.onOrphanDetected?.({ ...worker, status: "crashed", terminatedAt: reapedAt });
    reapedIds.push(worker.workerId);
  }

  return reapedIds;
}
