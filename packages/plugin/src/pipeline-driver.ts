import {
  PIPELINE_STAGE_IDS,
  REVIEW_RUNAWAY_GUARD,
  exitCriteriaFor,
  lensesApplicableTo,
  stageById,
  type PipelineStageId,
  type SkippedLens,
  type StackEvidence,
} from "@crabgic/contracts";

/**
 * The pipeline driver's decisions — roadmap/25 work item 7, closing
 * `docs/staged-review-pipeline.md` §8.4 in favour of a `Workflow` script.
 *
 * WHY THIS MODULE EXISTS SEPARATELY FROM THE SCRIPT. The audit that produced
 * phase 25 found the pipeline's sequencing living in `buildManagerProtocolBlock`'s
 * prose — an always-loaded `CLAUDE.md` paragraph that a model may simply not
 * follow. Stage order was a suggestion, lens coverage was a suggestion, and the
 * round ceiling was a constant interpolated into a sentence with no counter
 * behind it.
 *
 * A `Workflow` script fixes the "a model may skip it" half, because the script
 * runs deterministically. It does NOT fix the "nothing can check it" half: a
 * script executes inside the harness, so anything decided there is decided
 * somewhere no test reaches. Putting the rules in the script would have
 * relocated the problem into a place with worse visibility.
 *
 * So the rules live here, under test, and the script is glue that calls them and
 * spawns what they return.
 *
 * WHAT THIS STILL DOES NOT MAKE TRUE, stated so nobody reads more into it: the
 * script is invoked by the manager model. A script never called constrains
 * nothing. This moves enforcement from per-stage prose compliance to a single
 * invocation — a large improvement, and not a proof.
 */

/**
 * Re-exported, never restated.
 *
 * A driver carrying its own copy of the stage list is a second list that must
 * agree with `PIPELINE_STAGES`, and this repository has twice measured what
 * happens to two lists that must agree — the contract sections, and the path
 * normalizer the overlap analyzer and the finding index share.
 */
export const STAGE_ORDER: readonly PipelineStageId[] = PIPELINE_STAGE_IDS;

/**
 * Stages that close on the OWNER rather than on a reviewer or a gate.
 *
 * `integrate` is deliberately absent. It has no lenses either, but it closes on
 * the final-candidate gate — conflating "no reviewer" with "needs a human" would
 * stop the pipeline for the owner at a place a tool already decides, which is
 * the check-in behaviour the manager protocol exists to prevent.
 */
const OWNER_GATED: readonly PipelineStageId[] = ["clarify", "design-gate"];

export function isOwnerGated(stage: PipelineStageId): boolean {
  return OWNER_GATED.includes(stage);
}

/**
 * The next stage to run, or `undefined` when the pipeline is finished.
 *
 * REFUSES a completion set with a hole in it. This is the audit's finding made
 * mechanical: "a manager that goes design → implement, skipping plan, violates
 * nothing mechanical" was true, and this is the mechanism it violates now. The
 * error names the skipped stage, because a refusal an operator cannot act on
 * sends them reading the whole roster to find out what happened.
 *
 * Completion is treated as a SET: a caller that recorded its completions out of
 * order has not skipped anything, and refusing that would be an accident of
 * bookkeeping rather than a rule about the pipeline.
 */
export function nextStage(completed: readonly PipelineStageId[]): PipelineStageId | undefined {
  const done = new Set(completed);
  const firstIncomplete = STAGE_ORDER.find((stage) => !done.has(stage));
  if (firstIncomplete === undefined) return undefined;

  const skipped = STAGE_ORDER.slice(STAGE_ORDER.indexOf(firstIncomplete) + 1).filter((stage) =>
    done.has(stage),
  );
  if (skipped.length > 0) {
    throw new Error(
      `stage order violated: ${skipped.join(", ")} completed before ${firstIncomplete}`,
    );
  }
  return firstIncomplete;
}

/** One reviewer to dispatch, and the checklist it owes an answer about. */
export interface PlannedLens {
  readonly lens: string;
  readonly obligations: readonly string[];
}

export interface StageRoundPlan {
  readonly stage: PipelineStageId;
  readonly lenses: readonly PlannedLens[];
  /** Domain lenses that did not apply to this project, with reasons. Audit stage only. */
  readonly skipped: readonly SkippedLens[];
  /** The stage's exit criteria — what must be answered, whoever answers it. */
  readonly obligations: readonly string[];
}

/**
 * What to dispatch for one round of one stage.
 *
 * THE OBLIGATION SEAM. `admissibility.ts`'s bound 2 treats an empty obligation
 * list as UNMET rather than satisfied, because a lens that was never told what
 * it owed has not covered anything. This function is where that bound gets its
 * input, so a lens is never dispatched without a checklist — a driver that did
 * so would stall its own stage forever.
 *
 * The `audit` stage plans through the DOMAIN lenses, filtered by what the
 * project actually contains, and returns the skipped ones with their reasons. A
 * plan that silently ran five of six domains would be indistinguishable from one
 * that ran all six, which is the inert-control failure this repository's
 * discipline exists to surface.
 */
export function planStageRound(stage: PipelineStageId, evidence: StackEvidence): StageRoundPlan {
  // Throws for an unknown stage. A typo that returned an empty plan would
  // dispatch nobody and read as a stage with nothing to check.
  const definition = stageById(stage);
  const obligations = exitCriteriaFor(stage);

  if (stage === "audit") {
    const { applicable, skipped } = lensesApplicableTo(evidence);
    return {
      stage,
      lenses: applicable.map((lens) => ({ lens: lens.id, obligations })),
      skipped,
      obligations,
    };
  }

  return {
    stage,
    lenses: definition.lenses.map((lens) => ({ lens, obligations })),
    skipped: [],
    obligations,
  };
}

/**
 * How many rounds this stage may run.
 *
 * An owner-gated stage gets ONE. There is no loop to run — the owner answers or
 * they do not — and looping on a human is the "shall I proceed?" check-in the
 * manager protocol forbids in its second paragraph.
 *
 * Everything else gets the runaway guard, which under ruling R4 is a backstop
 * and not the closure rule: a healthy stage closes on its first quiet round,
 * usually far below this number.
 */
export function roundBudgetFor(stage: PipelineStageId): number {
  return isOwnerGated(stage) ? 1 : REVIEW_RUNAWAY_GUARD;
}
