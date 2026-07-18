/**
 * `createJournalStore` — the friendly factory assembling every `../store/*`
 * operation module into one bound object whose method names match
 * roadmap/04-journal-idempotency-leases.md §Interfaces produced verbatim
 * (`appendEntry`, `queryEntries`, `writeSnapshot`, `loadLatestSnapshot`,
 * `recover`), plus this package's own `verifyJournal`/`repairJournal` and
 * `gc` (retention). This is the single entry point the barrel
 * (`src/index.ts`, owned by another worker) is expected to re-export.
 *
 * VALIDATION ROUND (2026-07-18) fix, MAJOR 1: this store's bound
 * `verifyChain(segmentFilePath, expectedInitialPrevHash?)` /
 * `repairChain(segmentFilePath, expectedInitialPrevHash?)` convenience
 * methods were REMOVED from this surface — `journal-store.ts:58-59`'s own
 * defaulted-genesis pass-through is exactly what let a caller invoke
 * `store.repairChain(highestSegmentPath)` against a ROTATED (multi-
 * segment) journal and have it silently default `expectedInitialPrevHash`
 * to genesis, misreport a perfectly valid non-first segment as corrupted,
 * and durably truncate away a real committed entry. The store's own
 * blessed surface now exposes only the SAFE, whole-journal-aware
 * `verifyJournal()`/`repairJournal()` (`./verify-journal.js`/`./repair-
 * journal.js`), which thread `expectedInitialPrevHash`/`expectedInitialSeq`
 * across every segment boundary themselves and refuse (via
 * `JournalTamperedError`) rather than repair when the first invalid point
 * is historical/mid-journal corruption instead of a torn tail. The
 * low-level, single-segment `verifyChain`/`repairChain` functions
 * themselves are UNCHANGED and still directly importable (see this
 * package's barrel) for tests and power users who explicitly want to
 * operate on one named segment — just no longer reachable through this
 * store's own convenience surface with an implicit, dangerous default.
 *
 * Every underlying operation module (`append-entry.ts`, `verify-chain.ts`,
 * `verify-journal.ts`, `repair-chain.ts`, `repair-journal.ts`, `snapshot-
 * io.ts`, `query-entries.ts`, `retention-gc.ts`) is independently
 * importable and testable against a bare `JournalStoreConfig` — this
 * factory is a thin composition layer, not where the logic lives.
 */

import { appendEntry } from "./append-entry.js";
import { gcJournal, type GcReport, type RetentionOptions } from "./retention-gc.js";
import { queryEntries, type JournalEntryFilter } from "./query-entries.js";
import { repairJournal, type JournalRepairReport } from "./repair-journal.js";
import { loadLatestSnapshot, recover, writeSnapshot, type RecoverResult } from "./snapshot-io.js";
import {
  resolveStoreConfig,
  type JournalStoreConfig,
  type JournalStoreOptions,
} from "./store-config.js";
import { verifyJournal, type JournalVerificationReport } from "./verify-journal.js";
import type { JournalEntry, JournalEntryInput } from "../codec/journal-entry.js";
import type { RunSnapshot } from "@eo/contracts";

export interface JournalStore {
  appendEntry(input: JournalEntryInput): Promise<JournalEntry>;
  queryEntries(filter?: JournalEntryFilter): AsyncIterable<JournalEntry>;
  /** Verifies the WHOLE journal (every segment, boundary-threaded) — see `./verify-journal.js`. */
  verifyJournal(): Promise<JournalVerificationReport>;
  /** Repairs a torn TAIL only; refuses (`JournalTamperedError`) on mid-journal corruption — see `./repair-journal.js`. */
  repairJournal(): Promise<JournalRepairReport>;
  writeSnapshot(snapshot: RunSnapshot): Promise<void>;
  loadLatestSnapshot(runId: string): Promise<RunSnapshot | undefined>;
  recover(runId: string): Promise<RecoverResult>;
  gc(options?: RetentionOptions): Promise<GcReport>;
  /** Exposed for advanced/test use — e.g. introspecting `segmentsDir`/`snapshotsDir` directly, or calling the low-level per-segment `verifyChain`/`repairChain` (barrel-exported) explicitly against one named segment. */
  readonly config: JournalStoreConfig;
}

export function createJournalStore(options: JournalStoreOptions): JournalStore {
  const config = resolveStoreConfig(options);

  return {
    appendEntry: (input) => appendEntry(config, input),
    queryEntries: (filter) => queryEntries(config, filter),
    verifyJournal: () => verifyJournal(config),
    repairJournal: () => repairJournal(config),
    writeSnapshot: (snapshot) => writeSnapshot(config, snapshot),
    loadLatestSnapshot: (runId) => loadLatestSnapshot(config, runId),
    recover: (runId) => recover(config, runId),
    gc: (gcOptions) => gcJournal(config, gcOptions),
    config,
  };
}

export type { JournalStoreOptions, JournalStoreConfig } from "./store-config.js";
export type { JournalEntryFilter } from "./query-entries.js";
export type {
  ChainVerificationReport,
  ChainVerificationIssue,
  ChainVerificationIssueKind,
} from "./verify-chain.js";
export type { ChainRepairReport } from "./repair-chain.js";
export type {
  JournalVerificationReport,
  JournalVerificationSegmentReport,
  JournalFirstInvalidPoint,
} from "./verify-journal.js";
export type { JournalRepairReport } from "./repair-journal.js";
export { JournalTamperedError } from "./repair-journal.js";
export type { RecoverResult } from "./snapshot-io.js";
export type { GcReport, RetentionOptions } from "./retention-gc.js";
export { JournalCorruptedTailError } from "./append-entry.js";
export { DEFAULT_RETENTION_MIN_SEGMENTS_TO_KEEP } from "./retention-gc.js";
export { DEFAULT_SEGMENT_MAX_AGE_MS, DEFAULT_SEGMENT_MAX_BYTES } from "./segment-layout.js";
