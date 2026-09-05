/**
 * The throwaway worktree the RED half is measured in.
 *
 * WHY THIS IS ITS OWN MODULE. It was four statements inside a closure in
 * `./run-dispatcher.ts`, and an adversarial review round measured what that
 * cost: deleting the provisioning call left the whole `packages/cli` suite
 * green at 1517/1517, and instrumenting it showed the closure body is entered
 * by no test at all. A correctness fix nothing executes is a comment. Extracted
 * here so the ordering it exists to guarantee can be driven directly — the git
 * seam is `GitPlumbing`, which `run-dispatcher.ts` already documents as
 * "overridden in tests so no real repository is touched", and the provisioning
 * is the real function rather than a spy.
 */
import { join } from "node:path";
import { provisionWorktreeDependencies, type GitPlumbing } from "@crabgic/git-engine";

export interface RedBaselineTreeOptions {
  readonly plumbing: GitPlumbing;
  /** The control clone the worktree is cut from and removed through. */
  readonly controlDir: string;
  /** Where throwaway worktrees live for this control clone. */
  readonly worktreesRootDir: string;
  /** The run's ONE frozen base — what "red at base" is red against. */
  readonly baseObjectId: string;
  /** The user's checkout, whose `node_modules` the tree shares. */
  readonly projectDir: string;
  readonly candidateObjectId: string;
  /** The candidate's test files, checked out over the base. Empty means there is nothing to measure. */
  readonly testPaths: readonly string[];
}

/**
 * Materialises a tree at the frozen base carrying the candidate's versions of
 * `testPaths` and nothing else of the candidate, provisions its dependencies,
 * hands it to `use`, and removes it.
 *
 * ⚠️ `--detach` AT THE BASE, then a path-scoped checkout. Checking the whole
 * candidate out would answer the wrong question entirely: the tests would run
 * against the code they were written for and pass, which is the opposite of
 * what is being measured.
 *
 * ⚠️ PROVISIONED BEFORE `use`, AND THAT ORDER IS THE POINT. Until 2026-09-05
 * this tree got no `node_modules` at all while the attempt worktree beside it
 * had been provisioned since roast round 1 (F7) found the same defect there.
 * The cost was not a failed run but a FABRICATED one: `npm` exits non-zero for
 * a missing dependency tree, `runToExitStatus` reports `ran: true`, and the
 * baseline capture mints `captured` — a red baseline, the strongest evidence
 * this system has, earned by an uninstalled tree rather than by a failing test.
 * A non-Node project provisions nothing and proceeds.
 *
 * ⚠️ REMOVED IN `finally`, and `--force` because the test run leaves the tree
 * dirty by construction — a failed suite writes reports and caches. A worktree
 * left behind pins disk and, worse, is registered in the control clone's
 * metadata, so the next `worktree add` at the same path fails.
 *
 * Returns `undefined` for every unmet precondition and every failure, because
 * the caller's own contract is that an unmeasurable base tree is not a red
 * baseline.
 */
export async function withRedBaselineTree<T>(
  options: RedBaselineTreeOptions,
  use: (worktreePath: string) => Promise<T>,
): Promise<T | undefined> {
  if (options.testPaths.length === 0) return undefined;

  const treePath = join(
    options.worktreesRootDir,
    `red-baseline-${options.candidateObjectId.slice(0, 12)}`,
  );
  try {
    await options.plumbing.run(
      ["worktree", "add", "--detach", treePath, options.baseObjectId],
      { cwd: options.controlDir },
    );
  } catch {
    return undefined;
  }
  try {
    await options.plumbing.run(
      ["checkout", options.candidateObjectId, "--", ...options.testPaths],
      { cwd: treePath },
    );
    await provisionWorktreeDependencies({
      worktreePath: treePath,
      sourceDir: options.projectDir,
    });
    return await use(treePath);
  } catch {
    return undefined;
  } finally {
    await options.plumbing
      .run(["worktree", "remove", "--force", treePath], { cwd: options.controlDir })
      .catch(() => undefined);
  }
}
