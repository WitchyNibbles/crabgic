/**
 * Publish-time attribution-leak scenario — the STRONGEST fail-first proof
 * in this project: a real commit whose message carries a dev-engine
 * attribution token is created DIRECTLY via `git commit` (bypassing 17's
 * renderer entirely — modeling "some other bug already let a leaking
 * message through"), then fed to the REAL `publishLocal`
 * (`@crabgic/git-engine`, 08's local-publication routine). `publishLocal`'s own
 * belt-and-suspenders re-scan (its file-level doc comment: "re-scans each
 * [newly introduced commit]'s full commit message... FAILS CLOSED: on any
 * hit, the just-created branch ref is deleted... and
 * `PublishedAttributionLeakError` is thrown") must fire — this is
 * production code, not a harness-owned re-implementation.
 *
 * A companion clean-publish scenario proves the positive case: a clean
 * commit publishes successfully, the branch appears in the user repo, and
 * the user repo's checkout is proven byte-identical throughout.
 */
import { randomUUID } from "node:crypto";
import type { JournalStore } from "@crabgic/journal";
import {
  PublishedAttributionLeakError,
  computeWorkingTreeHash,
  publishLocal,
} from "@crabgic/git-engine";
import { emitScenarioEvidence } from "../evidence.js";
import { buildBasicFixtureRepo, commitAll, plumbing, writeFixtureFile } from "../fixtures.js";
import { exitStatusFor, requirePassed, type ScenarioOutcome } from "../scenario-types.js";

export async function runPublishAttributionLeakScenario(
  journal: JournalStore,
): Promise<ScenarioOutcome> {
  const controlRepo = await buildBasicFixtureRepo();
  const userRepo = await buildBasicFixtureRepo();
  try {
    await plumbing.run(["checkout", "-q", "-b", "leak-branch"], { cwd: controlRepo.dir });
    await writeFixtureFile(controlRepo.dir, "src/leaky-feature.txt", "leaky feature\n");
    // Deliberately bypasses 17's renderer entirely — a raw commit message
    // seeded with the exact shared attribution fixture token
    // (`@crabgic/contracts`'s `ATTRIBUTION_TOKENS`), modeling a leak that
    // reached this point despite the upstream renderer's own lint.
    await plumbing.run(
      [
        "commit",
        "--allow-empty",
        "-q",
        "-m",
        "feat: leaky feature\n\nCo-Authored-By: Claude <noreply@anthropic.com>",
      ],
      { cwd: controlRepo.dir },
    );

    let caught: unknown;
    try {
      await publishLocal(plumbing, {
        userRepoPath: userRepo.dir,
        controlRepoPath: controlRepo.dir,
        sourceRef: "leak-branch",
        branchName: "feat/leaky-feature",
      });
    } catch (err) {
      caught = err;
    }

    const branchDeleted =
      (
        await plumbing.run(["rev-parse", "--verify", "refs/heads/feat/leaky-feature"], {
          cwd: userRepo.dir,
          allowFailure: true,
        })
      ).exitCode !== 0;

    const passed = caught instanceof PublishedAttributionLeakError && branchDeleted;
    const detail = `caught=${caught instanceof Error ? caught.name : String(caught)}; branchDeletedAfterLeak=${String(branchDeleted)}`;

    await emitScenarioEvidence(journal, {
      changeSetId: randomUUID(),
      command: "publishLocal (seeded attribution leak, must reject + delete branch)",
      exitStatus: exitStatusFor(passed),
      objectId: userRepo.headObjectId,
      detail,
    });
    requirePassed(passed, "git-matrix/publish-attribution-leak", detail);
    return {
      name: "git-matrix/publish-attribution-leak",
      passed,
      detail,
      objectId: userRepo.headObjectId,
    };
  } finally {
    await controlRepo.cleanup();
    await userRepo.cleanup();
  }
}

export async function runCleanPublishScenario(journal: JournalStore): Promise<ScenarioOutcome> {
  const controlRepo = await buildBasicFixtureRepo();
  const userRepo = await buildBasicFixtureRepo();
  try {
    await plumbing.run(["checkout", "-q", "-b", "clean-branch"], { cwd: controlRepo.dir });
    await writeFixtureFile(controlRepo.dir, "src/clean-feature.txt", "clean feature\n");
    const controlHeadObjectId = await commitAll(controlRepo.dir, "feat: clean feature");

    // `publishLocal`'s OWN internal invariance check already asserts
    // HEAD/index are untouched (throwing `PublishLocalInvarianceViolationError`
    // otherwise) — 07's combined `withUserCheckoutInvariance` is
    // deliberately NOT used here (it hashes every ref under `refs/`, and
    // this operation's entire purpose is to add exactly one new ref; see
    // `packages/git-engine/src/publish-local.ts`'s own file-level doc
    // comment). This scenario independently re-checks the working-tree
    // hash (`.git`-blind, tolerant of the new ref) before/after as its own
    // second, harness-owned confirmation.
    const beforeWorkingTreeHash = await computeWorkingTreeHash(userRepo.dir);
    const result = await publishLocal(plumbing, {
      userRepoPath: userRepo.dir,
      controlRepoPath: controlRepo.dir,
      sourceRef: "clean-branch",
      branchName: "feat/clean-feature",
    });
    const afterWorkingTreeHash = await computeWorkingTreeHash(userRepo.dir);

    const passed =
      result.status === "published" &&
      result.branchName === "feat/clean-feature" &&
      result.objectId === controlHeadObjectId &&
      afterWorkingTreeHash === beforeWorkingTreeHash;
    const detail = `result=${JSON.stringify(result)}; workingTreeHashUnchanged=${String(afterWorkingTreeHash === beforeWorkingTreeHash)}`;

    await emitScenarioEvidence(journal, {
      changeSetId: randomUUID(),
      command: "publishLocal (clean commit, real fetch into user repo)",
      exitStatus: exitStatusFor(passed),
      objectId: controlHeadObjectId,
      detail,
    });
    requirePassed(passed, "git-matrix/clean-publish", detail);
    return { name: "git-matrix/clean-publish", passed, detail, objectId: controlHeadObjectId };
  } finally {
    await controlRepo.cleanup();
    await userRepo.cleanup();
  }
}
