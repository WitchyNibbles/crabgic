import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
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
  const canonical = JSON.stringify(policy, Object.keys(policy).sort());
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
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(policy, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
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
    const mode = statSync(path).mode & 0o077;
    if (mode !== 0) {
      return {
        status: "invalid",
        reason: `policy file ${path} is accessible to other accounts (mode ${(mode | 0o600).toString(8)}); it decides what runs without review and must be 0600`,
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
