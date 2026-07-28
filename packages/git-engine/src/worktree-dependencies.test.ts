/**
 * Roast round 1, F7: `createWorktree` runs `git worktree add` and nothing
 * else, so `npm run test` and `npm run build` -- two of only four grantable
 * command prefixes -- failed immediately in every fresh worktree, and a first
 * real run could not proceed on any Node project at any policy setting.
 */
import { mkdir, mkdtemp, readlink, rm, stat, writeFile } from "node:fs/promises";
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
    expect(result.realDirectories).toEqual([".cache"]);
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

    expect(result).toEqual({ linkedCount: 0, realDirectories: [] });
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
