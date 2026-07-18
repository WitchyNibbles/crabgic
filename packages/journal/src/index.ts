/**
 * `@eo/journal` public barrel — roadmap/04-journal-idempotency-leases.md
 * §Interfaces produced: the full exported surface consumed directly by 05,
 * 07, 16 (and transitively by 06, 09, 13, 21, 22, 23). Re-exports, grouped
 * by concern:
 *
 *   - Store: the friendly `createJournalStore` factory plus every
 *     underlying free function it composes (`appendEntry`, `queryEntries`,
 *     the whole-journal-safe `verifyJournal`/`repairJournal`, `writeSnapshot`,
 *     `loadLatestSnapshot`, `recover`, `gcJournal`) — both styles are exported
 *     so a caller can use whichever fits (a bound `JournalStore` instance, or
 *     individual functions against a raw `JournalStoreConfig`). The low-level
 *     per-segment `verifyChain`/`repairChain` are intentionally withheld (see
 *     the note at their former export site below).
 *   - Codec: the `JournalEntry`/`JournalEntryInput` envelope schemas/types
 *     and the ndjson wire-format functions.
 *   - Layout: the sole-definition-site XDG state/cache root constants and
 *     path-builder functions (exit criterion 11).
 *   - Lease: `Lease` + its two typed errors.
 *   - Kill harness: `runKillHarness` + every report/option type (07's test
 *     plan names this "the phase-04 kill harness").
 *   - `IdempotencyRegistry` (work item 5) and `recordAttempt`/
 *     `getLatestAttempt` (work-unit attempt tracking).
 *
 * A repo-wide export-name collision check (grep-based, mirroring the same
 * check `packages/contracts/src/index.ts`'s own barrel doc comment
 * describes) found zero duplicate identifiers across every name below.
 */

// ---- Store: factory + free functions + types ----
export {
  createJournalStore,
  JournalCorruptedTailError,
  JournalTamperedError,
  DEFAULT_RETENTION_MIN_SEGMENTS_TO_KEEP,
  DEFAULT_SEGMENT_MAX_AGE_MS,
  DEFAULT_SEGMENT_MAX_BYTES,
} from "./store/journal-store.js";
export type {
  JournalStore,
  JournalStoreOptions,
  JournalStoreConfig,
  JournalEntryFilter,
  ChainVerificationReport,
  ChainVerificationIssue,
  ChainVerificationIssueKind,
  ChainRepairReport,
  JournalVerificationReport,
  JournalVerificationSegmentReport,
  JournalFirstInvalidPoint,
  JournalRepairReport,
  RecoverResult,
  GcReport,
  RetentionOptions,
} from "./store/journal-store.js";

export { appendEntry } from "./store/append-entry.js";
export { queryEntries } from "./store/query-entries.js";
// The low-level per-segment `verifyChain`/`repairChain` are deliberately NOT
// re-exported: their `expectedInitialPrevHash` defaults to `GENESIS_PREV_HASH`,
// which is correct ONLY for segment 1 — calling them with the default on any
// rotated (non-first) segment truncates committed entries (reproduced in the
// 2026-07-18 durability re-audit). Downstream consumers (05/07/16) get only the
// whole-journal-safe surface below, which threads prevHash across segment
// boundaries; the per-segment functions stay module-internal, exercised by their
// own colocated tests via direct relative import.
export { verifyJournal } from "./store/verify-journal.js";
export { repairJournal } from "./store/repair-journal.js";
export {
  writeSnapshot,
  loadLatestSnapshot,
  recover,
  snapshotFileName,
} from "./store/snapshot-io.js";
export { gcJournal } from "./store/retention-gc.js";
export { createNodeFsPort } from "./store/fs-port.js";
export type { FsPort, FsStat, OpaqueHandle, OpenFlags } from "./store/fs-port.js";
export {
  measureAppendLatencies,
  percentile,
  summarizeLatencies,
} from "./store/append-benchmark.js";
export type { LatencyStats } from "./store/append-benchmark.js";

// ---- Codec: entry envelope + ndjson wire format ----
export {
  JournalEntrySchema,
  JournalEntryInputSchema,
  FIRST_SEQ,
  HashHexSchema,
  CURRENT_SCHEMA_VERSION,
} from "./codec/journal-entry.js";
export type { JournalEntry, JournalEntryInput } from "./codec/journal-entry.js";
export { encodeEntryToLine, decodeLine, tryDecodeLine } from "./codec/ndjson-codec.js";
export type { DecodeLineResult } from "./codec/ndjson-codec.js";
export { GENESIS_PREV_HASH } from "./codec/hash-chain.js";

// ---- Layout: sole-definition-site XDG state/cache roots (exit criterion 11) ----
export {
  JOURNAL_DIR_MODE,
  JOURNAL_FILE_MODE,
  ENGINEERING_ORCHESTRATOR_DIR_NAME,
  JOURNAL_STATE_SUBDIR,
  LEASES_STATE_SUBDIR,
  JOURNAL_SEGMENTS_SUBDIR,
  JOURNAL_SNAPSHOTS_SUBDIR,
  resolveXdgStateHome,
  resolveXdgCacheHome,
  resolveStateRoot,
  resolveCacheRoot,
  resolveJournalDir,
  resolveJournalSegmentsDir,
  resolveJournalSnapshotsDir,
  resolveLeasesDir,
  readXdgEnvFromProcess,
} from "./layout/xdg-layout.js";
export type { XdgEnv } from "./layout/xdg-layout.js";

// ---- Lease ----
export {
  Lease,
  LeaseHeldError,
  LeaseAcquireRaceLostError,
  LeaseLostError,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_LEASE_TTL_MS,
} from "./lease.js";
export type { LeaseClock, LeaseAcquireOptions, LeaseLostReason } from "./lease.js";
export type { LeaseRecord } from "./lease-record.js";
export { acquireProjectLease } from "./lease-project.js";

// ---- Kill harness (test-support export; "the phase-04 kill harness" 07/05/13/23 reuse) ----
export { runKillHarness, signalFaultPoint, FAULT_POINT_MARKER_PREFIX } from "./kill-harness.js";
export type {
  KillHarnessOperation,
  KillHarnessOperationSpec,
  KillHarnessOptions,
  KillHarnessReport,
  KillHarnessFaultPointReport,
  KillHarnessRunContext,
  KillHarnessVerdict,
  KillHarnessKilledAt,
} from "./kill-harness.js";

// ---- Idempotency registry (work item 5) ----
export { IdempotencyRegistry } from "./idempotency.js";
export type { IdempotencyStatus, IdempotencyOutcome } from "./idempotency.js";

// ---- Work-unit attempt tracking ----
export { recordAttempt, getLatestAttempt } from "./attempts.js";
export type { WorkUnitAttemptRecord } from "./attempts.js";
