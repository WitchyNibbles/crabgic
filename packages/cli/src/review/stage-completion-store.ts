import { closeSync, constants, ftruncateSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { StageCompletionRecordSchema, type StageCompletionRecord } from "@crabgic/contracts";
import {
  CRABGIC_DIR_NAME,
  ensureOwnedDir,
  openOwnedFile,
  resolveXdgStateHome,
  type XdgEnv,
} from "@crabgic/journal";

/**
 * The durable record of which pipeline stages have CLOSED.
 * Owner ruling R8 (2026-08-16); ledger Gap 23's disclosed residual 2.
 *
 * WHY IT EXISTS. `pipeline.plan` took `completedStages` from its caller, so it
 * could refuse a completion set with a HOLE in it and could not refuse a caller
 * claiming a stage it never ran. That was disclosed rather than fixed because
 * nothing depended on the answer. R8 makes dispatch depend on it, so the claim
 * has to become a record.
 *
 * ⚠️ WRITTEN BY THE SERVER, FROM ITS OWN DECISION. `review.submit` appends here
 * when its closure computation says a stage closed — never from a field on its
 * input, and `StageCompletionRecord` deliberately has no member a caller could
 * use to assert closure. A record carrying the caller's answer to the question
 * it exists to answer would be a slower way of trusting the caller.
 *
 * This is a DIFFERENT division from the design-verdict store's. That one is
 * CLI-write-only because nothing session-reachable may record an owner's
 * approval. This one is server-written because closure is a server computation;
 * the model can cause a stage to close only by doing the work `review.submit`
 * scores. For the `design-gate` stage — the one R8 makes dispatch depend on —
 * that computation is `resolveDesignGate`, whose only input is an
 * `OwnerDesignVerdict`, so the chain dispatch hangs on stays owner-anchored.
 *
 * WHY XDG STATE AND NOT THE JOURNAL. `JournalEntryType` is closed at thirteen
 * members (ledger Gap 5) and a stage closing is not an `EvidenceRecord`: it has
 * no `objectId`, no `command` and no `toolchainFingerprint` that would be
 * anything but invented. Same store shape as the finding store, the
 * design-verdict store and the standing `EnvelopePolicy`, with the same
 * `ensureOwnedDir`/`openOwnedFile` hardening rounds 30-32 earned.
 *
 * ⚠️ THE FAIL-SAFE DIRECTION IS THE OPPOSITE OF MOST STORES'. Every read failure
 * — absent, unparseable, not ours, symlinked — reads as EMPTY, which means NOT
 * CLOSED, which means dispatch refuses. A store that degraded the other way
 * would turn an unreadable file into an authorization to start work nobody
 * approved.
 *
 * ⚠️ DISCLOSED RESIDUAL, measured while writing these tests rather than assumed.
 * `openOwnedFile` opens with `O_NOFOLLOW`, which refuses a symlinked FINAL
 * component and nothing else — POSIX follows every parent directory. So a
 * symlink planted at the project's state DIRECTORY redirects reads of this store
 * without being refused, and forged completions there would let a run dispatch
 * on a design nobody approved.
 *
 * This is not new and is not widened here: the design-verdict store, the finding
 * store and the standing `EnvelopePolicy` all share it, and `docs/deploy-posture.md`
 * certifies crabgic for the single-tenant, trusted-operator scope only — where an
 * attacker who can create that symlink already owns the state root. It is
 * recorded because R8 makes this the first store a DISPATCH DECISION depends on,
 * which raises what the residual is worth to an attacker even though the
 * mechanism is unchanged. The write path does not share it: `ensureOwnedDir`
 * runs before any descriptor is opened.
 */

/** Pinned file name under the project's XDG state root. */
export const STAGE_COMPLETIONS_FILE_NAME = "stage-completions.json";

export function resolveStageCompletionStorePath(env: XdgEnv, projectHash: string): string {
  return join(resolveXdgStateHome(env), CRABGIC_DIR_NAME, projectHash, STAGE_COMPLETIONS_FILE_NAME);
}

/**
 * Every completion on record, or `[]`.
 *
 * An individual invalid entry is dropped rather than poisoning the file: one
 * corrupt record must not silently re-open every stage that really did close.
 * A store that is not an array at all is read as empty, since there is no entry
 * in it to salvage.
 */
export async function loadStageCompletions(
  path: string,
): Promise<readonly StageCompletionRecord[]> {
  await Promise.resolve();
  const opened = openOwnedFile(path, constants.O_RDONLY, { requirePrivateMode: true });
  if (opened.refused !== undefined) return [];
  const fd = opened.fd as number;
  let raw: string;
  try {
    raw = readFileSync(fd, "utf8");
  } catch {
    return [];
  } finally {
    closeSync(fd);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const records: StageCompletionRecord[] = [];
  for (const entry of parsed) {
    const result = StageCompletionRecordSchema.safeParse(entry);
    if (result.success) records.push(result.data);
  }
  return records;
}

/**
 * Appends a completion.
 *
 * Appends rather than replaces, so a stage re-opened by an edit and re-closed
 * does not erase the round it closed on the first time — the only durable
 * evidence of whether it converged or was pushed through.
 *
 * Throws rather than degrading. A silent no-op would leave a stage the server
 * decided had closed looking permanently open, and under R8 that presents as the
 * run refusing to dispatch — a failure that reads as the pipeline stalling
 * rather than as the write failing.
 */
export async function recordStageCompletion(
  path: string,
  record: StageCompletionRecord,
  stateHome: string,
): Promise<void> {
  await Promise.resolve();
  const parsed = StageCompletionRecordSchema.safeParse(record);
  if (!parsed.success) {
    throw new Error(
      `refusing to record an invalid stage completion: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")} ${issue.message}`)
        .join("; ")}`,
    );
  }

  const dirRefusal = ensureOwnedDir(dirname(path), stateHome);
  if (dirRefusal !== undefined) {
    throw new Error(
      `refusing to write stage completions: the directory holding ${path} is ${dirRefusal}`,
    );
  }

  const existing = await loadStageCompletions(path);
  const next = [...existing, parsed.data];

  // No `O_TRUNC` on open: truncation is a write, and must not happen to
  // anything the ownership checks would go on to refuse.
  const opened = openOwnedFile(path, constants.O_WRONLY | constants.O_CREAT);
  if (opened.refused !== undefined) {
    throw new Error(`refusing to write stage completions to ${path}: it is ${opened.refused}`);
  }
  const fd = opened.fd as number;
  try {
    ftruncateSync(fd, 0);
    writeFileSync(fd, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  } finally {
    closeSync(fd);
  }
}
