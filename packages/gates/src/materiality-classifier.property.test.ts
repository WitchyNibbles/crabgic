import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  classifyMateriality,
  MATERIAL_TRACKED_FIELDS,
  type FieldDiff,
} from "./materiality-classifier.js";

/**
 * roadmap/21 §Test plan, Property: "materiality classifier: fast-check
 * property over randomized field-level diffs — any diff touching summary/
 * description/acceptance-criteria fields classifies material = true;
 * diffs touching only non-tracked fields classify material = false,
 * holding across the generated space."
 */

const NON_TRACKED_FIELDS = [
  "watchers",
  "labels",
  "assignee",
  "reporter",
  "priority",
  "components",
  "fix-version",
  "sprint",
] as const;

const FIELD_UNIVERSE = [...MATERIAL_TRACKED_FIELDS, ...NON_TRACKED_FIELDS] as const;

const diffArb: fc.Arbitrary<FieldDiff> = fc
  .record({
    field: fc.constantFrom(...FIELD_UNIVERSE),
    before: fc.string({ minLength: 0, maxLength: 20 }),
    afterSuffix: fc.string({ minLength: 1, maxLength: 20 }),
  })
  .map(({ field, before, afterSuffix }) => ({ field, before, after: `${before}${afterSuffix}` }));

describe("classifyMateriality — property: material iff at least one CHANGED diff touches a tracked field", () => {
  it("holds across the generated diff-set space", () => {
    fc.assert(
      fc.property(fc.array(diffArb, { minLength: 0, maxLength: 12 }), (diffs) => {
        const result = classifyMateriality(diffs);
        const expectedMaterial = diffs.some(
          (d) =>
            d.before !== d.after &&
            (MATERIAL_TRACKED_FIELDS as readonly string[]).includes(d.field),
        );
        expect(result.material).toBe(expectedMaterial);
        // Every reported materialField must actually be a tracked field that changed.
        for (const field of result.materialFields) {
          expect(MATERIAL_TRACKED_FIELDS as readonly string[]).toContain(field);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("a diff set drawn ONLY from non-tracked fields is never material, across the generated space", () => {
    const nonTrackedDiffArb: fc.Arbitrary<FieldDiff> = fc
      .record({
        field: fc.constantFrom(...NON_TRACKED_FIELDS),
        before: fc.string(),
        afterSuffix: fc.string({ minLength: 1 }),
      })
      .map(({ field, before, afterSuffix }) => ({
        field,
        before,
        after: `${before}${afterSuffix}`,
      }));

    fc.assert(
      fc.property(fc.array(nonTrackedDiffArb, { minLength: 0, maxLength: 12 }), (diffs) => {
        expect(classifyMateriality(diffs).material).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});
