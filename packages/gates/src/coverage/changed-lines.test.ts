import { describe, expect, it } from "vitest";
import { changedLineCount, parseChangedLines } from "./changed-lines.js";

/** Reads the parser's output back as a plain object, so a failure prints legibly. */
function asObject(changed: ReturnType<typeof parseChangedLines>): Record<string, number[]> {
  return Object.fromEntries([...changed].map(([path, lines]) => [path, [...lines].sort((a, b) => a - b)]));
}

describe("parseChangedLines", () => {
  it("records the new-side line numbers of added lines", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 111..222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,3 +1,5 @@",
      " const a = 1;",
      "+const b = 2;",
      "+const c = 3;",
      " const d = 4;",
      " const e = 5;",
    ].join("\n");
    expect(asObject(parseChangedLines(diff))).toStrictEqual({ "src/a.ts": [2, 3] });
  });

  /**
   * The cursor arithmetic, which is the only thing in this file that can be
   * subtly wrong: a removed line consumes NO new-side number, and a context line
   * consumes one. Getting either backwards shifts every subsequent line number
   * in the hunk, and the coverage check would then score lines the diff never
   * touched — silently, and in whichever direction the shift happened to land.
   */
  it("advances the cursor on context lines and not on removed lines", () => {
    const diff = [
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,5 +1,4 @@",
      " keep1",
      "-removed1",
      "-removed2",
      " keep2",
      "+added-at-3",
      " keep3",
    ].join("\n");
    // keep1 = 1, keep2 = 2, added = 3. The two removals consume nothing.
    expect(asObject(parseChangedLines(diff))).toStrictEqual({ "src/a.ts": [3] });
  });

  it("honours the hunk header's new-side start line rather than counting from 1", () => {
    const diff = ["+++ b/src/a.ts", "@@ -40,2 +120,3 @@", " ctx", "+added", " ctx2"].join("\n");
    expect(asObject(parseChangedLines(diff))).toStrictEqual({ "src/a.ts": [121] });
  });

  it("accepts a hunk header with the count omitted, which git emits for a single line", () => {
    const diff = ["+++ b/src/a.ts", "@@ -0,0 +7 @@", "+only"].join("\n");
    expect(asObject(parseChangedLines(diff))).toStrictEqual({ "src/a.ts": [7] });
  });

  it("carries the cursor across several hunks in one file, and across several files", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,1 +1,2 @@",
      " ctx",
      "+a-added",
      "@@ -10,1 +11,2 @@",
      " ctx",
      "+a-added-2",
      "diff --git a/src/b.ts b/src/b.ts",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -1,0 +1,1 @@",
      "+b-added",
    ].join("\n");
    expect(asObject(parseChangedLines(diff))).toStrictEqual({
      "src/a.ts": [2, 12],
      "src/b.ts": [1],
    });
  });

  /**
   * ⚠️ git writes a blank context line with NO leading space. Treating that as a
   * section break would drop the cursor and silently discard every added line
   * after the first blank line in a hunk — the most common shape in real source.
   */
  it("treats an unprefixed empty line as context, not as the end of the hunk", () => {
    const diff = ["+++ b/src/a.ts", "@@ -1,3 +1,4 @@", " ctx", "", "+added", " ctx2"].join("\n");
    expect(asObject(parseChangedLines(diff))).toStrictEqual({ "src/a.ts": [3] });
  });

  it("ignores a deleted file's /dev/null header", () => {
    const diff = ["--- a/src/gone.ts", "+++ /dev/null", "@@ -1,2 +0,0 @@", "-a", "-b"].join("\n");
    expect(asObject(parseChangedLines(diff))).toStrictEqual({});
  });

  it("records a newly-created file's lines under its new path", () => {
    const diff = [
      "diff --git a/src/new.ts b/src/new.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/new.ts",
      "@@ -0,0 +1,3 @@",
      "+line1",
      "+line2",
      "+line3",
    ].join("\n");
    expect(asObject(parseChangedLines(diff))).toStrictEqual({ "src/new.ts": [1, 2, 3] });
  });

  it("ignores the no-newline marker without consuming a line number", () => {
    const diff = [
      "+++ b/src/a.ts",
      "@@ -1,1 +1,2 @@",
      " ctx",
      "+added",
      "\\ No newline at end of file",
    ].join("\n");
    expect(asObject(parseChangedLines(diff))).toStrictEqual({ "src/a.ts": [2] });
  });

  /**
   * A `@@@` combined diff is a merge commit's, and its content lines carry TWO
   * prefix columns — so a `+` in column 1 does not mean what it means here.
   * Skipping the whole hunk is right; misreading it would attribute invented
   * line numbers to a real file.
   */
  it("skips a combined (merge) diff hunk rather than misreading its two-column content", () => {
    const diff = ["+++ b/src/a.ts", "@@@ -1,1 -1,1 +1,2 @@@", "++added", " ctx"].join("\n");
    expect(asObject(parseChangedLines(diff))).toStrictEqual({});
  });

  /**
   * A quoted path is git's encoding for a name with a special character.
   * Decoding it wrong would attribute one file's lines to another, which is
   * worse than not measuring it — and the file then lands in the
   * absent-from-report population, which refuses rather than passes.
   */
  it("skips a C-quoted path rather than guessing at its decoding", () => {
    const diff = ['+++ "b/src/od\\303\\251.ts"', "@@ -0,0 +1,1 @@", "+added"].join("\n");
    expect(asObject(parseChangedLines(diff))).toStrictEqual({});
  });

  /**
   * An empty `+++ ` header names no file. Attributing the hunk that follows it
   * to whichever file was open before would merge one file's added lines into
   * another's — the same class of error the quoted-path skip avoids.
   */
  it("attributes nothing when the +++ header carries no path", () => {
    const diff = [
      "+++ b/src/a.ts",
      "@@ -0,0 +1,1 @@",
      "+kept",
      "+++ ",
      "@@ -0,0 +1,1 @@",
      "+orphaned",
    ].join("\n");
    expect(asObject(parseChangedLines(diff))).toStrictEqual({ "src/a.ts": [1] });
  });

  /** A path with no `b/` prefix — the plain unified-diff spelling `git format-patch --no-prefix` emits. */
  it("accepts a path with no a/ or b/ prefix", () => {
    const diff = ["+++ src/a.ts", "@@ -0,0 +1,1 @@", "+added"].join("\n");
    expect(asObject(parseChangedLines(diff))).toStrictEqual({ "src/a.ts": [1] });
  });

  it("attributes nothing to a content line that arrives before any hunk header", () => {
    const diff = ["+++ b/src/a.ts", "+orphan", "@@ -1,0 +1,1 @@", "+real"].join("\n");
    expect(asObject(parseChangedLines(diff))).toStrictEqual({ "src/a.ts": [1] });
  });

  it("keeps everything read before a malformed tail", () => {
    const diff = ["+++ b/src/a.ts", "@@ -1,0 +1,1 @@", "+kept", "Binary files differ", "+dropped"].join(
      "\n",
    );
    expect(asObject(parseChangedLines(diff))).toStrictEqual({ "src/a.ts": [1] });
  });

  it("strips a trailing tab-delimited timestamp from the path", () => {
    const diff = ["+++ b/src/a.ts\t2026-08-16 00:00:00.000000000 +0000", "@@ -0,0 +1,1 @@", "+x"].join(
      "\n",
    );
    expect(asObject(parseChangedLines(diff))).toStrictEqual({ "src/a.ts": [1] });
  });

  it("returns nothing for an empty diff", () => {
    expect(asObject(parseChangedLines(""))).toStrictEqual({});
    expect(changedLineCount(parseChangedLines(""))).toBe(0);
  });

  it("counts added lines across every file", () => {
    const diff = [
      "+++ b/a.ts",
      "@@ -0,0 +1,2 @@",
      "+1",
      "+2",
      "diff --git a/b.ts b/b.ts",
      "+++ b/b.ts",
      "@@ -0,0 +1,1 @@",
      "+1",
    ].join("\n");
    expect(changedLineCount(parseChangedLines(diff))).toBe(3);
  });
});
