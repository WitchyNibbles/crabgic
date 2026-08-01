/**
 * A minimal recording `adjudication_decision` sink for this package's own
 * tests — the capability-quarantine journaling seam (interface-ledger Gap
 * 5's resolution) writes through a one-method sink, exactly like
 * `@crabgic/contracts`'s `ApprovalTokenMintSink`, so a test never needs a
 * real on-disk `JournalStore` to assert what was appended.
 *
 * `onAppend` runs BEFORE the entry is recorded, which is how the
 * journal-first ordering tests observe the store's on-disk state at the
 * exact moment the append happens (and how the fail-closed tests make an
 * append reject).
 *
 * Not part of this package's public barrel (`../index.ts`) — test
 * scaffolding only.
 */
import type {
  CapabilityAuditJournalEntryInput,
  CapabilityAuditJournalSink,
} from "../capability-store/audit-journal.js";

export interface RecordingJournal extends CapabilityAuditJournalSink {
  readonly entries: readonly CapabilityAuditJournalEntryInput[];
}

export function createRecordingJournal(
  onAppend?: (input: CapabilityAuditJournalEntryInput) => void,
): RecordingJournal {
  const entries: CapabilityAuditJournalEntryInput[] = [];
  return {
    entries,
    async appendEntry(input) {
      onAppend?.(input);
      entries.push(input);
      return input;
    },
  };
}

/** A sink that always rejects — the fail-closed fixture. */
export function createFailingJournal(
  message = "journal append failed",
): CapabilityAuditJournalSink {
  return {
    async appendEntry() {
      throw new Error(message);
    },
  };
}
