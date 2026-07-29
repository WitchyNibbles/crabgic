import { describe, expect, it } from "vitest";
import {
  CriterionAttestationSchema,
  StoredAttestationSchema,
  attestationKey,
} from "./criterion-attestation.js";

/**
 * `CriterionAttestation` — the judged criteria's claim, made attributable.
 *
 * Four exit criteria are derived from evidence and cannot be claimed. The rest are
 * judgements no tool can settle, and they were arriving as bare strings in a
 * `metCriteria` array: nobody said it, nothing pointed at what it described, and a
 * misreport left no trace. The criterion stays undecidable; the CLAIM does not
 * have to stay anonymous.
 *
 * Every field below is required non-empty, and each one removes a specific way a
 * claim can be unfalsifiable — no author, no argument, nowhere to look.
 */

function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    criterion: "design-risks-have-mitigations",
    asserter: "eo-reviewer:security",
    rationale:
      "all four recorded risks carry a mitigation; the fifth is marked accepted with the reason stated",
    artifactAnchor: "docs/design/state-store.md#risks",
    assertedAt: "2026-07-29T00:00:00.000Z",
    round: 1,
    ...overrides,
  };
}

describe("CriterionAttestationSchema", () => {
  it("parses a fully-formed attestation", () => {
    expect(CriterionAttestationSchema.safeParse(valid()).success).toBe(true);
  });

  /**
   * The three refusals are the whole point of the schema. Each one is a way for a
   * claim to mean nothing while still validating.
   */
  it("refuses an attestation nobody asserts", () => {
    expect(CriterionAttestationSchema.safeParse(valid({ asserter: "" }).success)).not.toBe(true);
    expect(CriterionAttestationSchema.safeParse(valid({ asserter: "   " })).success).toBe(false);
  });

  it("refuses an attestation with no argument behind it", () => {
    expect(CriterionAttestationSchema.safeParse(valid({ rationale: "" })).success).toBe(false);
  });

  it("refuses an attestation that points nowhere", () => {
    // The falsifiability half: a reader told WHICH part of the artifact to read
    // can check the claim. Without it the claim can only be accepted or ignored.
    expect(CriterionAttestationSchema.safeParse(valid({ artifactAnchor: "" })).success).toBe(false);
  });

  it("refuses an attestation naming no criterion", () => {
    expect(CriterionAttestationSchema.safeParse(valid({ criterion: "" })).success).toBe(false);
  });

  it("refuses a round that is not a positive whole number", () => {
    expect(CriterionAttestationSchema.safeParse(valid({ round: 0 })).success).toBe(false);
    expect(CriterionAttestationSchema.safeParse(valid({ round: 1.5 })).success).toBe(false);
  });

  it("rejects an unknown key (.strict())", () => {
    expect(CriterionAttestationSchema.safeParse(valid({ verified: true })).success).toBe(false);
  });
});

describe("attestationKey", () => {
  /**
   * The stage is part of the identity, not the payload. An attestation carried
   * across a stage boundary would be a judgement about one artifact answering for
   * another.
   */
  it("separates the same criterion asserted for two different stages", () => {
    const design = StoredAttestationSchema.parse({ ...valid(), stage: "design" });
    const plan = StoredAttestationSchema.parse({ ...valid(), stage: "plan" });
    expect(attestationKey(design)).not.toBe(attestationKey(plan));
  });

  it("gives the same key to a re-assertion of one stage's criterion, so it supersedes", () => {
    const first = StoredAttestationSchema.parse({ ...valid(), stage: "design" });
    const revised = StoredAttestationSchema.parse({
      ...valid({ round: 2, rationale: "revised after the risk table was rewritten" }),
      stage: "design",
    });
    expect(attestationKey(revised)).toBe(attestationKey(first));
  });
});
