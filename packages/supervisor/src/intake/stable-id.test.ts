import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { IdSchema } from "@eo/contracts";
import { deriveStableId } from "./stable-id.js";

describe("deriveStableId", () => {
  it("is deterministic: the same seed always derives the same id", () => {
    expect(deriveStableId("scope:Add login")).toBe(deriveStableId("scope:Add login"));
  });

  it("derives an IdSchema-valid (RFC-4122-shaped) UUID", () => {
    expect(IdSchema.safeParse(deriveStableId("scope:Add login")).success).toBe(true);
  });

  it("different seeds derive different ids (collision resistance, property)", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), (a, b) => {
        if (a !== b) {
          expect(deriveStableId(a)).not.toBe(deriveStableId(b));
        }
      }),
      { numRuns: 300 },
    );
  });
});
