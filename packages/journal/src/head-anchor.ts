import { closeSync, constants, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { openOwnedFile } from "./layout/owned-open.js";
import { JOURNAL_FILE_MODE } from "./layout/xdg-layout.js";
import type { JournalStore } from "./store/journal-store.js";

/**
 * Journal head anchoring — the answer to the one thing `verifyJournal()`
 * structurally cannot detect.
 *
 * THE GAP. The chain is a plain SHA-256 over each entry, linked by
 * `prevHash`, with no key and no signature (`./codec/hash-chain.ts`).
 * `verifyJournal()` walks it from `GENESIS_PREV_HASH` and checks that every
 * link recomputes. That catches an entry edited IN PLACE — its hash stops
 * matching — but it cannot catch a WHOLESALE REWRITE: recompute every hash
 * forward from genesis and the result is a different history that verifies
 * perfectly clean. `repairJournal()` never fires either, because there is no
 * invalid point to find, and `crabgic doctor`'s `journal.chain` check inherits
 * the same blind spot. A rewritten journal is indistinguishable from a
 * truthful one by inspection of the journal alone.
 *
 * WHAT CLOSES IT. Remembering, somewhere else, what the head USED to be. If a
 * previously-observed `(seq, hash)` pair is no longer present at that seq, the
 * history under it changed. That is a comparison against an outside record,
 * which is the only kind of evidence a self-consistent forgery cannot supply.
 *
 * WHAT THIS IS NOT, stated plainly. Writing the anchor to a file beside the
 * journal, owned by the same uid, does NOT make the journal tamper-proof: an
 * adversary who can rewrite the segments can usually rewrite the anchor in the
 * same breath. What it buys is that the two must now be forged CONSISTENTLY
 * and, more importantly, that the anchor is a small, copyable, comparable
 * value — it can be shipped off-host (a signed log, a WORM bucket, a git note
 * pushed to a remote, an operator's own notes) where the local uid cannot
 * reach it, and any holder of an older copy can detect the rewrite. The
 * primitive is the anchor; the strength is wherever you keep it.
 */

/** The journal's last entry, identified by the two fields a rewrite cannot preserve together. */
export interface JournalHead {
  readonly seq: number;
  readonly hash: string;
}

export const HeadAnchorRecordSchema = z
  .object({
    seq: z.number().int().positive(),
    hash: z.string().regex(/^[0-9a-f]{64}$/),
    recordedAt: z.string().datetime(),
  })
  .strict();
export type HeadAnchorRecord = z.infer<typeof HeadAnchorRecordSchema>;

export type HeadAnchorFailureReason =
  /** The journal no longer reaches the anchored seq — truncated, emptied, or replaced with a shorter history. */
  | "head_behind_anchor"
  /** The anchored seq exists but carries a different hash — the history under it was rewritten. */
  | "anchor_hash_mismatch";

export type HeadAnchorVerdict =
  | { readonly ok: true; readonly head: JournalHead }
  | {
      readonly ok: false;
      readonly reason: HeadAnchorFailureReason;
      readonly anchoredSeq: number;
      readonly anchoredHash: string;
      /** The hash actually found at `anchoredSeq`, when one was found at all. */
      readonly observedHash?: string;
      /** The journal's current head, when it has one. */
      readonly head?: JournalHead;
    };

export interface RecordHeadAnchorOptions {
  /** Overridable clock for deterministic tests. */
  readonly now?: () => Date;
}

/** The journal's current head, or `undefined` when it holds no entries. */
export async function readJournalHead(journal: JournalStore): Promise<JournalHead | undefined> {
  let head: JournalHead | undefined;
  // Ascending append order is `queryEntries`' documented contract, so the last
  // one seen is the head. Scanned rather than seeked because the store exposes
  // no reverse cursor; journals are thousands of entries, not millions.
  for await (const entry of journal.queryEntries({})) {
    head = { seq: entry.seq, hash: entry.hash };
  }
  return head;
}

/**
 * Records the current head to `anchorPath`, atomically and owner-only.
 * Returns `undefined` — writing nothing — for an empty journal, because there
 * is no head to pin and an anchor at seq 0 would assert something false.
 */
export async function recordHeadAnchor(
  journal: JournalStore,
  anchorPath: string,
  options: RecordHeadAnchorOptions = {},
): Promise<HeadAnchorRecord | undefined> {
  const head = await readJournalHead(journal);
  if (head === undefined) return undefined;

  const record = HeadAnchorRecordSchema.parse({
    seq: head.seq,
    hash: head.hash,
    recordedAt: (options.now?.() ?? new Date()).toISOString(),
  });

  await mkdir(dirname(anchorPath), { recursive: true, mode: 0o700 });
  // Written to a sibling and renamed, so a crash mid-write can never leave a
  // half-written anchor that would read as a mismatch and cry tamper.
  const staging = `${anchorPath}.tmp`;
  await writeFile(staging, `${JSON.stringify(record, null, 2)}\n`, { mode: JOURNAL_FILE_MODE });
  await rename(staging, anchorPath);
  return record;
}

/**
 * Reads a previously recorded anchor. Absent → `undefined` (nothing has been
 * anchored yet). Present but unreadable, mis-owned, group/world-accessible, a
 * symlink, hardlinked, or malformed → THROWS. An anchor that cannot be
 * trusted must never be silently skipped: skipping it is exactly the
 * fail-open this primitive exists to prevent.
 */
export async function readHeadAnchor(anchorPath: string): Promise<HeadAnchorRecord | undefined> {
  const opened = openOwnedFile(anchorPath, constants.O_RDONLY, { requirePrivateMode: true });
  if (opened.refused === "absent") return undefined;
  if (opened.refused !== undefined || opened.fd === undefined) {
    throw new Error(
      `journal: refusing to read the head anchor at ${anchorPath} (${opened.refused ?? "unreadable"})`,
    );
  }
  try {
    return HeadAnchorRecordSchema.parse(JSON.parse(readFileSync(opened.fd, "utf8")));
  } finally {
    closeSync(opened.fd);
  }
}

/**
 * Checks the journal still contains the anchored entry.
 *
 * Passing means the anchored `(seq, hash)` is still present, so every entry up
 * to it is unchanged — the chain links each hash to its predecessor, so one
 * surviving hash vouches for the whole prefix. It says nothing about entries
 * appended since; those are covered by the next anchor.
 */
export async function verifyAgainstHeadAnchor(
  journal: JournalStore,
  anchor: HeadAnchorRecord,
): Promise<HeadAnchorVerdict> {
  let observedHash: string | undefined;
  let head: JournalHead | undefined;

  for await (const entry of journal.queryEntries({})) {
    if (entry.seq === anchor.seq) observedHash = entry.hash;
    head = { seq: entry.seq, hash: entry.hash };
  }

  if (observedHash === undefined) {
    return {
      ok: false,
      reason: "head_behind_anchor",
      anchoredSeq: anchor.seq,
      anchoredHash: anchor.hash,
      ...(head !== undefined ? { head } : {}),
    };
  }

  if (observedHash !== anchor.hash) {
    return {
      ok: false,
      reason: "anchor_hash_mismatch",
      anchoredSeq: anchor.seq,
      anchoredHash: anchor.hash,
      observedHash,
      ...(head !== undefined ? { head } : {}),
    };
  }

  return { ok: true, head: head! };
}

/** Convenience: read the anchor from disk and verify it, if one exists. `undefined` means nothing has been anchored yet. */
export async function verifyRecordedHeadAnchor(
  journal: JournalStore,
  anchorPath: string,
): Promise<HeadAnchorVerdict | undefined> {
  const anchor = await readHeadAnchor(anchorPath);
  if (anchor === undefined) return undefined;
  return verifyAgainstHeadAnchor(journal, anchor);
}
