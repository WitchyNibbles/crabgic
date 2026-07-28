import { mkdir, readdir, symlink } from "node:fs/promises";
import { join } from "node:path";

/**
 * Provisioning a fresh worktree's dependencies.
 *
 * WHY THIS EXISTS. `createWorktree` runs `git worktree add` and nothing else,
 * so a new worktree contains the repository's tracked files and no
 * `node_modules`. Roast round 1 (F7) established what that costs: `npm run
 * test` and `npm run build` are **two of only four** command prefixes a
 * compiled worker profile can ever grant, and both fail immediately in a tree
 * with no installed dependencies. `npm ci` is not a grantable prefix and
 * would need network the standing policy denies by default. So a first real
 * run could not proceed on any Node project at any policy setting — not
 * because a gate refused it, but because the work itself could not run.
 *
 * WHY SYMLINKS, AND WHY PER-ENTRY. Copying `node_modules` is prohibitively
 * slow and large per attempt, and this system cuts one worktree per attempt.
 * Symlinking the whole `node_modules` directory would be one call — but then
 * `node_modules/.cache`, which real build tools write to constantly, would
 * resolve into the SOURCE checkout, i.e. outside the worktree. So this
 * creates a real `node_modules` directory and symlinks each top-level entry
 * into it, leaving `.cache` a real directory inside the worktree where the
 * standing policy's scratch grant can actually reach it.
 *
 * WHAT MAKES THIS SAFE. A symlinked entry points at the source checkout,
 * which is outside the worktree — so a write through one resolves outside
 * every path the narrowed sandbox grants and is denied at the syscall layer,
 * regardless of how the engine's own path matching treats symlinks. That last
 * clause matters: whether the permission layer resolves symlinks before
 * matching is an unprobed engine fact (`owned-path.ts`'s own
 * ENGINE-FACT-DRIFT note; `docs/engine-baseline.md` records no path-anchor
 * probe). This design does not depend on the answer — dependencies are
 * read-only by construction of where they physically live, not by a rule
 * anything has to enforce.
 */

/** Written into the worktree as a real directory rather than a symlink — build tools write here constantly. */
const REAL_SUBDIRECTORIES = [".cache"] as const;

export interface ProvisionWorktreeDependenciesOptions {
  /** The freshly created worktree. */
  readonly worktreePath: string;
  /** The checkout whose already-installed dependencies are being shared. */
  readonly sourceDir: string;
}

export interface ProvisionWorktreeDependenciesResult {
  /** Number of top-level entries linked. `0` means the source had no `node_modules` — a normal answer, not a failure. */
  readonly linkedCount: number;
  /** Real directories created inside the worktree's own `node_modules`. */
  readonly realDirectories: readonly string[];
}

/**
 * Shares `sourceDir`'s installed dependencies into `worktreePath`.
 *
 * A source checkout with no `node_modules` is **not an error**: a non-Node
 * project has nothing to provision, and a Node project whose dependencies
 * were never installed is a problem for the owner's own toolchain rather than
 * something this function should invent. Both return `linkedCount: 0`, and
 * the run proceeds — failing loudly later at the actual build command is more
 * honest than refusing to create a worktree here.
 */
export async function provisionWorktreeDependencies(
  options: ProvisionWorktreeDependenciesOptions,
): Promise<ProvisionWorktreeDependenciesResult> {
  const sourceModules = join(options.sourceDir, "node_modules");

  let entries: readonly string[];
  try {
    entries = (await readdir(sourceModules, { withFileTypes: true })).map((entry) => entry.name);
  } catch {
    return { linkedCount: 0, realDirectories: [] };
  }

  const targetModules = join(options.worktreePath, "node_modules");
  await mkdir(targetModules, { recursive: true });

  const realDirectories: string[] = [];
  let linkedCount = 0;

  for (const entry of entries) {
    if ((REAL_SUBDIRECTORIES as readonly string[]).includes(entry)) continue;
    try {
      await symlink(join(sourceModules, entry), join(targetModules, entry), "junction");
      linkedCount += 1;
    } catch {
      // An entry that cannot be linked (already present, permission, a race
      // with a concurrent attempt) is skipped rather than fatal. One
      // unlinkable package must not cost the whole worktree; the build that
      // needs it will say so precisely, and this function cannot.
      continue;
    }
  }

  // Created AFTER the link loop and unconditionally, so it exists even when
  // the source had no `.cache` of its own to skip.
  for (const real of REAL_SUBDIRECTORIES) {
    await mkdir(join(targetModules, real), { recursive: true });
    realDirectories.push(real);
  }

  return { linkedCount, realDirectories };
}
