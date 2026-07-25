import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

/**
 * Injectable seam over "does this ref/SHA name a real commit in this
 * repository, and which one?" — the single git question the release-tag
 * and marketplace-pin checks both need, factored out so neither re-derives
 * it and so both are unit-testable without a contrived git fixture.
 *
 * Resolves to the full 40-hex commit SHA, or `undefined` when the ref
 * names no commit here. "Does not resolve" is an ordinary, reportable
 * release fact (an unpinned or foreign marketplace commit, a tag that was
 * never cut), never an exception — a throw would abort the whole gate run
 * and turn an honest FAIL into a hard ERROR.
 */
export type GitCommitResolver = (repoRoot: string, rev: string) => Promise<string | undefined>;

/**
 * Real resolver: `git rev-parse --verify --quiet <rev>^{commit}`. The
 * `^{commit}` peel is what makes an annotated tag resolve to the COMMIT it
 * points at rather than to the tag object's own id, so a tag and the
 * release-candidate object id are compared like for like.
 */
export const realGitCommitResolver: GitCommitResolver = async (repoRoot, rev) => {
  try {
    const { stdout } = await execFile(
      "git",
      ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`],
      { cwd: repoRoot },
    );
    const resolved = stdout.trim();
    // The empty-output-on-exit-0 arm is defensive only: `git rev-parse
    // --verify --quiet` exits NON-zero (the catch below) whenever it has
    // nothing to print, so no real git invocation reaches it. Direct
    // coverage of every reachable path lives in `./gitCommitResolver.test.ts`.
    // The pragma is what an UNREACHABLE arm gets — the honest form of "this
    // cannot be exercised". Leaving it merely uncovered would put this file
    // under roadmap/README.md ground rule 2's ">=80% line+branch on all new
    // code" (1 of 2 branches = 50%), which the project-aggregate threshold
    // in `../vitest.config.ts` would not have caught.
    /* v8 ignore next */
    return resolved.length > 0 ? resolved : undefined;
  } catch {
    // `git rev-parse --verify --quiet` exits non-zero with no output for an
    // unresolvable rev; an unreadable repoRoot fails the same way. Both are
    // "no such commit here" for this check's purposes.
    return undefined;
  }
};
