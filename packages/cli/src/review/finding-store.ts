import { closeSync, constants, ftruncateSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ReviewFindingSchema, type ReviewFinding } from "@crabgic/contracts";
import {
  CRABGIC_DIR_NAME,
  ensureOwnedDir,
  openOwnedFile,
  resolveXdgStateHome,
  type XdgEnv,
} from "@crabgic/journal";

/**
 * The durable finding store — `docs/staged-review-pipeline.md` §8.0.
 *
 * WHY NOT THE JOURNAL. `JournalEntryType` is closed at thirteen members, and its
 * own docblock forbids a unilateral fourteenth: "a 14th member requires a new
 * coordinated cross-phase resolution round ... never a unilateral addition
 * here". It cites phase 12, which flagged that capability-audit verdicts have no
 * clean member and left the tension open rather than adding one. Doing here what
 * that phase declined to do would be exactly the addition the constraint names.
 *
 * `EvidenceRecord` does not fit either. Its `objectId` is a **Git object id**,
 * not a payload pointer, and `command` / `toolchainFingerprint` are required
 * fields a review has no honest value for. Filling them with plausible-looking
 * strings to make a record validate is how a schema stops meaning anything.
 *
 * WHY XDG STATE IS PRINCIPLED RATHER THAN A FALLBACK. The `EnvelopePolicy` —
 * the artifact that decides what runs WITHOUT review — already lives in XDG
 * state and not in the journal. Findings are strictly less privileged than that,
 * so the precedent covers them comfortably.
 *
 * MIGRATION IS OPEN, NOT FORECLOSED. This sits behind `loadFindings` /
 * `saveFindings`, so if a coordinated round later adds a `review_verdict` entry
 * kind, moving is a migration and not a redesign.
 *
 * The store path is predictable by design, so it gets the same treatment as the
 * policy and the signing key: `ensureOwnedDir` and `openOwnedFile`, hardened by
 * roast rounds 30-32 against a symlinked component, a hardlink, a FIFO, and a
 * foreign owner.
 */

/** Pinned file name under the project's XDG state root. */
export const REVIEW_FINDINGS_FILE_NAME = "review-findings.json";

export function resolveFindingStorePath(env: XdgEnv, projectHash: string): string {
  return join(resolveXdgStateHome(env), CRABGIC_DIR_NAME, projectHash, REVIEW_FINDINGS_FILE_NAME);
}

/**
 * Every finding on record, or `[]`.
 *
 * Reads as EMPTY for every failure — absent, unparseable, not ours. Losing the
 * record is bad; refusing to review at all is worse, and the next save rewrites
 * it. What must never happen is a malformed entry reaching the closure
 * computation, where a finding with no disposition would hold a stage open
 * forever with nothing able to answer it — so entries are validated one by one
 * and the invalid ones dropped rather than the whole file trusted or discarded.
 */
export async function loadFindings(path: string): Promise<readonly ReviewFinding[]> {
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

  const findings: ReviewFinding[] = [];
  for (const entry of parsed) {
    const result = ReviewFindingSchema.safeParse(entry);
    if (result.success) findings.push(result.data);
  }
  return findings;
}

/**
 * Replace the record.
 *
 * Throws rather than degrading: a save that silently did nothing would lose the
 * disposition a reviewer just recorded, and the caller would report a stage
 * closed on findings that were never written down.
 */
export async function saveFindings(
  path: string,
  findings: readonly ReviewFinding[],
  stateHome: string,
): Promise<void> {
  await Promise.resolve();
  const dirRefusal = ensureOwnedDir(dirname(path), stateHome);
  if (dirRefusal !== undefined) {
    throw new Error(
      `refusing to write review findings: the directory holding ${path} is ${dirRefusal}`,
    );
  }

  // No `O_TRUNC`: truncation is a write, and must not happen to anything the
  // checks would go on to refuse.
  const opened = openOwnedFile(path, constants.O_WRONLY | constants.O_CREAT);
  if (opened.refused !== undefined) {
    throw new Error(`refusing to write review findings to ${path}: it is ${opened.refused}`);
  }
  const fd = opened.fd as number;
  try {
    ftruncateSync(fd, 0);
    writeFileSync(fd, `${JSON.stringify(findings, null, 2)}\n`, "utf8");
  } finally {
    closeSync(fd);
  }
}
