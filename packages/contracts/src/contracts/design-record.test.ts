import { describe, expect, it } from "vitest";
import {
  DESIGN_INTERFACES_CRITERION,
  DESIGN_RISKS_CRITERION,
  DesignRecordSchema,
  deriveDesignCriteria,
  designContradictions,
  isRiskAnswered,
  type DesignRecord,
} from "./design-record.js";

/**
 * "Every risk the design records carries either a mitigation or an explicit
 * statement that it is accepted, and why" was recorded as a criterion no tool can
 * decide. The question was never subjective — the design lived in an
 * `IntentContract` narrative section, so there was nothing to check against. Given a
 * shape, it is a list walk.
 */

const CHANGE_SET_ID = "22222222-2222-4222-8222-222222222222";

function record(overrides: Record<string, unknown> = {}): DesignRecord {
  return DesignRecordSchema.parse({
    schemaVersion: 1,
    changeSetId: CHANGE_SET_ID,
    ...overrides,
  });
}

const risk = (id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  statement: `${id} could fail under load`,
  ...overrides,
});

describe("isRiskAnswered", () => {
  it("accepts a mitigation", () => {
    expect(isRiskAnswered({ id: "r", statement: "s", mitigation: "bounded retry" })).toBe(true);
  });

  it("accepts an explicit acceptance, since the criterion's own wording allows it", () => {
    // "or an explicit statement that it is accepted, and why". Forcing a mitigation
    // for every risk would push callers into writing fictional ones.
    expect(isRiskAnswered({ id: "r", statement: "s", acceptedBecause: "out of threat model" })).toBe(
      true,
    );
  });

  it("refuses a risk answered by neither", () => {
    expect(isRiskAnswered({ id: "r", statement: "s" })).toBe(false);
  });
});

describe("deriveDesignCriteria", () => {
  it("derives the risks criterion when every recorded risk is answered", () => {
    const derived = deriveDesignCriteria(
      record({
        risks: [risk("r1", { mitigation: "bounded retry" }), risk("r2", { acceptedBecause: "rare" })],
      }),
    );
    expect(derived).toContain(DESIGN_RISKS_CRITERION);
  });

  it("withholds it when a risk is answered by neither, and reports the contradiction", () => {
    const design = record({ risks: [risk("r1", { mitigation: "retry" }), risk("r2")] });
    expect(deriveDesignCriteria(design)).not.toContain(DESIGN_RISKS_CRITERION);
    expect(designContradictions(design)).toContain(DESIGN_RISKS_CRITERION);
  });

  /**
   * ABSENCE IS NOT COMPLIANCE. `[].every(...)` is `true`, so a design recording no
   * risks would satisfy the criterion vacuously — the same failure `exitCriteriaFor`
   * refuses for an unknown stage. A design with no risks written down has not shown
   * every risk is answered; it has shown that nobody wrote any risks down.
   */
  it("derives nothing from a design that records no risks at all", () => {
    expect(deriveDesignCriteria(record({ risks: [] }))).not.toContain(DESIGN_RISKS_CRITERION);
  });

  /**
   * ...and absence is not violation either. "This design records no risks" is a
   * legitimate claim for someone to make and sign, so it is left to an attestation
   * rather than refuted here.
   */
  it("contradicts nothing on a design that records no risks", () => {
    expect(designContradictions(record({ risks: [] }))).toEqual([]);
  });

  it("derives the interfaces criterion from interfaces that name their package", () => {
    const derived = deriveDesignCriteria(
      record({ interfaces: [{ name: "GateRegistry", package: "@crabgic/gates" }] }),
    );
    expect(derived).toContain(DESIGN_INTERFACES_CRITERION);
  });

  it("derives nothing about interfaces from an empty list", () => {
    expect(deriveDesignCriteria(record({ interfaces: [] }))).not.toContain(
      DESIGN_INTERFACES_CRITERION,
    );
  });

  /**
   * The acceptance-criteria criterion is deliberately NOT derived. The set to cover
   * lives on the `Requirement`s, and a design supplying its own list of what it must
   * satisfy could omit the awkward ones — which is the self-certification every part
   * of this pipeline is built to refuse.
   */
  it("never derives design-addresses-every-acceptance-criterion", () => {
    const derived = deriveDesignCriteria(
      record({ elements: [{ id: "e1", name: "store", addresses: ["req-1#0"] }] }),
    );
    expect(derived).not.toContain("design-addresses-every-acceptance-criterion");
  });
});

describe("DesignRecordSchema", () => {
  /**
   * An unanswered risk stays REPRESENTABLE, unlike the three verdict properties Gap
   * 20 part 1 made unrepresentable. Those were about a document's honesty — a
   * reviewer approving over its own open blocker is never legitimate. A design with
   * an unanswered risk IS legitimate: it is what a design looks like halfway
   * through. The criterion goes unmet; the document is not rejected, because a
   * rejected document cannot be reviewed and the stage would have nothing to
   * converge on.
   */
  it("accepts a design whose risk carries no answer yet", () => {
    expect(
      DesignRecordSchema.safeParse({
        schemaVersion: 1,
        changeSetId: CHANGE_SET_ID,
        risks: [risk("r1")],
      }).success,
    ).toBe(true);
  });

  it("refuses an interface with no owning package", () => {
    // Required rather than derived-as-unmet: the criterion is "named, WITH the
    // package that owns it", so an unowned interface is not an incomplete design but
    // a malformed entry.
    expect(
      DesignRecordSchema.safeParse({
        schemaVersion: 1,
        changeSetId: CHANGE_SET_ID,
        interfaces: [{ name: "GateRegistry", package: "" }],
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown key (.strict())", () => {
    expect(
      DesignRecordSchema.safeParse({
        schemaVersion: 1,
        changeSetId: CHANGE_SET_ID,
        approvedBy: "me",
      }).success,
    ).toBe(false);
  });

  it("defaults its three lists so an absent section is empty rather than undefined", () => {
    const parsed = record();
    expect(parsed.elements).toEqual([]);
    expect(parsed.interfaces).toEqual([]);
    expect(parsed.risks).toEqual([]);
  });
});
