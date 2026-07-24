import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { computeCapabilityStoreKey } from "./key.js";

describe("computeCapabilityStoreKey — property", () => {
  it("is deterministic: the same (digest, permissionFootprint) always yields the same key", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.array(fc.string()), (digest, footprint) => {
        expect(computeCapabilityStoreKey(digest, footprint)).toBe(
          computeCapabilityStoreKey(digest, footprint),
        );
      }),
      { numRuns: 50 },
    );
  });

  it("is order-independent over permissionFootprint", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.array(fc.string(), { minLength: 1 }),
        (digest, footprint) => {
          const shuffled = [...footprint].reverse();
          expect(computeCapabilityStoreKey(digest, footprint)).toBe(
            computeCapabilityStoreKey(digest, shuffled),
          );
        },
      ),
      { numRuns: 50 },
    );
  });

  it("property: mutating the digest (holding footprint fixed) always forces a different key", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        fc.array(fc.string()),
        (digestA, digestB, footprint) => {
          fc.pre(digestA !== digestB);
          expect(computeCapabilityStoreKey(digestA, footprint)).not.toBe(
            computeCapabilityStoreKey(digestB, footprint),
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it("property: changing the permission SET (not just order, holding digest fixed) always forces a different key", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.uniqueArray(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 5 }),
        (digest, footprintA) => {
          const footprintB = [...footprintA, `${footprintA[0]}-extra`];
          expect(computeCapabilityStoreKey(digest, footprintA)).not.toBe(
            computeCapabilityStoreKey(digest, footprintB),
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
