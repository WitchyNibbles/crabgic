/**
 * The single site that decides whether a path may be opened.
 *
 * ROAST ROUND 31. Round 30 hardened two openers against a symlink and a FIFO.
 * Sweeping the repo for the rest of the class found three more using
 * `O_NOFOLLOW` WITHOUT `O_NONBLOCK`, and a differential against one corpus of
 * hostile objects — each case in its OWN PROCESS, because a synchronous block
 * cannot be observed by any in-process timer — measured how far they had
 * already drifted apart:
 *
 *   object     | policy-store.load | signing-key.loadOrCreate | round 30's opener
 *   regular    | loaded            | ok                       | accepted
 *   symlink    | invalid           | threw                    | refused
 *   dangling   | invalid           | threw                    | refused
 *   directory  | invalid           | threw                    | refused
 *   mode 644   | invalid           | threw                    | (not checked)
 *   fifo       | *** BLOCKED ***   | *** BLOCKED ***          | refused
 *   hardlink   | LOADED            | OK                       | REFUSED
 *
 * Three implementations, two behaviours, in both of the rows that matter — and
 * the FIFO row is not a wrong answer but no answer at all: `crabgic doctor`
 * with a FIFO at the envelope-policy path ran 36 seconds, ignored SIGTERM,
 * needed SIGKILL, and produced ZERO bytes of output. The same `loadEnvelopePolicy`
 * call runs in `bin/supervisord.ts`, which gates every dispatch.
 *
 * That is round 7's lesson exactly — "three attempts at keeping two functions
 * in agreement each diverged somewhere new" — so the flags and the descriptor
 * checks live here, once, and each caller maps the refusal onto its own error
 * shape rather than re-deriving the policy.
 */
import { closeSync, constants, fstatSync, openSync } from "node:fs";

/**
 * Why a path was not opened.
 *
 * `absent` is deliberately its own case rather than folded into a generic
 * refusal: every caller needs to tell "nothing here yet, run `install`" from
 * "something is planted at your path", because they are different sentences
 * and different remedies.
 */
export type OwnedOpenRefusal =
  | "absent"
  | "symlink"
  | "not-a-regular-file"
  | "not-owned"
  | "hardlinked"
  | "group-or-world-accessible"
  | "unsupported-platform"
  | "unreadable";

/** What was actually found, when a path is refused for not being a regular file. */
export type OwnedOpenKind = "directory" | "fifo" | "socket" | "device" | "other";

export interface OwnedOpenResult {
  /** An open descriptor the caller must close. Present iff `refused` is absent. */
  readonly fd?: number;
  readonly refused?: OwnedOpenRefusal;
  /** The underlying errno, when one explains the refusal. */
  readonly code?: string;
  /**
   * Populated for `not-a-regular-file`.
   *
   * Here rather than left to each caller because the callers have owner-facing
   * wording that several roast rounds fought over — "is a directory, not a
   * policy file; remove it and re-run `crabgic install`" is a different remedy
   * from the one a FIFO deserves. One site decides WHAT it is; each caller
   * still decides what to SAY about it.
   */
  readonly kind?: OwnedOpenKind;
  /**
   * The uid and mode actually found, when a descriptor was obtained.
   *
   * Exposed because callers quote them at the owner — "owned by uid 0, not the
   * account running Crabgic" and "accessible to other accounts (mode 644)" are
   * messages roast rounds fought over, and a caller that cannot see the numbers
   * has to re-`stat` the PATH, which reopens the check-then-read swap this
   * function exists to close.
   */
  readonly observedUid?: number;
  readonly observedMode?: number;
}

export interface OwnedOpenOptions {
  /**
   * Refuse a file any other account can reach (any bit in `0o077`).
   *
   * Opt-in, because not every caller's file is a secret. The policy store's is
   * — it decides what runs without review — but the sandbox self-test's sweep
   * cursor is a rotation hint, and refusing it over its mode would turn a
   * cosmetic difference into a lost health check.
   */
  readonly requirePrivateMode?: boolean;
  /** Mode for a file created under `O_CREAT`. Defaults to owner-only. */
  readonly createMode?: number;
}

/**
 * Open `path` and prove it is a regular file this account owns.
 *
 * `O_NOFOLLOW` refuses a planted symlink AT OPEN TIME rather than detecting one
 * afterwards, which is what closes the swap between the check and the read.
 * `O_NONBLOCK` is what stops a FIFO blocking in `open(2)`. The `fstat` is taken
 * on the DESCRIPTOR, so the inode inspected is the inode the caller will use.
 * `nlink === 1` refuses a hardlink — an object `O_NOFOLLOW` does not cover at
 * all, because it opens as a perfectly ordinary regular file this uid owns.
 *
 * `O_TRUNC` is deliberately NOT accepted in `flags`: truncation is a write, and
 * it must not happen to anything the checks below would go on to refuse. A
 * caller that needs an empty file truncates explicitly once it holds the fd.
 */
export function openOwnedFile(
  path: string,
  flags: number,
  options: OwnedOpenOptions = {},
): OwnedOpenResult {
  if ((flags & constants.O_TRUNC) !== 0) {
    throw new TypeError(
      "openOwnedFile: O_TRUNC would truncate a path before it could be refused; truncate the descriptor instead",
    );
  }

  let fd: number;
  try {
    fd = openSync(
      path,
      flags | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      options.createMode ?? 0o600,
    );
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ELOOP is the kernel refusing to follow the final component; ENXIO is a
    // FIFO opened for writing with no reader. Both mean "not what you meant to
    // open", not "unreadable".
    if (code === "ELOOP") return { refused: "symlink", code };
    if (code === "ENOENT") return { refused: "absent", code };
    // ENXIO on a write-open means a FIFO with no reader — there is no
    // descriptor to stat, but the errno already names the kind.
    if (code === "ENXIO") return { refused: "not-a-regular-file", code, kind: "fifo" };
    return { refused: "unreadable", ...(code !== undefined ? { code } : {}) };
  }

  const refusal = classify(fd, options);
  if (refusal === undefined) return { fd };
  const kind = refusal === "not-a-regular-file" ? kindOf(fd) : undefined;
  const observed = observe(fd);
  closeSync(fd);
  return {
    refused: refusal,
    ...(kind !== undefined ? { kind } : {}),
    ...observed,
  };
}

function observe(fd: number): { observedUid?: number; observedMode?: number } {
  try {
    const stats = fstatSync(fd);
    return { observedUid: stats.uid, observedMode: stats.mode };
  } catch {
    return {};
  }
}

function kindOf(fd: number): OwnedOpenKind {
  try {
    const stats = fstatSync(fd);
    if (stats.isDirectory()) return "directory";
    if (stats.isFIFO()) return "fifo";
    if (stats.isSocket()) return "socket";
    if (stats.isCharacterDevice() || stats.isBlockDevice()) return "device";
  } catch {
    // fall through
  }
  return "other";
}

function classify(fd: number, options: OwnedOpenOptions): OwnedOpenRefusal | undefined {
  let stats;
  try {
    stats = fstatSync(fd);
  } catch {
    return "unreadable";
  }

  if (!stats.isFile()) return "not-a-regular-file";
  if (stats.nlink !== 1) return "hardlinked";

  // `getuid` is absent on platforms this project does not support (Linux
  // x64/arm64 and WSL2). Refusing there is deliberate and explicit rather than
  // an accident of `0 !== undefined`: ownership that cannot be established must
  // not be assumed.
  const uid = process.getuid?.();
  if (uid === undefined) return "unsupported-platform";
  if (stats.uid !== uid) return "not-owned";

  if (options.requirePrivateMode === true && (stats.mode & 0o077) !== 0) {
    return "group-or-world-accessible";
  }
  return undefined;
}
