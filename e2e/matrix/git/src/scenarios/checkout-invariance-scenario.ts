/**
 * Checkout-invariance scenario — roadmap/23-release-hardening.md work item
 * 5: "checkout invariance (tree-hash before/after via 07's exported
 * invariance harness `withTreeInvariance`/`computeWorkingTreeHash`)."
 * Wraps a REAL `@crabgic/git-engine` control-clone cycle
 * (`ensureControlClone` + `fetchRefresh`, the exact 07 primitives 08/23
 * reuse directly, never reimplemented) around a real "user" repo, proving
 * the source repo's own working tree is byte-identical before and after —
 * 07's own invariance harness is reused verbatim, not forked.
 */
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import type { JournalStore } from "@crabgic/journal";
import { ensureControlClone, fetchRefresh, withTreeInvariance } from "@crabgic/git-engine";
import { emitScenarioEvidence } from "../evidence.js";
import { buildBasicFixtureRepo, freshTmpDir, plumbing } from "../fixtures.js";
import { exitStatusFor, requirePassed, type ScenarioOutcome } from "../scenario-types.js";

export async function runCheckoutInvarianceScenario(
  journal: JournalStore,
): Promise<ScenarioOutcome> {
  const userRepo = await buildBasicFixtureRepo();
  const controlDir = await freshTmpDir("control-clone");
  try {
    const result = await withTreeInvariance(userRepo.dir, async () => {
      const clone = await ensureControlClone(plumbing, {
        sourceRepoPath: userRepo.dir,
        controlDir,
      });
      const fetchedObjectId = await fetchRefresh(plumbing, controlDir, "main");
      return { clone, fetchedObjectId };
    });

    const passed =
      result.clone.created === true && result.fetchedObjectId === userRepo.headObjectId;
    const detail =
      `control clone created=${String(result.clone.created)}; ` +
      `fetched=${result.fetchedObjectId}; user HEAD=${userRepo.headObjectId}; ` +
      "user working tree proven byte-identical before/after (withTreeInvariance)";

    await emitScenarioEvidence(journal, {
      changeSetId: randomUUID(),
      command: "control-clone + fetch (checkout invariance)",
      exitStatus: exitStatusFor(passed),
      objectId: userRepo.headObjectId,
      detail,
    });
    requirePassed(passed, "git-matrix/checkout-invariance", detail);
    return {
      name: "git-matrix/checkout-invariance",
      passed,
      detail,
      objectId: userRepo.headObjectId,
    };
  } finally {
    await userRepo.cleanup();
    await rm(controlDir, { recursive: true, force: true });
  }
}
