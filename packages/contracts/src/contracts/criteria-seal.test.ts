import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { RequirementSchema, type Requirement } from "./requirement.js";
import {
  CRITERIA_SEAL_FAILURE_REASONS,
  CriteriaApprovalSealSchema,
  CriteriaSealMismatchError,
  CriteriaApprovalSealMissingError,
  computeCriteriaHash,
  verifyCriteriaSeal,
  assertCriteriaSealIntact,
  type CriteriaApprovalSeal,
} from "./criteria-seal.js";

const REQUIREMENT_ID = "8f14e45f-ceea-467e-b4d3-8b5f8f5f8f5f";
const CHANGE_SET_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const CRITERIA = ["p95 wall-clock time under 5s on a warm cache", "No request exceeds 30s"];

function buildRequirement(overrides: Partial<Requirement> = {}): Requirement {
  const acceptanceCriteria = overrides.acceptanceCriteria ?? CRITERIA;
  return RequirementSchema.parse({
    schemaVersion: 1,
    id: REQUIREMENT_ID,
    intentContractId: CHANGE_SET_ID,
    section: "performance",
    title: "Doctor run completes quickly",
    description: "The `doctor` command must complete its full check suite in bounded time.",
    acceptanceCriteria,
    criteriaHash: computeCriteriaHash(acceptanceCriteria),
    workUnitIds: [],
    renderedArtifactIds: [],
    testIdentifiers: [],
    evidenceRecordIds: [],
    createdAt: "2026-07-15T12:00:00.000Z",
    ...overrides,
  } satisfies Requirement);
}

function sealFor(requirement: Requirement): CriteriaApprovalSeal {
  return CriteriaApprovalSealSchema.parse({
    changeSetId: CHANGE_SET_ID,
    criteriaHashes: { [requirement.id]: requirement.criteriaHash },
  });
}

describe("computeCriteriaHash", () => {
  it("produces the repo's `sha256:`-prefixed digest convention", () => {
    expect(computeCriteriaHash(CRITERIA)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is deterministic across repeated evaluation", () => {
    expect(computeCriteriaHash(CRITERIA)).toBe(computeCriteriaHash(CRITERIA));
  });

  it("is sensitive to a single-criterion edit", () => {
    const edited = ["p95 wall-clock time under 5s on a warm cache", "No request exceeds 300s"];
    expect(computeCriteriaHash(edited)).not.toBe(computeCriteriaHash(CRITERIA));
  });

  it("is sensitive to criteria ORDER — array order is semantically meaningful", () => {
    const reordered = [...CRITERIA].reverse();
    expect(computeCriteriaHash(reordered)).not.toBe(computeCriteriaHash(CRITERIA));
  });

  it("is sensitive to an added criterion", () => {
    expect(computeCriteriaHash([...CRITERIA, "And one more"])).not.toBe(
      computeCriteriaHash(CRITERIA),
    );
  });

  it("property: any two distinct criteria lists hash differently (fast-check)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 6 }),
        fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 6 }),
        (a, b) => {
          fc.pre(JSON.stringify(a) !== JSON.stringify(b));
          return computeCriteriaHash(a) !== computeCriteriaHash(b);
        },
      ),
    );
  });
});

describe("verifyCriteriaSeal — the three failure reasons, first failure wins", () => {
  it("passes when the record is self-consistent and matches the approval seal", () => {
    const requirement = buildRequirement();
    const result = verifyCriteriaSeal(requirement, sealFor(requirement));
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.recomputedHash).toBe(requirement.criteriaHash);
  });

  it("self_consistency_mismatch — criteria edited, stale hash left behind (the naive vector)", () => {
    const requirement = buildRequirement();
    const tampered = { ...requirement, acceptanceCriteria: ["Something else entirely"] };
    const result = verifyCriteriaSeal(tampered, sealFor(requirement));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("self_consistency_mismatch");
  });

  it("no_approval_seal — fails CLOSED rather than trusting the live record", () => {
    const requirement = buildRequirement();
    const result = verifyCriteriaSeal(requirement, undefined);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no_approval_seal");
  });

  it("no_approval_seal — a seal that omits THIS requirement is not a seal for it", () => {
    const requirement = buildRequirement();
    const otherSeal = CriteriaApprovalSealSchema.parse({
      changeSetId: CHANGE_SET_ID,
      criteriaHashes: { "6c84fb90-12c4-11e1-840d-7b25c5ee775a": "sha256:" + "0".repeat(64) },
    });
    expect(verifyCriteriaSeal(requirement, otherSeal).reason).toBe("no_approval_seal");
  });

  it("approval_seal_mismatch — criteria edited AND hash consistently recomputed", () => {
    const approved = buildRequirement();
    const seal = sealFor(approved);
    const widened = ["Anything at all is acceptable"];
    const tampered = buildRequirement({
      acceptanceCriteria: widened,
      criteriaHash: computeCriteriaHash(widened),
    });
    const result = verifyCriteriaSeal(tampered, seal);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("approval_seal_mismatch");
  });

  it("self-consistency is checked BEFORE the approval seal (ordering is observable)", () => {
    const requirement = buildRequirement();
    const doublyBroken = { ...requirement, acceptanceCriteria: ["stale-hash vector"] };
    const unrelatedSeal = CriteriaApprovalSealSchema.parse({
      changeSetId: CHANGE_SET_ID,
      criteriaHashes: { [requirement.id]: "sha256:" + "1".repeat(64) },
    });
    expect(verifyCriteriaSeal(doublyBroken, unrelatedSeal).reason).toBe(
      "self_consistency_mismatch",
    );
  });

  it("exposes exactly the three canonical reasons", () => {
    expect([...CRITERIA_SEAL_FAILURE_REASONS]).toStrictEqual([
      "self_consistency_mismatch",
      "no_approval_seal",
      "approval_seal_mismatch",
    ]);
  });
});

describe("assertCriteriaSealIntact — typed, fail-closed refusal", () => {
  it("returns silently when the seal is intact", () => {
    const requirement = buildRequirement();
    expect(() => assertCriteriaSealIntact(requirement, sealFor(requirement))).not.toThrow();
  });

  it("throws CriteriaSealMismatchError carrying the reason and requirement id", () => {
    const approved = buildRequirement();
    const widened = ["Anything at all is acceptable"];
    const tampered = buildRequirement({
      acceptanceCriteria: widened,
      criteriaHash: computeCriteriaHash(widened),
    });
    try {
      assertCriteriaSealIntact(tampered, sealFor(approved));
      expect.unreachable("expected a CriteriaSealMismatchError");
    } catch (error) {
      expect(error).toBeInstanceOf(CriteriaSealMismatchError);
      const mismatch = error as CriteriaSealMismatchError;
      expect(mismatch.name).toBe("CriteriaSealMismatchError");
      expect(mismatch.reason).toBe("approval_seal_mismatch");
      expect(mismatch.requirementId).toBe(REQUIREMENT_ID);
    }
  });

  it("throws the missing-seal SUBCLASS when no seal exists, still catchable as the base", () => {
    const requirement = buildRequirement();
    try {
      assertCriteriaSealIntact(requirement, undefined);
      expect.unreachable("expected a CriteriaApprovalSealMissingError");
    } catch (error) {
      expect(error).toBeInstanceOf(CriteriaApprovalSealMissingError);
      expect(error).toBeInstanceOf(CriteriaSealMismatchError);
      expect((error as CriteriaApprovalSealMissingError).reason).toBe("no_approval_seal");
    }
  });
});

describe("CriteriaApprovalSealSchema", () => {
  it("rejects an unknown top-level key (.strict())", () => {
    const invalid = { changeSetId: CHANGE_SET_ID, criteriaHashes: {}, unexpected: "field" };
    expect(CriteriaApprovalSealSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a non-uuid requirement id as a hash key", () => {
    const invalid = {
      changeSetId: CHANGE_SET_ID,
      criteriaHashes: { "not-a-uuid": "sha256:" + "0".repeat(64) },
    };
    expect(CriteriaApprovalSealSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects an empty hash value", () => {
    const invalid = { changeSetId: CHANGE_SET_ID, criteriaHashes: { [REQUIREMENT_ID]: "" } };
    expect(CriteriaApprovalSealSchema.safeParse(invalid).success).toBe(false);
  });
});
