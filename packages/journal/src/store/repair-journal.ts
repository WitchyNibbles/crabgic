/**
 * `repairJournal` — VALIDATION ROUND (2026-07-18) fix, MAJOR 1: the SAFE,
 * whole-journal repair surface. Repairs ONLY a torn TAIL — corruption in
 * the journal's final invalid point when nothing decodable exists anywhere
 * after it (see `./verify-journal.ts`'s `isTailPosition`). Historical/mid-
 * journal corruption (tamper, not a torn write — roadmap/04-journal-
 * idempotency-leases.md's own "the property distinguishing integrity-
 * checking from mere corruption-recovery") makes this function REFUSE via
 * `JournalTamperedError`, naming exactly where the corruption was found,
 * rather than silently discarding already-committed, still-present data.
 */

import { GENESIS_PREV_HASH } from "../codec/hash-chain.js";
import { repairChain, type ChainRepairReport } from "./repair-chain.js";
import type { JournalStoreConfig } from "./store-config.js";
import {
  verifyJournal,
  type JournalFirstInvalidPoint,
  type JournalVerificationReport,
} from "./verify-journal.js";

/**
 * Thrown by `repairJournal` when the first invalid point found is NOT at
 * tail position — i.e. this is historical/mid-journal corruption (tamper),
 * not a torn write, and repairing it would silently discard real,
 * already-committed data. Names the exact segment/line/reason so a caller
 * can investigate rather than blindly truncate.
 */
export class JournalTamperedError extends Error {
  readonly segmentIndex: number;
  readonly segmentFilePath: string;
  readonly lineIndex: number;
  readonly issueKind: string;

  constructor(point: JournalFirstInvalidPoint) {
    super(
      `journal: historical (mid-journal) corruption detected in segment "${point.segmentFilePath}" ` +
        `at line ${point.issue.lineIndex} (${point.issue.kind}: ${point.issue.detail}) — this is NOT ` +
        `a torn tail write (at least one later, decodable entry still exists past this point), so ` +
        `repairJournal refuses to truncate it. This looks like tamper, not corruption-recovery — investigate before touching this segment.`,
    );
    this.name = "JournalTamperedError";
    this.segmentIndex = point.segmentIndex;
    this.segmentFilePath = point.segmentFilePath;
    this.lineIndex = point.issue.lineIndex;
    this.issueKind = point.issue.kind;
  }
}

export interface JournalRepairReport {
  readonly verification: JournalVerificationReport;
  /** `false` when the journal was already fully valid — a no-op, nothing repaired. */
  readonly repaired: boolean;
  readonly segmentRepair?: ChainRepairReport;
}

/**
 * Verifies the whole journal (`verifyJournal`); if it is already fully
 * valid, returns a no-op report. If the first invalid point is at TAIL
 * position, durably truncates ONLY that segment back to its own last valid
 * entry (via the low-level per-segment `repairChain`, given the CORRECT
 * `expectedInitialPrevHash` threaded in from every prior segment — the
 * exact threading `journal-store.ts`'s prior default-genesis convenience
 * method never did) and appends the tail-repair report entry, whose `seq`
 * naturally continues from the true last valid entry ACROSS segments (see
 * `../store/append-entry.ts`'s `readLastEntryAcrossSegments` fix). If the
 * first invalid point is NOT at tail position, throws `JournalTamperedError`
 * instead of repairing anything.
 */
export async function repairJournal(config: JournalStoreConfig): Promise<JournalRepairReport> {
  const verification = await verifyJournal(config);
  if (verification.firstInvalid === undefined) {
    return { verification, repaired: false };
  }
  if (!verification.firstInvalid.isTailPosition) {
    throw new JournalTamperedError(verification.firstInvalid);
  }

  const { segmentIndex, segmentFilePath } = verification.firstInvalid;
  let expectedInitialPrevHashForSegment = GENESIS_PREV_HASH;
  for (const segment of verification.segments) {
    if (segment.segmentIndex >= segmentIndex) break;
    if (segment.report.validEntries.length > 0) {
      const last = segment.report.validEntries[segment.report.validEntries.length - 1]!;
      expectedInitialPrevHashForSegment = last.hash;
    }
  }

  const segmentRepair = await repairChain(
    config,
    segmentFilePath,
    expectedInitialPrevHashForSegment,
  );
  const reVerification = await verifyJournal(config);
  return { verification: reVerification, repaired: true, segmentRepair };
}
