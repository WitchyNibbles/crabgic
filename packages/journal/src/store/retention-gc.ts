/**
 * Retention GC — roadmap/04-journal-idempotency-leases.md §In scope:
 * "segment + snapshot GC, conservative defaults — never deletes a segment
 * newer than the latest durable snapshot." §Risks: "Retention/GC numeric
 * thresholds ... left as an implementation-time tuning question, not a
 * build blocker; the only hard invariant is never deleting a segment
 * newer than the latest durable snapshot."
 *
 * SAFE-FLOOR COMPUTATION (documented decision): a segment is eligible for
 * deletion only if EVERY entry in it has `seq` <= the MINIMUM
 * `journalSequenceNumber` across every run's own latest durable snapshot.
 * Taking the minimum (not the maximum, and not per-run) is deliberate: a
 * single global segment file can hold entries for several different runs
 * interleaved, so a segment is only truly superseded once the LEAST
 * up-to-date run's own recovery point no longer needs it — otherwise a
 * `recover()` for that lagging run could replay past a deleted segment.
 * If ANY run has never been snapshotted (or no snapshots exist at all),
 * the floor is `-1` (nothing is deletable), matching "never deletes a
 * segment newer than the latest durable snapshot" for the degenerate case
 * where no durable snapshot exists yet.
 *
 * Conservative additional guardrails, both independent of the safe floor:
 * the active (highest-index) segment is NEVER deleted, and at least
 * `minSegmentsToKeep` of the most-recent otherwise-eligible segments are
 * always retained regardless of the floor.
 */

import { join } from "node:path";
import { RunSnapshotSchema } from "@eo/contracts";
import { listSegmentIndexes, segmentPath } from "./segment-layout.js";
import type { JournalStoreConfig } from "./store-config.js";
import { tryDecodeLine } from "../codec/ndjson-codec.js";

export const DEFAULT_RETENTION_MIN_SEGMENTS_TO_KEEP = 2;

export interface RetentionOptions {
  readonly minSegmentsToKeep: number;
}

export interface GcReport {
  readonly deletedSegmentIndexes: readonly number[];
  readonly retainedSegmentIndexes: readonly number[];
  readonly deletedSnapshotFiles: readonly string[];
  readonly safeSeqFloor: number;
}

async function safeReaddir(fs: JournalStoreConfig["fs"], path: string): Promise<readonly string[]> {
  try {
    return await fs.readdir(path);
  } catch {
    return [];
  }
}

/** The highest `seq` among the successfully-decoded entries of one segment file, or `undefined` if the segment is empty/unreadable/fully corrupt. */
async function maxSeqOfSegment(
  config: JournalStoreConfig,
  index: number,
): Promise<number | undefined> {
  let content: string;
  try {
    content = await config.fs.readFile(segmentPath(config.segmentsDir, index));
  } catch {
    return undefined;
  }
  let max: number | undefined;
  for (const line of content.split("\n")) {
    if (line.length === 0) continue;
    const decoded = tryDecodeLine(line);
    if (!decoded.ok) continue;
    if (max === undefined || decoded.entry!.seq > max) max = decoded.entry!.seq;
  }
  return max;
}

export async function gcJournal(
  config: JournalStoreConfig,
  options: RetentionOptions = { minSegmentsToKeep: DEFAULT_RETENTION_MIN_SEGMENTS_TO_KEEP },
): Promise<GcReport> {
  const snapshotNames = (await safeReaddir(config.fs, config.snapshotsDir)).filter((name) =>
    name.endsWith(".json"),
  );

  // Latest journalSequenceNumber per runId, and which single file currently holds it (kept; every other file for that run is superseded and deleted).
  const bestByRun = new Map<string, { readonly fileName: string; readonly seq: number }>();
  const parsedByFile = new Map<string, { readonly runId: string; readonly seq: number }>();

  for (const fileName of snapshotNames) {
    const raw = await config.fs.readFile(join(config.snapshotsDir, fileName));
    const parsed = RunSnapshotSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) continue;
    parsedByFile.set(fileName, {
      runId: parsed.data.runId,
      seq: parsed.data.journalSequenceNumber,
    });
    const best = bestByRun.get(parsed.data.runId);
    if (best === undefined || parsed.data.journalSequenceNumber > best.seq) {
      bestByRun.set(parsed.data.runId, { fileName, seq: parsed.data.journalSequenceNumber });
    }
  }

  const deletedSnapshotFiles: string[] = [];
  for (const [fileName, info] of parsedByFile) {
    const best = bestByRun.get(info.runId);
    if (best !== undefined && best.fileName !== fileName) {
      deletedSnapshotFiles.push(fileName);
    }
  }
  for (const fileName of deletedSnapshotFiles) {
    await config.fs.unlink(join(config.snapshotsDir, fileName));
  }

  const safeSeqFloor =
    bestByRun.size > 0 ? Math.min(...[...bestByRun.values()].map((v) => v.seq)) : -1;

  const indexes = await listSegmentIndexes(config.fs, config.segmentsDir);
  const highestIndex = indexes.length > 0 ? indexes[indexes.length - 1] : undefined;

  const eligible: number[] = [];
  for (const index of indexes) {
    if (index === highestIndex) continue; // never delete the active segment

    const maxSeq = await maxSeqOfSegment(config, index);
    if (maxSeq !== undefined && maxSeq <= safeSeqFloor) {
      eligible.push(index);
    }
  }

  // Keep at least `minSegmentsToKeep` of the most-recent segments overall
  // (by index, regardless of eligibility) — an additional conservative
  // guardrail independent of the safe-floor computation above.
  const keepFloorIndex =
    indexes.length > options.minSegmentsToKeep
      ? indexes[indexes.length - 1 - options.minSegmentsToKeep]
      : undefined;
  const deletable = eligible.filter(
    (index) => keepFloorIndex !== undefined && index <= keepFloorIndex,
  );

  for (const index of deletable) {
    await config.fs.unlink(segmentPath(config.segmentsDir, index));
  }

  return {
    deletedSegmentIndexes: deletable,
    retainedSegmentIndexes: indexes.filter((index) => !deletable.includes(index)),
    deletedSnapshotFiles,
    safeSeqFloor,
  };
}
