import { z } from "zod";
import { SchemaVersionField } from "../shared/schema-version.js";

/**
 * `AutonomySettings` — owner ruling R3 (2026-08-15), roadmap/25 work item 10.
 *
 * WHAT IT IS FOR. The owner's pipeline says that after the design gate "no
 * human/user feedback is needed and everything must be completed
 * automatically". Three of the seven stop conditions fire after that gate and
 * every one of them halted for the owner. R3 granted a declared default for two
 * — `irreducible_product_decision` and `exhausted_repairs` — and excluded the
 * third, `expanded_authority`, permanently.
 *
 * WHY THE EXCLUSION IS A SCHEMA AND NOT A RULE. `expanded_authority` fires when
 * the compiled envelope is not contained in the standing `EnvelopePolicy`. It is
 * the single mechanism making it true that nothing reachable from a session can
 * widen the model's own authority, which is the whole safety argument of ledger
 * Gap 18. A check that the key is absent is a check somebody can delete; a
 * `.strict()` object where the key cannot be REPRESENTED cannot be deleted by
 * accident, cannot be introduced by a migration, and needs no reviewer to
 * notice it. Gap 20's doctrine, applied to the one place it matters most.
 *
 * WHY BOTH KEYS ARE REQUIRED. An omitted condition would have to mean
 * something, and both readings are bad: reading absence as `halt` silently
 * disables an autonomy the owner asked for, and reading it as "proceed"
 * silently grants one they did not. Requiring both makes every choice explicit
 * and leaves the document self-describing.
 *
 * WHY A DEFAULT IS DECLARED BEFORE THE RUN. R3's obligation, and the reason the
 * emitted record carries `declaredBefore`. A disposition chosen while the
 * decision is live is the model deciding, wearing a default's name. Declaring it
 * in advance is what makes it the owner's decision applied later rather than the
 * model's decision made now.
 */

/**
 * The conditions R3 made defaultable. Exactly two, and deliberately not derived
 * by filtering the seven — a filter would silently gain a member the day
 * somebody adds a stop condition, which is how a scope ruling becomes a general
 * permission without anybody ruling for it.
 */
export const AUTONOMY_DEFAULTABLE_CONDITIONS = [
  "irreducible_product_decision",
  "exhausted_repairs",
] as const;
export type AutonomyDefaultableCondition = (typeof AUTONOMY_DEFAULTABLE_CONDITIONS)[number];

/**
 * What to do when a product fork has no repo-decidable answer.
 *
 * `halt` is a first-class choice, not the absence of one: the owner may decline
 * autonomy per condition without deleting the document, and an all-or-nothing
 * setting would push an operator into removing the file — losing the record of
 * what was decided along with the behaviour.
 */
export const PRODUCT_DECISION_DEFAULTS = [
  /** Take the option that is easiest to undo if it turns out wrong. */
  "prefer-reversible",
  /** Take the option with the smaller surface, leaving the larger one to a later decision. */
  "prefer-simpler",
  "halt",
] as const;

/** What to do when a work unit has spent its initial attempt and both repairs. */
export const EXHAUSTED_REPAIRS_DEFAULTS = [
  /** Journal the unit as parked and carry on with the rest of the DAG. */
  "park",
  /** Abandon this unit, keep its findings, and let the run finish without it. */
  "abandon-unit",
  "halt",
] as const;

export const AutonomyDefaultsSchema = z
  .object({
    irreducible_product_decision: z.enum(PRODUCT_DECISION_DEFAULTS),
    exhausted_repairs: z.enum(EXHAUSTED_REPAIRS_DEFAULTS),
  })
  .strict();

export const AutonomySettingsSchema = z
  .object({
    schemaVersion: SchemaVersionField,
    defaults: AutonomyDefaultsSchema,
  })
  .strict();
export type AutonomySettings = z.infer<typeof AutonomySettingsSchema>;

/**
 * The record an autonomous run must journal for every default it takes.
 *
 * The owner no longer blocks on these conditions, so the only way they can ever
 * see one is afterwards. A default taken and not recorded is exactly the silent
 * choosing R3 was careful to forbid.
 */
export interface DefaultedDecisionRecord {
  readonly kind: AutonomyDefaultableCondition;
  readonly disposition: string;
  /**
   * Always `true` for a record this module emits, and present anyway.
   *
   * A reader of the journal must be able to tell a pre-declared default from a
   * disposition chosen in the moment WITHOUT trusting the writer's word for it.
   * The field exists so that a record lacking it — written by some future code
   * path that decided at firing time — is visibly a different thing.
   */
  readonly declaredBefore: true;
}

export interface StopConditionVerdict {
  readonly halts: boolean;
  /** The declared default taken. Absent whenever the run halts. */
  readonly disposition?: string;
  /** Absent whenever the run halts: a halt is already visible to the owner. */
  readonly record?: DefaultedDecisionRecord;
}

function isDefaultable(kind: string): kind is AutonomyDefaultableCondition {
  return (AUTONOMY_DEFAULTABLE_CONDITIONS as readonly string[]).includes(kind);
}

/**
 * Whether this firing halts the run, or takes a declared default.
 *
 * Every condition outside `AUTONOMY_DEFAULTABLE_CONDITIONS` halts, including the
 * four R3 never mentioned. Defaulting one of those by omission is how a scope
 * ruling quietly turns into a general permission.
 */
export function resolveStopCondition(
  kind: string,
  settings: AutonomySettings,
): StopConditionVerdict {
  if (!isDefaultable(kind)) return { halts: true };

  const disposition = settings.defaults[kind];
  if (disposition === "halt") return { halts: true };

  return {
    halts: false,
    disposition,
    record: { kind, disposition, declaredBefore: true },
  };
}

/**
 * What an unconfigured project gets: the previous behaviour, exactly.
 *
 * A real document rather than a sentinel, so the resolver needs no second code
 * path for "unconfigured" — two paths answering one question is where they
 * drift. The permissive direction is the dangerous one here, so absence means
 * halt.
 */
export const HALTING_AUTONOMY: AutonomySettings = {
  schemaVersion: 1,
  defaults: { irreducible_product_decision: "halt", exhausted_repairs: "halt" },
};
