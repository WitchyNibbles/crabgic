/**
 * Tail repair — roadmap/04-journal-idempotency-leases.md §In scope: "tail
 * repair on torn writes (truncate to the last valid chained entry, report
 * the truncation as its own entry)."
 *
 * DEVIATION (documented per this worker's brief): the repair record is
 * appended as an `adjudication_decision` entry. `JournalEntryType` is a
 * closed, 13-member union owned by phase 02 (interface-ledger Gap 5) that
 * this package cannot unilaterally extend, and none of the 13 members
 * names a "chain-integrity repair" event. `adjudication_decision` — "a
 * human or policy adjudication decision recorded against a Run or
 * WorkUnit" — is the closest existing fit: truncating a corrupted tail is
 * itself an automated POLICY decision about the journal's own integrity,
 * structurally the same shape as any other adjudication (a decision +
 * rationale), just with no single Run/WorkUnit subject (`subjectId` is
 * left absent for this usage — see `../codec/journal-payloads.ts`'s
 * `AdjudicationDecisionPayloadSchema`). This mirrors the precedent
 * roadmap/02's own Gap-5 text sets for phase 12's capability-audit
 * verdicts ("no clean dedicated member... that tension stays open"): a
 * real mismatch, flagged here rather than silently resolved, for
 * Reconcile/the phase-02 owner to confirm or assign a dedicated member.
 */

import { dirname } from "node:path";
import { appendEntry } from "./append-entry.js";
import { durablyTruncateFile } from "./durable-io.js";
import { GENESIS_PREV_HASH } from "../codec/hash-chain.js";
import type { JournalStoreConfig } from "./store-config.js";
import { verifyChain, type ChainVerificationIssue } from "./verify-chain.js";

export interface ChainRepairReport {
  readonly segmentFilePath: string;
  /** `false` when the segment was already fully valid — a no-op, nothing truncated or appended. */
  readonly repaired: boolean;
  readonly discardedLineCount: number;
  readonly discardedByteLength: number;
  /** The last valid entry's `seq` retained after repair — absent if the segment held zero valid entries. */
  readonly truncatedToSeq?: number;
  /** The `seq` of the newly appended `adjudication_decision` repair-report entry — absent when `repaired` is `false`. */
  readonly repairEntrySeq?: number;
}

/** Only ever called once the caller has confirmed `report.firstIssue` is defined — a defensive `undefined` branch here would be dead code, unreachable by construction. */
function issueSummary(issue: ChainVerificationIssue): string {
  return `${issue.kind} at line ${issue.lineIndex} (${issue.detail})`;
}

/**
 * Verifies `segmentFilePath`; if corrupted, durably truncates it to the
 * last valid chained entry and appends an `adjudication_decision` entry
 * (chained onto that last valid entry) recording the repair. No-op if the
 * segment was already fully valid.
 *
 * PER-SEGMENT ONLY (VALIDATION ROUND 2026-07-18 note): this function knows
 * nothing about sibling segments — `expectedInitialPrevHash` MUST be
 * genesis only for a journal's true first segment; for any other segment
 * of a rotated (multi-segment) journal, the caller must thread in that
 * prior segment's own last valid hash (exactly what `./repair-journal.js`'s
 * `repairJournal` does for the whole journal). Calling this directly
 * against a non-first segment with the defaulted genesis hash is the exact
 * MAJOR 1 defect the validation round found (`journal-store.ts`'s prior
 * `repairChain` convenience method did exactly that) — this low-level
 * function is kept, unchanged, for tests and power users who explicitly
 * want one named segment; `createJournalStore`'s own store surface no
 * longer exposes it as a convenience method for exactly this reason.
 */
export async function repairChain(
  config: JournalStoreConfig,
  segmentFilePath: string,
  expectedInitialPrevHash: string = GENESIS_PREV_HASH,
): Promise<ChainRepairReport> {
  const report = await verifyChain(config.fs, segmentFilePath, expectedInitialPrevHash);
  const lastValid = report.validEntries[report.validEntries.length - 1];

  if (report.firstIssue === undefined) {
    return {
      segmentFilePath,
      repaired: false,
      discardedLineCount: 0,
      discardedByteLength: 0,
      ...(lastValid !== undefined ? { truncatedToSeq: lastValid.seq } : {}),
    };
  }

  await durablyTruncateFile(
    config.fs,
    segmentFilePath,
    dirname(segmentFilePath),
    report.lastValidByteLength,
  );

  const rationale =
    `chain tail repair: segment "${segmentFilePath}" truncated after line ${report.validEntries.length} ` +
    `of ${report.totalLines} (${issueSummary(report.firstIssue)}); discarded ${report.truncatedTrailingBytes} bytes`;

  const repairEntry = await appendEntry(config, {
    type: "adjudication_decision",
    payload: { decision: "chain_tail_truncated", rationale },
  });

  return {
    segmentFilePath,
    repaired: true,
    discardedLineCount: report.totalLines - report.validEntries.length,
    discardedByteLength: report.truncatedTrailingBytes,
    ...(lastValid !== undefined ? { truncatedToSeq: lastValid.seq } : {}),
    repairEntrySeq: repairEntry.seq,
  };
}
