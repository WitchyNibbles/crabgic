import {
  PIPELINE_STAGE_IDS,
  StackEvidenceSchema,
  type PipelineStageId,
  type StackEvidence,
} from "@crabgic/contracts";
import {
  isOwnerGated,
  nextStage,
  planStageRound,
  roundBudgetFor,
  type StageRoundPlan,
} from "@crabgic/plugin";

/**
 * `pipeline.plan` — the driver's decisions, served to the manager.
 * roadmap/25 work item 7; `docs/design/owner-pipeline-conformance.md` §5.3.
 *
 * WHY THIS IS A GATEWAY TOOL AND NOT A `Workflow` SCRIPT. §5.3 chose a
 * `Workflow` script to close `staged-review-pipeline.md` §8.4, and that choice
 * survives contact with one harness fact it did not account for: **workflow
 * scripts have no imports and no filesystem access.** A script therefore cannot
 * read `PIPELINE_STAGES`, `DOMAIN_LENSES` or the stage's exit criteria — it would
 * have to inline copies of all three, which is the "two lists that must agree"
 * failure this repository has measured twice, planted at the exact point that
 * decides what gets reviewed.
 *
 * So the decisions are served the way every other server-decided answer in this
 * product is served: as a gateway tool, over the same channel as
 * `review.submit`. The manager asks what to run; it does not decide. A
 * `Workflow` script remains the right vehicle for the FAN-OUT once the plan is
 * in hand, and it can carry the plan as its `args`.
 *
 * ⚠️ ~~**THE BOUND, STATED RATHER THAN IMPLIED.** `completedStages` comes from the
 * caller, because no durable stage-completion record exists yet — production
 * passes `appendEvidence: () => Promise.resolve()` for review verdicts, so a
 * closed stage leaves no journal trace to read back. What this tool therefore
 * removes is the SKIP: a completion set with a hole in it is refused server-side,
 * naming the stage that was jumped. What it does NOT remove is a caller claiming
 * a stage it never ran. That needs a journaled stage-completion record, and it is
 * named in phase 25's risks rather than quietly left to a reader to notice.~~
 *
 * **CLOSED 2026-08-16 by owner ruling R8, work item 3.** The bound above is
 * struck rather than deleted, per this repository's annotate-never-rewrite
 * convention, because the reasoning that produced it is still how the residual
 * came to exist. The record it called for now exists — `StageCompletionRecord`,
 * written by `review.submit` from its own closure computation — and
 * `recordedStages` carries it here.
 *
 * **When a recorded set is supplied it WINS**, and the caller's `completedStages`
 * is used for one thing only: telling the caller which of its claims the record
 * does not support, on `unrecordedClaims`. Silently correcting a caller would
 * leave it submitting against a stage it thinks is next, reading every refusal as
 * a bug in the server.
 *
 * **Absent is not empty.** An embedder that has not wired the store keeps the
 * pre-R8 behaviour rather than being told nothing has ever closed. Empty means
 * nothing closed, which is the fail-safe direction R8 needs; absent means nobody
 * asked, which is the pre-existing one.
 */

export interface PipelinePlanInput {
  /**
   * What the CALLER believes has closed. Retained, and no longer believed when
   * `recordedStages` is supplied — see the module docblock.
   */
  readonly completedStages?: readonly string[];
  /**
   * What the SERVER has on record as closed, from the stage-completion store.
   * Owner ruling R8. Supplied by the gateway wrapper, never by a caller: the
   * tool schema does not expose it, so a session cannot reach this field.
   */
  readonly recordedStages?: readonly string[];
  readonly stackEvidence?: unknown;
}

export interface PipelinePlanResult {
  readonly ok: boolean;
  readonly error?: string;
  /** The stage to run next. Absent when the pipeline is finished. */
  readonly stage?: PipelineStageId;
  readonly finished?: boolean;
  readonly lenses?: StageRoundPlan["lenses"];
  readonly skippedLenses?: StageRoundPlan["skipped"];
  readonly obligations?: readonly string[];
  readonly roundBudget?: number;
  /** True when this stage closes on the owner and no reviewer may close it. */
  readonly ownerGated?: boolean;
  /**
   * Stages the caller claimed as complete that the server has no record of —
   * owner ruling R8.
   *
   * Present only when it is non-empty AND a recorded set was supplied, so its
   * absence never has to be read as either "no disagreement" or "nobody
   * checked". The plan itself is already computed from the record; this exists
   * so a caller working from a stale view is TOLD, rather than silently
   * corrected into submitting against a stage it does not think is next.
   */
  readonly unrecordedClaims?: readonly string[];
}

function isKnownStage(stage: string): stage is PipelineStageId {
  return (PIPELINE_STAGE_IDS as readonly string[]).includes(stage);
}

/**
 * An absent or unparseable `stackEvidence` degrades to EMPTY, never to "assume
 * everything applies".
 *
 * Empty evidence is what a brand-new repository genuinely looks like, and the
 * four unconditional domain lenses still fire on it. Defaulting the other way —
 * running every lens when detection has not run — would report a frontend audit
 * on a project with no frontend, which is a false coverage claim and worse than
 * a stated skip.
 */
function coerceEvidence(raw: unknown): StackEvidence {
  const parsed = StackEvidenceSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return {
    schemaVersion: 1,
    id: "00000000-0000-4000-8000-000000000000",
    createdAt: new Date(0).toISOString(),
    findings: [],
    contradictions: [],
    unresolvedAmbiguity: [],
  } as StackEvidence;
}

export function runPipelinePlan(input: PipelinePlanInput): PipelinePlanResult {
  const claimedByCaller = input.completedStages ?? [];
  /**
   * The record wins where there is one. `??` rather than a truthiness test on
   * purpose: an EMPTY recorded set is a real answer — nothing has closed — and
   * must not fall through to the caller's claim, which is exactly the case an
   * attacker or a stale caller would exploit.
   */
  const authoritative = input.recordedStages ?? claimedByCaller;
  const unrecordedClaims =
    input.recordedStages === undefined
      ? []
      : claimedByCaller.filter((stage) => !input.recordedStages?.includes(stage));

  const claimed = authoritative;
  const unknown = claimed.filter((stage) => !isKnownStage(stage));
  if (unknown.length > 0) {
    // Refused rather than ignored. Silently dropping an unrecognized stage would
    // shift the whole sequence by one and hand back the wrong next stage.
    return { ok: false, error: `unknown stage(s): ${unknown.join(", ")}` };
  }

  let stage: PipelineStageId | undefined;
  try {
    stage = nextStage(claimed as readonly PipelineStageId[]);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  if (stage === undefined) {
    return {
      ok: true,
      finished: true,
      ...(unrecordedClaims.length > 0 ? { unrecordedClaims } : {}),
    };
  }

  const plan = planStageRound(stage, coerceEvidence(input.stackEvidence));
  return {
    ok: true,
    finished: false,
    stage,
    lenses: plan.lenses,
    skippedLenses: plan.skipped,
    obligations: plan.obligations,
    roundBudget: roundBudgetFor(stage),
    ownerGated: isOwnerGated(stage),
    ...(unrecordedClaims.length > 0 ? { unrecordedClaims } : {}),
  };
}
