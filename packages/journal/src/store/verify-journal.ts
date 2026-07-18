/**
 * `verifyJournal` — VALIDATION ROUND (2026-07-18) fix, MAJOR 1: whole-
 * journal recovery orchestration in the store layer, roadmap/04-journal-
 * idempotency-leases.md's own text distinguishing TAIL REPAIR (a torn
 * write) from post-hoc historical tamper ("the property distinguishing
 * integrity-checking from mere corruption-recovery").
 *
 * `./verify-chain.ts`'s `verifyChain` verifies exactly ONE segment file in
 * isolation, given a caller-supplied starting `expectedInitialPrevHash`/
 * `expectedInitialSeq` — it has no idea a sibling segment even exists. A
 * rotated journal's segment N+1 chains onto segment N's own LAST valid
 * entry, never genesis (except for the very first segment ever). This
 * module is the ONE place that threads that chain across every segment
 * boundary, verifies the journal's global `seq` continuity end-to-end, and
 * — critically — decides whether the first invalid point it finds is a
 * TAIL position (safe to repair: nothing decodable exists anywhere after
 * it) or a MID-JOURNAL one (historical tamper: something decodable exists
 * later in the journal, so blindly truncating would silently discard
 * already-committed, still-present data — `./repair-journal.ts` REFUSES in
 * that case rather than repairing).
 */

import { GENESIS_PREV_HASH } from "../codec/hash-chain.js";
import { tryDecodeLine } from "../codec/ndjson-codec.js";
import type { JournalEntry } from "../codec/journal-entry.js";
import { listSegmentIndexes, segmentPath } from "./segment-layout.js";
import type { JournalStoreConfig } from "./store-config.js";
import {
  verifyChain,
  type ChainVerificationIssue,
  type ChainVerificationReport,
} from "./verify-chain.js";

export interface JournalVerificationSegmentReport {
  readonly segmentIndex: number;
  readonly segmentFilePath: string;
  readonly report: ChainVerificationReport;
}

export interface JournalFirstInvalidPoint {
  readonly segmentIndex: number;
  readonly segmentFilePath: string;
  readonly issue: ChainVerificationIssue;
  /**
   * `true` when nothing anywhere AFTER this point in the whole journal
   * (later raw lines in the same segment, or any later segment) decodes as
   * a schema-valid entry — consistent with a torn write that simply never
   * finished, safe for `repairJournal` to truncate. `false` means at least
   * one later, decodable entry exists past this point: this is NOT a torn
   * tail, it is historical/mid-journal corruption (tamper), and
   * `repairJournal` REFUSES rather than silently discarding real data.
   */
  readonly isTailPosition: boolean;
}

export interface JournalVerificationReport {
  readonly segments: readonly JournalVerificationSegmentReport[];
  readonly firstInvalid?: JournalFirstInvalidPoint;
  /** The last valid, chain-continuous entry across the WHOLE journal (up to `firstInvalid`, or the true last entry if the whole journal verifies clean). */
  readonly lastValidEntry?: JournalEntry;
  /** Total valid, chain-continuous entries counted up to (and not including) `firstInvalid`. */
  readonly totalValidEntries: number;
  readonly valid: boolean;
}

/** Every non-empty raw line in `segmentFilePath`, decoded-or-not — used only to answer "is there anything decodable here at all," never to trust chain continuity. */
async function segmentHasAnyDecodableLine(
  config: JournalStoreConfig,
  segmentFilePath: string,
): Promise<boolean> {
  let content: string;
  try {
    content = await config.fs.readFile(segmentFilePath);
  } catch {
    return false;
  }
  const lines = content.split("\n").filter((line) => line.length > 0);
  return lines.some((line) => tryDecodeLine(line).ok);
}

/**
 * Decides `isTailPosition` for an issue found at `report.firstIssue` within
 * the segment at `indexes[segmentPos]`: checks the REMAINING raw lines of
 * that same segment (past the issue's `lineIndex`) for any decodable line,
 * then every later segment in the journal.
 */
async function hasLaterDecodableEntry(
  config: JournalStoreConfig,
  indexes: readonly number[],
  segmentPos: number,
  report: ChainVerificationReport,
): Promise<boolean> {
  const issue = report.firstIssue;
  if (issue === undefined) return false;

  let content: string;
  try {
    content = await config.fs.readFile(report.segmentFilePath);
  } catch {
    content = "";
  }
  const hasTrailingNewline = content.endsWith("\n");
  const rawLines = content.split("\n");
  const lines = hasTrailingNewline ? rawLines.slice(0, -1) : rawLines;
  for (let lineIndex = issue.lineIndex + 1; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!;
    if (line.length > 0 && tryDecodeLine(line).ok) return true;
  }

  for (let pos = segmentPos + 1; pos < indexes.length; pos++) {
    const path = segmentPath(config.segmentsDir, indexes[pos]!);
    if (await segmentHasAnyDecodableLine(config, path)) return true;
  }
  return false;
}

/**
 * Verifies the WHOLE journal (every segment, in ascending index order),
 * threading `expectedInitialPrevHash`/`expectedInitialSeq` across every
 * segment boundary — segment N+1's expected initial `prevHash` is segment
 * N's own last valid entry's `hash` (genesis only for the very first
 * segment), and its expected initial `seq` is that same entry's `seq + 1`.
 * Stops accumulating valid entries at the first issue found anywhere in the
 * journal; later segments are still walked (to answer `isTailPosition`) but
 * contribute nothing to `totalValidEntries`/`lastValidEntry`.
 */
export async function verifyJournal(
  config: JournalStoreConfig,
): Promise<JournalVerificationReport> {
  const indexes = await listSegmentIndexes(config.fs, config.segmentsDir);
  const segments: JournalVerificationSegmentReport[] = [];

  let expectedPrevHash = GENESIS_PREV_HASH;
  let expectedSeq: number | undefined;
  let firstInvalid: JournalFirstInvalidPoint | undefined;
  let lastValidEntry: JournalEntry | undefined;
  let totalValidEntries = 0;

  for (let pos = 0; pos < indexes.length; pos++) {
    const segmentIndex = indexes[pos]!;
    const segmentFilePath = segmentPath(config.segmentsDir, segmentIndex);

    if (firstInvalid !== undefined) {
      // Already broken earlier in the journal — this segment's own report
      // is still recorded (introspection), but its chain state is
      // meaningless once a prior break already exists.
      const report = await verifyChain(config.fs, segmentFilePath, GENESIS_PREV_HASH);
      segments.push({ segmentIndex, segmentFilePath, report });
      continue;
    }

    const report = await verifyChain(config.fs, segmentFilePath, expectedPrevHash, expectedSeq);
    segments.push({ segmentIndex, segmentFilePath, report });
    totalValidEntries += report.validEntries.length;

    if (report.validEntries.length > 0) {
      lastValidEntry = report.validEntries[report.validEntries.length - 1]!;
      expectedPrevHash = lastValidEntry.hash;
      expectedSeq = lastValidEntry.seq + 1;
    }

    if (report.firstIssue !== undefined) {
      const isTailPosition = !(await hasLaterDecodableEntry(config, indexes, pos, report));
      firstInvalid = { segmentIndex, segmentFilePath, issue: report.firstIssue, isTailPosition };
    }
  }

  return {
    segments,
    ...(firstInvalid !== undefined ? { firstInvalid } : {}),
    ...(lastValidEntry !== undefined ? { lastValidEntry } : {}),
    totalValidEntries,
    valid: firstInvalid === undefined,
  };
}
