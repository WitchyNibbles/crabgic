import { describe, expect, it } from "vitest";
import { CONTRACT_FIXTURES } from "./fixtures/registry.js";
import {
  createContractSchemaValidator,
  validateAgainstEmittedJsonSchema,
  validateAllFixturesAgainstEmittedJsonSchemas,
} from "./ajv-harness.js";

/**
 * INTEGRATION HARNESS (roadmap/02-contracts-and-schemas.md Test plan,
 * "Integration" bullet): "every testkit fixture builder round-trips
 * through its contract's own zod schema and JSON Schema export in one
 * harness pass — the same harness 03/16/18/19/20/22 import rather than
 * re-deriving fixtures." Failing-first (TDD): written before
 * `ajv-harness.ts` exists (and before `packages/contracts/schemas/*.json`
 * is regenerated in this same session).
 */
describe("ajv integration harness", () => {
  it("validates a single fixture's default output against its emitted JSON Schema file", () => {
    const workUnitEntry = CONTRACT_FIXTURES.find((entry) => entry.kebabName === "work-unit");
    expect(workUnitEntry).toBeDefined();
    const result = validateAgainstEmittedJsonSchema(
      "work-unit",
      workUnitEntry?.build(),
      createContractSchemaValidator(),
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects an instance that violates the emitted JSON Schema (negative control)", () => {
    const result = validateAgainstEmittedJsonSchema("work-unit", { not: "a work unit" });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    // Root-level "missing required property" ajv errors carry an empty
    // `instancePath`, exercising the `"(root)"` fallback branch.
    expect(result.errors.some((message) => message.startsWith("(root)"))).toBe(true);
  });

  it("reports a non-root instancePath verbatim for a nested-property type violation", () => {
    const workUnitEntry = CONTRACT_FIXTURES.find((entry) => entry.kebabName === "work-unit");
    const valid = workUnitEntry?.build() as Record<string, unknown>;
    const result = validateAgainstEmittedJsonSchema("work-unit", { ...valid, title: 12345 });
    expect(result.valid).toBe(false);
    // A `title` type mismatch carries a non-empty `/title` instancePath,
    // exercising the non-fallback branch of the `||` in `formatAjvErrors`.
    expect(result.errors.some((message) => message.startsWith("/title"))).toBe(true);
  });

  it("validates every one of the 21 contract fixtures' default output against its own emitted schema", () => {
    const results = validateAllFixturesAgainstEmittedJsonSchemas();
    expect(results).toHaveLength(21);
    const failures = results.filter((r) => !r.valid);
    expect(failures).toEqual([]);
  });
});
