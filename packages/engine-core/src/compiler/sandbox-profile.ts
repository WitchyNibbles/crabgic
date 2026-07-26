import type { AuthorizationEnvelope } from "@crabgic/contracts";
import { SandboxProfileSchema, type SandboxProfile } from "./compiled-worker-profile.js";
import { validateNetworkDestination } from "./network-destination.js";
import {
  CONTROL_REPO_STATE_ROOT_DENY_PATH,
  CONTROL_REPO_CACHE_ROOT_DENY_PATH,
  SSH_DENY_PATH,
  AWS_DENY_PATH,
} from "./xdg-default-paths.js";
import {
  WORKTREE_WRITE_PLACEHOLDER,
  WORKER_TMP_WRITE_PLACEHOLDER,
} from "./worktree-placeholders.js";

/**
 * Re-exported for existing consumers that imported these placeholder
 * tokens from this module — the single source of truth is now
 * `./worktree-placeholders.js` (phase-03 security-fix round, CRITICAL 1),
 * shared with `permission-profile.ts`'s owned-path `Edit`/`Write` allow
 * emission. See that module's own doc comment for why this was lifted out
 * of this file.
 */
export { WORKTREE_WRITE_PLACEHOLDER, WORKER_TMP_WRITE_PLACEHOLDER };

/**
 * The mandatory sensitive-path roots, mirrored into BOTH `filesystem.denyRead`
 * and `filesystem.denyWrite`. `denyRead` alone left the write side of these
 * roots governed only by `allowWrite`'s omission of them — and the SDK
 * documents `allowWrite` as being "Merged with paths from `Edit(...)` allow
 * permission rules", so a future owned-path `Edit` allow that happened to
 * cover one of these roots would have merged write access straight back in.
 * Denying them explicitly is the deny-wins backstop, symmetric with
 * `permission-profile.ts`'s own `Read`/`Edit`/`Write` deny triplets.
 */
const MANDATORY_SENSITIVE_DENY_PATHS: readonly string[] = [
  CONTROL_REPO_STATE_ROOT_DENY_PATH,
  CONTROL_REPO_CACHE_ROOT_DENY_PATH,
  SSH_DENY_PATH,
  AWS_DENY_PATH,
];

/**
 * The worktree's own git internals, carved back OUT of the whole-worktree
 * `allowWrite` grant. BOTH forms are emitted deliberately:
 *
 * - `<worktree>/.git` — the bare path. In this system's real layout the
 *   worktree is created by `git worktree add` (`@crabgic/git-engine`'s
 *   `worktree-lifecycle.ts`), where `<worktree>/.git` is a FILE holding a
 *   `gitdir:` pointer, not a directory. Rewriting that one file repoints the
 *   worktree at an attacker-controlled gitdir — hooks and all.
 * - `<worktree>/.git/**` — everything beneath it, for the plain-clone layout
 *   where `.git` IS a directory (`.git/hooks/*`, `.git/config`'s
 *   `core.hooksPath`/`core.pager`/`alias.*`/filter drivers).
 *
 * Why these paths are singled out at all: `.git/hooks/*` and `.git/config`
 * are not merely in-worktree data, they are HOST code execution OUTSIDE the
 * sandbox the next time the supervisor runs git against this worktree.
 * `permission-profile.ts` already denies
 * `Edit(//<worktree>/.git/**)` / `Write(//<worktree>/.git/**)`, but that
 * covers only the engine's own file tools; before this fix a sandboxed shell
 * redirect (`echo … > <worktree>/.git/hooks/post-commit`) was covered by
 * nothing at all, because `allowWrite` granted the whole worktree.
 *
 * Nothing legitimate writes here from inside the sandbox: with `git worktree
 * add`, `git status`/`git diff` (two of the four allowlisted commands) write
 * their index/lock to the CONTROL REPO's `.git/worktrees/<name>/`, which is
 * outside `<worktree>` and therefore already outside `allowWrite`.
 *
 * HONEST SCOPE OF THE EVIDENCE — this carve-out's own contribution is
 * UNPROVEN, and it is kept as belt-and-braces, not as the proven barrier.
 * `sandbox-containment.live.test`'s arms 7a/7b measured it directly: a
 * sandboxed shell `printf > <worktree>/.git/hooks/post-commit` was refused
 * WITH this `denyWrite` in force (`sandbox-git-hook-denywrite`) and refused
 * IDENTICALLY with `denyWrite` emptied and everything else byte-identical
 * (`sandbox-git-hook-denywrite-removed`). So the observed closure of the
 * git-hook vector is attributable to the engine's own handling of `.git`
 * write targets once `autoAllowBashIfSandboxed: false` restores the Bash
 * permission gate — not to this list. It is emitted anyway because it is a
 * SECOND, independent layer sitting at the sandbox rather than the
 * permission gate, it costs nothing measurable (arm 7c writes inside the
 * owned path under the identical sandbox and succeeds), and the engine's
 * `.git` handling is an undocumented behavior this repo does not control.
 * Do not cite `denyWrite` as the thing that closes the hook vector.
 */
const WORKTREE_GIT_INTERNALS_DENY_PATHS: readonly string[] = [
  `${WORKTREE_WRITE_PLACEHOLDER}/.git`,
  `${WORKTREE_WRITE_PLACEHOLDER}/.git/**`,
];

/**
 * `emitSandboxProfile` — roadmap/03-envelope-compiler-engine-adapter.md
 * work item 3 (adaptation §4.2; docs/engine-baseline.md §6). Pure: only
 * reads `envelope`, never mutates it.
 *
 * ── WHY `filesystem.allowWrite` IS STILL THE WHOLE WORKTREE ──────────────
 * The phase-06 containment investigation asked whether `allowWrite` should be
 * narrowed from `[<worktree>, <worker-tmp>]` to the envelope's OWNED PATHS,
 * so that owned-path containment would survive even a fully unlocked `Bash`.
 * It must NOT be, and the reason is not a preference:
 *
 * `permission-profile.ts`'s `MANDATORY_BASH_ALLOWLIST` is exactly
 * `npm run test`, `npm run build`, `git status`, `git diff`. ALL FOUR write
 * outside any owned path — `npm run build` emits `dist/`/`*.tsbuildinfo`/
 * `node_modules/.cache`, `npm run test` emits `coverage/` and its runner
 * cache, and `git status`/`git diff` refresh git's index. An `allowWrite` of
 * owned paths alone therefore breaks every command the envelope authorizes,
 * which is a failed fix, not a tighter one. Nor can the safe set be widened
 * by guesswork: this compiler's ONLY inputs are the envelope's owned paths,
 * commands, network destinations and credential references — build-output
 * directory names (`dist`, `target`, `build`, `.next`, `.turbo`, `coverage`,
 * …) are project-specific and unknowable here, so any enumeration would fail
 * open for the ones it forgot and silently break real work for the rest.
 *
 * The narrowest safe posture is therefore LAYERED, and is what this function
 * emits:
 *  - the SANDBOX enforces the COARSE boundary — nothing outside the worktree
 *    and the worker tmp dir is writable at all — plus a `denyWrite` carve-out
 *    for the two classes the coarse boundary cannot express (the worktree's
 *    own git internals, and the sensitive roots on their write side); see
 *    `WORKTREE_GIT_INTERNALS_DENY_PATHS` for the measured, honest scope of
 *    what that carve-out has been shown to contribute;
 *  - the PERMISSION layer enforces the FINE boundary — owned-path scoping —
 *    which live evidence shows it does for BOTH `Write` and shell redirects
 *    once `autoAllowBashIfSandboxed: false` stops the sandbox from unlocking
 *    `Bash` (`docs/evidence/phase-06/sandbox-containment-determination.json`:
 *    with the sandbox off, the compiled profile denied `printf > ` writes to
 *    every out-of-owned-path target).
 */
export function emitSandboxProfile(envelope: AuthorizationEnvelope): SandboxProfile {
  return SandboxProfileSchema.parse({
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: false,
    allowUnsandboxedCommands: false,
    network: {
      allowedDomains: envelope.networkDestinations.map(validateNetworkDestination),
      // The Linux/WSL2 UDS gate (docs/engine-baseline.md §6, "Schema
      // correction: Unix-socket allow flag") — NEVER `allowUnixSockets`
      // (a differently-typed, macOS-only, `string[]` path allowlist,
      // "ignored on Linux (seccomp cannot filter by path)").
      allowAllUnixSockets: true,
      allowLocalBinding: false,
    },
    filesystem: {
      allowWrite: [WORKTREE_WRITE_PLACEHOLDER, WORKER_TMP_WRITE_PLACEHOLDER],
      denyWrite: [...WORKTREE_GIT_INTERNALS_DENY_PATHS, ...MANDATORY_SENSITIVE_DENY_PATHS],
      denyRead: [...MANDATORY_SENSITIVE_DENY_PATHS],
    },
    credentials: {
      envVars: envelope.credentialReferences.map((name) => ({ name, mode: "mask" as const })),
    },
  });
}
