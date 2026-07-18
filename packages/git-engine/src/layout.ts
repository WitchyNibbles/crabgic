/**
 * On-disk layout for this package — roadmap/07-git-control-repo-
 * worktrees.md: "Control clone ... into `$XDG_CACHE_HOME/engineering-
 * orchestrator/<project-hash>/git-control/` (cache-root convention pinned
 * in 04)." Interface-ledger Gap 14: `@eo/journal`'s `resolveCacheRoot` is
 * the SOLE definition site of the shared cache root; this module only
 * nests this phase's own subpaths under it, never re-deriving the root.
 *
 * `worktrees/` and `worktree-quarantine/` (WI6) are this phase's OWN path
 * choice — the roadmap pins the `git-control/` path exactly but leaves the
 * worktree/quarantine directory layout to this phase (see docs/evidence/
 * phase-07/README.md "Deviations" for this documented, in-authority
 * choice).
 */

import { join } from "node:path";
import { resolveCacheRoot, type XdgEnv } from "@eo/journal";

export const GIT_CONTROL_SUBDIR = "git-control";
export const WORKTREES_SUBDIR = "worktrees";
export const WORKTREE_QUARANTINE_SUBDIR = "worktree-quarantine";

/** `$XDG_CACHE_HOME/engineering-orchestrator/<project-hash>/git-control/` — the pinned control-clone path (Gap 14). */
export function resolveGitControlDir(env: XdgEnv, projectHash: string): string {
  return join(resolveCacheRoot(env, projectHash), GIT_CONTROL_SUBDIR);
}

/** `.../worktrees/` — this phase's own choice of where supervisor-owned worktrees live, nested under the same pinned cache root. */
export function resolveWorktreesRootDir(env: XdgEnv, projectHash: string): string {
  return join(resolveCacheRoot(env, projectHash), WORKTREES_SUBDIR);
}

/** `.../worktree-quarantine/` — where a quarantined worktree is moved (never silently cleaned). */
export function resolveWorktreeQuarantineDir(env: XdgEnv, projectHash: string): string {
  return join(resolveCacheRoot(env, projectHash), WORKTREE_QUARANTINE_SUBDIR);
}
