/**
 * `evidence <change-set-id>` query — roadmap/09-cli-and-doctor.md §In scope:
 * "a real query over 04's journal from this phase's own build onward...
 * Returns every journaled `EvidenceRecord` (02) for that `ChangeSet`...
 * Content is sparse before 11 creates `ChangeSet`s... it degrades
 * gracefully... rather than erroring." An `evidence_pointer` journal entry's
 * `payload` deserializes as `EvidenceRecord` verbatim (`@eo/journal`'s own
 * codec property) — this module reads through `JournalStore.queryEntries`
 * directly; it never re-implements journal scanning.
 */
import type { EvidenceRecord } from "@eo/contracts";
import type { JournalStore } from "@eo/journal";

export interface EvidenceReport {
  readonly changeSetId: string;
  readonly records: readonly EvidenceRecord[];
}

export interface EvidenceQueryOptions {
  readonly journal: Pick<JournalStore, "queryEntries">;
  readonly changeSetId: string;
}

/**
 * Returns every `EvidenceRecord` journaled (as an `evidence_pointer` entry)
 * against `changeSetId`. An empty result is a VALID report, not an error —
 * exercised explicitly by work item 7's own failing-first framing:
 * "querying a fresh ChangeSet fixture with zero records returns an
 * empty-but-valid report, not an error."
 */
export async function queryEvidence(options: EvidenceQueryOptions): Promise<EvidenceReport> {
  const records: EvidenceRecord[] = [];
  for await (const entry of options.journal.queryEntries({
    type: "evidence_pointer",
    changeSetId: options.changeSetId,
  })) {
    if (entry.type === "evidence_pointer") {
      records.push(entry.payload);
    }
  }
  return { changeSetId: options.changeSetId, records };
}
