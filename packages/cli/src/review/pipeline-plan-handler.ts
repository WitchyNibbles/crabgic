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
 * ⚠️ **THE BOUND, STATED RATHER THAN IMPLIED.** `completedStages` comes from the
 * caller, because no durable stage-completion record exists yet — production
 * passes `appendEvidence: () => Promise.resolve()` for review verdicts, so a
 * closed stage leaves no journal trace to read back. What this tool therefore
 * removes is the SKIP: a completion set with a hole in it is refused server-side,
 * naming the stage that was jumped. What it does NOT remove is a caller claiming
 * a stage it never ran. That needs a journaled stage-completion record, and it is
 * named in phase 25's risks rather than quietly left to a reader to notice.
 */

export interface PipelinePlanInput {
  readonly completedStages?: readonly string[];
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
  const claimed = input.completedStages ?? [];
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

  if (stage === undefined) return { ok: true, finished: true };

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
  };
}
