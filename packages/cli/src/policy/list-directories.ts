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

    // Excluded: links into `node_modules` or `.git`. Neither is ever a source
    // directory, and `node_modules` in particular is where this system's own
    // provisioner puts symlinks back to the owner's checkout — so a tracked
    // `docs -> node_modules` would derive a write grant that reaches the
    // source tree two hops later (roast round 6).
    //
    // NOT excluded: a link whose target is outside the repository. Round 5
    // added that restriction and round 6 showed it cancelled the round-4 fix
    // it was written under: a repo whose source directories are external
    // links — ordinary with bind mounts and shared monorepos — derived NO
    // prefixes at all, was reported vacuous, and got no policy written.
    // Containment is the sandbox's job, at the syscall layer, and the owner
    // reviews the rendered policy before confirming it; under-granting here
    // silently breaks real repositories to defend a boundary that is enforced
    // elsewhere anyway.
    const real = realpathSync(full);
    for (const excluded of ["node_modules", ".git"]) {
      // The EXCLUSION target is realpath'd too. Round 7: comparing against
      // `join(realpath(parent), "node_modules")` fails the moment
      // `node_modules` is itself a symlink — a shared store, a bind mount, a
      // docker volume, which are the very layouts round 6 cited as its reason
      // for allowing external links at all. A tracked `docs -> node_modules/x`
      // then derived a write grant into the shared module store.
      let excludedReal: string;
      try {
        excludedReal = realpathSync(join(parent, excluded));
      } catch {
        continue; // not present here
      }
      if (real === excludedReal || real.startsWith(`${excludedReal}/`)) return false;
    }
    return true;
  } catch {
    return false;
  }
}
