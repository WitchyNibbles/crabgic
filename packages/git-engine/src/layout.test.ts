import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveXdgCacheHome, type XdgEnv } from "@eo/journal";
import {
  resolveGitControlDir,
  resolveWorktreeQuarantineDir,
  resolveWorktreesRootDir,
  WORKTREE_QUARANTINE_SUBDIR,
  WORKTREES_SUBDIR,
} from "./layout.js";

const env: XdgEnv = { HOME: "/home/fixture-user", XDG_CACHE_HOME: "/custom/cache" };
const projectHash = "abc123hash";

describe("layout resolvers (WI5/WI6 own path choices, nested under Gap 14's pinned cache root)", () => {
  it("resolveGitControlDir nests git-control/ under the pinned cache root", () => {
    expect(resolveGitControlDir(env, projectHash)).toBe(
      join(resolveXdgCacheHome(env), "engineering-orchestrator", projectHash, "git-control"),
    );
  });

  it("resolveWorktreesRootDir nests worktrees/ under the same cache root", () => {
    expect(resolveWorktreesRootDir(env, projectHash)).toBe(
      join(resolveXdgCacheHome(env), "engineering-orchestrator", projectHash, WORKTREES_SUBDIR),
    );
  });

  it("resolveWorktreeQuarantineDir nests worktree-quarantine/ under the same cache root", () => {
    expect(resolveWorktreeQuarantineDir(env, projectHash)).toBe(
      join(
        resolveXdgCacheHome(env),
        "engineering-orchestrator",
        projectHash,
        WORKTREE_QUARANTINE_SUBDIR,
      ),
    );
  });

  it("all three roots share the identical <project-hash> parent", () => {
    const controlDir = resolveGitControlDir(env, projectHash);
    const worktreesDir = resolveWorktreesRootDir(env, projectHash);
    const quarantineDir = resolveWorktreeQuarantineDir(env, projectHash);
    const parentOf = (p: string) => p.slice(0, p.lastIndexOf("/"));
    expect(parentOf(controlDir)).toBe(parentOf(worktreesDir));
    expect(parentOf(worktreesDir)).toBe(parentOf(quarantineDir));
  });
});
