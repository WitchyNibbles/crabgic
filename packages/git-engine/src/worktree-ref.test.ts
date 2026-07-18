import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildWorktreeRef,
  InvalidRefSegmentError,
  resolveWorktreePath,
  WorktreePathEscapeError,
} from "./worktree-ref.js";
import { freshTmpDir, removeDirTree } from "./test-support/fixture-repo.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) removeDirTree(dirs.pop()!);
});

describe("buildWorktreeRef", () => {
  it("builds the neutral work/<run>/<change-set>/<task>/<attempt> ref", () => {
    const ref = buildWorktreeRef({
      runId: "run1",
      changeSetId: "cs1",
      taskId: "task1",
      attempt: "att-abc-123",
    });
    expect(ref).toBe("work/run1/cs1/task1/att-abc-123");
  });

  it("rejects a segment containing a slash", () => {
    expect(() =>
      buildWorktreeRef({ runId: "run/1", changeSetId: "cs1", taskId: "task1", attempt: "a" }),
    ).toThrow(InvalidRefSegmentError);
  });

  it("rejects a segment attempting path traversal", () => {
    expect(() =>
      buildWorktreeRef({ runId: "run1", changeSetId: "..", taskId: "task1", attempt: "a" }),
    ).toThrow(InvalidRefSegmentError);
  });
});

describe("resolveWorktreePath — path-escape boundary (Security test plan)", () => {
  it("resolves a normal nested path under the root", () => {
    const root = freshTmpDir();
    dirs.push(root);
    const resolved = resolveWorktreePath(root, ["run1", "cs1", "task1", "att-1"]);
    expect(resolved).toBe(join(root, "run1", "cs1", "task1", "att-1"));
  });

  it("rejects a `../` traversal segment", () => {
    const root = freshTmpDir();
    dirs.push(root);
    expect(() => resolveWorktreePath(root, ["..", "etc", "passwd"])).toThrow(
      WorktreePathEscapeError,
    );
  });

  it("rejects an absolute-path segment", () => {
    const root = freshTmpDir();
    dirs.push(root);
    expect(() => resolveWorktreePath(root, ["/etc/passwd"])).toThrow(WorktreePathEscapeError);
  });

  it("rejects a symlink-escape: an existing subdirectory that is a symlink pointing outside the root", () => {
    const root = freshTmpDir();
    dirs.push(root);
    const outside = freshTmpDir();
    dirs.push(outside);
    symlinkSync(outside, join(root, "escape-link"));

    expect(() => resolveWorktreePath(root, ["escape-link", "evil"])).toThrow(
      WorktreePathEscapeError,
    );
  });

  it("allows a legitimate nested existing directory (no symlink involved)", () => {
    const root = freshTmpDir();
    dirs.push(root);
    mkdirSync(join(root, "run1", "cs1"), { recursive: true });
    const resolved = resolveWorktreePath(root, ["run1", "cs1", "task1"]);
    expect(resolved).toBe(join(root, "run1", "cs1", "task1"));
  });
});
