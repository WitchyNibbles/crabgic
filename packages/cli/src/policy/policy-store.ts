import { createHash } from "node:crypto";
import { lstatSync, readFileSync, statSync } from "node:fs";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
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
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(policy, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
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
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { status: "absent" };
  }

  try {
    // `lstat`, not `stat`: `stat` follows symlinks, so a policy path that is
    // a link to a file owned by another account passed the mode check by
    // validating the TARGET's mode (roast round 3, F4). The link itself is
    // what an attacker controls.
    const linkStats = lstatSync(path);
    if (linkStats.isSymbolicLink()) {
      return {
        status: "invalid",
        reason: `policy file ${path} is a symbolic link; the standing approval must be a real file this account owns`,
      };
    }

    // Ownership, not just mode. A 0600 file owned by someone else is a policy
    // this account cannot edit and did not write — the opposite of a standing
    // approval given by the owner.
    if (linkStats.uid !== process.getuid?.()) {
      return {
        status: "invalid",
        reason: `policy file ${path} is owned by another account (uid ${linkStats.uid}); it must be owned by the account running Crabgic`,
      };
    }

    const mode = linkStats.mode & 0o077;
    if (mode !== 0) {
      return {
        status: "invalid",
        reason: `policy file ${path} is accessible to other accounts (mode ${(mode | 0o600).toString(8)}); it decides what runs without review and must be 0600`,
      };
    }

    // The containing directory too: a policy is only as protected as the
    // directory it can be replaced in.
    const dirMode = statSync(dirname(path)).mode & 0o022;
    if (dirMode !== 0) {
      return {
        status: "invalid",
        reason: `the directory holding ${path} is writable by other accounts, so the policy can be replaced regardless of its own mode`,
      };
    }
  } catch {
    return { status: "absent" };
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
