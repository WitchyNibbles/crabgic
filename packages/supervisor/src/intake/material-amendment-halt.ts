/**
 * Material-amendment halt wiring — the connection
 * roadmap/21-connector-evidence-integration.md §In scope predicts ("a
 * material diff raises 11's `material amendment` stop condition — 21
 * supplies the trigger signal, 11 owns the amendment/re-approval
 * mechanics"), and the first PRODUCTION caller of `haltOnStopCondition`
 * (`./stop-conditions.ts`), which until now was reached only from tests.
 *
 * WHY THE SIGNAL TYPE IS DECLARED STRUCTURALLY AND NOT IMPORTED — the spec
 * is silent on where this wiring lives, and the silence is filled by a
 * ruling, so the reason is recorded here rather than only in a review
 * thread. The producing type is `@crabgic/gates`' `MaterialAmendmentSignal`
 * (`materiality-classifier.ts`), but a phase 05/11 package may not depend
 * on a phase 14/21 one: that would invert the 21 -> 14 -> 13 -> 11 path the
 * roadmap phase graph fixes. Note precisely which instrument forbids it —
 * `scripts/check-package-graph-acyclic.mjs` would in fact ACCEPT such an
 * edge today (nothing in gates' transitive closure depends on supervisor,
 * so no manifest cycle is completed); the binding constraint is the phase
 * graph, not manifest acyclicity. TypeScript's structural assignability
 * closes the seam instead, and the cross-package e2e
 * (`packages/cli/src/intake/material-amendment-halt.e2e.test.ts`) passes
 * gates' REAL signal value into this function, so any drift between the two
 * shapes fails compilation there rather than silently at runtime.
 *
 * The opposite placements, and why each was rejected: (a) the wiring inside
 * `packages/gates` — the forbidden inversion above; (b) a supervisor
 * devDependency on gates so the unit test could import the real signal —
 * same inversion, merely hidden in devDeps; (c) invoking the halt directly
 * on the production walk in `packages/cli/src/daemon/post-completion-pipeline.ts`
 * — the honest full fix, but it needs a resource client and a poll
 * scheduler composed into the daemon, which is future work (see RESIDUAL).
 *
 * RESIDUAL, disclosed rather than implied: the composed daemon does not yet
 * invoke this function. No production milestone-polling loop exists —
 * `planMilestoneSync` has no production caller either — and 13's dispatch
 * loop is the intended caller once it exists, exactly as
 * `./stop-conditions.ts`'s own header already says of `haltOnStopCondition`.
 * What this module closes is the signal -> halt half; the poll -> signal
 * production loop remains open, and `docs/evidence/phase-21/halt-wiring-journal-excerpt-batchB.txt`
 * says so in the same words.
 */
import type { JournalStore } from "@crabgic/journal";
import type { RunRecord } from "../router/operations.js";
import type { RunsRegistry } from "../registries/runs-registry.js";
import { haltOnStopCondition } from "./stop-conditions.js";

/**
 * Structural mirror of `@crabgic/gates`' `MaterialAmendmentSignal` (see the
 * module header for why it is mirrored and not imported). `materialFields`
 * is widened to `readonly string[]` so gates' narrower
 * `readonly MaterialTrackedField[]` is assignable without this package
 * knowing that allow-list — which is 21's to widen, never 11's.
 */
export interface MaterialAmendmentHaltSignal {
  readonly requirementId: string;
  readonly material: boolean;
  readonly materialFields: readonly string[];
}

export interface HaltRunOnMaterialAmendmentOptions {
  readonly journal: JournalStore;
  readonly runs: RunsRegistry;
  readonly runId: string;
  readonly changeSetId: string;
}

export type MaterialAmendmentHaltOutcome =
  { readonly halted: true; readonly record: RunRecord } | { readonly halted: false };

/**
 * Raises 11's `material_amendment` stop condition for a run whose tracked
 * remote fields were amended after approval.
 *
 * NON-MATERIAL => a no-op: returns `{halted:false}` and journals NOTHING.
 * This is the contract, not an optimization — 21's classifier is
 * deliberately conservative (a revision may move for a non-tracked field,
 * a watcher, a label), and halting on the coarse revision signal instead of
 * the classified one would block runs for edits nobody approved anything
 * about. The distinction is pinned by the does-not-halt controls in
 * `./material-amendment-halt.test.ts` and in the cli seam e2e.
 *
 * MATERIAL => 11's real stop condition: the run transitions to `blocked`
 * via `haltOnStopCondition` (which drives 02's `transitionRun` FIRST, then
 * writes one `adjudication_decision` naming the kind and the tracked
 * fields). `blocked` is absorbing, so the halted run can never afterwards
 * reach `final_verifying`.
 *
 * A run already in a state with no `-> blocked` edge rejects with
 * `IllegalTransitionError` from `transitionRun` — deliberately propagated,
 * never swallowed into `{halted:false}`, because "the halt was not needed"
 * and "the halt was refused" are different facts and a caller must be able
 * to tell them apart.
 */
export async function haltRunOnMaterialAmendment(
  signal: MaterialAmendmentHaltSignal,
  options: HaltRunOnMaterialAmendmentOptions,
): Promise<MaterialAmendmentHaltOutcome> {
  if (!signal.material) {
    return { halted: false };
  }

  const record = await haltOnStopCondition({
    journal: options.journal,
    runs: options.runs,
    runId: options.runId,
    changeSetId: options.changeSetId,
    kind: "material_amendment",
    reason:
      `material remote amendment on requirement "${signal.requirementId}": ` +
      `tracked field(s) [${signal.materialFields.join(", ")}] changed since approval`,
  });

  return { halted: true, record };
}
