import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync, statSync } from "node:fs";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { EnvelopePolicySchema, type EnvelopePolicy } from "@crabgic/contracts";
import { resolveStateRoot, type XdgEnv } from "@crabgic/journal";

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
  | { readonly status: "invalid"; readonly reason: string };

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
function validateOpenPolicyFile(fd: number, path: string): LoadPolicyResult | undefined {
  const stats = fstatSync(fd);

  // Checked BEFORE the mode, or a directory is refused for the wrong reason.
  // Roast round 6: `mkdir` under a default umask gives 0755, so the mode test
  // fired first and reported "accessible to other accounts (mode 655)" — a
  // mode the directory does not even have — leaving the specific message
  // reachable only for a 0700 directory nobody creates by accident.
  if (stats.isDirectory()) {
    return {
      status: "invalid",
      reason: `${path} is a directory, not a policy file; remove it and re-run \`crabgic install\``,
    };
  }

  // Ownership, not just mode. A 0600 file owned by someone else is a policy
  // this account cannot edit and did not write — the opposite of a standing
  // approval given by the owner.
  //
  // `getuid` is absent on platforms this project does not support (README
  // pins Linux x64/arm64/WSL2). Refusing there is deliberate and explicit
  // rather than an accident of `0 !== undefined`: an unsupported platform
  // must not silently accept a policy whose ownership cannot be established.
  const uid = process.getuid?.();
  if (uid === undefined) {
    return {
      status: "invalid",
      reason: `cannot establish ownership of ${path} on this platform; Crabgic supports Linux (x64, arm64) and WSL2`,
    };
  }
  if (stats.uid !== uid) {
    return {
      status: "invalid",
      reason:
        `policy file ${path} is owned by uid ${stats.uid}, not the account running Crabgic (uid ${uid}); ` +
        `if you are running under sudo, run without it rather than changing the file's owner`,
    };
  }

  const mode = stats.mode & 0o077;
  if (mode !== 0) {
    return {
      status: "invalid",
      reason: `policy file ${path} is accessible to other accounts (mode ${(mode | 0o600).toString(8)}); it decides what runs without review and must be 0600`,
    };
  }

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
export async function writeEnvelopePolicy(path: string, policy: EnvelopePolicy): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });
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
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ELOOP") {
      return {
        status: "invalid",
        reason: `policy file ${path} is a symbolic link; the standing approval must be a real file this account owns`,
      };
    }
    // ONLY a genuinely missing path is `absent`. Roast round 5 caught the
    // read-side of this and the open-side survived: a mode-000 policy fails
    // here with `EACCES`, and reporting that as "no policy exists, run
    // `crabgic install`" both misdiagnoses it and invites `install` to
    // overwrite a file the owner deliberately locked.
    // ONLY `ENOENT`. Round 7: `ENOTDIR` was added alongside it and undid the
    // sibling fix in the same commit — a state root that is a regular file
    // raises `ENOTDIR`, reporting "absent" sent the owner to `crabgic
    // install`, and the writer then died with a raw `EEXIST` from `mkdir`.
    // `ENOTDIR` never means a policy exists, but "absent" is the wrong
    // REMEDY, which is the whole point of the absent/invalid split.
    if (code === "ENOENT") return { status: "absent" };
    // Deliberately does NOT assert the file exists. Roast round 6: an
    // unreadable PARENT directory raises `EACCES` here whether or not a
    // policy is present, and the previous wording said "exists but could not
    // be opened" — misdiagnosing in the opposite direction from the bug it
    // was written to fix. Both cases need an owner to look, which is what the
    // message now asks for.
    // Resource-exhaustion codes describe THIS PROCESS, not the file. Round 8:
    // under an exhausted descriptor table a perfectly valid policy was
    // reported `invalid`, sending the owner to inspect a file that is fine.
    // There is no third bucket in the absent/invalid split, so the message
    // has to carry the distinction.
    if (code === "EMFILE" || code === "ENFILE" || code === "ENOMEM") {
      return {
        status: "invalid",
        reason: `could not open ${path} because this process is out of resources (${code}); the policy itself is probably fine — retry, or raise the open-file limit`,
      };
    }
    return {
      status: "invalid",
      reason: `policy file ${path} could not be opened (${code ?? "unknown error"}); check the file and the directory holding it`,
    };
  }

  let raw: string;
  try {
    const check = validateOpenPolicyFile(fd, path);
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
