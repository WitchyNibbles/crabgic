/**
 * Recovery wiring — roadmap/05-supervisor-daemon.md §Lifecycle: "a crash
 * at any point is always recoverable via 04's `recover(runId)` (latest
 * snapshot + journal replay)." This module never re-implements replay
 * itself — it calls `@crabgic/journal`'s own `recover(runId)` (via a bound
 * `JournalStore`) and rebuilds exactly this package's own registries
 * (`RunsRegistry`, `WorkersRegistry`) from the returned
 * `{ snapshot, replayed, verification, repair? }`.
 *
 * `recover()` can throw `JournalTamperedError` (mid-journal corruption, as
 * opposed to a torn tail, which `recover()` repairs in place before
 * returning) — this module does NOT catch that: a tampered journal is a
 * data-integrity emergency this phase's own scope explicitly does not own
 * a policy for (04 owns verify/repair; this phase only calls it), so the
 * error propagates to the caller (the supervisor's own startup sequence)
 * uncaught, exactly as 04's own contract requires.
 */
import type { JournalStore, RecoverResult } from "@crabgic/journal";
import type { RunRecord } from "../router/operations.js";
import type { RunsRegistry } from "./runs-registry.js";
import type { WorkersRegistry } from "./workers-registry.js";

export class RunRecoveryDataError extends Error {
  constructor(runId: string, reason: string) {
    super(`supervisor: cannot recover run "${runId}" (${reason})`);
    this.name = "RunRecoveryDataError";
  }
}

export interface RecoverRunOptions {
  readonly journal: JournalStore;
  readonly runs: RunsRegistry;
  readonly workers: WorkersRegistry;
}

/**
 * Recovers one run's `RunsRegistry` state from the journal, and marks any
 * worker left in a non-terminal status by the replay as `crashed` in the
 * `WorkersRegistry` — the hand-off point WI4's startup orphan reaper
 * (`../worker-lifecycle/orphan-reaper.ts`) consumes. Idempotent: calling
 * this twice for the same `runId` converges to the same registry state
 * (never duplicates a side effect — the exit criterion this function
 * exists to satisfy).
 */
export async function recoverRun(
  runId: string,
  options: RecoverRunOptions,
): Promise<RecoverResult> {
  const result = await options.journal.recover(runId);

  let runRecord: RunRecord | undefined = options.runs.get(runId);
  const sessionToWorkUnit = new Map<string, string>();

  for (const entry of result.replayed) {
    if (entry.type === "run_transition") {
      const changeSetId = entry.changeSetId ?? runRecord?.changeSetId;
      if (changeSetId === undefined) {
        throw new RunRecoveryDataError(
          runId,
          `run_transition entry (seq ${String(entry.seq)}) carries no changeSetId and no prior RunRecord exists`,
        );
      }
      runRecord = {
        runId,
        changeSetId,
        runState: entry.payload.to,
        updatedAt: entry.timestamp,
      };
    } else if (entry.type === "session_assignment" && entry.workUnitId !== undefined) {
      sessionToWorkUnit.set(entry.payload.sessionId, entry.workUnitId);
    } else if (entry.type === "work_unit_transition" && entry.payload.sessionId !== undefined) {
      sessionToWorkUnit.set(entry.payload.sessionId, entry.workUnitId ?? "");
    }
  }

  if (runRecord !== undefined) {
    options.runs.upsert(runRecord);
  }

  reconstructOrphanedWorkers(result, options.workers);

  return result;
}

const TERMINAL_ATTEMPT_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

/**
 * Statuses that are neither terminal nor orphaned — a session deliberately
 * held open rather than one a crash abandoned.
 *
 * `parked:rate_limit` is the only one. It is 13's limit-parking state: the
 * session is RETAINED on purpose so a later `resume` can continue the same
 * engine conversation once the reset window passes, and the park record
 * (plus its journal-derived reset timer) is the authoritative statement of
 * what the unit is doing. Classifying it as an orphan meant a restart
 * synthesized a `crashed` worker for it and the startup reaper then journaled
 * a `failed` attempt over the park — an edge `WorkUnitAttemptStatus` does not
 * even permit (`parked:rate_limit` transitions ONLY to `dispatched`), and one
 * written WITHOUT the run's id, so it was invisible to every run-scoped
 * reader while visible to unscoped ones. `crabgic resume` then read a park
 * that had been failed behind its back on one side and was still parked on
 * the other.
 */
const RETAINED_ATTEMPT_STATUSES = new Set(["parked:rate_limit"]);

/**
 * The engine session ids this replay mentions. `recover(runId)` filters
 * entries to that run, so every id here belongs to it — which is what lets
 * the startup orphan reaper attribute its attempt records to a run instead of
 * writing them unscoped (`../worker-lifecycle/orphan-reaper.ts`).
 */
export function collectReplayedSessionIds(result: RecoverResult): readonly string[] {
  const sessionIds = new Set<string>();
  for (const entry of result.replayed) {
    if (entry.type === "session_assignment") {
      sessionIds.add(entry.payload.sessionId);
    } else if (entry.type === "work_unit_transition" && entry.payload.sessionId !== undefined) {
      sessionIds.add(entry.payload.sessionId);
    }
  }
  return [...sessionIds];
}

/**
 * Rebuilds orphaned `WorkerRecord`s purely from the replayed journal —
 * deliberately NOT dependent on any pre-existing `WorkersRegistry` entry,
 * since on a genuine process restart the in-memory registry starts EMPTY
 * (it is never itself persisted; only the journal is durable). For every
 * session a `session_assignment` entry names, tracks that session's LATEST
 * replayed `work_unit_transition` status; a session with no terminal
 * status by the end of replay survived a crash mid-flight — synthesizes
 * (or updates) a `crashed` `WorkerRecord` for it, the exact hand-off
 * `../worker-lifecycle/orphan-reaper.ts`'s startup sweep consumes.
 */
function reconstructOrphanedWorkers(result: RecoverResult, workers: WorkersRegistry): void {
  const workUnitBySession = new Map<string, string>();
  const latestStatusBySession = new Map<string, string>();

  for (const entry of result.replayed) {
    if (entry.type === "session_assignment" && entry.workUnitId !== undefined) {
      workUnitBySession.set(entry.payload.sessionId, entry.workUnitId);
    } else if (entry.type === "work_unit_transition" && entry.payload.sessionId !== undefined) {
      const sessionId = entry.payload.sessionId;
      if (entry.workUnitId !== undefined) {
        workUnitBySession.set(sessionId, entry.workUnitId);
      }
      latestStatusBySession.set(sessionId, entry.payload.status);
    }
  }

  const nowIso = new Date().toISOString();
  for (const [sessionId, workUnitId] of workUnitBySession) {
    const latestStatus = latestStatusBySession.get(sessionId);
    // Orphaned = the replay left it neither finished nor deliberately held.
    // A retained (parked) session is left exactly as the journal describes it
    // — see `RETAINED_ATTEMPT_STATUSES`.
    const isOrphaned =
      latestStatus === undefined ||
      !(TERMINAL_ATTEMPT_STATUSES.has(latestStatus) || RETAINED_ATTEMPT_STATUSES.has(latestStatus));
    if (!isOrphaned) continue;

    const existing = workers.query((w) => w.sessionId === sessionId)[0];
    workers.upsert({
      workerId: existing?.workerId ?? sessionId,
      workUnitId,
      sessionId,
      status: "crashed",
      startedAt: existing?.startedAt ?? nowIso,
      terminatedAt: nowIso,
    });
  }
}
