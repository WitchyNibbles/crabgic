/**
 * Minimal journal-appending surface for this phase's own two `JournalEntryType`
 * members (`cas_ref_update`, `evidence_pointer`) — roadmap/08-integration-
 * publication.md §Interfaces produced: "Every attempt is journaled as a
 * `cas_ref_update`-typed entry ... via 04's journal (transitively available
 * through 07)."
 *
 * Deliberately a SEPARATE, phase-08-owned file rather than an edit to 07's
 * `./journal-appender.js` (whose `GitEngineJournalEntryInput` union is
 * closed over exactly 07's two members, `git_freeze`/`worktree_quarantine` —
 * see `./journal-entry-type-compliance.test.ts`'s own exit-criterion
 * assertion that 07 writes "exactly two members, never a 3rd"). Extending
 * that union here would both violate 07's own closed exit criterion and
 * blur the module boundary the roadmap's Risks section asks this phase to
 * keep clean. Instead this module types directly against `@eo/journal`'s
 * OWN generic `JournalStore`/`JournalEntryInput` surface (already a
 * declared dependency of this package), structurally narrowed to just the
 * `appendEntry` method every caller here needs.
 */

import type { EvidenceRecord } from "@eo/contracts";
import type { JournalEntryInput, JournalStore } from "@eo/journal";

export type { JournalEntryInput } from "@eo/journal";

/** Structural subset of `@eo/journal`'s `JournalStore` — every function in this phase's own files that journals only ever needs `appendEntry`. */
export type IntegrationJournalAppender = Pick<JournalStore, "appendEntry">;

/** This phase's own two `JournalEntryType` members (roadmap §Interfaces consumed: "the `cas_ref_update` and `evidence_pointer` members"). */
export const INTEGRATION_JOURNAL_ENTRY_TYPES = ["cas_ref_update", "evidence_pointer"] as const;
export type IntegrationJournalEntryType = (typeof INTEGRATION_JOURNAL_ENTRY_TYPES)[number];

/** Builds a `cas_ref_update`-typed `JournalEntryInput`, correlation ids included only when supplied (never `undefined`-valued keys, matching this repo's `exactOptionalPropertyTypes` convention). */
export function buildCasRefUpdateEntryInput(
  ref: string,
  objectId: string,
  correlation: {
    readonly runId?: string;
    readonly changeSetId?: string;
    readonly workUnitId?: string;
  } = {},
): JournalEntryInput {
  return {
    type: "cas_ref_update",
    payload: { ref, objectId },
    ...(correlation.runId !== undefined ? { runId: correlation.runId } : {}),
    ...(correlation.changeSetId !== undefined ? { changeSetId: correlation.changeSetId } : {}),
    ...(correlation.workUnitId !== undefined ? { workUnitId: correlation.workUnitId } : {}),
  };
}

/** Builds an `evidence_pointer`-typed `JournalEntryInput` wrapping an already-constructed `EvidenceRecord` (the payload schema for this member IS `EvidenceRecordSchema` verbatim — `@eo/journal`'s own `journal-payloads.ts`). */
export function buildEvidencePointerEntryInput(
  evidenceRecord: EvidenceRecord,
  changeSetId: string,
): JournalEntryInput {
  return { type: "evidence_pointer", payload: evidenceRecord, changeSetId };
}
