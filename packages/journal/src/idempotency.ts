/**
 * `IdempotencyRegistry` — roadmap/04-journal-idempotency-leases.md §In
 * scope: "keyed `(operationId, contentHash)`. Same id + same hash ->
 * returns the previously recorded result byte-identical, no re-execution.
 * Same id + different hash -> typed conflict failure, never a silent
 * overwrite."; §Interfaces produced: "`IdempotencyRegistry.checkOrRecord
 * (operationId, contentHash, compute)` -> `{ status: "replayed" |
 * "recorded" | "conflict", result? }`."
 *
 * JOURNAL ENTRY TYPE DECISION (work item 5 asks this worker to "decide and
 * document"): every record this registry writes is a `remote_operation_record`
 * entry. `JOURNAL_ENTRY_TYPE_DESCRIPTIONS.remote_operation_record` (02) is
 * itself captioned "A pre-I/O record of a planned remote mutation (16's
 * idempotency registry, 04)" — 02 already designed this entry type's
 * `operationId`/`contentHash`/`status` fields to double as 04's own
 * idempotency-registry storage row, not solely as 16's pipeline-internal
 * bookkeeping. This registry is generic (also backs 08's CAS-ref rebuild
 * loop per roadmap/04's own text), but `RemoteOperationRecordSchema` (02,
 * out of this package's authority to extend) is the ONLY one of the 13
 * closed `JournalEntryType` members shaped for exactly this
 * (operationId, contentHash, status) triple, so it is used for every
 * caller, not just 16's real `RemoteMutationPlan` pipeline:
 *
 *   - `operationId`/`contentHash` map directly onto this registry's own key.
 *   - `status`: "recorded" while newly written; "conflict" is never
 *     persisted as its own entry (see below) — only "recorded" is ever
 *     written by this module.
 *   - `remoteMutationPlanId` (required by 02's schema, IdSchema/UUID):
 *     generic, non-16 callers have no real `RemoteMutationPlan` to point
 *     at, so this field is set to the SAME freshly generated UUID as the
 *     record's own `id` — a documented self-referential placeholder, never
 *     a fabricated foreign key into a real plan. Real 16 callers whose
 *     `compute()` closure already knows its own `RemoteMutationPlan` id are
 *     free to fold that id into the JSON-serialized `result` they return
 *     from `compute()` (see below) — this primitive doesn't lose that
 *     information, it just doesn't thread a 4th constructor parameter
 *     through the fixed 3-parameter `checkOrRecord` signature 04's own
 *     interfaces-produced text specifies.
 *   - `appliedRevision` (free `NonEmptyStringSchema` text, no format
 *     constraint beyond non-empty): reused to carry
 *     `JSON.stringify({ value: result })` — the ARBITRARY, generic
 *     `compute()` result this registry must round-trip byte-identically.
 *     `RemoteOperationRecordSchema` has no dedicated free-form "result"
 *     field (02 didn't design one — this entry type's real fields are
 *     status/appliedRevision/errorKind, not an opaque payload slot), so
 *     `appliedRevision` is the only available strict-schema-legal carrier;
 *     wrapping in `{ value }` (rather than bare `JSON.stringify(result)`)
 *     handles `result === undefined` correctly (`JSON.stringify(undefined)`
 *     is the JS value `undefined`, not a string, which would fail
 *     `NonEmptyStringSchema`).
 *   - `errorKind` is never set by this module (only meaningful for a
 *     16-mapped connector failure, out of this generic primitive's scope).
 *
 * CONFLICT HANDLING: a conflicting write (same operationId, different
 * contentHash) is NEVER itself journaled. The invariant this phase demands
 * — "never a silent overwrite" — is satisfied by refusing to write at all
 * once an operationId already has a recorded entry; there is no need to
 * additionally persist the REJECTED attempt as its own fact for this
 * primitive to be correct (a caller that wants an audit trail of rejected
 * attempts can log that itself; 04 doesn't own that decision).
 *
 * CONCURRENCY (documented limitation, mirroring `lease.ts`'s own
 * documented residual-race precedent): this registry's `checkOrRecord` is
 * safe under SEQUENTIAL calls with correct persistence and reference-model
 * behavior (proven by this file's own fast-check property suite). It is
 * NOT safe against two truly concurrent, overlapping first-time calls for
 * the SAME never-before-seen `operationId` — both could observe "no prior
 * record" before either persists, and both would append a
 * `remote_operation_record` entry. Closing this fully requires a
 * lease-style atomic claim this primitive does not implement; production
 * callers with genuine concurrent first-writers should serialize calls for
 * the same `operationId` themselves (e.g. via 05's per-work-unit
 * scheduling) until a future phase adds one.
 */

import { randomUUID } from "node:crypto";
import type { RemoteOperationRecord } from "@eo/contracts";
import { CURRENT_SCHEMA_VERSION, type JournalEntry } from "./codec/journal-entry.js";
import type { JournalStore } from "./store/journal-store.js";

export type IdempotencyStatus = "replayed" | "recorded" | "conflict";

export interface IdempotencyOutcome<T> {
  readonly status: IdempotencyStatus;
  readonly result?: T;
  /** Present only when `status === "conflict"` — the contentHash the ORIGINAL record was recorded with, for a caller that wants to report what it conflicts with. */
  readonly existingContentHash?: string;
}

/** The `{ value: T }` envelope this module JSON-serializes into `appliedRevision` — see file-level doc comment. */
interface ResultEnvelope<T> {
  readonly value: T;
}

function encodeResult<T>(result: T): string {
  return JSON.stringify({ value: result } satisfies ResultEnvelope<T>);
}

function decodeResult<T>(serialized: string): T {
  return (JSON.parse(serialized) as ResultEnvelope<T>).value;
}

/**
 * Defensive type guard: `appendEntry` is always called here with
 * `type: "remote_operation_record"`, so the returned entry should always
 * carry that same discriminant — this narrows the type and fails loudly if
 * that invariant is ever violated (e.g. by a future codec bug), rather
 * than silently returning a wrongly-typed payload. Exported for direct
 * unit-testing of this branch (see idempotency.test.ts) — not otherwise
 * part of the module's intended public call surface.
 */
export function assertRemoteOperationRecordEntry(entry: JournalEntry): RemoteOperationRecord {
  if (entry.type !== "remote_operation_record") {
    throw new Error(
      `journal: appendEntry returned an entry of the wrong type ("${entry.type}") for remote_operation_record`,
    );
  }
  return entry.payload;
}

/**
 * Journal-backed idempotency registry (roadmap/04 work item 5). One
 * instance may be constructed per process, but persistence lives entirely
 * in the journal — a fresh instance pointed at the same store replays
 * correctly with no warm-up (proven by this file's own "survives a
 * brand-new instance" test), matching the durability this phase requires.
 */
export class IdempotencyRegistry {
  readonly #store: JournalStore;
  /** Lazily built, keyed by `operationId` — avoids a full journal scan on construction; built on first `checkOrRecord` call and kept warm afterward. */
  #index: Map<string, RemoteOperationRecord> | undefined;

  constructor(store: JournalStore) {
    this.#store = store;
  }

  /**
   * VALIDATION ROUND (2026-07-18) fix, MINOR 3: `result` is JSON-round-
   * tripped (`JSON.stringify`/`JSON.parse`, via `appliedRevision` — see the
   * file-level doc comment) on EVERY call, including the very first
   * ("recorded") one — not just on later "replayed" calls. Before this
   * fix, the first caller received the raw `compute()` return value while
   * every later replaying caller received the JSON-coerced one, so the two
   * could silently diverge (`Date` -> ISO string, `NaN`/`Infinity`/
   * `-Infinity` -> `null`, `undefined`-valued object members dropped).
   * This means `result`'s value domain is restricted to what JSON can
   * represent byte-identically: a caller needing a richer type (Map, Set,
   * class instance, bigint, …) must serialize/deserialize it themselves
   * around this call — `checkOrRecord` guarantees "recorded" and every
   * later "replayed" call for the same `(operationId, contentHash)`
   * observe the exact same JSON-value-domain result, never that the
   * result equals whatever `compute()` literally returned.
   *
   * CONCURRENCY (mirroring `lease.ts`'s own documented residual-race
   * precedent, unchanged by this validation round — see this file's own
   * "CONCURRENCY" doc-comment section above for the full rationale): this
   * method is proven correct under SEQUENTIAL calls only. Two truly
   * concurrent, overlapping FIRST-time calls for the same never-before-seen
   * `operationId` can both observe "no prior record" before either
   * persists, and both would append a `remote_operation_record` entry —
   * closing this fully requires a lease-style atomic claim this primitive
   * does not implement. Production callers with genuine concurrent
   * first-writers for the same `operationId` must serialize those calls
   * themselves (e.g. via 05's per-work-unit scheduling).
   */
  async checkOrRecord<T>(
    operationId: string,
    contentHash: string,
    compute: () => T | Promise<T>,
  ): Promise<IdempotencyOutcome<T>> {
    const index = await this.#ensureIndex();
    const existing = index.get(operationId);

    if (existing !== undefined) {
      if (existing.contentHash === contentHash) {
        return { status: "replayed", result: decodeResult<T>(existing.appliedRevision ?? "") };
      }
      return { status: "conflict", existingContentHash: existing.contentHash };
    }

    const result = await compute();
    const record = await this.#persist(operationId, contentHash, result);
    index.set(operationId, record);
    // Round-trip through the same JSON encoding replay uses, so "recorded"
    // and every later "replayed" call return byte-identical values — see
    // this method's own doc comment above.
    return { status: "recorded", result: decodeResult<T>(record.appliedRevision ?? "") };
  }

  async #ensureIndex(): Promise<Map<string, RemoteOperationRecord>> {
    if (this.#index !== undefined) return this.#index;
    const index = new Map<string, RemoteOperationRecord>();
    for await (const entry of this.#store.queryEntries({ type: "remote_operation_record" })) {
      if (entry.type !== "remote_operation_record") continue;
      // First writer wins in the index too, matching the journal's own
      // append-only, never-silently-overwritten invariant: if somehow more
      // than one entry exists for the same operationId (should never
      // happen via this module, but defensive against hand-crafted
      // fixtures), the earliest-appended one is authoritative.
      if (!index.has(entry.payload.operationId)) {
        index.set(entry.payload.operationId, entry.payload);
      }
    }
    this.#index = index;
    return index;
  }

  async #persist<T>(
    operationId: string,
    contentHash: string,
    result: T,
  ): Promise<RemoteOperationRecord> {
    const id = randomUUID();
    const entry = await this.#store.appendEntry({
      type: "remote_operation_record",
      payload: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id,
        remoteMutationPlanId: id,
        operationId,
        contentHash,
        status: "recorded",
        appliedRevision: encodeResult(result),
        recordedAt: this.#store.config.clock(),
      },
    });
    return assertRemoteOperationRecordEntry(entry);
  }
}
