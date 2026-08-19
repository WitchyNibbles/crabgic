import { describe, expect, it } from "vitest";
import { selectChangedTestFiles } from "./changed-tests.js";

/**
 * ⚠️ WHICH FILES ARE THE NEW TESTS — owner ruling 2026-08-18, "new tests against
 * base code".
 *
 * The red-before-green check is not "was the suite red at base". A healthy
 * repository is green at base, which is what made the first shipped version of
 * this gate refuse every run. The check that means something is the one the
 * prior art enforces: the tests this change set ADDED must fail against the code
 * as it stood BEFORE the change.
 *
 * That needs the test files out of the diff, and nothing else out of it. A
 * selector that is too greedy runs implementation files as if they were tests; a
 * selector that is too narrow silently proves nothing while reporting success.
 */

function diffFor(...paths: readonly string[]): string {
  return paths
    .map(
      (path) =>
        `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1 @@\n+const x = 1;\n`,
    )
    .join("");
}

describe("selectChangedTestFiles", () => {
  it("selects the test files a diff touches", () => {
    const selected = selectChangedTestFiles(
      diffFor("packages/gates/src/foo.test.ts", "packages/gates/src/foo.ts"),
    );

    expect(selected).toStrictEqual(["packages/gates/src/foo.test.ts"]);
  });

  /**
   * ⚠️ The anti-greed arm. An implementation file is not a test, and running one
   * as though it were would report a meaningless verdict — most would simply
   * "pass" by doing nothing.
   */
  it("selects NOTHING from a diff that touches no test file", () => {
    expect(selectChangedTestFiles(diffFor("src/a.ts", "README.md"))).toStrictEqual([]);
  });

  /**
   * The conventions this repository and its neighbours actually use. Stated as
   * one arm per family so a future widening has to add its own case rather than
   * quietly changing what an existing one means.
   */
  it("recognises the conventional test-file spellings", () => {
    const selected = selectChangedTestFiles(
      diffFor(
        "a/foo.test.ts",
        "a/foo.spec.ts",
        "a/foo.test.tsx",
        "a/bar_test.go",
        "a/test_bar.py",
        "a/bar_spec.rb",
        "a/__tests__/baz.ts",
      ),
    );

    expect(selected).toHaveLength(7);
  });

  /**
   * ⚠️ A DELETED test file must not be selected. It does not exist in the
   * candidate, so there is nothing to run against base — and a path that cannot
   * be read would make the whole capture error rather than report red.
   */
  it("ignores a test file the change set DELETED", () => {
    const deleted =
      "diff --git a/a/gone.test.ts b/a/gone.test.ts\n" +
      "deleted file mode 100644\n--- a/a/gone.test.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-const x = 1;\n";

    expect(selectChangedTestFiles(deleted)).toStrictEqual([]);
  });

  /** Deduped and ordered, so the command line a caller builds is stable across runs. */
  it("returns each path once, in a stable order", () => {
    const twice = diffFor("b/two.test.ts") + diffFor("a/one.test.ts") + diffFor("b/two.test.ts");

    expect(selectChangedTestFiles(twice)).toStrictEqual(["a/one.test.ts", "b/two.test.ts"]);
  });

  /**
   * ⚠️ A path that is merely NAMED inside a diff's content is not a changed
   * file. Without this the selector would pick up every test file quoted in an
   * added comment or fixture string — and then run files this change set never
   * touched, at base, where many of them genuinely fail.
   */
  it("reads the file headers, not the diff's content", () => {
    const mentioning =
      "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n" +
      "@@ -0,0 +1 @@\n+// see packages/other/deep.test.ts for the counterpart\n";

    expect(selectChangedTestFiles(mentioning)).toStrictEqual([]);
  });
});
