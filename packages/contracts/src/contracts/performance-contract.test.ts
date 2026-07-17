import { describe, expect, it } from "vitest";
import { PerformanceContractSchema } from "./performance-contract.js";

const provisionalBudgetEntry = {
  metric: "latency",
  percentile: 95,
  threshold: 200,
  unit: "ms",
  riskCategory: "networking",
};

const provisionalContract = {
  schemaVersion: 1,
  id: "8f14e45f-ceea-467e-b4d3-8b5f8f5f8f5f",
  changeSetId: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  createdAt: "2026-07-15T12:00:00.000Z",
  budgetSource: "requirement_acceptance_criteria",
  variant: "provisional",
  budgets: [provisionalBudgetEntry],
  budgetHash: "sha256:provisional-aaa",
};

const enforcedContract = {
  schemaVersion: 1,
  id: "6c84fb90-12c4-11e1-840d-7b25c5ee775a",
  changeSetId: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  createdAt: "2026-07-15T13:00:00.000Z",
  budgetSource: "requirement_acceptance_criteria",
  variant: "enforced",
  budgets: [{ ...provisionalBudgetEntry, measuredValue: 187.4 }],
  budgetHash: "sha256:provisional-aaa",
  provisionalBudgetHash: "sha256:provisional-aaa",
  outcome: "pass",
};

describe("PerformanceContractSchema — valid fixtures", () => {
  it("parses a fully-valid provisional fixture (roadmap/15 §Interfaces produced)", () => {
    expect(PerformanceContractSchema.safeParse(provisionalContract).success).toBe(true);
  });

  it("parses a fully-valid enforced fixture (roadmap/15 §Interfaces produced, 'enforced variant')", () => {
    expect(PerformanceContractSchema.safeParse(enforcedContract).success).toBe(true);
  });
});

describe("PerformanceContractSchema — discriminated-union branch coverage", () => {
  it.each([
    ["provisional", provisionalContract],
    ["enforced", enforcedContract],
  ] as const)("accepts the %s variant", (_variant, fixture) => {
    expect(PerformanceContractSchema.safeParse(fixture).success).toBe(true);
  });

  it.each(["pass", "block", "inconclusive_blocking"] as const)(
    "accepts every declared enforced outcome: %s",
    (outcome) => {
      const fixture = { ...enforcedContract, outcome };
      expect(PerformanceContractSchema.safeParse(fixture).success).toBe(true);
    },
  );
});

describe("PerformanceContractSchema — invalid-shape rejection", () => {
  it("rejects an enforced contract missing `outcome`", () => {
    const { outcome: _outcome, ...broken } = enforcedContract;
    expect(PerformanceContractSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects an enforced contract missing `provisionalBudgetHash` (hash-link check, roadmap/15:23)", () => {
    const { provisionalBudgetHash: _provisionalBudgetHash, ...broken } = enforcedContract;
    expect(PerformanceContractSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a budgetSource outside the closed 3-source union", () => {
    const invalid = { ...provisionalContract, budgetSource: "guesswork" };
    expect(PerformanceContractSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a percentile outside [1, 99]", () => {
    const invalid = {
      ...provisionalContract,
      budgets: [{ ...provisionalBudgetEntry, percentile: 100 }],
    };
    expect(PerformanceContractSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a variant discriminant outside provisional|enforced", () => {
    const invalid = { ...provisionalContract, variant: "final" };
    expect(PerformanceContractSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("PerformanceContractSchema — unknown-key rejection (.strict())", () => {
  it("rejects a provisional contract carrying an enforced-only `measuredValue` budget field", () => {
    const invalid = {
      ...provisionalContract,
      budgets: [{ ...provisionalBudgetEntry, measuredValue: 10 }],
    };
    expect(PerformanceContractSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects an unknown top-level key", () => {
    const invalid = { ...provisionalContract, unexpected: "field" };
    expect(PerformanceContractSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("PerformanceContractSchema — round-trip", () => {
  it("provisional: parse -> JSON.stringify -> JSON.parse -> parse yields a deep-equal output", () => {
    const first = PerformanceContractSchema.parse(provisionalContract);
    const roundTripped = PerformanceContractSchema.parse(JSON.parse(JSON.stringify(first)));
    expect(roundTripped).toStrictEqual(first);
  });

  it("enforced: parse -> JSON.stringify -> JSON.parse -> parse yields a deep-equal output", () => {
    const first = PerformanceContractSchema.parse(enforcedContract);
    const roundTripped = PerformanceContractSchema.parse(JSON.parse(JSON.stringify(first)));
    expect(roundTripped).toStrictEqual(first);
  });
});
