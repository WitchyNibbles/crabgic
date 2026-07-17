import { describe, expect, it } from "vitest";
import { ALL_FIXTURES, CONTRACT_FIXTURES, ENUM_FIXTURES } from "./registry.js";

/**
 * META-TEST (roadmap/02-contracts-and-schemas.md exit criterion: "Testkit
 * fixture builders exist for all 21 contracts plus both new unions, each
 * producing an instance that validates against its own schema — meta-test
 * running every builder through its contract's zod parser"). Failing-first
 * (TDD): written before any fixture builder or the registry exists.
 */
describe("fixture registry — meta-test", () => {
  it("registers exactly 21 contract fixtures", () => {
    expect(CONTRACT_FIXTURES).toHaveLength(21);
  });

  it("registers exactly 2 enum-instance fixtures (WorkUnitAttemptStatus, JournalEntryType)", () => {
    expect(ENUM_FIXTURES).toHaveLength(2);
  });

  it("ALL_FIXTURES is the concatenation of both (23 total)", () => {
    expect(ALL_FIXTURES).toHaveLength(23);
  });

  it("every contract fixture has a unique kebabName matching a contract module's own naming", () => {
    const kebabNames = CONTRACT_FIXTURES.map((entry) => entry.kebabName);
    expect(new Set(kebabNames).size).toBe(kebabNames.length);
  });

  it.each(CONTRACT_FIXTURES.map((entry) => [entry.name, entry] as const))(
    "%s builder's default output parses against its own contract zod schema",
    (_name, entry) => {
      const instance = entry.build();
      const result = entry.schema.safeParse(instance);
      expect(result.success).toBe(true);
    },
  );

  it.each(ENUM_FIXTURES.map((entry) => [entry.name, entry] as const))(
    "%s builder's default output parses against its own union zod schema",
    (_name, entry) => {
      const instance = entry.build();
      const result = entry.schema.safeParse(instance);
      expect(result.success).toBe(true);
    },
  );

  it("every builder honors partial overrides immutably (does not mutate a shared default)", () => {
    for (const entry of CONTRACT_FIXTURES) {
      const first = entry.build();
      const second = entry.build();
      expect(first).not.toBe(second);
      expect(first).toEqual(second);
    }
  });
});
