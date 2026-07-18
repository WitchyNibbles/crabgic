/**
 * The crash suite's `verify()` steps (roadmap/04 §Interfaces produced
 * text: recovery via `verifyChain`/tail repair — run in the PARENT test
 * process, real fs, against whatever the killed child left behind), shared
 * between `crash-suite.test.ts` (original, non-rotating variant) and
 * `crash-suite-rotation.test.ts` (VALIDATION ROUND 2026-07-18's new
 * segment-rotation variant). Split out into its own module so both test
 * files stay under this repo's 400-line-file convention while reusing the
 * SAME verifier — proving it is correct for both the single- and
 * multi-segment case.
 */

import type { KillHarnessVerdict } from "../kill-harness.js";
import { appendEntry } from "../store/append-entry.js";
import { createNodeFsPort } from "../store/fs-port.js";
import { queryEntries } from "../store/query-entries.js";
import { JournalTamperedError, repairJournal } from "../store/repair-journal.js";
import { loadLatestSnapshot } from "../store/snapshot-io.js";
import { resolveStoreConfig, type JournalStoreConfig } from "../store/store-config.js";
import { verifyJournal } from "../store/verify-journal.js";

export async function collectAll<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

/**
 * For "append" mode: after repair, the chain must have zero remaining
 * issues AND its valid-entry count must be exactly `entryCountBefore` (the
 * armed append never landed) or `entryCountBefore + 1` (it fully landed) —
 * any other count means either lost prior entries or a half-landed one,
 * i.e. undetected corruption.
 *
 * VALIDATION ROUND (2026-07-18) fix, MAJOR 1: previously operated on ONLY
 * the highest segment (`segmentPath(config.segmentsDir, FIRST_SEQ)`, i.e.
 * always segment 1 — the crash suite never rotated segments, so this was a
 * silent single-segment assumption baked into the verifier, not just the
 * store). Now uses the orchestrated, whole-journal-aware
 * `verifyJournal`/`repairJournal` (`../store/verify-journal.js`/
 * `../store/repair-journal.js`), so this same verifier is correct whether
 * or not the journal under test ever rotated.
 */
export async function verifyAppendRecovery(
  journalDir: string,
  entryCountBefore: number,
): Promise<KillHarnessVerdict> {
  const config = resolveStoreConfig({ journalDir, fs: createNodeFsPort() });

  let repair;
  try {
    repair = await repairJournal(config);
  } catch (err) {
    if (err instanceof JournalTamperedError) {
      return {
        recovered: false,
        detail: `repairJournal refused (tamper detected): ${err.message}`,
      };
    }
    return { recovered: false, detail: `repairJournal threw: ${String(err)}` };
  }

  const after = repair.verification;
  if (after.firstInvalid !== undefined) {
    return {
      recovered: false,
      detail: `journal still invalid after repair: ${after.firstInvalid.issue.kind}`,
    };
  }

  const allEntries = await collectAll(queryEntries(config));

  // Global seq uniqueness/monotonicity across the WHOLE journal — the
  // exact invariant MAJOR 1's rotated-journal defect violated (a
  // truncate-to-zero repair on the wrong segment producing a duplicate
  // seq=1 entry).
  const seqValues = allEntries.map((e) => e.seq);
  if (new Set(seqValues).size !== seqValues.length) {
    return {
      recovered: false,
      detail: `duplicate seq detected across journal: ${JSON.stringify(seqValues)}`,
    };
  }

  // The repair entry itself (adjudication_decision) only gets appended when
  // a repair actually happened — exclude it from the "how many of MY
  // fanout_rationale entries survived" count.
  const ownEntries = allEntries.filter((e) => e.type === "fanout_rationale");
  const acceptable =
    ownEntries.length === entryCountBefore || ownEntries.length === entryCountBefore + 1;
  if (!acceptable) {
    return {
      recovered: false,
      detail: `expected ${String(entryCountBefore)} or ${String(entryCountBefore + 1)} surviving entries, found ${String(ownEntries.length)}`,
    };
  }

  // Extra rigor: the journal must remain genuinely writable afterward —
  // catches fd leaks / orphaned lock-like state a naive recovery check
  // wouldn't notice.
  const proof = await appendEntry(config, {
    type: "fanout_rationale",
    payload: { rationale: "post-recovery-proof" },
  });
  if (proof.seq <= 0) {
    return { recovered: false, detail: "post-recovery append did not succeed" };
  }
  return { recovered: true };
}

export async function verifySnapshotRecovery(
  journalDir: string,
  entryCountBefore: number,
): Promise<KillHarnessVerdict> {
  const config: JournalStoreConfig = resolveStoreConfig({ journalDir, fs: createNodeFsPort() });
  // A killed snapshot write must be all-or-nothing: either no snapshot file
  // exists yet (killed before the atomic rename), or exactly one complete,
  // schema-valid snapshot exists (killed after) — NEVER a lingering
  // `.tmp-*` file mistaken for a real one, and never a partially-written
  // final-path file (the atomic temp+rename contract's whole point).
  const runId = "44444444-4444-4444-8444-444444444444";
  try {
    const loaded = await loadLatestSnapshot(config, runId);
    if (loaded !== undefined && loaded.journalSequenceNumber !== entryCountBefore) {
      return {
        recovered: false,
        detail: "snapshot loaded but with unexpected journalSequenceNumber",
      };
    }
  } catch (err) {
    return { recovered: false, detail: `loadLatestSnapshot threw: ${String(err)}` };
  }
  // The append path underneath prior entries must also still verify clean
  // (the snapshot write never touches segment files, but confirms the kill
  // didn't corrupt anything else in the same directory). Whole-journal
  // aware (VALIDATION ROUND 2026-07-18 fix) — correct whether or not the
  // prior entries rotated across multiple segments.
  const wholeJournal = await verifyJournal(config);
  if (wholeJournal.firstInvalid !== undefined) {
    return {
      recovered: false,
      detail: `journal unexpectedly invalid: ${wholeJournal.firstInvalid.issue.kind}`,
    };
  }
  return { recovered: true };
}
