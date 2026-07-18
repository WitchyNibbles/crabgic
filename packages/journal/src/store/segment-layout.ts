/**
 * Segment file naming, listing, and rotation-threshold logic — roadmap/04
 * §In scope: "segment rotation at a size/age threshold." Conservative
 * defaults (documented tunables, per this phase's own §Risks note:
 * "Retention/GC numeric thresholds ... left as an implementation-time
 * tuning question, not a build blocker").
 */

import { join } from "node:path";
import type { FsPort } from "./fs-port.js";

export const SEGMENT_FILE_PREFIX = "segment-";
export const SEGMENT_FILE_EXTENSION = ".ndjson";
export const SEGMENT_INDEX_PAD = 8;

/** 8 MiB — conservative default segment size threshold before rotation. */
export const DEFAULT_SEGMENT_MAX_BYTES = 8 * 1024 * 1024;
/** 24h — conservative default segment age threshold before rotation. */
export const DEFAULT_SEGMENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function segmentFileName(index: number): string {
  return `${SEGMENT_FILE_PREFIX}${String(index).padStart(SEGMENT_INDEX_PAD, "0")}${SEGMENT_FILE_EXTENSION}`;
}

/** Inverse of `segmentFileName` — returns `undefined` for any name that isn't a well-formed segment file name. */
export function segmentIndexFromFileName(fileName: string): number | undefined {
  if (!fileName.startsWith(SEGMENT_FILE_PREFIX) || !fileName.endsWith(SEGMENT_FILE_EXTENSION)) {
    return undefined;
  }
  const middle = fileName.slice(
    SEGMENT_FILE_PREFIX.length,
    fileName.length - SEGMENT_FILE_EXTENSION.length,
  );
  if (!/^\d+$/.test(middle)) return undefined;
  return Number.parseInt(middle, 10);
}

export function segmentPath(segmentsDir: string, index: number): string {
  return join(segmentsDir, segmentFileName(index));
}

/** Every segment index present in `segmentsDir`, ascending. Returns `[]` if the directory doesn't exist yet. */
export async function listSegmentIndexes(
  fs: FsPort,
  segmentsDir: string,
): Promise<readonly number[]> {
  let names: readonly string[];
  try {
    names = await fs.readdir(segmentsDir);
  } catch {
    return [];
  }
  const indexes = names
    .map((name) => segmentIndexFromFileName(name))
    .filter((index): index is number => index !== undefined);
  return [...indexes].sort((a, b) => a - b);
}

/** True when a segment with the given stats has crossed the size or age rotation threshold and the NEXT append should start a fresh segment instead. */
export function shouldRotateSegment(
  stats: { readonly size: number; readonly birthtimeMs: number },
  nowMs: number,
  maxBytes: number,
  maxAgeMs: number,
): boolean {
  return stats.size >= maxBytes || nowMs - stats.birthtimeMs >= maxAgeMs;
}
