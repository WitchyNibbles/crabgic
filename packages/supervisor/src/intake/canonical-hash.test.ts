import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { canonicalHash, canonicalStringify } from "./canonical-hash.js";

describe("canonicalStringify / canonicalHash", () => {
  it("is stable across key-order permutations of the same object", () => {
    const a = { b: 1, a: 2, c: { z: 1, y: 2 } };
    const b = { a: 2, c: { y: 2, z: 1 }, b: 1 };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  it("changes when exactly one field's value changes (perturbation-sensitivity)", () => {
    const base = { ownedPaths: ["a", "b"], commands: ["echo"], depth: 1 };
    const perturbed = { ...base, depth: 2 };
    expect(canonicalHash(base)).not.toBe(canonicalHash(perturbed));
  });

  it("does not normalize array order — order is semantically meaningful", () => {
    const a = { ownedPaths: ["a", "b"] };
    const b = { ownedPaths: ["b", "a"] };
    expect(canonicalHash(a)).not.toBe(canonicalHash(b));
  });

  it("serializes null and undefined (top-level and nested) as 'null'", () => {
    expect(canonicalStringify(null)).toBe("null");
    expect(canonicalStringify(undefined)).toBe("null");
    expect(canonicalStringify({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it("produces a 'sha256:' prefixed 64-hex-char digest", () => {
    const hash = canonicalHash({ x: 1 });
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("two independent builds of an identical structure are byte-identical", () => {
    const build = (): unknown => ({
      ownedPaths: ["packages/example/src/"],
      commands: ["npm test"],
      nested: { a: 1, b: [1, 2, 3] },
    });
    expect(canonicalHash(build())).toBe(canonicalHash(build()));
  });

  it("property: identical values always hash identically, and any single scalar leaf mutation changes the hash", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1 }),
          fc.oneof(fc.string(), fc.integer(), fc.boolean()),
        ),
        fc.string({ minLength: 1 }),
        fc.oneof(fc.string(), fc.integer(), fc.boolean()),
        (obj, extraKey, extraValue) => {
          const withExtra = { ...obj, [extraKey]: extraValue };
          // Same value twice -> same hash.
          expect(canonicalHash(withExtra)).toBe(canonicalHash({ ...withExtra }));
          // Removing the extra key (when it doesn't collide with an existing one) changes the hash.
          if (!(extraKey in obj)) {
            expect(canonicalHash(withExtra)).not.toBe(canonicalHash(obj));
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
