/**
 * `queryEntries` — roadmap/04-journal-idempotency-leases.md §Interfaces
 * produced: "`queryEntries(filter: { type?: JournalEntryType; runId?;
 * changeSetId?; workUnitId? }): AsyncIterable<JournalEntry>` — the
 * evidence/traceability read path; `type: "evidence_pointer"` results
 * deserialize as `EvidenceRecord` (02)."; work item 4: "a query-by-change-
 * set-id test fails against a stub supporting only full-segment scans."
 *
 * See docs/evidence/phase-04/wi4-query-failing.txt for the failing-first
 * evidence captured against the prior full-segment-scan-only stub (filter
 * ignored entirely) before real filtering landed. `evidence_pointer`
 * entries already deserialize as `EvidenceRecord` for free (the payload
 * schema IS `EvidenceRecordSchema` — see `../codec/journal-payloads.ts`),
 * since that's a property of the codec (work item 1), not this module.
 */

import { tryDecodeLine } from "../codec/ndjson-codec.js";
import type { JournalEntry } from "../codec/journal-entry.js";
import type { JournalEntryType } from "@eo/contracts";
import { listSegmentIndexes, segmentPath } from "./segment-layout.js";
import type { JournalStoreConfig } from "./store-config.js";

export interface JournalEntryFilter {
  readonly type?: JournalEntryType;
  readonly runId?: string;
  readonly changeSetId?: string;
  readonly workUnitId?: string;
}

function matchesFilter(entry: JournalEntry, filter: JournalEntryFilter): boolean {
  if (filter.type !== undefined && entry.type !== filter.type) return false;
  if (filter.runId !== undefined && entry.runId !== filter.runId) return false;
  if (filter.changeSetId !== undefined && entry.changeSetId !== filter.changeSetId) return false;
  if (filter.workUnitId !== undefined && entry.workUnitId !== filter.workUnitId) return false;
  return true;
}

/**
 * Scans every segment in ascending order, yielding every entry that
 * matches `filter` (AND semantics across whichever fields are supplied;
 * an empty filter yields everything). A line that fails to decode is
 * silently skipped here — recovering a corrupted tail is `repairChain`'s
 * dedicated job (work item 3), not this read path's.
 */
export async function* queryEntries(
  config: JournalStoreConfig,
  filter: JournalEntryFilter = {},
): AsyncGenerator<JournalEntry, void, void> {
  const indexes = await listSegmentIndexes(config.fs, config.segmentsDir);
  for (const index of indexes) {
    const path = segmentPath(config.segmentsDir, index);
    let content: string;
    try {
      content = await config.fs.readFile(path);
    } catch {
      continue;
    }
    const lines = content.split("\n").filter((line) => line.length > 0);
    for (const line of lines) {
      const decoded = tryDecodeLine(line);
      if (decoded.ok && matchesFilter(decoded.entry!, filter)) {
        yield decoded.entry!;
      }
    }
  }
}
