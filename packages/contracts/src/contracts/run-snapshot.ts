import { z } from "zod";
import { SchemaVersionField } from "../shared/schema-version.js";
import { IdSchema, TimestampSchema } from "../shared/ids.js";
import { RunLifecycleStateSchema } from "../state-machines/run-lifecycle.js";

/**
 * `RunSnapshot` (roadmap/02-contracts-and-schemas.md §In scope contract
 * list; "Interfaces produced" table row `RunSnapshot | 04 (implements
 * atomic write), 05, 13`). Written atomically via temp-file + rename
 * (roadmap/04-journal-idempotency-leases.md:17, "atomic `RunSnapshot` (02
 * schema) via temp-file + rename; recovery = load the latest snapshot +
 * replay journal entries after its sequence number"); loaded on supervisor
 * restart (05-supervisor-daemon.md:58,71, "`writeSnapshot(snapshot:
 * RunSnapshot)` / `loadLatestSnapshot(runId)` / `recover(runId): {
 * snapshot, replayed }`").
 *
 * Its run-state field reuses the existing run-lifecycle state union from
 * `../state-machines/run-lifecycle.js` verbatim (never a re-typed string
 * list), per this task's own explicit instruction and matching
 * `ChangeSet.state`'s identical reuse above.
 */
export const RunSnapshotSchema = z
  .object({
    schemaVersion: SchemaVersionField,

    /** This snapshot instance's own identity (one write per atomic temp-file+rename cycle). */
    id: IdSchema,

    /**
     * The run this snapshot captures — 04's `writeSnapshot`/
     * `loadLatestSnapshot(runId)`/`recover(runId)` all key off this id
     * (04:42,57; 05:58). No `Run` schema exists among this phase's 21
     * contracts (roadmap/02 §In scope contract list has no separate `Run`
     * entry) — `runId` is an opaque identifier the supervisor (05) assigns
     * to a run, analogous to how `session_id` is an opaque engine string
     * elsewhere; this phase does not model a `Run` contract, only its
     * snapshot.
     */
    runId: IdSchema,

    /**
     * Cross-reference to the `ChangeSet` this run is executing. Journal
     * query filters treat `runId` and `changeSetId` as distinct fields
     * (04:40, "`queryEntries(filter: { type?: JournalEntryType; runId?;
     * changeSetId?; workUnitId? })`"), confirming they are separate ids,
     * not aliases of one another — hence this explicit cross-reference
     * rather than reusing `runId` for both purposes.
     */
    changeSetId: IdSchema,

    /**
     * The run's lifecycle state at snapshot time — reuses
     * `RunLifecycleStateSchema` (11 members), never a re-typed string list
     * (this task's own explicit instruction).
     */
    runState: RunLifecycleStateSchema,

    /**
     * The journal sequence number after which recovery must replay entries
     * (04:17, "recovery = load the latest snapshot + replay journal
     * entries after its sequence number").
     */
    journalSequenceNumber: z.number().int().nonnegative(),

    /** When this snapshot was atomically written. */
    capturedAt: TimestampSchema,
  })
  .strict();

export type RunSnapshot = z.infer<typeof RunSnapshotSchema>;
