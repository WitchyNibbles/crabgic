/**
 * The project-scoped HMAC signing key that binds `run`'s minted approval
 * tokens to the process that later VERIFIES them.
 *
 * WHY THIS EXISTS (2026-07-25). `bootstrap.ts` used to mint the key with a
 * bare `randomBytes(32)` per process, documented as deliberate: "a minted
 * token is single-use and verified... within the same process tree." That
 * held only while every approval path lived in one short-lived CLI
 * invocation. It stops holding the moment `contract.approve` is served from
 * the `gateway mcp` stdio process: `eo run` mints the token in one process
 * and the long-lived MCP server verifies it in a different one, so a
 * per-process key makes `contract.approve` structurally unable to ever
 * succeed — a registered-but-dead surface.
 *
 * The security property the per-process key was protecting — "a token must
 * not outlive its single use" — is NOT weakened by persisting the key,
 * because it is no longer the key's job: `./durable-approval-ledger.ts`
 * claims each `tokenId` through 04's `IdempotencyRegistry` under a
 * per-token `Lease`, so a replay from ANY process at ANY later time lands
 * in `ApprovalTokenAlreadyVerifiedError`, and every token still carries its
 * own `expiresAt`. What the key must supply is confidentiality, which is
 * the same same-uid trust boundary 05's UDS socket already relies on: mode
 * 0600 inside a 0700 directory, never followed through a symlink, and
 * refused outright if either the mode has been widened or the material is
 * not exactly 32 bytes.
 */
import { closeSync, constants, fstatSync, mkdirSync, openSync, readSync, writeSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import {
  CRABGIC_DIR_NAME,
  openOwnedFile,
  resolveXdgStateHome,
  type XdgEnv,
} from "@crabgic/journal";

/** The pinned file name, under the project's XDG **state** root — a signing key is durable state, not a regenerable cache artifact. */
export const APPROVAL_SIGNING_KEY_FILE_NAME = "approval-signing.key";

/** HMAC-SHA256's block-aligned key length, matching what `bootstrap.ts` generated inline before this module existed. */
export const APPROVAL_SIGNING_KEY_BYTES = 32;

export class ApprovalSigningKeyError extends Error {
  readonly path: string;

  constructor(path: string, detail: string) {
    super(`approval signing key at "${path}" is unusable: ${detail}`);
    this.name = "ApprovalSigningKeyError";
    this.path = path;
  }
}

/** `$XDG_STATE_HOME/crabgic/<project-hash>/approval-signing.key` — the same state root `resolveStateRoot` pins the ChangeSet/work-unit/envelope registries at, so one project's approval material never leaks into another's. */
export function resolveApprovalSigningKeyPath(env: XdgEnv, projectHash: string): string {
  return join(
    resolveXdgStateHome(env),
    CRABGIC_DIR_NAME,
    projectHash,
    APPROVAL_SIGNING_KEY_FILE_NAME,
  );
}

/**
 * Reads the key, or `undefined` when there is none yet.
 *
 * ROAST ROUND 31: the flags and descriptor checks used to live here, and a
 * differential against one corpus proved this copy had drifted — it BLOCKED
 * outright on a FIFO (synchronously, so no timer or signal could rescue it)
 * and ACCEPTED a hardlink, which round 30's opener refuses. Absence is a
 * RETURN VALUE now rather than an `ENOENT` this function's own caller had to
 * sniff out of a thrown error: "no key yet, mint one" is a normal first run,
 * not an exception.
 */
function readExistingKey(path: string): Buffer | undefined {
  const opened = openOwnedFile(path, constants.O_RDONLY, { requirePrivateMode: true });
  switch (opened.refused) {
    case undefined:
      break;
    case "absent":
      return undefined;
    case "symlink":
      throw new ApprovalSigningKeyError(path, "it is a symlink — refusing to follow it");
    case "not-a-regular-file":
      throw new ApprovalSigningKeyError(path, "it is not a regular file");
    case "hardlinked":
      // An attacker who can hardlink a file they control into the state
      // directory chooses the signing key, and therefore forges tokens --
      // exactly the outcome `O_NOFOLLOW` is here to prevent, by an object
      // `O_NOFOLLOW` does not cover.
      throw new ApprovalSigningKeyError(
        path,
        "it has more than one hard link — refusing to use it as a signing key",
      );
    case "not-owned":
      throw new ApprovalSigningKeyError(
        path,
        `it is owned by uid ${String(opened.observedUid)} — expected the account running Crabgic`,
      );
    case "unsupported-platform":
      throw new ApprovalSigningKeyError(
        path,
        "ownership cannot be established on this platform; Crabgic supports Linux (x64, arm64) and WSL2",
      );
    case "group-or-world-accessible":
      throw new ApprovalSigningKeyError(
        path,
        `mode ${((opened.observedMode ?? 0) & 0o777).toString(8)} grants group/other access — expected 0600`,
      );
    case "unreadable": {
      const error: NodeJS.ErrnoException = new Error(
        `approval signing key at "${path}" could not be opened (${opened.code ?? "unknown error"})`,
      );
      if (opened.code !== undefined) error.code = opened.code;
      throw error;
    }
  }

  const fd = opened.fd as number;
  try {
    const stat = fstatSync(fd);
    if (stat.size !== APPROVAL_SIGNING_KEY_BYTES) {
      throw new ApprovalSigningKeyError(
        path,
        `it holds ${stat.size} bytes, expected exactly ${APPROVAL_SIGNING_KEY_BYTES}`,
      );
    }
    const key = Buffer.alloc(APPROVAL_SIGNING_KEY_BYTES);
    const read = readSync(fd, key, 0, APPROVAL_SIGNING_KEY_BYTES, 0);
    if (read !== APPROVAL_SIGNING_KEY_BYTES) {
      throw new ApprovalSigningKeyError(path, `short read: ${read} bytes`);
    }
    return key;
  } finally {
    closeSync(fd);
  }
}

/**
 * Reads the project's signing key, creating it on first use. Concurrent
 * first-time callers are safe: creation is `O_EXCL`, and the loser of the
 * race re-reads the winner's key rather than clobbering it (which would
 * silently invalidate a token another process had already minted).
 */
export function loadOrCreateApprovalSigningKey(path: string): Buffer {
  const existing = readExistingKey(path);
  if (existing !== undefined) return existing;

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const key = randomBytes(APPROVAL_SIGNING_KEY_BYTES);
  try {
    const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      writeSync(fd, key);
    } finally {
      closeSync(fd);
    }
    return key;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      // Another process created it between our read and our create — its
      // key is the one of record.
      const raced = readExistingKey(path);
      if (raced === undefined) {
        // EEXIST and then absent: the winner's key was removed between the two
        // syscalls. Reporting it as a signing-key fault is honest; silently
        // minting a second key would invalidate a token already issued.
        throw new ApprovalSigningKeyError(path, "it vanished between creation and read");
      }
      return raced;
    }
    throw err;
  }
}
