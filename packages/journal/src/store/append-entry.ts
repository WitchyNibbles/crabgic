/**
 * `appendEntry` — roadmap/04-journal-idempotency-leases.md §Interfaces
 * produced: "`appendEntry(entry: JournalEntryInput): Promise<JournalEntry>`
 * — typed against `JournalEntryType` (02); assigns `seq`, `prevHash`,
 * `hash`, `schemaVersion`; resolves only after `write -> fsync(file) ->
 * fsync(dir)` completes." This module also assigns `timestamp` (via the
 * config's injectable `clock`) — the remaining envelope field work item 1
 * lists alongside seq/prevHash/hash, and equally caller-independent.
 *
 * Rotation policy (documented decision): the CURRENT segment's stats are
 * checked BEFORE writing; if it has already crossed the size/age
 * threshold, THIS entry starts a fresh segment. This means the entry that
 * finally crosses the threshold still lands in the old segment, and the
 * next call after it rotates — a simple, easy-to-reason-about "rotate
 * before the next write" policy. The hash chain and `seq` counter are
 * global across the whole journal, never reset per segment: the "last
 * entry" lookup always reads the highest-indexed segment's own last line,
 * so a rotation never breaks the chain.
 */

import { toErrorMessage } from "../codec/error-message.js";
import { computeEntryHash, GENESIS_PREV_HASH } from "../codec/hash-chain.js";
import {
  CURRENT_SCHEMA_VERSION,
  FIRST_SEQ,
  JournalEntryInputSchema,
  JournalEntrySchema,
  type JournalEntry,
  type JournalEntryInput,
} from "../codec/journal-entry.js";
import { decodeLine, encodeEntryToLine } from "../codec/ndjson-codec.js";
import { durablyAppendLine } from "./durable-io.js";
import { listSegmentIndexes, segmentPath, shouldRotateSegment } from "./segment-layout.js";
import type { JournalStoreConfig } from "./store-config.js";

/** Thrown when the highest-indexed segment's last line fails to decode — a torn/tampered tail must be repaired (`repairChain`) before any further append is accepted. */
export class JournalCorruptedTailError extends Error {
  readonly segmentFilePath: string;

  constructor(segmentFilePath: string, cause: string) {
    super(
      `journal: segment "${segmentFilePath}" has a corrupted tail entry (${cause}) — run repairChain before appending`,
    );
    this.name = "JournalCorruptedTailError";
    this.segmentFilePath = segmentFilePath;
  }
}

/** Reads the highest-indexed segment's last line and decodes it. Returns `undefined` if the segment is empty (never valid to have zero lines in an existing non-genesis segment, but tolerated defensively). Throws `JournalCorruptedTailError` if the last line fails to decode. */
export async function readLastEntry(
  config: JournalStoreConfig,
  index: number,
): Promise<JournalEntry | undefined> {
  const path = segmentPath(config.segmentsDir, index);
  let content: string;
  try {
    content = await config.fs.readFile(path);
  } catch {
    return undefined;
  }
  const lines = content.split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) return undefined;
  const lastLine = lines[lines.length - 1]!;
  try {
    return decodeLine(lastLine);
  } catch (err) {
    throw new JournalCorruptedTailError(path, toErrorMessage(err));
  }
}

/**
 * VALIDATION ROUND (2026-07-18) fix, MAJOR 1: the true "last entry" of a
 * journal is not always the highest-indexed segment's own last line — a
 * segment can legitimately exist but hold ZERO valid entries (e.g. right
 * after a tail-repair truncated it down to 0 bytes because its own only
 * entry was the torn one). Walks backward from the highest segment index,
 * returning the first segment's last entry that decodes to something
 * (skipping segments that are genuinely empty), so `appendEntry`'s
 * seq/prevHash assignment never silently resets to genesis just because
 * the CURRENT segment happens to be empty while an earlier segment still
 * holds the journal's real last entry. A segment whose tail fails to
 * *decode* (a genuine corrupted/torn line, as opposed to a clean empty
 * file) still throws `JournalCorruptedTailError` and is never silently
 * skipped — only truly empty (0-line) segments are walked past.
 */
export async function readLastEntryAcrossSegments(
  config: JournalStoreConfig,
  indexes: readonly number[],
): Promise<JournalEntry | undefined> {
  for (let i = indexes.length - 1; i >= 0; i--) {
    const last = await readLastEntry(config, indexes[i]!);
    if (last !== undefined) return last;
  }
  return undefined;
}

/** Assigns seq/prevHash/hash/schemaVersion/timestamp and durably appends the resulting entry (write -> fsync(file) -> fsync(dir)) before resolving. */
export async function appendEntry(
  config: JournalStoreConfig,
  input: JournalEntryInput,
): Promise<JournalEntry> {
  const validatedInput = JournalEntryInputSchema.parse(input);

  await config.fs.mkdir(config.segmentsDir, { recursive: true, mode: config.dirMode });

  const indexes = await listSegmentIndexes(config.fs, config.segmentsDir);
  const highestIndex = indexes.length > 0 ? indexes[indexes.length - 1]! : undefined;
  const last = await readLastEntryAcrossSegments(config, indexes);

  const timestamp = config.clock();
  const nowMs = Date.parse(timestamp);

  let targetIndex: number;
  if (highestIndex === undefined) {
    targetIndex = FIRST_SEQ; // first-ever segment, index 1
  } else {
    const currentPath = segmentPath(config.segmentsDir, highestIndex);
    const stats = await config.fs.stat(currentPath);
    targetIndex = shouldRotateSegment(stats, nowMs, config.segmentMaxBytes, config.segmentMaxAgeMs)
      ? highestIndex + 1
      : highestIndex;
  }

  const nextSeq = last ? last.seq + 1 : FIRST_SEQ;
  const prevHash = last ? last.hash : GENESIS_PREV_HASH;

  const draft: Record<string, unknown> = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    seq: nextSeq,
    type: validatedInput.type,
    payload: validatedInput.payload,
    prevHash,
    timestamp,
    ...(validatedInput.runId !== undefined ? { runId: validatedInput.runId } : {}),
    ...(validatedInput.changeSetId !== undefined
      ? { changeSetId: validatedInput.changeSetId }
      : {}),
    ...(validatedInput.workUnitId !== undefined ? { workUnitId: validatedInput.workUnitId } : {}),
  };
  const hash = computeEntryHash(draft);
  const entry = JournalEntrySchema.parse({ ...draft, hash });

  const targetPath = segmentPath(config.segmentsDir, targetIndex);
  const line = encodeEntryToLine(entry);
  await durablyAppendLine(config.fs, targetPath, config.segmentsDir, line, config.fileMode);

  return entry;
}
