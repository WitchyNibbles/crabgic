/**
 * Roast round 1, F7: `createWorktree` runs `git worktree add` and nothing
 * else, so `npm run test` and `npm run build` -- two of only four grantable
 * command prefixes -- failed immediately in every fresh worktree, and a first
 * real run could not proceed on any Node project at any policy setting.
 */
import { mkdir, mkdtemp, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import { lstatSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { provisionWorktreeDependencies } from "./worktree-dependencies.js";

let root: string;
let sourceDir: string;
let worktreePath: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eo-wt-deps-"));
  sourceDir = join(root, "source");
  worktreePath = join(root, "worktree");
  await mkdir(worktreePath, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function seedSourceModules(packages: Record<string, string>): Promise<void> {
  for (const [name, contents] of Object.entries(packages)) {
    const dir = join(sourceDir, "node_modules", name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.js"), contents);
  }
}

describe("provisionWorktreeDependencies", () => {
  it("makes the source's packages readable from the worktree", async () => {
    await seedSourceModules({ vitest: "module.exports = 'vitest';" });

    const result = await provisionWorktreeDependencies({ worktreePath, sourceDir });

    expect(result.linkedCount).toBe(1);
    expect(readFileSync(join(worktreePath, "node_modules", "vitest", "index.js"), "utf8")).toBe(
      "module.exports = 'vitest';",
    );
  });

  it("links every top-level entry, including scoped-package directories", async () => {
    await seedSourceModules({ vitest: "a", typescript: "b" });
    await mkdir(join(sourceDir, "node_modules", "@types", "node"), { recursive: true });

    const result = await provisionWorktreeDependencies({ worktreePath, sourceDir });

    expect(result.linkedCount).toBe(3);
    await expect(stat(join(worktreePath, "node_modules", "@types", "node"))).resolves.toBeTruthy();
  });

  /**
   * The reason this links per entry instead of symlinking `node_modules`
   * wholesale. Build tools write to `node_modules/.cache` constantly, and a
   * wholesale symlink would resolve that into the SOURCE checkout -- outside
   * the worktree, and therefore outside every path the narrowed sandbox
   * grants. It has to be a real directory the standing policy's scratch grant
   * can actually reach.
   */
  it("gives the worktree its own real .cache directory, not a link", async () => {
    await seedSourceModules({ vitest: "a" });
    await mkdir(join(sourceDir, "node_modules", ".cache", "stale"), { recursive: true });

    const result = await provisionWorktreeDependencies({ worktreePath, sourceDir });

    const cache = join(worktreePath, "node_modules", ".cache");
    expect(lstatSync(cache).isSymbolicLink()).toBe(false);
    expect(lstatSync(cache).isDirectory()).toBe(true);
    expect(result.realDirectories).toContain(".cache");
    // The source's own cache contents must NOT leak in.
    await expect(stat(join(cache, "stale"))).rejects.toThrow();
  });

  it("creates .cache even when the source has none to skip", async () => {
    await seedSourceModules({ vitest: "a" });

    await provisionWorktreeDependencies({ worktreePath, sourceDir });

    expect(lstatSync(join(worktreePath, "node_modules", ".cache")).isDirectory()).toBe(true);
  });

  /**
   * The safety property, asserted rather than assumed: a linked entry points
   * OUTSIDE the worktree, so a write through it resolves outside every path
   * the narrowed sandbox grants and is denied at the syscall layer -- whatever
   * the engine's own path matching does with symlinks, which is an unprobed
   * engine fact this design deliberately does not depend on.
   */
  it("points its links at the source checkout, outside the worktree", async () => {
    await seedSourceModules({ vitest: "a" });

    await provisionWorktreeDependencies({ worktreePath, sourceDir });

    const target = await readlink(join(worktreePath, "node_modules", "vitest"));
    expect(target).toBe(join(sourceDir, "node_modules", "vitest"));
    expect(target.startsWith(worktreePath)).toBe(false);
  });

  /**
   * A non-Node project has nothing to provision, and a Node project whose
   * dependencies were never installed is the owner's toolchain problem. Both
   * proceed: failing loudly later at the actual build command is more honest
   * than refusing to create a worktree here.
   */
  it("is a no-op when the source has no node_modules at all", async () => {
    await mkdir(sourceDir, { recursive: true });

    const result = await provisionWorktreeDependencies({ worktreePath, sourceDir });

    expect(result).toEqual({ linkedCount: 0, realDirectories: [], skipped: [] });
    await expect(stat(join(worktreePath, "node_modules"))).rejects.toThrow();
  });

  /** One unlinkable package must not cost the whole worktree. */
  it("skips an entry that cannot be linked rather than failing the run", async () => {
    await seedSourceModules({ vitest: "a", typescript: "b" });
    // Pre-create a real directory where a link would go, so `symlink` throws EEXIST.
    await mkdir(join(worktreePath, "node_modules", "vitest"), { recursive: true });

    const result = await provisionWorktreeDependencies({ worktreePath, sourceDir });

    expect(result.linkedCount).toBe(1);
    expect(lstatSync(join(worktreePath, "node_modules", "typescript")).isSymbolicLink()).toBe(true);
  });

  it("is idempotent — provisioning twice leaves a usable tree", async () => {
    await seedSourceModules({ vitest: "a" });

    await provisionWorktreeDependencies({ worktreePath, sourceDir });
    await provisionWorktreeDependencies({ worktreePath, sourceDir });

    expect(readFileSync(join(worktreePath, "node_modules", "vitest", "index.js"), "utf8")).toBe(
      "a",
    );
    expect(lstatSync(join(worktreePath, "node_modules", ".cache")).isDirectory()).toBe(true);
  });
});

/**
 * Roast round 3, F2 — the defect this module would otherwise have introduced,
 * and the most serious one found in any round.
 *
 * In a workspace repo `node_modules` holds links back into the checkout
 * itself (verified live here: `node_modules/@crabgic/contracts ->
 * ../../packages/contracts`). Copying those verbatim points the worktree's
 * module resolution at the SOURCE checkout, so a worker that edits its own
 * copy and runs the tests has them resolve the OWNER's code instead. Green
 * tests would be evidence about a tree the worker never touched.
 */
describe("provisionWorktreeDependencies — workspace self-links", () => {
  async function seedWorkspaceLink(scope: string, name: string): Promise<void> {
    const pkgDir = join(sourceDir, "packages", name);
    await mkdir(pkgDir, { recursive: true });
    await writeFile(join(pkgDir, "index.js"), "module.exports = 'source';");
    await mkdir(join(sourceDir, "node_modules", scope), { recursive: true });
    await symlink(join(sourceDir, "packages", name), join(sourceDir, "node_modules", scope, name));
  }

  it("redirects a workspace self-link into the worktree, not the source", async () => {
    await seedWorkspaceLink("@acme", "contracts");
    // The worktree's own copy, with DIFFERENT content — this is what a worker
    // would have edited.
    const wtPkg = join(worktreePath, "packages", "contracts");
    await mkdir(wtPkg, { recursive: true });
    await writeFile(join(wtPkg, "index.js"), "module.exports = 'worktree';");

    await provisionWorktreeDependencies({ worktreePath, sourceDir });

    // Resolving through node_modules must reach the WORKTREE's edit.
    const resolved = join(worktreePath, "node_modules", "@acme", "contracts", "index.js");
    expect(readFileSync(resolved, "utf8")).toBe("module.exports = 'worktree';");
  });

  /**
   * A scope directory holds a MIX of real packages and self-links, so linking
   * it wholesale would carry every self-link inside it back to the source.
   */
  it("recurses into a scope directory instead of linking it wholesale", async () => {
    await seedWorkspaceLink("@acme", "contracts");
    // A genuinely external package sharing the same scope.
    const external = join(sourceDir, "node_modules", "@acme", "vendor");
    await mkdir(external, { recursive: true });
    await writeFile(join(external, "index.js"), "module.exports = 'vendor';");

    await provisionWorktreeDependencies({ worktreePath, sourceDir });

    expect(lstatSync(join(worktreePath, "node_modules", "@acme")).isSymbolicLink()).toBe(false);
    // External stays shared from the source...
    expect(await readlink(join(worktreePath, "node_modules", "@acme", "vendor"))).toBe(external);
    // ...while the self-link points into the worktree.
    expect(await readlink(join(worktreePath, "node_modules", "@acme", "contracts"))).toBe(
      join(worktreePath, "packages", "contracts"),
    );
  });

  it("still shares an ordinary external package from the source", async () => {
    await seedSourceModules({ vitest: "a" });

    await provisionWorktreeDependencies({ worktreePath, sourceDir });

    expect(await readlink(join(worktreePath, "node_modules", "vitest"))).toBe(
      join(sourceDir, "node_modules", "vitest"),
    );
  });
});

describe("provisionWorktreeDependencies — reporting", () => {
  /**
   * Roast round 3, F10: every failure was swallowed, so re-provisioning an
   * already-provisioned worktree returned `linkedCount: 0` — byte-identical
   * to "the source has no node_modules", which the result type documents as a
   * normal answer. A caller could not tell a working worktree from an empty
   * one.
   */
  it("names the entries it could not link", async () => {
    await seedSourceModules({ vitest: "a", typescript: "b" });
    await mkdir(join(worktreePath, "node_modules", "vitest"), { recursive: true });

    const result = await provisionWorktreeDependencies({ worktreePath, sourceDir });

    expect(result.skipped).toEqual(["vitest"]);
    expect(result.linkedCount).toBe(1);
  });

  it("reports nothing skipped on a clean provision", async () => {
    await seedSourceModules({ vitest: "a" });
    expect((await provisionWorktreeDependencies({ worktreePath, sourceDir })).skipped).toEqual([]);
  });

  /** Roast round 3, F6: this toolchain writes to .vite and .vite-temp, not .cache. */
  it("gives the worktree real directories for every cache dir the toolchain uses", async () => {
    await seedSourceModules({ vitest: "a" });

    const result = await provisionWorktreeDependencies({ worktreePath, sourceDir });

    expect(result.realDirectories).toEqual([".cache", ".vite", ".vite-temp"]);
    for (const dir of result.realDirectories) {
      expect(lstatSync(join(worktreePath, "node_modules", dir)).isSymbolicLink()).toBe(false);
    }
  });
});

/**
 * Roast round 4. Both of these silently DISABLED the self-link rewrite that
 * exists to stop a worker validating the owner's checkout — the worst kind of
 * failure, because the module still reported a healthy provision.
 */
describe("provisionWorktreeDependencies — non-canonical paths", () => {
  it("still rewrites self-links when sourceDir has a symlinked component", async () => {
    const physical = join(root, "physical");
    const aliased = join(root, "alias");
    await mkdir(join(physical, "packages", "contracts"), { recursive: true });
    await mkdir(join(physical, "node_modules", "@acme"), { recursive: true });
    await symlink(
      join(physical, "packages", "contracts"),
      join(physical, "node_modules", "@acme", "contracts"),
    );
    await symlink(physical, aliased);

    // Provision through the ALIAS, as a shell with a symlinked home would.
    await provisionWorktreeDependencies({ worktreePath, sourceDir: aliased });

    const target = await readlink(join(worktreePath, "node_modules", "@acme", "contracts"));
    expect(target).toBe(join(worktreePath, "packages", "contracts"));
  });

  it("emits absolute targets even when sourceDir is relative", async () => {
    await seedSourceModules({ vitest: "a" });
    const previous = process.cwd();
    process.chdir(root);
    try {
      await provisionWorktreeDependencies({ worktreePath, sourceDir: "source" });
    } finally {
      process.chdir(previous);
    }

    const target = await readlink(join(worktreePath, "node_modules", "vitest"));
    // A relative target resolves against <worktree>/node_modules/ and dangles,
    // while symlink() still succeeds -- so nothing would have reported it.
    expect(target.startsWith("/")).toBe(true);
    expect(readFileSync(join(worktreePath, "node_modules", "vitest", "index.js"), "utf8")).toBe(
      "a",
    );
  });

  it("recurses into a scope directory that is itself a symlink", async () => {
    await mkdir(join(sourceDir, "packages", "contracts"), { recursive: true });
    const realScope = join(sourceDir, "scope-store");
    await mkdir(realScope, { recursive: true });
    await symlink(join(sourceDir, "packages", "contracts"), join(realScope, "contracts"));
    await mkdir(join(sourceDir, "node_modules"), { recursive: true });
    await symlink(realScope, join(sourceDir, "node_modules", "@acme"));

    await provisionWorktreeDependencies({ worktreePath, sourceDir });

    // Wholesale-sharing the scope would have carried the self-link back out.
    expect(lstatSync(join(worktreePath, "node_modules", "@acme")).isSymbolicLink()).toBe(false);
    expect(await readlink(join(worktreePath, "node_modules", "@acme", "contracts"))).toBe(
      join(worktreePath, "packages", "contracts"),
    );
  });
});
