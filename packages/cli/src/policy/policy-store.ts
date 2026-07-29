import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, readFileSync, statSync } from "node:fs";
import { chmod, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { EnvelopePolicySchema, type EnvelopePolicy } from "@crabgic/contracts";
import {
  ensureOwnedDir,
  openOwnedFile,
  resolveStateRoot,
  type OwnedOpenResult,
  type XdgEnv,
} from "@crabgic/journal";

/**
 * Reading the standing `EnvelopePolicy` from disk (ledger Gap 18).
 *
 * ONE WRITER, ONE CALL SITE. Part 3 of the ruling is that nothing reachable
 * from a manager session may create or widen the policy — that, and not the
 * retired terminal prompt, is what still makes "the model cannot satisfy its
 * own approval gate" true. `writeEnvelopePolicy` below is the only writer in
 * the system and is called from exactly one place: `crabgic install`, after
 * an interactive human confirmation. Every other consumer — the daemon, the
 * gateway, every command — takes the loader. A second call site is not a
 * refactor; it is a change to the security model, and the grep that finds
 * them is the check.
 */

/** Pinned file name under the project's XDG **state** root — durable owner state, never a regenerable cache artifact. */
export const ENVELOPE_POLICY_FILE_NAME = "envelope-policy.json";

export function resolveEnvelopePolicyPath(xdgEnv: XdgEnv, projectHash: string): string {
  return join(resolveStateRoot(xdgEnv, projectHash), ENVELOPE_POLICY_FILE_NAME);
}

export type LoadPolicyResult =
  | { readonly status: "loaded"; readonly policy: EnvelopePolicy; readonly digest: string }
  | { readonly status: "absent" }
  | {
      readonly status: "invalid";
      readonly reason: string;
      /**
       * True when the policy itself is probably fine and only this process's
       * state prevented reading it.
       *
       * Round 9: the resource-exhaustion message was added to the loader and
       * the doctor's `repairStep` was left static, so one finding said "the
       * policy is fine" and "go rewrite it" at once — and following that step
       * runs `install`, which renames a machine-derived policy over a
       * hand-tuned one because of a transient descriptor shortage. A remedy
       * that contradicts its own evidence is worse than no remedy, so the
       * classification travels with the result instead of being re-derived
       * from prose by every consumer.
       */
      readonly transient?: true;
    };

/**
 * The digest journaled with every dispatch the policy authorized.
 *
 * Part 4 of the ruling: a standing approval otherwise makes "what was the
 * human standing behind when this ran" unanswerable after the fact. Computed
 * over the PARSED policy rather than the file bytes, so that reformatting or
 * key reordering does not read as a different authorization — and so that a
 * policy whose defaults were filled in by the schema digests identically to
 * one that spelled them out.
 */
/**
 * Validates the OPEN policy file, returning a refusal or `undefined`.
 *
 * Every check is against the descriptor (`fstatSync`), never the path, so
 * nothing can be swapped between checking and reading.
 */
/**
 * Maps `openOwnedFile`'s refusal onto this module's owner-facing wording.
 *
 * ROAST ROUND 31: the flags and the descriptor checks used to live here, and a
 * differential against one corpus proved they had drifted from the other two
 * copies in the repo — this one BLOCKED on a FIFO (36s, SIGTERM ignored, zero
 * output, through the real CLI) and ACCEPTED a hardlink, which round 30's
 * opener refuses. Deciding is now done in one place; only the sentences are
 * decided here.
 */
function refusalToResult(result: OwnedOpenResult, path: string): LoadPolicyResult | undefined {
  switch (result.refused) {
    case undefined:
      return undefined;
    case "absent":
      // ONLY a genuinely missing path is `absent`.
      return { status: "absent" };
    case "symlink":
      return {
        status: "invalid",
        reason: `policy file ${path} is a symbolic link; the standing approval must be a real file this account owns`,
      };
    case "not-a-regular-file":
      // Roast round 6: the directory message must not be reached through the
      // mode test, which reported a mode the directory does not even have.
      return {
        status: "invalid",
        reason:
          result.kind === "directory"
            ? `${path} is a directory, not a policy file; remove it and re-run \`crabgic install\``
            : `${path} is not a regular file (${result.kind ?? "unknown"}); the standing approval must be a real file this account owns`,
      };
    case "hardlinked":
      return {
        status: "invalid",
        reason: `policy file ${path} has more than one hard link; the standing approval must be a file only this path names`,
      };
    case "unsupported-platform":
      return {
        status: "invalid",
        reason: `cannot establish ownership of ${path} on this platform; Crabgic supports Linux (x64, arm64) and WSL2`,
      };
    case "not-owned":
      return {
        status: "invalid",
        reason:
          `policy file ${path} is owned by uid ${String(result.observedUid)}, not the account running Crabgic (uid ${String(process.getuid?.())}); ` +
          `if you are running under sudo, run without it rather than changing the file's owner`,
      };
    case "group-or-world-accessible":
      return {
        status: "invalid",
        reason: `policy file ${path} is accessible to other accounts (mode ${(((result.observedMode ?? 0) & 0o077) | 0o600).toString(8)}); it decides what runs without review and must be 0600`,
      };
    case "unreadable":
      return classifyOpenFailure(result.code, path);
  }
}

/**
 * Validates the OPEN policy file's SURROUNDINGS — the directory it can be
 * replaced in. The file itself is decided by `openOwnedFile`.
 */
function validatePolicyDirectory(path: string): LoadPolicyResult | undefined {
  // `openOwnedFile` has already established that the FILE is ours; this is the
  // uid every directory check compares against.
  const uid = process.getuid?.();

  // The containing directory too: a policy is only as protected as the
  // directory it can be replaced in. Owner AND mode — a foreign-owned 0755
  // directory grants its owner unlink and rename regardless of the mode bits
  // this masks (roast round 4).
  let dirStats;
  try {
    dirStats = statSync(dirname(path));
  } catch (err) {
    // Distinct from "absent": the policy WAS read successfully one step ago,
    // so reporting it missing would send the owner to re-run an installer
    // that is not what is broken.
    return {
      status: "invalid",
      reason: `cannot inspect the directory holding ${path}: ${(err as Error).message}`,
    };
  }
  if (dirStats.uid !== uid || (dirStats.mode & 0o022) !== 0) {
    return {
      status: "invalid",
      reason: `the directory holding ${path} is owned by uid ${dirStats.uid} or writable by other accounts, so the policy can be replaced regardless of its own mode`,
    };
  }

  return undefined;
}

/**
 * Maps an `openSync` failure to a load result.
 *
 * Extracted so the branch is reachable from a test without exhausting the
 * real descriptor table, which would destabilise every other test in the run.
 * Round 9 found the resource-exhaustion branch shipped with no coverage at
 * all -- `grep` located these codes nowhere else in the repo, and v8 named
 * the `return` uncovered -- which is the same "a green suite proves nothing
 * about the new path" pattern round 8 existed to punish.
 */
export function classifyOpenFailure(code: string | undefined, path: string): LoadPolicyResult {
  if (code === "ELOOP") {
    return {
      status: "invalid",
      reason: `policy file ${path} is a symbolic link; the standing approval must be a real file this account owns`,
    };
  }
  // ONLY a genuinely missing path is `absent`. A mode-000 policy fails here
  // with `EACCES`, and reporting that as "no policy exists, run `crabgic
  // install`" both misdiagnoses it and invites `install` to overwrite a file
  // the owner deliberately locked.
  if (code === "ENOENT") return { status: "absent" };
  // Resource-exhaustion codes describe THIS PROCESS, not the file.
  if (code === "EMFILE" || code === "ENFILE" || code === "ENOMEM") {
    return {
      status: "invalid",
      transient: true,
      reason: `could not open ${path} because this process is out of resources (${code}); the policy itself is probably fine`,
    };
  }
  return {
    status: "invalid",
    reason: `policy file ${path} could not be opened (${code ?? "unknown error"}); check the file and the directory holding it`,
  };
}

export function digestPolicy(policy: EnvelopePolicy): string {
  // `JSON.stringify(policy)` with NO replacer. The replacer array form used
  // here originally — `Object.keys(policy).sort()` — is not an ordering
  // device: it is a DEEP key allow-list applied at every nesting level, so
  // `{limits:{maxTurns:5}}` and `{limits:{maxTurns:9999}}` both serialize to
  // `{"limits":{}}` and digest identically (roast round 3, F7). Flat today,
  // so nothing collides yet — but the first nested field would silently make
  // the journaled authorization identity a lie. The object comes from a
  // fixed-shape `.strict()` parse, so plain stringify is already stable.
  const canonical = JSON.stringify(policy);
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

/**
 * Writes a confirmed policy `0600`.
 *
 * This is the ONLY writer in the system, and it is reachable from exactly one
 * place: `crabgic install`, after an interactive human confirmation. Ledger
 * Gap 18 part 3 is that nothing reachable from a manager session may create
 * or widen the policy — no MCP tool, no session-invocable CLI command, no
 * skill — because that, and not the retired terminal prompt, is what still
 * makes "the model cannot satisfy its own approval gate" true. Adding a
 * second call site is not a refactor; it is a change to the security model.
 *
 * `0600` at creation, not chmod-after-write: a window in which the file
 * exists world-readable is a window in which another local account can read
 * what this project will run unattended.
 */
export async function writeEnvelopePolicy(
  path: string,
  policy: EnvelopePolicy,
  stateHome: string,
): Promise<void> {
  const dir = dirname(path);
  // ROAST ROUND 32: `mkdir(..., {recursive: true})` SUCCEEDS on an existing
  // symlink-to-directory, so a symlink planted one level above the policy sent
  // the standing authorization — the artifact that decides what runs WITHOUT
  // review — into an attacker's directory, where they can also rewrite it.
  // Measured through this writer. `O_NOFOLLOW` guards the final component only.
  const dirRefusal = ensureOwnedDir(dir, stateHome);
  if (dirRefusal !== undefined) {
    throw new Error(
      `refusing to write the standing policy: the directory holding ${path} is ${dirRefusal}`,
    );
  }
  // Recursive mkdir does NOT chmod a directory that already exists, so an
  // XDG state root created earlier (or by something else) keeps its mode. A
  // 0777 directory leaves the policy replaceable by another local account
  // even at 0600 — unlink and recreate needs only directory write (roast
  // round 3, F4).
  await chmod(dir, 0o700);

  // Write to a fresh temp file and rename, rather than opening `path`
  // directly. `writeFile`'s `mode` is passed to `open(2)` and applies ONLY
  // when it creates the file, so writing over a pre-existing world-writable
  // policy put the new grant into it and only then narrowed the mode — the
  // exact window the old comment claimed to avoid (F5). Rename is also
  // atomic, so a concurrent `doctor` or dispatch can never observe a
  // half-written policy.
  // `wx` — O_CREAT|O_EXCL, which REFUSES to open an existing path and does
  // not follow symlinks. Roast round 4 found the attack the previous form
  // allowed: the temp name was `${path}.${process.pid}.tmp`, entirely
  // predictable, and the default `w` flag follows links — so pre-planting
  // that name as a symlink to any file the owner owns made `install`
  // truncate the victim, write the policy into it, and then `rename` the
  // policy path into a symlink pointing at it. The victim was destroyed and
  // the loader then permanently rejected the policy, so the install reported
  // success and the product was bricked. A random suffix removes the
  // predictability; `wx` removes the primitive.
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(policy, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, path);
  } catch (err) {
    // Never leave a temp file behind on a failed write — nothing else would
    // ever unlink it.
    await rm(temporary, { force: true });
    throw err;
  }
}

/**
 * Loads the project's standing policy.
 *
 * Distinguishes **absent** from **invalid** deliberately. Both refuse a
 * dispatch, but they are different owner problems: absent means `install`
 * never ran (or was run before this feature existed), while invalid means a
 * file was hand-edited into a state the schema rejects. Collapsing them into
 * one "no policy" answer would send an owner to re-run an installer that is
 * not the thing that is broken.
 *
 * A world-readable or group-writable policy is treated as **invalid**, not
 * merely noted: it is the artifact that decides what runs without review, so
 * a mode that lets another local account edit it defeats the gate exactly as
 * thoroughly as a session-reachable writer would.
 */
export function loadEnvelopePolicy(path: string): LoadPolicyResult {
  // Opened ONCE, and every check made against that descriptor. Roast round 4:
  // the previous form read the bytes and then validated the path, so the
  // inode that was checked need not be the inode that was read — an attacker
  // with directory write could swap their own file in, let it be read, and
  // restore the owner's real 0600 file before the checks ran. `O_NOFOLLOW`
  // refuses a symlink at open time rather than detecting one afterwards.
  const opened = openOwnedFile(path, constants.O_RDONLY, { requirePrivateMode: true });
  const refusal = refusalToResult(opened, path);
  if (refusal !== undefined) return refusal;
  const fd = opened.fd as number;

  let raw: string;
  try {
    const check = validatePolicyDirectory(path);
    if (check !== undefined) return check;
    raw = readFileSync(fd, "utf8");
  } catch (err) {
    // A policy that EXISTS but cannot be read is `invalid`, never `absent`.
    // Roast round 5: a directory at the policy path opens fine under
    // `O_RDONLY|O_NOFOLLOW` and passes every ownership check, then throws
    // `EISDIR` on read — which the blanket catch reported as "no policy
    // exists, run `crabgic install`", and `install` then crashed trying to
    // `rename` over it. Same for `EACCES` on a mode-000 file. The whole point
    // of the absent/invalid split is not sending an owner to re-run an
    // installer that is not what is broken.
    const code = (err as NodeJS.ErrnoException).code;
    return {
      status: "invalid",
      reason:
        code === "EISDIR"
          ? `${path} is a directory, not a policy file; remove it and re-run \`crabgic install\``
          : `policy file ${path} exists but could not be read (${code ?? "unknown error"})`,
    };
  } finally {
    closeSync(fd);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      status: "invalid",
      reason: `policy file ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const result = EnvelopePolicySchema.safeParse(parsed);
  if (!result.success) {
    return {
      status: "invalid",
      reason: `policy file ${path} does not match the EnvelopePolicy schema: ${result.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
    };
  }

  return { status: "loaded", policy: result.data, digest: digestPolicy(result.data) };
}
