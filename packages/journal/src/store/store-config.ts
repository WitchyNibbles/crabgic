/**
 * `JournalStoreConfig` — the resolved, fully-defaulted configuration every
 * `../store/*` operation module (`append-entry.ts`, `verify-chain.ts`,
 * `repair-chain.ts`, `snapshot-io.ts`, `query-entries.ts`, `retention-gc.ts`)
 * takes as its first parameter. `journal-store.ts` is the only place that
 * constructs one from a caller-supplied `JournalStoreOptions` (filling in
 * defaults); every other module in this directory just consumes it.
 */

import { join } from "node:path";
import { JOURNAL_DIR_MODE, JOURNAL_FILE_MODE } from "../layout/xdg-layout.js";
import { createNodeFsPort, type FsPort } from "./fs-port.js";
import { DEFAULT_SEGMENT_MAX_AGE_MS, DEFAULT_SEGMENT_MAX_BYTES } from "./segment-layout.js";

export interface JournalStoreConfig {
  readonly segmentsDir: string;
  readonly snapshotsDir: string;
  readonly fs: FsPort;
  /** Returns the current instant as an `TimestampSchema`-valid ISO string. Injectable for deterministic tests. */
  readonly clock: () => string;
  readonly segmentMaxBytes: number;
  readonly segmentMaxAgeMs: number;
  readonly dirMode: number;
  readonly fileMode: number;
}

export interface JournalStoreOptions {
  /** The `journal/` directory (roadmap/04's pinned layout — see `../layout/xdg-layout.js`). Segments live at `<journalDir>/segments/`, snapshots at `<journalDir>/snapshots/`. */
  readonly journalDir: string;
  readonly fs?: FsPort;
  readonly clock?: () => string;
  readonly segmentMaxBytes?: number;
  readonly segmentMaxAgeMs?: number;
  readonly dirMode?: number;
  readonly fileMode?: number;
}

function defaultClock(): string {
  return new Date().toISOString();
}

export function resolveStoreConfig(options: JournalStoreOptions): JournalStoreConfig {
  return {
    segmentsDir: join(options.journalDir, "segments"),
    snapshotsDir: join(options.journalDir, "snapshots"),
    fs: options.fs ?? createNodeFsPort(),
    clock: options.clock ?? defaultClock,
    segmentMaxBytes: options.segmentMaxBytes ?? DEFAULT_SEGMENT_MAX_BYTES,
    segmentMaxAgeMs: options.segmentMaxAgeMs ?? DEFAULT_SEGMENT_MAX_AGE_MS,
    dirMode: options.dirMode ?? JOURNAL_DIR_MODE,
    fileMode: options.fileMode ?? JOURNAL_FILE_MODE,
  };
}
