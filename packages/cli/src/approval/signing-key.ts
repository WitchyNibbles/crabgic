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
import { ENGINEERING_ORCHESTRATOR_DIR_NAME, resolveXdgStateHome, type XdgEnv } from "@eo/journal";

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

/** `$XDG_STATE_HOME/engineering-orchestrator/<project-hash>/approval-signing.key` — the same state root `resolveStateRoot` pins the ChangeSet/work-unit/envelope registries at, so one project's approval material never leaks into another's. */
export function resolveApprovalSigningKeyPath(env: XdgEnv, projectHash: string): string {
  return join(
    resolveXdgStateHome(env),
    ENGINEERING_ORCHESTRATOR_DIR_NAME,
    projectHash,
    APPROVAL_SIGNING_KEY_FILE_NAME,
  );
}

function readExistingKey(path: string): Buffer {
  // O_NOFOLLOW: a symlink planted at the pinned path must be REFUSED, never
  // followed — otherwise an attacker who can create one file in the state
  // directory chooses the signing key (and therefore forges tokens).
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ELOOP") {
      throw new ApprovalSigningKeyError(path, "it is a symlink — refusing to follow it");
    }
    throw err;
  }

  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) {
      throw new ApprovalSigningKeyError(path, "it is not a regular file");
    }
    if ((stat.mode & 0o077) !== 0) {
      throw new ApprovalSigningKeyError(
        path,
        `mode ${(stat.mode & 0o777).toString(8)} grants group/other access — expected 0600`,
      );
    }
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
  try {
    return readExistingKey(path);
  } catch (err) {
    if (err instanceof ApprovalSigningKeyError) throw err;
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

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
      return readExistingKey(path);
    }
    throw err;
  }
}
