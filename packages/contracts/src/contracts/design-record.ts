import { z } from "zod";
import { SchemaVersionField } from "../shared/schema-version.js";
import { IdSchema, NonEmptyStringSchema } from "../shared/ids.js";

/**
 * `DesignRecord` — the design stage's artifact, as data.
 *
 * WHY THIS EXISTS. Four of the design stage's exit criteria read like judgements:
 * "every risk the design records carries either a mitigation or an explicit
 * statement that it is accepted, and why". Interface-ledger Gap 20 recorded them
 * as undecidable by any tool, and that was true — but the reason was never that
 * the QUESTION is subjective. It is that the design lived in an
 * `IntentContract` narrative section, so there was nothing to check against.
 *
 * Give the design a shape and the question answers itself. "Every risk carries a
 * mitigation" is a list walk. That is not a cleverer judge; it is the same
 * observation §8.0 and §8.3 both made too late — a thing recorded as impossible
 * turned out to be a thing nobody had built.
 *
 * WHAT STRUCTURE CANNOT DO, stated here so no reader has to infer it: this decides
 * **claimed** coverage, never **adequate** coverage. A `mitigation` field can hold
 * "we'll be careful", and every check below will pass. Structure removes the
 * OMISSION failure — a risk nobody answered, an interface nobody assigned an
 * owner — and omission is the failure that ran twelve rounds. The quality half
 * stays judged and stays attested (`CriterionAttestation`).
 *
 * WHY THE SCHEMA DOES NOT REFUSE AN INCOMPLETE DESIGN. Gap 20 part 1 made three
 * properties of a `ReviewVerdict` unrepresentable rather than discouraged, and the
 * temptation here is to copy that: a risk with no mitigation could simply fail to
 * parse. It deliberately does not. Those verdict properties were about a document's
 * HONESTY — a reviewer approving over its own open blocker is never a legitimate
 * state. A design with an unanswered risk IS a legitimate state; it is what a
 * design looks like halfway through. The right outcome is the criterion reported
 * unmet, not the document rejected, because a rejected document cannot be reviewed
 * and the stage would have nothing to converge on.
 */

/**
 * One named element of the design — a module, a component, a decision.
 *
 * `addresses` carries the acceptance criteria this element answers, which is the
 * traceability half of `design-addresses-every-acceptance-criterion`. That
 * criterion is NOT derived (see `deriveDesignCriteria`): the set of acceptance
 * criteria to cover lives on the `Requirement`s, and a design that supplied its own
 * list of what it must satisfy could omit the inconvenient ones. What the field
 * does support is a reviewer checking the mapping against the contract by hand.
 */
export const DesignElementSchema = z
  .object({
    id: NonEmptyStringSchema,
    name: NonEmptyStringSchema,
    /** Acceptance criteria this element answers, as `${requirementId}#${index}`. */
    addresses: z.array(NonEmptyStringSchema).default([]),
  })
  .strict();

/**
 * An interface the design introduces or changes.
 *
 * `package` is required and non-empty because the criterion is "every interface is
 * named, WITH the package that owns it" — an interface with no owner is the state
 * that criterion exists to exclude, and this repository has spent rounds on
 * exactly the confusion an unowned interface causes.
 */
export const DesignInterfaceSchema = z
  .object({
    name: NonEmptyStringSchema,
    package: NonEmptyStringSchema,
  })
  .strict();

/**
 * A risk the design records.
 *
 * Either answer is acceptable and one is required: a `mitigation`, or an
 * `acceptedBecause` saying why it is being lived with. The criterion's own wording
 * gives both, and the design is right that it should — "accepted, and why" is a
 * real answer, and forcing a mitigation for every risk would push callers into
 * writing fictional ones.
 *
 * Both absent is the state the criterion excludes, and it stays REPRESENTABLE for
 * the reason in the module docblock: an unanswered risk is what a design in
 * progress looks like.
 */
export const DesignRiskSchema = z
  .object({
    id: NonEmptyStringSchema,
    statement: NonEmptyStringSchema,
    mitigation: NonEmptyStringSchema.optional(),
    acceptedBecause: NonEmptyStringSchema.optional(),
  })
  .strict();

export const DesignRecordSchema = z
  .object({
    schemaVersion: SchemaVersionField,
    changeSetId: IdSchema,
    elements: z.array(DesignElementSchema).default([]),
    interfaces: z.array(DesignInterfaceSchema).default([]),
    risks: z.array(DesignRiskSchema).default([]),
  })
  .strict();

export type DesignElement = z.infer<typeof DesignElementSchema>;
export type DesignInterface = z.infer<typeof DesignInterfaceSchema>;
export type DesignRisk = z.infer<typeof DesignRiskSchema>;
export type DesignRecord = z.infer<typeof DesignRecordSchema>;

/** A risk is answered by a mitigation or by an explicit acceptance, never by neither. */
export function isRiskAnswered(risk: DesignRisk): boolean {
  return (
    (risk.mitigation ?? "").trim().length > 0 || (risk.acceptedBecause ?? "").trim().length > 0
  );
}

/** `design-risks-have-mitigations` — every recorded risk carries an answer. */
export const DESIGN_RISKS_CRITERION = "design-risks-have-mitigations";
/** `design-interfaces-named` — every interface names its owning package. */
export const DESIGN_INTERFACES_CRITERION = "design-interfaces-named";

/**
 * The design-stage criteria the RECORD decides.
 *
 * An EMPTY list decides nothing, in both directions: a design with no risks
 * recorded has not shown that every risk carries a mitigation, it has shown that
 * nobody wrote any risks down. `[].every(...)` is `true`, and letting that close a
 * stage is how a criterion gets satisfied by an absent artifact — the same
 * vacuous-closure failure `exitCriteriaFor` refuses for an unknown stage and
 * `deriveGateCriteria` refuses for an empty evidence set.
 *
 * Two of the stage's four criteria are deliberately absent:
 *
 *   - `design-addresses-every-acceptance-criterion` needs the acceptance-criteria
 *     set, which lives on the `Requirement`s and not in the design. A design
 *     supplying its own list of what it must cover could omit the awkward ones, so
 *     this stays judged until a requirements source is wired in.
 *   - `design-reconciled-with-ledger` asks whether a reconciliation is GENUINE,
 *     which is the quality half no shape can carry.
 */
export function deriveDesignCriteria(record: DesignRecord): readonly string[] {
  const derived: string[] = [];
  if (record.risks.length > 0 && record.risks.every(isRiskAnswered)) {
    derived.push(DESIGN_RISKS_CRITERION);
  }
  // `package` is required non-empty by the schema, so a parsed record cannot hold
  // an unowned interface. The presence check is what carries the criterion: an
  // empty list is silence, not compliance.
  if (record.interfaces.length > 0) {
    derived.push(DESIGN_INTERFACES_CRITERION);
  }
  return derived;
}

/**
 * Criteria the record actively CONTRADICTS, as opposed to merely not establishing.
 *
 * The distinction matters because an empty list and a violated list are different
 * states that a single "derived or not" answer would flatten. A design with no
 * risks recorded has not proven the criterion — but it has not refuted it either,
 * and "this design records no risks" is a legitimate thing to assert with an
 * attestation. A design with a risk nobody answered is different: it is evidence
 * AGAINST the criterion, and an attestation claiming otherwise is contradicted by
 * the artifact it describes.
 *
 * So: derivation handles the provable case, an attestation covers the empty case,
 * and this stops an attestation being used to paper over the violated one.
 */
export function designContradictions(record: DesignRecord): readonly string[] {
  const contradicted: string[] = [];
  if (record.risks.some((risk) => !isRiskAnswered(risk))) {
    contradicted.push(DESIGN_RISKS_CRITERION);
  }
  return contradicted;
}
