/**
 * `verifyChain` — roadmap/04-journal-idempotency-leases.md §Interfaces
 * produced: "`verifyChain(segment)` / tail repair — truncates to the last
 * valid chained entry, returns a structured report."; work item 3:
 * "a corrupted-tail fixture (valid chain truncated mid-entry) fails
 * verification before the repair path exists."
 *
 * See docs/evidence/phase-04/wi3-chain-snapshot-failing.txt for the
 * failing-first evidence captured against the prior permissive no-op stub
 * (always reporting every line as valid regardless of content) before
 * this real verification implementation landed.
 */

import type { JournalEntry } from "../codec/journal-entry.js";
import type { FsPort } from "./fs-port.js";
import { computeEntryHash, GENESIS_PREV_HASH } from "../codec/hash-chain.js";
import { tryDecodeLine } from "../codec/ndjson-codec.js";

export type ChainVerificationIssueKind =
  "parse_error" | "hash_mismatch" | "prev_hash_mismatch" | "seq_gap";

export interface ChainVerificationIssue {
  readonly kind: ChainVerificationIssueKind;
  readonly lineIndex: number;
  readonly detail: string;
}

export interface ChainVerificationReport {
  readonly segmentFilePath: string;
  /** Total raw (newline-delimited, non-empty) lines observed in the file, valid or not. */
  readonly totalLines: number;
  readonly validEntries: readonly JournalEntry[];
  readonly firstIssue?: ChainVerificationIssue;
  /** Byte offset in the file immediately after the last valid entry's trailing newline — the safe truncation point. */
  readonly lastValidByteLength: number;
  /** Bytes in the file from `lastValidByteLength` onward — 0 when the whole file is a valid chain. */
  readonly truncatedTrailingBytes: number;
}

/**
 * Verifies one segment file's internal hash chain, starting from
 * `expectedInitialPrevHash` (defaults to the journal genesis constant —
 * pass the previous segment's own last valid hash when verifying a
 * non-first segment as part of a whole-journal scan; the orchestrated
 * `verifyJournal`/`repairJournal` in `./verify-journal.js`/`./repair-
 * journal.js` do exactly this and are the SAFE surface for a rotated,
 * multi-segment journal — this function verifies exactly one segment in
 * isolation and knows nothing about sibling segments).
 *
 * `expectedInitialSeq` (VALIDATION ROUND 2026-07-18, MAJOR 1 fix):
 * optional — when supplied, the FIRST valid entry's `seq` is checked
 * against it too (in addition to internal monotonicity from there on),
 * closing the gap where per-segment verification alone could not detect
 * a duplicate/skipped `seq` exactly at a segment boundary (the global
 * `seq` counter is never reset per segment — see `../store/append-
 * entry.ts`'s own file-level doc comment). `undefined` (the default)
 * preserves this function's original single-segment behavior: accept
 * whatever `seq` the first entry carries, and only check monotonicity
 * from there.
 */
export async function verifyChain(
  fs: FsPort,
  segmentFilePath: string,
  expectedInitialPrevHash: string = GENESIS_PREV_HASH,
  expectedInitialSeq?: number,
): Promise<ChainVerificationReport> {
  let content: string;
  try {
    content = await fs.readFile(segmentFilePath);
  } catch {
    return {
      segmentFilePath,
      totalLines: 0,
      validEntries: [],
      lastValidByteLength: 0,
      truncatedTrailingBytes: 0,
    };
  }

  if (content.length === 0) {
    return {
      segmentFilePath,
      totalLines: 0,
      validEntries: [],
      lastValidByteLength: 0,
      truncatedTrailingBytes: 0,
    };
  }

  const hasTrailingNewline = content.endsWith("\n");
  const rawLines = content.split("\n");
  // A well-formed file ends with "\n", so split() leaves a trailing "" —
  // drop it. A torn write does NOT end with "\n", so every raw segment
  // (including the incomplete final one) is a real line to examine.
  const lines = hasTrailingNewline ? rawLines.slice(0, -1) : rawLines;

  const validEntries: JournalEntry[] = [];
  let expectedPrevHash = expectedInitialPrevHash;
  let expectedSeq: number | undefined = expectedInitialSeq;
  let consumedBytes = 0;
  let firstIssue: ChainVerificationIssue | undefined;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const rawLine = lines[lineIndex]!;
    const lineByteLength = Buffer.byteLength(rawLine, "utf8") + 1; // +1 for the trailing "\n" this line owns when well-formed

    if (rawLine.length === 0) {
      firstIssue = { kind: "parse_error", lineIndex, detail: "unexpected empty line" };
      break;
    }

    const decoded = tryDecodeLine(rawLine);
    if (!decoded.ok) {
      firstIssue = {
        kind: "parse_error",
        lineIndex,
        detail: decoded.error ?? "unknown parse error",
      };
      break;
    }
    const entry = decoded.entry!;

    if (entry.prevHash !== expectedPrevHash) {
      firstIssue = {
        kind: "prev_hash_mismatch",
        lineIndex,
        detail: `expected prevHash "${expectedPrevHash}", got "${entry.prevHash}"`,
      };
      break;
    }

    const recomputedHash = computeEntryHash(entry as unknown as Record<string, unknown>);
    if (recomputedHash !== entry.hash) {
      firstIssue = {
        kind: "hash_mismatch",
        lineIndex,
        detail: `recomputed hash "${recomputedHash}" does not match stored hash "${entry.hash}"`,
      };
      break;
    }

    if (expectedSeq !== undefined && entry.seq !== expectedSeq) {
      firstIssue = {
        kind: "seq_gap",
        lineIndex,
        detail: `expected seq ${expectedSeq}, got ${entry.seq}`,
      };
      break;
    }

    validEntries.push(entry);
    expectedPrevHash = entry.hash;
    expectedSeq = entry.seq + 1;
    consumedBytes += lineByteLength;
  }

  const totalBytes = Buffer.byteLength(content, "utf8");
  return {
    segmentFilePath,
    totalLines: lines.length,
    validEntries,
    ...(firstIssue !== undefined ? { firstIssue } : {}),
    lastValidByteLength: consumedBytes,
    truncatedTrailingBytes: totalBytes - consumedBytes,
  };
}
