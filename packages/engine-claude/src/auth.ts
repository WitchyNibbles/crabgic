import { access, open, readFile, constants as fsConstants } from "node:fs/promises";
import { join } from "node:path";
import type { WorkerAuthMaterial } from "./adapter-config.js";

/**
 * `auth` — roadmap/06-claude-engine-adapter.md §In scope, "Spawn path" auth
 * injection; docs/engine-baseline.md §1 (auth decision record: the
 * confirmed-PASS `.credentials.json` fallback, and the documented primary
 * `CLAUDE_CODE_OAUTH_TOKEN` env path); README design decisions 3/4. The
 * adapter never chooses between the two mechanisms independently
 * (roadmap/06 §Risks, risk 9) — it always applies whichever
 * `WorkerAuthMaterial` its caller supplies.
 */

const CREDENTIALS_FILE_NAME = ".credentials.json";
const CREDENTIALS_FILE_MODE = 0o600;

/**
 * Exclusive, no-follow create flags for the destination `.credentials.json`
 * (Finding 5 — credential TOCTOU / symlink-follow): `O_CREAT|O_EXCL` refuses
 * a dest that already exists, and `O_NOFOLLOW` refuses a dest that is a
 * symlink (`ELOOP`) rather than following it. Together they guarantee the
 * owner's real subscription credentials can never be leaked through a
 * pre-planted symlink or written over a pre-existing file at the dest path.
 */
const CREDENTIALS_DEST_OPEN_FLAGS =
  fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW;

/**
 * No-follow read flags for inspecting an already-present destination
 * (resume/fork idempotency — see `provisionWorkerAuth`): `O_NOFOLLOW` still
 * refuses a symlink (`ELOOP`), so a pre-planted symlink is never followed
 * even on the inspection read; a regular file is opened and its bytes read
 * for the identity comparison below.
 */
const CREDENTIALS_DEST_READ_FLAGS = fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW;

/**
 * Reads an already-present `.credentials.json` at `destPath` WITHOUT
 * following symlinks, for the resume/fork idempotency check. Returns:
 *  - `undefined` when the dest does not exist yet (`ENOENT`) — the caller
 *    proceeds to the exclusive no-follow create (the first-spawn path).
 *  - the dest's raw bytes when it is a plain regular file.
 * Throws `WorkerAuthError` for a symlink (`ELOOP`) or any other non-regular /
 * unreadable dest — refused, never followed (Finding 5 preserved on resume).
 */
async function readExistingCredentialsDest(destPath: string): Promise<Buffer | undefined> {
  let handle;
  try {
    handle = await open(destPath, CREDENTIALS_DEST_READ_FLAGS);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw new WorkerAuthError(
      "worker auth credentials destination is not a fresh regular file " +
        "(a symlink or otherwise non-openable path is refused, never followed)",
      { cause },
    );
  }
  try {
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

/**
 * Thrown when the `credentialsFile` source path is missing/unreadable, when
 * the destination already exists or is a symlink (refused, never followed —
 * Finding 5), or when the exclusive no-follow write/chmod into the worker's
 * `CLAUDE_CONFIG_DIR` otherwise fails. Message text NEVER includes
 * credential file bytes or token values — only static, generic text
 * (verified by `auth.test.ts`'s substring assertions) — so a
 * caught-and-logged `WorkerAuthError` can never leak secret material through
 * its own `.message`.
 */
export class WorkerAuthError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "WorkerAuthError";
  }
}

/**
 * Provisions worker auth per `docs/engine-baseline.md` §1's decision
 * record:
 *  - `"credentialsFile"`: copies `sourcePath` to
 *    `<claudeConfigDir>/.credentials.json`, chmod `0600`, returns `{}`
 *    (no env injection — the SDK worker resolves auth from the file).
 *  - `"oauthToken"`: writes NO file; returns
 *    `{ CLAUDE_CODE_OAUTH_TOKEN: token }` for the caller to fold into the
 *    worker's env (`buildWorkerEnv`).
 */
export async function provisionWorkerAuth(
  auth: WorkerAuthMaterial,
  claudeConfigDir: string,
): Promise<Readonly<Record<string, string>>> {
  if (auth.kind === "oauthToken") {
    return { CLAUDE_CODE_OAUTH_TOKEN: auth.token };
  }

  try {
    await access(auth.sourcePath, fsConstants.R_OK);
  } catch (cause) {
    throw new WorkerAuthError(
      "worker auth credentials file is missing or unreadable at the configured source path",
      { cause },
    );
  }

  // Read the source bytes first, then write them into a dest we EXCLUSIVELY
  // create without following symlinks (Finding 5) — never `copyFile` (which
  // opens the dest `O_WRONLY|O_CREAT|O_TRUNC`, following a pre-planted
  // symlink and leaking the owner's real credentials through it).
  const destPath = join(claudeConfigDir, CREDENTIALS_FILE_NAME);
  const bytes = await readFile(auth.sourcePath);

  // Idempotent re-provision (resume/fork land on the SAME per-worker
  // CLAUDE_CONFIG_DIR — 05 keys the dir by stable workerId, so `resume`/`fork`
  // hit the exact path the original `spawn` already provisioned). Inspect an
  // existing dest WITHOUT following symlinks: a regular file whose bytes
  // already match the source is the credentials we planted on the first
  // spawn — accept it as-is (no rewrite). A byte-mismatched regular file is
  // refused as tampering, never overwritten; a symlink is refused inside
  // `readExistingCredentialsDest` (Finding 5 preserved across resume, not
  // only first spawn).
  const existing = await readExistingCredentialsDest(destPath);
  if (existing !== undefined) {
    if (existing.equals(bytes)) {
      return {};
    }
    throw new WorkerAuthError(
      "worker auth credentials destination already exists with different content " +
        "(refused as potential tampering; never overwritten)",
    );
  }

  try {
    const handle = await open(destPath, CREDENTIALS_DEST_OPEN_FLAGS, CREDENTIALS_FILE_MODE);
    try {
      await handle.writeFile(bytes);
      await handle.chmod(CREDENTIALS_FILE_MODE);
    } finally {
      await handle.close();
    }
  } catch (cause) {
    throw new WorkerAuthError(
      "failed to provision the worker auth credentials file into the worker's CLAUDE_CONFIG_DIR " +
        "(the destination must be a fresh, non-symlinked path)",
      { cause },
    );
  }

  return {};
}

/** Provisioning triple `buildWorkerEnv` reads HOME/TMP/CLAUDE_CONFIG_DIR from. */
export interface WorkerEnvProvisioning {
  readonly HOME: string;
  readonly TMP: string;
  readonly CLAUDE_CONFIG_DIR: string;
}

/** Input to `buildWorkerEnv`. */
export interface BuildWorkerEnvInput {
  /** The host's own `PATH`, passed through verbatim (baseline §4.3's allowlist). */
  readonly hostPath: string;
  /** 05's per-worker HOME/TMP/CLAUDE_CONFIG_DIR provisioning result. */
  readonly provisioning: WorkerEnvProvisioning;
  /** `provisionWorkerAuth`'s own return value — folded in verbatim. */
  readonly authEnv: Readonly<Record<string, string>>;
}

/**
 * Builds the worker's env as a strict, from-scratch allowlist (baseline
 * §4.3: "workers must be spawned with an explicitly allowlisted env" —
 * SDK `Options.env` REPLACES the subprocess environment entirely, nothing
 * is inherited from `process.env`). Exactly `{ PATH, HOME, TMPDIR, TMP,
 * CLAUDE_CONFIG_DIR, ...authEnv }` — no other key, ever.
 */
export function buildWorkerEnv(input: BuildWorkerEnvInput): Readonly<Record<string, string>> {
  return {
    PATH: input.hostPath,
    HOME: input.provisioning.HOME,
    TMPDIR: input.provisioning.TMP,
    TMP: input.provisioning.TMP,
    CLAUDE_CONFIG_DIR: input.provisioning.CLAUDE_CONFIG_DIR,
    ...input.authEnv,
  };
}
