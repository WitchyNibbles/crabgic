import { readdirSync, realpathSync, statSync, type Dirent } from "node:fs";
import { join } from "node:path";

/**
 * The directory entries directly under `projectDir`.
 *
 * A seam of its own so `derivePolicy` stays a pure function of a listing —
 * its tests need no real tree, and the one place that touches the filesystem
 * is this four-line function. Failure is an empty listing rather than a
 * throw: derivation then reports the policy as vacuous, which is exactly the
 * right answer for a directory that cannot be read, and `install` refuses to
 * write it.
 */
export function listTopLevelDirectories(projectDir: string): readonly string[] {
  try {
    return readdirSync(projectDir, { withFileTypes: true })
      .filter((entry) => isDirectoryEntry(projectDir, entry))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * A dirent's `isDirectory()` is **false** for a symlink, so a repo whose
 * `src` or `packages` is a link derived no prefix for it — silently
 * under-granting, and in the limit calling a repo with plenty of source
 * "vacuous" (roast round 4). Symlinked source directories are ordinary in
 * monorepos and bind-mounted checkouts, so this follows the link.
 */
function isDirectoryEntry(parent: string, entry: Dirent): boolean {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  try {
    const full = join(parent, entry.name);
    if (!statSync(full).isDirectory()) return false;

    // Only a link that stays INSIDE the repository. Roast round 5: following
    // links unconditionally meant a tracked `packages/etc -> /etc` — git
    // tracks symlinks, so `git worktree add` reproduces it — derived
    // `packages/etc/dist` as a sandbox WRITE grant. Whether that escapes the
    // worktree depends on the engine's symlink resolution, which is recorded
    // as unprobed in two places; this would have turned a dormant unknown
    // into a live one driven by repo-controlled content. Under `packages/`
    // and `apps/` there is no name allowlist to bound it either.
    const root = realpathSync(parent);
    return realpathSync(full).startsWith(`${root}/`);
  } catch {
    return false;
  }
}
