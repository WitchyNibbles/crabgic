/**
 * Work-unit attempt tracking — roadmap/04-journal-idempotency-leases.md §In
 * scope: "every `WorkUnit` (02) attempt persisted with its engine
 * `session_id` and a status typed against `WorkUnitAttemptStatus` (02)...
 * `parked:rate_limit` retains `session_id` so a later `resume` can continue
 * the same engine conversation."; §Interfaces produced: "`recordAttempt
 * (workUnitId, sessionId, status: WorkUnitAttemptStatus)` — consumed by 05
 * (worker lifecycle) and 13 (limit parking, fan-out)."
 *
 * Entries are `work_unit_transition` (02's `JournalEntryType` member
 * dedicated to exactly this) — `WorkUnitTransitionPayloadSchema`
 * (`../codec/journal-payloads.ts`) already carries `status`,
 * `previousStatus?`, `sessionId?`. `workUnitId` is carried as the entry
 * ENVELOPE's own correlation field (`../codec/journal-entry.ts`), not
 * duplicated inside the payload — this is what lets `getLatestAttempt`
 * reuse `queryEntries`'s existing `workUnitId` filter directly rather than
 * a manual payload-level scan.
 */

import type { WorkUnitAttemptStatus } from "@crabgic/contracts";
import type { JournalEntry } from "./codec/journal-entry.js";
import type { JournalStore } from "./store/journal-store.js";

export interface WorkUnitAttemptRecord {
  readonly workUnitId: string;
  readonly sessionId?: string;
  readonly status: WorkUnitAttemptStatus;
  readonly previousStatus?: WorkUnitAttemptStatus;
  readonly seq: number;
  readonly timestamp: string;
}

/** Exported for direct unit-testing of the defensive type-guard branch below (see attempts.test.ts) — not otherwise part of the module's intended public call surface (the barrel does not re-export it). */
export function toAttemptRecord(entry: JournalEntry): WorkUnitAttemptRecord {
  if (entry.type !== "work_unit_transition") {
    throw new Error(
      `journal: expected a work_unit_transition entry, got "${entry.type}" (seq ${String(entry.seq)})`,
    );
  }
  return {
    workUnitId: entry.workUnitId ?? "",
    status: entry.payload.status,
    seq: entry.seq,
    timestamp: entry.timestamp,
    ...(entry.payload.sessionId !== undefined ? { sessionId: entry.payload.sessionId } : {}),
    ...(entry.payload.previousStatus !== undefined
      ? { previousStatus: entry.payload.previousStatus }
      : {}),
  };
}

/**
 * Persists one work-unit attempt (`work_unit_transition`), carrying
 * `sessionId` durably in the payload — the field the `parked:rate_limit`
 * exit criterion depends on surviving a crash+recover cycle.
 * `previousStatus` is auto-populated from this work unit's own latest
 * prior attempt (a read-back convenience for humans/CLI readers; not
 * required for the closed-union round-trip itself — see
 * `../codec/journal-payloads.ts`).
 *
 * `runId` is an OPTIONAL 5th parameter (added, backward-compatible —
 * every pre-existing 4-arg call site keeps compiling unchanged),
 * threaded onto the entry's top-level envelope field exactly as
 * `session_assignment` entries already carry it (`../codec/journal-
 * entry.ts`'s `envelopeFields.runId`, already optional — no schema
 * change). CRASH-RECOVERY CORRECTNESS FIX: `@crabgic/journal`'s own
 * `recover(runId)` (`./store/snapshot-io.ts`) replays only entries
 * matching `queryEntries({ runId })`'s EXACT-match filter
 * (`./store/query-entries.ts`) — an entry with no `runId` at all is
 * invisible to it. Before this fix, EVERY `work_unit_transition` entry
 * this function wrote carried no `runId`, so `@crabgic/supervisor`'s
 * `recoverRun` could never see a work unit's true terminal status after
 * a restart and misreported genuinely succeeded workers as crashed. See
 * `@crabgic/scheduler`'s `executor.ts` and `@crabgic/supervisor`'s
 * `worker-lifecycle-manager.ts`, both of which now thread their own
 * already-in-scope `runId` through to every call here.
 */
/**
 * What an attempt cost, carried on its terminal transition.
 *
 * WHY IT LIVES HERE (2026-07-30). The engine reports usage on every result —
 * `WorkerResult.usage` carries `totalCostUsd` and token counts, normalized from
 * the SDK's own `total_cost_usd` — and NOTHING was writing it down. So the
 * system knew what each attempt cost for exactly as long as the attempt was in
 * memory, and no run could ever answer "what did that cost me". For a product
 * that spends the owner's own subscription, that is the number they feel.
 *
 * Carried on the existing `work_unit_transition` payload rather than in a new
 * entry type, because `JournalEntryType` is a CLOSED union and ledger Gap 5's
 * ruling is to reuse it. Optional, so every pre-existing call site and every
 * already-written entry stays valid — an attempt that reports no usage is not
 * an error, it is an attempt the engine told us nothing about.
 */
export interface WorkerAttemptUsage {
  /** Turns spent. The load-bearing cap under subscription auth, and always present on a real result. */
  readonly turnsUsed: number;
  /** Optional on `WorkerResult.usage` itself — the engine does not always report a cost. Explicitly admits `undefined` so a result carrying the key with no value threads through unchanged, rather than forcing every caller to strip it. */
  readonly totalCostUsd?: number | undefined;
}

export async function recordAttempt(
  store: JournalStore,
  workUnitId: string,
  sessionId: string,
  status: WorkUnitAttemptStatus,
  runId?: string,
  usage?: WorkerAttemptUsage,
): Promise<WorkUnitAttemptRecord> {
  const previous = await getLatestAttempt(store, workUnitId);

  const entry = await store.appendEntry({
    type: "work_unit_transition",
    ...(runId !== undefined ? { runId } : {}),
    workUnitId,
    payload: {
      status,
      sessionId,
      ...(previous !== undefined ? { previousStatus: previous.status } : {}),
      ...(usage !== undefined ? { usage } : {}),
    },
  });

  return toAttemptRecord(entry);
}

/**
 * The read-back path: the latest (highest `seq`) attempt recorded for
 * `workUnitId`, or `undefined` if none exists yet. Scans in ascending
 * `seq` order (the store's own `queryEntries` segment-order guarantee) and
 * keeps the last match — equivalent to, but without assuming, a
 * monotonically-increasing scan order beyond what `queryEntries` already
 * documents.
 */
export async function getLatestAttempt(
  store: JournalStore,
  workUnitId: string,
): Promise<WorkUnitAttemptRecord | undefined> {
  let latest: JournalEntry | undefined;
  for await (const entry of store.queryEntries({ type: "work_unit_transition", workUnitId })) {
    if (latest === undefined || entry.seq > latest.seq) latest = entry;
  }
  return latest === undefined ? undefined : toAttemptRecord(latest);
}
