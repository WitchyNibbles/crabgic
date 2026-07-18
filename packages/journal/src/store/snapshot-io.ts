/**
 * Snapshot writer/loader + `recover` — roadmap/04-journal-idempotency-
 * leases.md §In scope: "atomic `RunSnapshot` (02 schema) via temp-file +
 * rename; recovery = load the latest snapshot + replay journal entries
 * after its sequence number."
 *
 * File naming: `snapshot-<runId>-<journalSequenceNumber padded to 12
 * digits>.json`, deterministic (no random nonce in the FINAL name) — a
 * second write for the same `(runId, journalSequenceNumber)` pair
 * naturally overwrites the same final path via the same atomic
 * temp+rename procedure, so re-snapshotting an unchanged point is
 * idempotent by construction. The random `tempSuffix` passed to
 * `durablyWriteFileAtomic` only disambiguates the intermediate `.tmp-*`
 * path against concurrent writers; it is not part of durable identity.
 */

import { join } from "node:path";
import { RunSnapshotSchema, type RunSnapshot } from "@eo/contracts";
import { durablyWriteFileAtomic } from "./durable-io.js";
import { queryEntries } from "./query-entries.js";
import { repairJournal, type JournalRepairReport } from "./repair-journal.js";
import type { JournalStoreConfig } from "./store-config.js";
import type { JournalVerificationReport } from "./verify-journal.js";
import type { JournalEntry } from "../codec/journal-entry.js";

const SNAPSHOT_SEQ_PAD = 12;

export function snapshotFileName(runId: string, journalSequenceNumber: number): string {
  return `snapshot-${runId}-${String(journalSequenceNumber).padStart(SNAPSHOT_SEQ_PAD, "0")}.json`;
}

/** Atomically writes `snapshot` (temp-file + rename, fsync'd file then directory) to `<snapshotsDir>/snapshot-<runId>-<seq>.json`. */
export async function writeSnapshot(
  config: JournalStoreConfig,
  snapshot: RunSnapshot,
): Promise<void> {
  const validated = RunSnapshotSchema.parse(snapshot);
  await config.fs.mkdir(config.snapshotsDir, { recursive: true, mode: config.dirMode });
  const finalPath = join(
    config.snapshotsDir,
    snapshotFileName(validated.runId, validated.journalSequenceNumber),
  );
  const tempSuffix = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  await durablyWriteFileAtomic(
    config.fs,
    finalPath,
    config.snapshotsDir,
    JSON.stringify(validated),
    config.fileMode,
    tempSuffix,
  );
}

/** Loads the highest-`journalSequenceNumber` snapshot on disk for `runId`, or `undefined` if none exists. */
export async function loadLatestSnapshot(
  config: JournalStoreConfig,
  runId: string,
): Promise<RunSnapshot | undefined> {
  let names: readonly string[];
  try {
    names = await config.fs.readdir(config.snapshotsDir);
  } catch {
    return undefined;
  }

  const prefix = `snapshot-${runId}-`;
  let latest: RunSnapshot | undefined;
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith(".json")) continue;
    const raw = await config.fs.readFile(join(config.snapshotsDir, name));
    const parsed = RunSnapshotSchema.parse(JSON.parse(raw));
    if (latest === undefined || parsed.journalSequenceNumber > latest.journalSequenceNumber) {
      latest = parsed;
    }
  }
  return latest;
}

export interface RecoverResult {
  readonly snapshot?: RunSnapshot;
  readonly replayed: readonly JournalEntry[];
  /** Whole-journal verification outcome (`./verify-journal.js`), computed BEFORE replay — see file-level doc comment on the VALIDATION ROUND fix below. */
  readonly verification: JournalVerificationReport;
  /** Present only when a torn-tail repair was actually performed as part of this `recover()` call. */
  readonly repair?: JournalRepairReport;
}

/**
 * Loads the latest snapshot for `runId` (if any) and replays every journal
 * entry with `seq` strictly greater than its `journalSequenceNumber` (or
 * every entry for the run, if no snapshot exists).
 *
 * VALIDATION ROUND (2026-07-18) fix, MAJOR 1 / MINOR 4: BEFORE replaying
 * anything, this now runs the orchestrated `repairJournal` (`./repair-
 * journal.js`) over the whole journal — a genuine torn tail is repaired in
 * place (the same durable tail-repair this package always performed, now
 * whole-journal-aware); historical/mid-journal corruption (a post-hoc
 * tampered but otherwise schema-valid entry) makes `repairJournal` throw
 * `JournalTamperedError` instead of silently replaying past it — closing
 * the previously-undetected path where `recover()` never verified anything
 * at all and a tampered entry would replay silently. The verification/
 * repair outcome is surfaced on the returned `RecoverResult` for callers
 * (05's supervisor restart path) that want to log or alert on it.
 */
export async function recover(config: JournalStoreConfig, runId: string): Promise<RecoverResult> {
  const repair = await repairJournal(config);

  const snapshot = await loadLatestSnapshot(config, runId);
  const afterSeq = snapshot?.journalSequenceNumber ?? 0;

  const replayed: JournalEntry[] = [];
  for await (const entry of queryEntries(config, { runId })) {
    if (entry.seq > afterSeq) replayed.push(entry);
  }

  return {
    ...(snapshot !== undefined ? { snapshot } : {}),
    replayed,
    verification: repair.verification,
    ...(repair.repaired ? { repair } : {}),
  };
}
