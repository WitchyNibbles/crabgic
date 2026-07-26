/**
 * Branch/commit golden scenarios — roadmap/23-release-hardening.md work
 * item 5: "branch/commit goldens INCLUDING attribution-leak fixtures."
 * Drives the REAL `nameBranch`/`renderCommit` (`@crabgic/git-engine`, 08's own
 * `renderWithRegeneration()`-backed renderers) — a clean golden pair, and
 * the explicit fail-first vector: "a seeded commit body carrying a
 * dev-engine attribution leak ('Generated with', 'Co-Authored-By: …
 * Claude…') must FAIL the neutral-rendering assertion." Also independently
 * re-checks the leaking candidate string with this project's OWN
 * `assertNeutralRendering` (`../neutral-rendering-assertion.js`) — a
 * second, harness-owned verification layer alongside the real renderer's
 * own block, mirroring 08's own belt-and-suspenders precedent.
 */
import { randomUUID } from "node:crypto";
import type { JournalStore } from "@crabgic/journal";
import { buildBranchNameCandidate, nameBranch, renderCommit } from "@crabgic/git-engine";
import { emitScenarioEvidence } from "../evidence.js";
import { findAttributionLeaks } from "../neutral-rendering-assertion.js";
import { exitStatusFor, requirePassed, type ScenarioOutcome } from "../scenario-types.js";

export async function runCleanBranchCommitGoldenScenario(
  journal: JournalStore,
): Promise<ScenarioOutcome> {
  const objectId = randomUUID();
  const branchResult = await nameBranch({ type: "feat", slugSource: "add widget support" });
  const commitResult = await renderCommit({
    type: "feat",
    outcome: "add widget support",
    why: "customers requested a configurable widget",
    risk: "low; additive UI only",
    compat: "no breaking changes",
    verification: "unit + integration tests pass",
  });

  const passed =
    branchResult.status === "named" &&
    /^feat\/[a-z0-9-]+$/.test(branchResult.status === "named" ? branchResult.branchName : "") &&
    commitResult.status === "rendered" &&
    /^feat: add widget support$/.test(commitResult.subject) &&
    commitResult.body.includes("Why:");

  const detail = `branch=${JSON.stringify(branchResult)}; commit=${JSON.stringify(commitResult)}`;

  await emitScenarioEvidence(journal, {
    changeSetId: randomUUID(),
    command: "nameBranch + renderCommit (clean golden)",
    exitStatus: exitStatusFor(passed),
    objectId,
    detail,
  });
  requirePassed(passed, "git-matrix/clean-branch-commit-golden", detail);
  return { name: "git-matrix/clean-branch-commit-golden", passed, detail, objectId };
}

/**
 * THE FAIL-FIRST VECTOR: a slug source and a commit outcome each carrying a
 * real dev-engine attribution token ("Co-Authored-By", the exact shared
 * `@crabgic/contracts` fixture token — see `packages/contracts/src/renderer-
 * core/attribution-scanner.ts`) must be BLOCKED by the real renderer, not
 * silently accepted.
 */
export async function runAttributionLeakBlockedScenario(
  journal: JournalStore,
): Promise<ScenarioOutcome> {
  const objectId = randomUUID();
  const leakingSlugSource = "co-authored-by claude fix";
  const leakingOutcome = "fix bug (Co-Authored-By: Claude <noreply@anthropic.com>)";

  // This project's OWN independent verification layer, proven (with a RED/
  // GREEN pair) in `test/neutral-rendering-assertion.test.ts` — re-checked
  // here against the exact candidate strings this scenario feeds the real
  // renderer, before the real renderer even runs.
  const preflightFindings = findAttributionLeaks(leakingOutcome);

  const branchResult = await nameBranch({ type: "fix", slugSource: leakingSlugSource });
  const commitResult = await renderCommit({
    type: "fix",
    outcome: leakingOutcome,
    why: "customer-reported regression",
    risk: "low",
    compat: "no breaking changes",
    verification: "regression test added",
  });

  const passed =
    preflightFindings.length > 0 &&
    branchResult.status === "blocked" &&
    commitResult.status === "blocked";
  const detail = `preflightFindings=${JSON.stringify(preflightFindings)}; branch=${JSON.stringify(branchResult)}; commit=${JSON.stringify(commitResult)}`;

  await emitScenarioEvidence(journal, {
    changeSetId: randomUUID(),
    command: "nameBranch + renderCommit (seeded attribution leak, must be blocked)",
    exitStatus: exitStatusFor(passed),
    objectId,
    detail,
  });
  requirePassed(passed, "git-matrix/attribution-leak-blocked", detail);
  return { name: "git-matrix/attribution-leak-blocked", passed, detail, objectId };
}

/** Exercised directly by this project's own unit test — a clean, construction-legal candidate must never itself carry an attribution token (defense-in-depth check on `buildBranchNameCandidate`'s own pure output, independent of the async renderer path above). */
export function buildCleanBranchNameCandidate(): string {
  return buildBranchNameCandidate({ type: "chore", slugSource: "tidy up build scripts" });
}
