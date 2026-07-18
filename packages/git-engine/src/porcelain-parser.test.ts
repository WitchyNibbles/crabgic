import { describe, expect, it } from "vitest";
import { dirtyPaths, parsePorcelainV2 } from "./porcelain-parser.js";

/**
 * WI4 — roadmap/07-git-control-repo-worktrees.md work item 4: "Failing-
 * test-first: a hand-built `git status --porcelain=v2` byte stream
 * (modified/added/deleted/renamed/untracked/ignored/conflicted) must parse
 * to the expected structured snapshot before the parser exists." Every
 * fixture below is a hand-built porcelain-v2 byte stream, not real `git`
 * output — this is a pure-function unit suite over the wire format itself.
 */

describe("parsePorcelainV2 (WI4)", () => {
  it("parses a header-only (clean) stream to an all-empty snapshot", () => {
    const text = "# branch.oid abc123\n# branch.head main\n";
    const snapshot = parsePorcelainV2(text);
    expect(snapshot.modified).toEqual([]);
    expect(snapshot.untracked).toEqual([]);
  });

  it("parses a modified ordinary entry (worktree-modified, index-unmodified)", () => {
    const line =
      "1 .M N... 100644 100644 100644 " +
      "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 " +
      "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 src/a.txt";
    const snapshot = parsePorcelainV2(line);
    expect(snapshot.modified).toHaveLength(1);
    expect(snapshot.modified[0]).toMatchObject({ kind: "modified", path: "src/a.txt" });
  });

  it("parses an added ordinary entry (staged new file)", () => {
    const line =
      "1 A. N... 000000 100644 100644 " +
      "0000000000000000000000000000000000000000 " +
      "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 src/new.txt";
    const snapshot = parsePorcelainV2(line);
    expect(snapshot.added).toHaveLength(1);
    expect(snapshot.added[0]).toMatchObject({ kind: "added", path: "src/new.txt" });
  });

  it("parses a deleted ordinary entry", () => {
    const line =
      "1 D. N... 100644 000000 000000 " +
      "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 " +
      "0000000000000000000000000000000000000000 src/gone.txt";
    const snapshot = parsePorcelainV2(line);
    expect(snapshot.deleted).toHaveLength(1);
    expect(snapshot.deleted[0]).toMatchObject({ kind: "deleted", path: "src/gone.txt" });
  });

  it("parses a renamed entry (type 2, tab-separated path/origPath)", () => {
    const line =
      "2 R100 N... 100644 100644 100644 " +
      "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 " +
      "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 R100 src/new-name.txt\tsrc/old-name.txt";
    const snapshot = parsePorcelainV2(line);
    expect(snapshot.renamed).toHaveLength(1);
    expect(snapshot.renamed[0]).toMatchObject({
      kind: "renamed",
      path: "src/new-name.txt",
      origPath: "src/old-name.txt",
      score: 100,
    });
  });

  it("parses a copied entry (type 2, C-score)", () => {
    const line =
      "2 C075 N... 100644 100644 100644 " +
      "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 " +
      "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 C075 src/copy.txt\tsrc/original.txt";
    const snapshot = parsePorcelainV2(line);
    expect(snapshot.copied).toHaveLength(1);
    expect(snapshot.copied[0]).toMatchObject({
      kind: "copied",
      path: "src/copy.txt",
      origPath: "src/original.txt",
      score: 75,
    });
  });

  it("parses an untracked entry", () => {
    const line = "? scratch/notes.txt";
    const snapshot = parsePorcelainV2(line);
    expect(snapshot.untracked).toEqual([{ path: "scratch/notes.txt" }]);
  });

  it("parses an ignored entry", () => {
    const line = "! dist/build.js";
    const snapshot = parsePorcelainV2(line);
    expect(snapshot.ignored).toEqual([{ path: "dist/build.js" }]);
  });

  it("parses a conflicted (unmerged) entry", () => {
    const line =
      "u UU N... 100644 100644 100644 100644 " +
      "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 " +
      "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 " +
      "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 src/conflict.txt";
    const snapshot = parsePorcelainV2(line);
    expect(snapshot.conflicted).toHaveLength(1);
    expect(snapshot.conflicted[0]!.path).toBe("src/conflict.txt");
  });

  it("parses a full mixed byte stream covering every state in one pass", () => {
    const lines = [
      "# branch.oid deadbeef",
      "# branch.head main",
      "1 .M N... 100644 100644 100644 " +
        "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 modified.txt",
      "1 A. N... 000000 100644 100644 " +
        "0000000000000000000000000000000000000000 e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 added.txt",
      "1 D. N... 100644 000000 000000 " +
        "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 0000000000000000000000000000000000000000 deleted.txt",
      "2 R100 N... 100644 100644 100644 " +
        "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 R100 new.txt\told.txt",
      "u UU N... 100644 100644 100644 100644 " +
        "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 conflict.txt",
      "? untracked.txt",
      "! ignored.txt",
    ].join("\n");
    const snapshot = parsePorcelainV2(lines);
    expect(snapshot.modified).toHaveLength(1);
    expect(snapshot.added).toHaveLength(1);
    expect(snapshot.deleted).toHaveLength(1);
    expect(snapshot.renamed).toHaveLength(1);
    expect(snapshot.conflicted).toHaveLength(1);
    expect(snapshot.untracked).toHaveLength(1);
    expect(snapshot.ignored).toHaveLength(1);
  });

  it("handles a path containing a literal space via fixed-field splitting", () => {
    const line =
      "1 .M N... 100644 100644 100644 " +
      "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 " +
      "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 src/my file.txt";
    const snapshot = parsePorcelainV2(line);
    expect(snapshot.modified[0]!.path).toBe("src/my file.txt");
  });
});

describe("dirtyPaths (WI4 — feeds WI5's overlap-vs-planned-writes check)", () => {
  it("collects every dirty-category path, excluding ignored", () => {
    const lines = [
      "1 .M N... 100644 100644 100644 " +
        "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 modified.txt",
      "? untracked.txt",
      "! ignored.txt",
    ].join("\n");
    const snapshot = parsePorcelainV2(lines);
    const paths = dirtyPaths(snapshot);
    expect(paths).toContain("modified.txt");
    expect(paths).toContain("untracked.txt");
    expect(paths).not.toContain("ignored.txt");
  });

  it("includes BOTH sides of a rename", () => {
    const line =
      "2 R100 N... 100644 100644 100644 " +
      "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 R100 new.txt\told.txt";
    const paths = dirtyPaths(parsePorcelainV2(line));
    expect(paths).toContain("new.txt");
    expect(paths).toContain("old.txt");
  });
});
