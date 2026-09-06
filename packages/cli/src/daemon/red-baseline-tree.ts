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

export interface RedBaselineTreeOptions<T> {
  readonly plumbing: GitPlumbing;
  /** The control clone the worktree is cut from and removed through. */
  readonly controlDir: string;
  /** Where throwaway worktrees live for this control clone. */
  readonly worktreesRootDir: string;
  /**
   * The base THIS UNIT'S attempt was cut from — what "red at base" is red
   * against.
   *
   * ⚠️ NOT NECESSARILY THE RUN'S FREEZE, which this said until 2026-09-06.
   * Under the owner's "chain the base" ruling a dependent unit is cut from its
   * predecessors' collected work, and the only production feeder
   * (`createBaseTreeSurface` -> `resolveRunBase`) passes that chained base
   * straight through. Measuring a chained unit against the run's freeze would
   * score it against a tree it never saw.
   */
  readonly baseObjectId: string;
  /** The user's checkout, whose `node_modules` the tree shares. */
  readonly projectDir: string;
  readonly candidateObjectId: string;
  /** The candidate's test files, checked out over the base. Empty means there is nothing to measure. */
  readonly testPaths: readonly string[];
  /**
   * Work the tree needs while it is still PRISTINE — before the candidate's
   * tests are laid over it. Returning a value stops the flow and becomes the
   * result; returning `undefined` proceeds.
   *
   * ⚠️ THE TIMING IS THE WHOLE POINT, and getting it wrong cost a round. The
   * only caller uses this to run the envelope's granted build, and a build run
   * AFTER the candidate's test files are in the tree typechecks those tests
   * against base source — so a change set adding `foo.test.ts` for a
   * not-yet-existing `foo.ts` fails the build, and the gate reads the strongest
   * possible red signal as a broken tree. Measured: 938e98a's own change set
   * flipped `tsc -b` from exit 0 to exit 2 on one added test file.
   *
   * Before the overlay, a build failure means what it says — the base tree is
   * broken — and the candidate's new tests are then free to fail at RUN time,
   * which is the red the gate is asking for.
   */
  readonly prepareBaseTree?: (worktreePath: string) => Promise<T | undefined>;
}

/**
 * Materialises a tree at `baseObjectId` — this unit's own base, which is the
 * run's freeze only for a unit with no predecessors — carrying the candidate's
 * versions of `testPaths` and nothing else of the candidate, provisions its
 * dependencies, hands it to `use`, and removes it.
 *
 * ⚠️ `--detach` AT THAT BASE, then a path-scoped checkout. Checking the whole
 * candidate out would answer the wrong question entirely: the tests would run
 * against the code they were written for and pass, which is the opposite of
 * what is being measured.
 *
 * ⚠️ PROVISIONED AND PREPARED BEFORE THE OVERLAY, AND BOTH ORDERS ARE THE POINT. Until 2026-09-05
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
  options: RedBaselineTreeOptions<T>,
  use: (worktreePath: string) => Promise<T>,
): Promise<T | undefined> {
  if (options.testPaths.length === 0) return undefined;

  const treePath = join(
    options.worktreesRootDir,
    `red-baseline-${options.candidateObjectId.slice(0, 12)}`,
  );
  try {
    await options.plumbing.run(["worktree", "add", "--detach", treePath, options.baseObjectId], {
      cwd: options.controlDir,
    });
  } catch {
    return undefined;
  }
  try {
    await provisionWorktreeDependencies({
      worktreePath: treePath,
      sourceDir: options.projectDir,
    });
    /**
     * PRISTINE FIRST. Everything the tree needs in order to be the BASE happens
     * here; only then does the candidate's overlay go on. See
     * `prepareBaseTree`'s own comment for what running this in the other order
     * costs.
     */
    const prepared = await options.prepareBaseTree?.(treePath);
    if (prepared !== undefined) return prepared;

    await options.plumbing.run(
      ["checkout", options.candidateObjectId, "--", ...options.testPaths],
      { cwd: treePath },
    );
    return await use(treePath);
  } catch {
    return undefined;
  } finally {
    await options.plumbing
      .run(["worktree", "remove", "--force", treePath], { cwd: options.controlDir })
      .catch(() => undefined);
  }
}

/** Where a work unit's base lives, as the dispatcher knows it — the run's freeze, or the unit's chained base when it has predecessors. */
export interface RunBaseResolution {
  readonly baseObjectId: string;
  /** The control clone the throwaway tree is cut from and removed through. */
  readonly controlDir: string;
}

export interface BaseTreeSurfaceOptions {
  readonly plumbing: GitPlumbing;
  /** The user's checkout, whose `node_modules` every base tree shares. */
  readonly projectDir: string;
  /** Where throwaway trees are cut, given a control clone. */
  readonly worktreesRootDirFor: (controlDir: string) => string;
  /**
   * The dispatcher's run-scoped state: the base THIS UNIT'S attempt was cut
   * from, or `undefined` when this dispatcher does not hold the run.
   *
   * ⚠️ PER WORK UNIT — owner ruling 2026-09-06, "chain the base". A dependent
   * unit is cut from its predecessors' collected work, so a run-wide answer
   * would measure its red baseline against a tree it never saw.
   */
  readonly resolveRunBase: (
    changeSetId: string,
    workUnitId: string,
  ) => RunBaseResolution | undefined;
}

/**
 * The dispatcher's `AttemptSurface.withBaseTree` — run-scoped state resolved
 * into a `withRedBaselineTree` call, and nothing else.
 *
 * ⚠️ EXTRACTED FOR THE SAME REASON THIS MODULE WAS, one round later. As an
 * inline method on the attempt surface, this adapter was measured at ZERO
 * statement hits across 727 files / 7940 tests — so the one line that forwards
 * `prepareBaseTree` could be deleted, making the entire base-tree build inert
 * in production, while every test that pins the build (they drive a stub
 * surface) stayed green. Both halves being individually tested is not the same
 * claim as the wire between them existing.
 *
 * `undefined` when this dispatcher does not know the run's base — an unknown
 * change set, or a re-drive after a restart that lost it. NO WORKTREE IS CUT in
 * that case, which is what makes "the gate reports the red half as
 * unestablished" cheap rather than a git operation that then fails.
 */
export function createBaseTreeSurface(options: BaseTreeSurfaceOptions) {
  return async function withBaseTree<T>(
    changeSetId: string,
    workUnitId: string,
    candidateObjectId: string,
    testPaths: readonly string[],
    use: (worktreePath: string) => Promise<T>,
    prepareBaseTree?: (worktreePath: string) => Promise<T | undefined>,
  ): Promise<T | undefined> {
    const base = options.resolveRunBase(changeSetId, workUnitId);
    if (base === undefined) return undefined;
    return withRedBaselineTree(
      {
        plumbing: options.plumbing,
        controlDir: base.controlDir,
        worktreesRootDir: options.worktreesRootDirFor(base.controlDir),
        baseObjectId: base.baseObjectId,
        projectDir: options.projectDir,
        candidateObjectId,
        testPaths,
        ...(prepareBaseTree !== undefined ? { prepareBaseTree } : {}),
      },
      use,
    );
  };
}
