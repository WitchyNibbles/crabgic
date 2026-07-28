import { mkdir, readdir, realpath, stat, symlink } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

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
 * WORKSPACE LINKS MUST STAY INSIDE THE WORKTREE. Roast round 3 (F2) found
 * the defect this whole module would otherwise have introduced. In a
 * workspace repo `node_modules` contains links back into the checkout itself
 * — here, `node_modules/@crabgic/contracts -> ../../packages/contracts`.
 * Copying those verbatim would point the worktree's own module resolution at
 * the SOURCE checkout, so a worker that edited
 * `<worktree>/packages/contracts/src/x.ts` and then ran `npm run test` would
 * have its tests resolve the OWNER's copy instead. Green tests would be
 * evidence about a tree the worker never touched — the attempt-validation
 * loop reporting on code it did not run, which is worse than no validation at
 * all. So a link whose target lies inside the source checkout (and outside
 * its `node_modules`) is REWRITTEN to the equivalent path inside the
 * worktree; only genuinely external packages are shared.
 *
 * WHAT MAKES SHARING EXTERNAL PACKAGES SAFE — and what it does not cover. A
 * shared entry points at the source checkout, outside the worktree, so a
 * write through it resolves outside every path the narrowed sandbox grants
 * and is refused by the sandbox. That covers the **Bash** write path only.
 * It deliberately does NOT claim layer-independence: `docs/engine-baseline.md`
 * §14.2 records that on the probed host "the sandbox does not constrain the
 * engine's `Write` tool at all", so for `Write`/`Edit` the barrier is the
 * permission layer's string matching against the compiled owned-path rules —
 * which is the unprobed symlink-resolution question in `owned-path.ts`'s
 * ENGINE-FACT-DRIFT note. An earlier version of this comment claimed the
 * guarantee held "regardless of how the engine matches paths". Roast round 3
 * (F9) showed that mis-attributes a Bash-layer property to every layer, and
 * the claim is narrowed here rather than left overstated.
 */

/**
 * Written into the worktree as real directories rather than symlinks —
 * build tools write to these constantly, and a symlink would resolve them
 * into the source checkout, outside every path the narrowed sandbox grants.
 *
 * `.cache` was originally the only member, chosen from what build tools
 * generally use. Roast round 3 (F6) checked what this repository actually
 * has and found no `.cache` at all — but `.vite` and `.vite-temp`, which
 * Vite and Vitest write to on every run, were being symlinked out. The list
 * is now what real toolchains here use, and is deliberately a fixed set
 * rather than a pattern: each member is also granted as policy scratch, and
 * a grant derived from a pattern is a grant nobody can read.
 */
export const WORKTREE_LOCAL_MODULE_DIRS = [".cache", ".vite", ".vite-temp"] as const;

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
  /**
   * Entries that could not be linked. Reported rather than swallowed: a
   * silent skip made total failure byte-identical to "the source had no
   * `node_modules`", so a caller could not tell a working worktree from an
   * empty one (roast round 3, F10).
   */
  readonly skipped: readonly string[];
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
    return { linkedCount: 0, realDirectories: [], skipped: [] };
  }

  const targetModules = join(options.worktreePath, "node_modules");
  await mkdir(targetModules, { recursive: true });

  const realDirectories: string[] = [];
  let linkedCount = 0;

  const skipped: string[] = [];
  for (const entry of entries) {
    if ((WORKTREE_LOCAL_MODULE_DIRS as readonly string[]).includes(entry)) continue;
    if (await linkEntry(options, sourceModules, targetModules, entry)) {
      linkedCount += 1;
    } else {
      skipped.push(entry);
    }
  }

  // Created AFTER the link loop and unconditionally, so it exists even when
  // the source had no `.cache` of its own to skip.
  for (const real of WORKTREE_LOCAL_MODULE_DIRS) {
    await mkdir(join(targetModules, real), { recursive: true });
    realDirectories.push(real);
  }

  return { linkedCount, realDirectories, skipped };
}

/**
 * Links one `node_modules` entry, rewriting workspace self-links so they stay
 * inside the worktree. Returns whether it was linked.
 *
 * A scoped directory (`@scope/`) is recursed into rather than linked
 * wholesale: in a workspace repo the scope directory holds a MIX of real
 * packages and self-links, so linking it as one unit would carry every
 * self-link inside it back to the source checkout.
 */
async function linkEntry(
  options: ProvisionWorktreeDependenciesOptions,
  sourceModules: string,
  targetModules: string,
  entry: string,
): Promise<boolean> {
  const sourcePath = join(sourceModules, entry);
  const targetPath = join(targetModules, entry);

  try {
    // A scope directory that is ITSELF a symlink (pnpm/yarn layouts) reports
    // `isDirectory() === false` from `lstat`, so it used to fall through to
    // the wholesale-share branch — carrying every self-link inside it back to
    // the source, which is the case the recursion exists to prevent. `.bin`
    // is recursed for the same reason: its entries are relative links that
    // would otherwise resolve into the source's `node_modules`.
    const isScopeLike = entry.startsWith("@") || entry === ".bin";
    if (isScopeLike && (await isDirectoryAfterLinks(sourcePath))) {
      await mkdir(targetPath, { recursive: true });
      const scoped = await readdir(sourcePath);
      let any = false;
      for (const child of scoped) {
        if (await linkEntry(options, sourcePath, targetPath, child)) any = true;
      }
      return any;
    }

    await symlink(await resolveLinkTarget(options, sourcePath), targetPath);
    return true;
  } catch {
    // An entry that cannot be linked (already present, permission, a race
    // with a concurrent attempt, a dangling source link) is skipped rather
    // than fatal. One unlinkable package must not cost the whole worktree;
    // the build that needs it will say so precisely, and this cannot. It is
    // REPORTED though — see `skipped` — because a silent skip made total
    // failure indistinguishable from "the source had no node_modules"
    // (roast round 3, F10).
    return false;
  }
}

/** Whether `path` is a directory once symlinks are followed — `lstat` alone says no for a symlinked scope dir. */
async function isDirectoryAfterLinks(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Where a worktree entry should actually point.
 *
 * A source entry that resolves back INSIDE the checkout — but outside its own
 * `node_modules` — is a workspace self-link, and is redirected to the same
 * relative location inside the worktree. Everything else is shared from the
 * source as-is.
 */
async function resolveLinkTarget(
  options: ProvisionWorktreeDependenciesOptions,
  sourcePath: string,
): Promise<string> {
  // `realpath` on BOTH sides. Roast round 4: this compared `resolve()`d
  // source root against a `realpath`d target, so any non-canonical component
  // in `sourceDir` — a symlinked `~/dev`, a bind-mount alias — made
  // `insideCheckout` false for every workspace self-link. The rewrite then
  // silently turned itself off and shared them back to the source checkout,
  // which is the exact defect this module exists to prevent, failing open.
  let sourceRoot: string;
  try {
    sourceRoot = await realpath(options.sourceDir);
  } catch {
    sourceRoot = resolve(options.sourceDir);
  }
  const sourceModulesRoot = join(sourceRoot, "node_modules");

  let real: string;
  try {
    real = await realpath(sourcePath);
  } catch {
    return sourcePath; // dangling: share it and let the build complain precisely
  }

  const insideCheckout = real.startsWith(`${sourceRoot}/`);
  const insideModules = real.startsWith(`${sourceModulesRoot}/`);
  if (insideCheckout && !insideModules) {
    return join(resolve(options.worktreePath), relative(sourceRoot, real));
  }
  // Absolute, always. A relative `sourceDir` (CRABGIC_PROJECT_DIR is read
  // straight from the environment) would otherwise produce a relative symlink
  // target, which resolves against `<worktree>/node_modules/` and dangles —
  // while `symlink()` still succeeds, so nothing reports it (roast round 4).
  return resolve(sourcePath);
}
