import { afterEach, describe, expect, it } from "vitest";
import {
  freshTmpDir,
  removeDirTree,
  writeFixtureFile,
  writeFixtureSymlink,
} from "../test-support/fixture-repo.js";
import { walkRepoTree } from "./safe-walk.js";

/**
 * `walkRepoTree` — the sole file-enumeration primitive every detector uses.
 * roadmap/12-stack-detection-quarantine.md §Goal: "`StackEvidence` is
 * always derived from static analysis with zero child-process spawns."
 * This suite proves the walk itself is pure `node:fs` traversal (no
 * `node:child_process` import anywhere in this module — see the repo-wide
 * `spawn-surface-scan.test.ts`), ignores VCS/dependency noise directories,
 * never follows a symlink outside the walked root, and is bounded (depth +
 * entry count) so a pathological/adversarial tree can't exhaust memory.
 */
describe("walkRepoTree", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) removeDirTree(d);
  });

  function newRoot(): string {
    const dir = freshTmpDir();
    dirs.push(dir);
    return dir;
  }

  it("lists plain files at the root and in nested directories", () => {
    const root = newRoot();
    writeFixtureFile(root, "package.json", "{}");
    writeFixtureFile(root, "src/index.ts", "export {};");
    const files = walkRepoTree(root)
      .map((f) => f.relativePath)
      .sort();
    expect(files).toEqual(["package.json", "src/index.ts"]);
  });

  it("ignores node_modules, .git, and dist directories", () => {
    const root = newRoot();
    writeFixtureFile(root, "package.json", "{}");
    writeFixtureFile(root, "node_modules/left-pad/index.js", "module.exports = 1;");
    writeFixtureFile(root, ".git/HEAD", "ref: refs/heads/main");
    writeFixtureFile(root, "dist/index.js", "export {};");
    const files = walkRepoTree(root).map((f) => f.relativePath);
    expect(files).toEqual(["package.json"]);
  });

  it("never follows a symlink that escapes the walked root", () => {
    const root = newRoot();
    const outside = newRoot();
    writeFixtureFile(outside, "secret.txt", "outside-content");
    writeFixtureFile(root, "package.json", "{}");
    writeFixtureSymlink(root, "escape", outside);
    const files = walkRepoTree(root).map((f) => f.relativePath);
    expect(files).toEqual(["package.json"]);
  });

  it("never follows a symlink pointing at a file outside the root either", () => {
    const root = newRoot();
    const outside = newRoot();
    const outsideFile = writeFixtureFile(outside, "secret.txt", "outside-content");
    writeFixtureFile(root, "package.json", "{}");
    writeFixtureSymlink(root, "escape.txt", outsideFile);
    const files = walkRepoTree(root).map((f) => f.relativePath);
    expect(files).toEqual(["package.json"]);
  });

  it("follows a symlink that points at a file WITHIN the walked root", () => {
    const root = newRoot();
    const target = writeFixtureFile(root, "real/data.json", "{}");
    writeFixtureSymlink(root, "link-to-data.json", target);
    const files = walkRepoTree(root)
      .map((f) => f.relativePath)
      .sort();
    expect(files).toEqual(["link-to-data.json", "real/data.json"]);
  });

  it("follows a symlink that points at a DIRECTORY within the walked root", () => {
    const root = newRoot();
    writeFixtureFile(root, "real/nested.txt", "x");
    writeFixtureSymlink(root, "link-dir", `${root}/real`);
    const files = walkRepoTree(root)
      .map((f) => f.relativePath)
      .sort();
    expect(files).toEqual(["link-dir/nested.txt", "real/nested.txt"]);
  });

  it("skips a dangling symlink (target does not exist) rather than throwing", () => {
    const root = newRoot();
    writeFixtureFile(root, "package.json", "{}");
    writeFixtureSymlink(root, "dangling", `${root}/does-not-exist`);
    const files = walkRepoTree(root).map((f) => f.relativePath);
    expect(files).toEqual(["package.json"]);
  });

  it("returns [] for a root path that IS a file, not a directory", () => {
    const root = newRoot();
    const filePath = writeFixtureFile(root, "just-a-file.txt", "x");
    expect(walkRepoTree(filePath)).toEqual([]);
  });

  it("stops descending past the configured max depth", () => {
    const root = newRoot();
    writeFixtureFile(root, "a/b/c/d/e/f/too-deep.txt", "x");
    const files = walkRepoTree(root, { maxDepth: 3 }).map((f) => f.relativePath);
    expect(files).toEqual([]);
  });

  it("stops enumerating past the configured max entry count rather than growing unbounded", () => {
    const root = newRoot();
    for (let i = 0; i < 20; i += 1) {
      writeFixtureFile(root, `file-${String(i)}.txt`, "x");
    }
    const files = walkRepoTree(root, { maxEntries: 5 });
    expect(files.length).toBeLessThanOrEqual(5);
  });

  it("returns an empty list, never throws, for a root that does not exist", () => {
    expect(walkRepoTree(join_nonexistent())).toEqual([]);
  });

  /**
   * Adversarial-review finding (HIGH, confirmed DoS): a directory of `k`
   * self-referential symlinks (`loopN -> .`) with ZERO regular files
   * recurses with branching factor `k` down to `maxDepth` — the
   * `maxEntries` budget only ever decremented when a FILE was pushed, so a
   * few-byte crafted repo could hang detection for minutes (empirically:
   * k=2 ~970ms, k=3 did not finish in 90s before this fix). The walk must
   * refuse to re-enter a directory realpath already on the CURRENT
   * ancestor path, terminating near-instantly regardless of `k`.
   */
  it("terminates quickly and returns no files for a directory of self-referential symlinks (symlink-loop DoS)", () => {
    const root = newRoot();
    const K = 6;
    for (let i = 0; i < K; i += 1) {
      writeFixtureSymlink(root, `loop${String(i)}`, root);
    }
    const start = Date.now();
    const files = walkRepoTree(root);
    const elapsedMs = Date.now() - start;
    expect(files).toEqual([]);
    expect(elapsedMs).toBeLessThan(2000);
  }, 5000);

  it("terminates quickly for a self-referential symlink nested inside a real subdirectory (not just at the root)", () => {
    const root = newRoot();
    writeFixtureFile(root, "real/marker.txt", "x");
    const K = 6;
    for (let i = 0; i < K; i += 1) {
      writeFixtureSymlink(root, `real/loop${String(i)}`, `${root}/real`);
    }
    const start = Date.now();
    const files = walkRepoTree(root).map((f) => f.relativePath);
    const elapsedMs = Date.now() - start;
    expect(files).toEqual(["real/marker.txt"]);
    expect(elapsedMs).toBeLessThan(2000);
  }, 5000);

  it("still allows a legitimate DIAMOND of symlinks (two distinct branches pointing at the same non-ancestor target) — not a false-positive cycle", () => {
    const root = newRoot();
    writeFixtureFile(root, "shared/data.txt", "x");
    writeFixtureSymlink(root, "branch-a", `${root}/shared`);
    writeFixtureSymlink(root, "branch-b", `${root}/shared`);
    const files = walkRepoTree(root)
      .map((f) => f.relativePath)
      .sort();
    expect(files).toEqual(["branch-a/data.txt", "branch-b/data.txt", "shared/data.txt"]);
  });
});

function join_nonexistent(): string {
  return "/nonexistent-eo-detect-fixture-root-xyz";
}
