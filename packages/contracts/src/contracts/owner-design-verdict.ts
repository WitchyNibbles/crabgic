import { z } from "zod";
import { SchemaVersionField } from "../shared/schema-version.js";
import { IdSchema, NonEmptyStringSchema, TimestampSchema } from "../shared/ids.js";

/**
 * `OwnerDesignVerdict` — the design gate's only key.
 * Owner ruling R2 (2026-08-15); roadmap/25 work item 5.
 *
 * WHAT IT IS FOR. Steps 6 and 7 of the owner's pipeline: ask whether the design
 * is what they intended, and loop while it is not. The `design-gate` stage
 * already exists in `PIPELINE_STAGES` with its criterion; this is what makes the
 * criterion unsatisfiable by anything except the owner.
 *
 * WHY THE STAGE HAS NO LENSES. A reviewer lens at this stage would be a second
 * route to closure that is not the owner — which is precisely the difference
 * between a gate and a checkpoint the model can satisfy for itself. The same
 * principle `contract.approve` rests on (adaptation §5.5: the model must not be
 * able to satisfy its own approval gate), applied one stage earlier.
 *
 * WHY IT IS PLACED BEFORE DISPATCH. It widens no authority and grants nothing,
 * so ledger Gap 18's argument is untouched: the standing `EnvelopePolicy` still
 * governs what may EXECUTE, and this governs what is worth executing. Two
 * different questions, and only the second was ever the owner's to skip.
 *
 * WHY THE REVISION IS PART OF THE VERDICT. An approval that does not say what
 * was approved carries forward across an edited design — approving something
 * nobody read. That is the material-amendment failure phase 24's criteria seal
 * blocks at the requirements level, reproduced one stage earlier, and it is
 * blocked here the same way: by binding the verdict to the exact artifact.
 */

export const OWNER_DESIGN_VERDICTS = ["approved", "rejected"] as const;

/**
 * A rejection REQUIRES a reason; an approval does not.
 *
 * Steps 6-7 are a loop, and a rejection returns to the design stage. A
 * rejection with no reason gives the next round nothing to change, so the loop
 * would run again on the same design and be rejected again. "Yes, this is what
 * I meant" is a complete answer on its own; "no" is not.
 */
export const OwnerDesignVerdictSchema = z
  .object({
    schemaVersion: SchemaVersionField,
    changeSetId: IdSchema,
    /** The exact design this verdict was given over — a content hash, not a name. */
    designRevision: NonEmptyStringSchema,
    verdict: z.enum(OWNER_DESIGN_VERDICTS),
    reason: NonEmptyStringSchema.optional(),
    recordedAt: TimestampSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.verdict === "rejected" && (value.reason ?? "").trim().length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message:
          "a rejection must say why: the design stage loops on this, and a rejection with no reason gives the next round nothing to change",
      });
    }
  });
export type OwnerDesignVerdict = z.infer<typeof OwnerDesignVerdictSchema>;

/** The single exit criterion `PIPELINE_STAGES` declares for the `design-gate` stage. */
export const DESIGN_GATE_CRITERION = "design-gate-owner-verdict-recorded";

export interface DesignGateInput {
  /** Absent when the owner has not answered yet — the stage's default state. */
  readonly ownerVerdict?: OwnerDesignVerdict;
  /** The design revision currently under review. */
  readonly designRevision: string;
}

export interface DesignGateResult {
  readonly closable: boolean;
  /** Why not, when it is not. Carries the owner's own words on a rejection. */
  readonly reason: string;
}

/**
 * Whether the design gate may close.
 *
 * Takes NO findings, NO attestations and NO derived criteria, deliberately: this
 * function's whole job is that none of those can close the stage. A signature
 * that accepted them would be a signature somebody could later make them count
 * through.
 *
 * Absence is refused rather than defaulted. A stage that closed on "no verdict
 * recorded" would be a gate nobody ever has to pass through, which is the
 * inert-control failure applied to the one control the owner asked for by name.
 */
export function resolveDesignGate(input: DesignGateInput): DesignGateResult {
  const owner = input.ownerVerdict;
  if (owner === undefined) {
    return {
      closable: false,
      reason:
        "no owner verdict is on record for this design; the design gate closes on the owner's answer and on nothing else",
    };
  }

  if (owner.designRevision !== input.designRevision) {
    return {
      closable: false,
      reason: `the owner's verdict was given over design revision ${owner.designRevision}, and the design under review is ${input.designRevision} — an approval does not carry forward across an edit`,
    };
  }

  if (owner.verdict === "rejected") {
    return {
      closable: false,
      reason: `the owner rejected this design: ${owner.reason ?? ""}`,
    };
  }

  return { closable: true, reason: "the owner approved this exact design revision" };
}
