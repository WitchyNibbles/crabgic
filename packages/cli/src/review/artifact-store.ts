import { closeSync, constants, ftruncateSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DesignRecordSchema,
  PlanRecordSchema,
  type DesignRecord,
  type PlanRecord,
} from "@crabgic/contracts";
import {
  CRABGIC_DIR_NAME,
  ensureOwnedDir,
  openOwnedFile,
  resolveXdgStateHome,
  type XdgEnv,
} from "@crabgic/journal";

/**
 * The design and plan records a ChangeSet has produced.
 *
 * WHY DURABLE. `plan-covers-every-design-element` scores the plan against the
 * DESIGN's elements, and the two arrive in different stages, in different tool
 * calls. Without a store the plan stage would have to be handed the design by its
 * caller — which is asking the party being checked to supply the reference set it
 * is checked against, and the answer to that is always yes.
 *
 * Keyed by ChangeSet, because that is the unit a design and a plan belong to. Two
 * ChangeSets sharing one file must not read each other's artifacts as their own.
 *
 * Same store discipline as the findings, the calibration corpus and the
 * attestations: XDG state rather than the journal, and `ensureOwnedDir` /
 * `openOwnedFile` on every open. Reads as empty for every failure and validates
 * each record on its own, so a malformed one is dropped rather than reaching a
 * derivation that would then decide a criterion from a document nobody could read.
 */

/** Pinned file name under the project's XDG state root. */
export const REVIEW_ARTIFACTS_FILE_NAME = "review-artifacts.json";

export function resolveArtifactStorePath(env: XdgEnv, projectHash: string): string {
  return join(resolveXdgStateHome(env), CRABGIC_DIR_NAME, projectHash, REVIEW_ARTIFACTS_FILE_NAME);
}

export interface StoredArtifacts {
  readonly design?: DesignRecord;
  readonly plan?: PlanRecord;
}

/** Every ChangeSet's artifacts, keyed by ChangeSet id. */
type ArtifactFile = Record<string, StoredArtifacts>;

function readFile(path: string): ArtifactFile {
  const opened = openOwnedFile(path, constants.O_RDONLY, { requirePrivateMode: true });
  if (opened.refused !== undefined) return {};
  const fd = opened.fd as number;
  let raw: string;
  try {
    raw = readFileSync(fd, "utf8");
  } catch {
    return {};
  } finally {
    closeSync(fd);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};

  const file: ArtifactFile = {};
  for (const [changeSetId, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const entry = value as { design?: unknown; plan?: unknown };
    // Validated one field at a time: a malformed plan must not take a valid design
    // down with it, since the design is what a later stage compares against.
    const design = DesignRecordSchema.safeParse(entry.design);
    const plan = PlanRecordSchema.safeParse(entry.plan);
    file[changeSetId] = {
      ...(design.success ? { design: design.data } : {}),
      ...(plan.success ? { plan: plan.data } : {}),
    };
  }
  return file;
}

export async function loadArtifacts(path: string, changeSetId: string): Promise<StoredArtifacts> {
  await Promise.resolve();
  return readFile(path)[changeSetId] ?? {};
}

/**
 * Record what this submission carried, leaving the other kind and every other
 * ChangeSet untouched.
 *
 * A submission that carried only a plan must not erase the design the design stage
 * left behind — that record is precisely what the plan is being scored against.
 *
 * Throws rather than degrading, like the other stores: a save that silently did
 * nothing would let a later stage score against an artifact that was never written.
 */
export async function saveArtifacts(
  path: string,
  changeSetId: string,
  artifacts: StoredArtifacts,
  stateHome: string,
): Promise<void> {
  await Promise.resolve();
  const file = readFile(path);
  const existing = file[changeSetId] ?? {};
  const merged: StoredArtifacts = {
    ...((artifacts.design ?? existing.design)
      ? { design: artifacts.design ?? existing.design }
      : {}),
    ...((artifacts.plan ?? existing.plan) ? { plan: artifacts.plan ?? existing.plan } : {}),
  };

  const dirRefusal = ensureOwnedDir(dirname(path), stateHome);
  if (dirRefusal !== undefined) {
    throw new Error(
      `refusing to write review artifacts: the directory holding ${path} is ${dirRefusal}`,
    );
  }
  // No `O_TRUNC`: truncation is a write, and must not happen to anything the checks
  // would go on to refuse.
  const opened = openOwnedFile(path, constants.O_WRONLY | constants.O_CREAT);
  if (opened.refused !== undefined) {
    throw new Error(`refusing to write review artifacts to ${path}: it is ${opened.refused}`);
  }
  const fd = opened.fd as number;
  try {
    ftruncateSync(fd, 0);
    writeFileSync(fd, `${JSON.stringify({ ...file, [changeSetId]: merged }, null, 2)}\n`, "utf8");
  } finally {
    closeSync(fd);
  }
}
