import { z } from "zod";
import { SchemaVersionField } from "../shared/schema-version.js";
import { IdSchema, NonEmptyStringSchema } from "../shared/ids.js";

/**
 * `SpecRecord` — the spec-driven-development unit carried to the worker.
 * roadmap/25 work item 3; `docs/design/owner-pipeline-conformance.md` §5.4.
 *
 * WHAT IT FIXES, precisely. `PlanRecord` gives a task a name, a dependency edge
 * and done-criteria. What no artifact gives it is the ACCEPTANCE CRITERIA, and
 * the party that never sees them is the worker — `TaskPacket` carries
 * `requirementIds`, and a worker in a sandboxed worktree has no registry to
 * resolve them against. So the one party obliged to satisfy the criteria is the
 * one party that cannot read them, and completion has been judged against a
 * document the doer never held.
 *
 * `packages/contracts/src/contracts/design-record.ts` already records the
 * downstream half of this: `design-addresses-every-acceptance-criterion` "stays
 * judged until a requirements source is wired in". Phase 24 wired the registry.
 * This carries it the last hop.
 *
 * WHY THE CRITERIA ARE COPIED AND NOT REFERENCED. A reference is resolvable only
 * where the registry is, which is the supervisor and not the worktree. Copying
 * is duplication and duplication drifts — so the copy is bound: phase 24's
 * `criteriaHash` seal already fails closed when the criteria in force are not
 * the criteria that were approved, and `unresolvableRequirementIds` below
 * refuses a spec claiming a requirement the registry does not hold. The copy is
 * checkable against its source, which is what makes it a copy rather than a
 * second original.
 */

/**
 * One requirement this task serves, with its criteria in full.
 *
 * `.min(1)` on the array AND `NonEmptyStringSchema` on each member: an empty
 * list and a list of blanks are different ways of shipping the same nothing,
 * and only refusing one of them would leave the record able to look compliant
 * while telling the worker as little as `requirementIds` did.
 */
export const SpecRequirementSchema = z
  .object({
    requirementId: NonEmptyStringSchema,
    acceptanceCriteria: z.array(NonEmptyStringSchema).min(1),
  })
  .strict();
export type SpecRequirement = z.infer<typeof SpecRequirementSchema>;

/**
 * `testsFirst` is `z.literal(true)`, not `z.boolean()`.
 *
 * The repository's first ground rule is "TDD is mandatory", without exception.
 * A boolean field able to hold `false` is an exception mechanism that nobody
 * ruled for, and it would be reached for under exactly the schedule pressure
 * the rule exists to survive. The obligation is a property of the record, not a
 * setting on it.
 *
 * `permittedInterfaces` may be empty and that is deliberate: a task touching no
 * declared interface is ordinary, and requiring one would push callers into
 * naming a fictional interface to make the record parse.
 */
export const SpecRecordSchema = z
  .object({
    schemaVersion: SchemaVersionField,
    id: IdSchema,
    taskId: NonEmptyStringSchema,
    requirements: z.array(SpecRequirementSchema).default([]),
    doneCriteria: z.array(NonEmptyStringSchema).default([]),
    testsFirst: z.literal(true),
    permittedInterfaces: z.array(NonEmptyStringSchema).default([]),
  })
  .strict();
export type SpecRecord = z.infer<typeof SpecRecordSchema>;

/** Every requirement this spec serves carries its acceptance criteria in full. */
export const SPEC_ACCEPTANCE_VERBATIM_CRITERION = "spec-acceptance-criteria-verbatim";
/** The task states how it will be known to be done. */
export const SPEC_DONE_CRITERIA_CRITERION = "plan-tasks-have-done-criteria";

/**
 * The criteria the SPEC decides.
 *
 * Both guards require a non-empty list first. This is the same vacuity rule
 * `deriveDesignCriteria` and `deriveResearchCriteria` carry, and it has now
 * been earned separately at four criteria in this package: a universal
 * quantifier over an empty list is `true`, so an absent artifact would close the
 * stage it was supposed to describe.
 */
export function deriveSpecCriteria(record: SpecRecord): readonly string[] {
  const derived: string[] = [];
  if (record.requirements.length > 0) {
    derived.push(SPEC_ACCEPTANCE_VERBATIM_CRITERION);
  }
  if (record.doneCriteria.length > 0) {
    derived.push(SPEC_DONE_CRITERIA_CRITERION);
  }
  return derived;
}

/**
 * Requirement ids this spec claims that the supplied registry does not hold.
 *
 * Phase 24 ruled the semantics this implements: an unresolvable declared id
 * means the run's acceptance basis is INCOHERENT — the registry does not
 * contain what intake declared — which is an integrity failure of the run's
 * inputs rather than a verdict on any one unit's output.
 *
 * Returns the missing ids rather than a boolean, and a PARTIAL set names only
 * what is missing. A bare refusal sends an operator through the whole
 * requirement set to find out which one; naming them is the difference between
 * a refusal and a diagnosis.
 */
export function unresolvableRequirementIds(
  record: SpecRecord,
  resolvableIds: readonly string[],
): readonly string[] {
  const resolvable = new Set(resolvableIds);
  return record.requirements
    .map((requirement) => requirement.requirementId)
    .filter((id) => !resolvable.has(id));
}

/**
 * Criteria the record actively CONTRADICTS.
 *
 * Two entries for one requirement id mean two criteria sets both claim to be
 * what the worker must satisfy, and nothing in the record chooses between them.
 * That is not silence — it is a spec that cannot be satisfied as written, so an
 * attestation claiming the criteria are carried verbatim is void rather than
 * merely unsupported.
 */
export function specContradictions(record: SpecRecord): readonly string[] {
  const contradicted: string[] = [];
  const seen = new Set<string>();
  for (const requirement of record.requirements) {
    if (seen.has(requirement.requirementId)) {
      contradicted.push(SPEC_ACCEPTANCE_VERBATIM_CRITERION);
      break;
    }
    seen.add(requirement.requirementId);
  }
  return contradicted;
}
