/**
 * `selectChangedTestFiles` — which files in a change set's diff are the tests it
 * ADDED, and nothing else.
 *
 * ⚠️ WHY THIS EXISTS, and what it replaced. The first shipped red-before-green
 * check asked "was the suite red at base". A healthy repository is GREEN at
 * base, so no baseline was ever captured and the TDD gate refused every real
 * run — satisfiable only when the repository was already broken. Owner ruling
 * 2026-08-18 replaced the question with the one the prior art enforces: the
 * tests this change set added must FAIL against the code as it stood before it.
 *
 * That check needs the diff's test files, and only those. Too greedy and
 * implementation files get run as though they were tests, most of which
 * trivially "pass" by doing nothing. Too narrow and the capture reports success
 * having proved nothing at all.
 *
 * ⚠️ AN HONEST BOUND: this is a CONVENTION list, not a language-aware
 * classification. A project whose tests live somewhere unconventional gets an
 * empty selection, which the caller must treat as "not established" rather than
 * as a pass — the same direction every other unmet precondition takes. Widening
 * it is a deliberate act with its own test, never a silent regex tweak.
 */

/**
 * The spellings that count as a test file.
 *
 * One entry per ecosystem convention rather than a single clever pattern: a
 * reader has to be able to see which conventions are covered, and a widening has
 * to name the one it is adding.
 */
const TEST_FILE_PATTERNS: readonly RegExp[] = Object.freeze([
  /\.test\.[cm]?[jt]sx?$/, // foo.test.ts, foo.test.tsx, foo.test.mjs
  /\.spec\.[cm]?[jt]sx?$/, // foo.spec.ts
  /_test\.go$/, // Go
  /(^|\/)test_[^/]+\.py$/, // pytest
  /_spec\.rb$/, // RSpec
  /(^|\/)__tests__\//, // Jest convention directory
]);

/** `true` iff `path` is spelled like a test file under one of the covered conventions. */
export function isTestFilePath(path: string): boolean {
  return TEST_FILE_PATTERNS.some((pattern) => pattern.test(path));
}

/**
 * Every test file present in the CANDIDATE side of `diffText`, deduped and
 * sorted.
 *
 * ⚠️ READS THE `+++ b/` HEADERS, never the diff's content. A test path merely
 * NAMED inside an added comment or fixture string is not a changed file, and
 * treating it as one would run files this change set never touched — at base,
 * where many of them genuinely fail, manufacturing a red baseline out of a
 * mention.
 *
 * ⚠️ A DELETED file is excluded by construction: git writes `+++ /dev/null` for
 * it, so it has no candidate-side path and `/dev/null` matches no test-file
 * convention. Selecting it would name a file that cannot be read out of the
 * candidate, turning the capture into an error rather than a verdict.
 *
 * There is deliberately no separate `/dev/null` guard. One was written and then
 * MEASURED redundant: deleting it reddened nothing, because the pattern check
 * already excludes the path. A guard that cannot fail is a claim about
 * protection that does not exist.
 *
 * Sorted so the command line a caller builds from this is stable across runs —
 * an unstable argument order makes two identical attempts look different in the
 * journal.
 */
export function selectChangedTestFiles(diffText: string): readonly string[] {
  const found = new Set<string>();
  for (const line of diffText.split("\n")) {
    if (!line.startsWith("+++ ")) continue;
    const target = line.slice(4).trim();
    // `+++ b/<path>`; the `b/` prefix is git's, not part of the path.
    const path = target.startsWith("b/") ? target.slice(2) : target;
    if (path.length > 0 && isTestFilePath(path)) found.add(path);
  }
  return [...found].sort();
}
