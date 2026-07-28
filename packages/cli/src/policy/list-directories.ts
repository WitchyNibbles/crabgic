import { readdirSync, statSync, type Dirent } from "node:fs";
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
    return statSync(join(parent, entry.name)).isDirectory();
  } catch {
    return false;
  }
}
