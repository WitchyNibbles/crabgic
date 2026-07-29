import { closeSync, constants, ftruncateSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { StoredAttestationSchema, type StoredAttestation } from "@crabgic/contracts";
import {
  CRABGIC_DIR_NAME,
  ensureOwnedDir,
  openOwnedFile,
  resolveXdgStateHome,
  type XdgEnv,
} from "@crabgic/journal";

/**
 * The durable record of who asserted which judged criterion, and why.
 *
 * WHY IT HAS TO BE DURABLE. Without it, an attestation lives for exactly one tool
 * call: round 2 would have to re-argue everything round 1 established, and the
 * record of whose judgement closed a stage would vanish with the response that
 * carried it. An attributed claim nobody can look up later is barely more
 * falsifiable than the anonymous boolean it replaced.
 *
 * Same store discipline as the findings and the calibration corpus, for the same
 * reasons: XDG state rather than the journal (`JournalEntryType` is closed at
 * thirteen and forbids a unilateral fourteenth; `EvidenceRecord` has required
 * fields a judgement has no honest value for), the `EnvelopePolicy` precedent for
 * privileged state living there, and `ensureOwnedDir`/`openOwnedFile` on every
 * open so a predictable path still refuses a symlinked component, a hardlink, a
 * FIFO and a foreign owner.
 *
 * Reads as empty for every failure, and drops invalid entries one by one. An
 * attestation that fails validation must never reach the closure computation,
 * where a malformed one would be a criterion counted as met with nothing behind
 * it — which is precisely the state this whole mechanism exists to end.
 */

/** Pinned file name under the project's XDG state root. */
export const REVIEW_ATTESTATIONS_FILE_NAME = "review-attestations.json";

export function resolveAttestationStorePath(env: XdgEnv, projectHash: string): string {
  return join(
    resolveXdgStateHome(env),
    CRABGIC_DIR_NAME,
    projectHash,
    REVIEW_ATTESTATIONS_FILE_NAME,
  );
}

export async function loadAttestations(path: string): Promise<readonly StoredAttestation[]> {
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

  const attestations: StoredAttestation[] = [];
  for (const entry of parsed) {
    const result = StoredAttestationSchema.safeParse(entry);
    if (result.success) attestations.push(result.data);
  }
  return attestations;
}

/**
 * Replace the record for the stage that was just submitted, leaving other stages
 * alone.
 *
 * Scoped by stage deliberately: a submission for `implement` knows what it judged
 * about the implementation and nothing about what the design stage established, so
 * writing the whole file from one stage's view would silently drop the others'.
 *
 * Throws rather than degrading, for the same reason `saveFindings` does — a save
 * that silently did nothing would report a stage closed on judgements never
 * written down.
 */
export async function saveAttestationsForStage(
  path: string,
  stage: string,
  attestations: readonly StoredAttestation[],
  stateHome: string,
): Promise<void> {
  const existing = await loadAttestations(path);
  const merged = [
    ...existing.filter((entry) => entry.stage !== stage),
    ...attestations.filter((entry) => entry.stage === stage),
  ];

  const dirRefusal = ensureOwnedDir(dirname(path), stateHome);
  if (dirRefusal !== undefined) {
    throw new Error(
      `refusing to write criterion attestations: the directory holding ${path} is ${dirRefusal}`,
    );
  }
  // No `O_TRUNC`: truncation is a write, and must not happen to anything the
  // checks would go on to refuse.
  const opened = openOwnedFile(path, constants.O_WRONLY | constants.O_CREAT);
  if (opened.refused !== undefined) {
    throw new Error(`refusing to write criterion attestations to ${path}: it is ${opened.refused}`);
  }
  const fd = opened.fd as number;
  try {
    ftruncateSync(fd, 0);
    writeFileSync(fd, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  } finally {
    closeSync(fd);
  }
}
