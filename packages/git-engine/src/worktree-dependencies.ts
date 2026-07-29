import { mkdir, readdir, readlink, realpath, stat, symlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

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
 * KNOWN COST OF THE REWRITE, stated rather than discovered. A workspace
 * package's `main` usually points into `dist/`, which is gitignored — so in a
 * fresh worktree the redirected link resolves to a package with no build
 * output, and the first cross-package `import` fails with
 * `ERR_MODULE_NOT_FOUND` until something runs the build. Nothing currently
 * orders that build first, so an attempt can fail for this reason and look
 * like a genuine test failure. The trade is still right — validating against
 * the owner's checkout would be silently WRONG, where this is loudly broken —
 * but it is a real gap between here and a first green run, and it belongs to
 * the scheduler's ordering rather than to this module.
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
    // the source, which is the case the recursion exists to prevent.
    //
    // `.bin` is recursed and its entries are copied LEXICALLY — see
    // `linkBinEntry`. Round 4 recursed it and resolved targets, which broke
    // in an unbuilt checkout; round 5 shared it wholesale, which round 6
    // measured as strictly worse (a built source made every worktree binary
    // resolve to the OWNER's file while `node_modules/<pkg>` correctly
    // resolved to the worktree — two answers for one package). Copying the
    // relative target verbatim is build-state independent in both directions
    // and agrees with the package links beside it.
    if (entry === ".bin" && (await isDirectoryAfterLinks(sourcePath))) {
      await mkdir(targetPath, { recursive: true });
      const bins = await readdir(sourcePath);
      let anyBin = false;
      for (const bin of bins) {
        if (await linkBinEntry(options, join(sourcePath, bin), join(targetPath, bin)))
          anyBin = true;
      }
      return anyBin;
    }

    if (entry.startsWith("@") && (await isDirectoryAfterLinks(sourcePath))) {
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

/**
 * Copies one `node_modules/.bin` entry, preserving a RELATIVE target verbatim.
 *
 * A `.bin` entry points at `../<pkg>/<file>`, which resolves through the
 * sibling package link — and this module has already pointed that link at the
 * right place. So copying the target unresolved makes the binary agree with
 * the package beside it: a workspace binary reaches the worktree's copy, an
 * external one reaches the shared package, and neither answer depends on
 * whether anyone has run a build yet. Resolving instead (round 4) broke on an
 * unbuilt checkout; sharing the whole directory (round 5) made every binary
 * point at the owner's tree even when the package link did not.
 */
async function linkBinEntry(
  options: ProvisionWorktreeDependenciesOptions,
  sourcePath: string,
  targetPath: string,
): Promise<boolean> {
  try {
    const raw = await readlink(sourcePath);
    // An ABSOLUTE target is re-anchored like any other entry. Round 7: the
    // previous version copied it verbatim on the reasoning that it "names a
    // location, not a relationship" — but `resolveLinkTarget` already
    // re-anchors absolute targets inside the checkout for package entries, so
    // copying here produced two answers for one package in one worktree,
    // which is exactly what this treatment exists to prevent.
    if (isAbsolute(raw)) {
      await symlink(await resolveLinkTarget(options, sourcePath), targetPath);
      return true;
    }
    // A relative target resolves through the sibling package link, which this
    // module has already pointed at the right place — so it is copied as-is.
    await symlink(raw, targetPath);
    return true;
  } catch (err) {
    // NOT a symlink at all. npm writes real shim FILES for some entries
    // (`.cmd`/`.ps1`, and whole binaries on some platforms), and `readlink`
    // raises EINVAL on those. Round 7: they were silently dropped and not
    // even counted in `skipped`, so a tree whose bins are shims got an EMPTY
    // `.bin` in the worktree — and `npm run test`, one of only two useful
    // grantable commands, had no binary at all. A shim is not a relationship
    // to re-anchor, so it is shared from the source like any other file.
    if ((err as NodeJS.ErrnoException).code === "EINVAL") {
      try {
        await symlink(resolve(sourcePath), targetPath);
        return true;
      } catch {
        return false;
      }
    }
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
    // Dangling. ABSOLUTE, like the branch below — roast round 5 caught the
    // round-4 fix being applied to one return and not its sibling, so a
    // relative `sourceDir` produced a relative target here that resolved
    // against `<worktree>/node_modules/` and dangled, while `symlink()`
    // succeeded and the entry was counted as linked rather than skipped.
    return resolve(sourcePath);
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
