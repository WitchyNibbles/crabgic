import type { EvidenceRecord } from "@crabgic/contracts";
import type { JournalStore } from "@crabgic/journal";
import { captureRedBaseline } from "./tdd-gate.js";
import {
  runGrantedAcceptanceCommand,
  selectAcceptanceCommand,
  TDD_BASELINE_TIMEOUT_MS,
} from "./tdd-baseline.js";

/**
 * `captureRedBaselineForChangedTests` — red-before-green, asked as the question
 * that actually discriminates.
 *
 * ⚠️ WHAT THIS REPLACED, AND WHY. The first shipped protocol ran the whole suite
 * at base and required it to be RED. A healthy repository is green at base, so
 * no baseline was ever captured and the TDD gate refused every real run — it was
 * satisfiable only when the repository was already broken. Owner ruling
 * 2026-08-18 replaced the question with the one the prior art enforces: run the
 * tests THIS CHANGE SET ADDED against the code as it stood BEFORE it, and
 * require those to fail.
 *
 * That is a discrimination check rather than a state check. A new test that
 * passes against the old code tests nothing the change set introduced — it is
 * the `assert(true)` of a test-first claim — and this is the one place that gets
 * caught.
 *
 * WHAT THE CALLER MUST HAND OVER. `worktreePath` is a tree holding the FROZEN
 * BASE plus the candidate's versions of `testPaths`, and nothing else of the
 * candidate. Materialising it needs git, which this package has no business
 * doing, so the composition root builds it and this module only runs in it. If
 * the caller hands over the candidate tree by mistake the tests pass, the
 * outcome is `notRed`, and nothing is minted — the failure direction is safe.
 *
 * ⚠️ THE COMMAND IS STILL THE ENVELOPE'S. `runGrantedAcceptanceCommand` filters
 * to the `acceptance` class, so an envelope granting no test command authorizes
 * no run here either. The test paths are appended as arguments, which the
 * compiled `Bash(<prefix>:*)` rule genuinely permits.
 */

export type ChangedTestsBaselineOutcome =
  | {
      readonly kind: "captured";
      readonly command: string;
      readonly exitStatus: number;
      readonly records: readonly EvidenceRecord[];
    }
  /**
   * ⚠️ The added tests PASSED against base code. Not a baseline, and not a
   * defect either — it means those tests do not discriminate this change set's
   * work from its absence.
   */
  | { readonly kind: "notRed"; readonly command: string; readonly exitStatus: number }
  /** The change set added no test file. Nothing to prove red; running the whole suite instead is exactly the bug this replaced. */
  | { readonly kind: "noTestFiles" }
  | { readonly kind: "noAcceptanceCommand" }
  | { readonly kind: "didNotRun"; readonly command: string; readonly reason: string }
  | { readonly kind: "noRequirements" };

export interface ChangedTestsBaselineInput {
  readonly journal: JournalStore;
  readonly changeSetId: string;
  readonly workUnitId: string;
  readonly requirementIds: readonly string[];
  readonly baseObjectId: string;
  /** A tree holding the frozen base PLUS the candidate's versions of `testPaths`. Built by the composition root. */
  readonly worktreePath: string;
  readonly grantedCommands: readonly string[];
  /** The test files this change set added or changed — `./coverage/changed-tests.ts`'s output. */
  readonly testPaths: readonly string[];
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}

/**
 * Runs the granted acceptance command over `testPaths` in `worktreePath` and
 * journals one red-baseline `EvidenceRecord` per declared requirement.
 *
 * ⚠️ ONLY A NON-ZERO EXIT FROM A COMPLETED RUN MINTS ONE. A command that failed
 * to spawn or was killed on the timeout also exits non-zero, and folding either
 * into the red path would let a broken worktree mint the strongest evidence this
 * system has.
 */
export async function captureRedBaselineForChangedTests(
  input: ChangedTestsBaselineInput,
): Promise<ChangedTestsBaselineOutcome> {
  if (input.requirementIds.length === 0) return { kind: "noRequirements" };
  if (input.testPaths.length === 0) return { kind: "noTestFiles" };

  const command = selectAcceptanceCommand(input.grantedCommands);
  if (command === undefined) return { kind: "noAcceptanceCommand" };

  /**
   * The paths are appended after `--`, which every runner this convention list
   * covers reads as "restrict to these files" — and which the compiled
   * `Bash(<prefix>:*)` rule permits, because it is a prefix grant.
   */
  const scoped = `${command} -- ${input.testPaths.join(" ")}`;
  const run = await runGrantedAcceptanceCommand({
    grantedCommands: [scoped],
    worktreePath: input.worktreePath,
    timeoutMs: input.timeoutMs ?? TDD_BASELINE_TIMEOUT_MS,
  });
  if (!run.ran) return { kind: "didNotRun", command: scoped, reason: run.reason };
  if (run.exitStatus === 0) return { kind: "notRed", command: scoped, exitStatus: 0 };

  const records: EvidenceRecord[] = [];
  for (const requirementId of input.requirementIds) {
    records.push(
      await captureRedBaseline(input.journal, {
        changeSetId: input.changeSetId,
        requirementId,
        workUnitId: input.workUnitId,
        baseObjectId: input.baseObjectId,
        command: scoped,
        exitStatus: run.exitStatus,
        toolchainFingerprint: `node@${process.versions.node}`,
        ...(input.now !== undefined ? { now: input.now } : {}),
      }),
    );
  }
  return { kind: "captured", command: scoped, exitStatus: run.exitStatus, records };
}
