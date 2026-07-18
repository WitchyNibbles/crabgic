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

import type { WorkUnitAttemptStatus } from "@eo/contracts";
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
 */
export async function recordAttempt(
  store: JournalStore,
  workUnitId: string,
  sessionId: string,
  status: WorkUnitAttemptStatus,
): Promise<WorkUnitAttemptRecord> {
  const previous = await getLatestAttempt(store, workUnitId);

  const entry = await store.appendEntry({
    type: "work_unit_transition",
    workUnitId,
    payload: {
      status,
      sessionId,
      ...(previous !== undefined ? { previousStatus: previous.status } : {}),
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
