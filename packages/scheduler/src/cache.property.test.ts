import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SchedulerCache } from "./cache.js";

/**
 * Exit criterion #5 — roadmap/13-scheduler-packets-context.md: "Cache hit
 * path byte-identical to cold path; poisoning/partial-match property tests
 * green." §Test plan, Property: "random content/fingerprint pairs — cache
 * hit iff both match exactly, no partial-match false positive." §Test
 * plan, Security: "cache-poisoning resistance — an entry keyed to one
 * toolchain fingerprint is never served to a dispatch declaring a
 * different one."
 */
const hashArb = fc.string({ minLength: 1, maxLength: 12 });
const fingerprintArb = fc.string({ minLength: 1, maxLength: 12 });

describe("SchedulerCache — property: hit iff BOTH contentHash and toolchainFingerprint match exactly", () => {
  it("holds over random (write, read) key pairs — no partial-match false positive", () => {
    fc.assert(
      fc.property(
        hashArb,
        fingerprintArb,
        hashArb,
        fingerprintArb,
        fc.string(),
        (writeHash, writeFingerprint, readHash, readFingerprint, value) => {
          const cache = new SchedulerCache<string>();
          cache.set({ contentHash: writeHash, toolchainFingerprint: writeFingerprint }, value);

          const result = cache.get({
            contentHash: readHash,
            toolchainFingerprint: readFingerprint,
          });
          const exactMatch = writeHash === readHash && writeFingerprint === readFingerprint;

          if (exactMatch) {
            expect(result).toBe(value);
          } else {
            // Poisoning resistance: ANY partial match (same hash, different
            // fingerprint; same fingerprint, different hash) is a MISS,
            // never a served value from the mismatched entry.
            expect(result).toBeUndefined();
          }
        },
      ),
      { numRuns: 3000 },
    );
  });

  it("an entry keyed to one fingerprint is NEVER served to a dispatch declaring a different one, even with an identical contentHash and many co-resident entries", () => {
    fc.assert(
      fc.property(
        hashArb,
        fc.uniqueArray(fingerprintArb, { minLength: 2, maxLength: 6 }),
        (sharedHash, fingerprints) => {
          const cache = new SchedulerCache<string>();
          for (const fp of fingerprints) {
            cache.set({ contentHash: sharedHash, toolchainFingerprint: fp }, `value-for-${fp}`);
          }
          for (const fp of fingerprints) {
            expect(cache.get({ contentHash: sharedHash, toolchainFingerprint: fp })).toBe(
              `value-for-${fp}`,
            );
          }
        },
      ),
      { numRuns: 1000 },
    );
  });

  /**
   * MINOR-2 fix (adversarial-validation round): the two suites above use
   * INDEPENDENTLY random `hashArb`/`fingerprintArb` strings for both the
   * write and read side — a boundary-shift collision (two DIFFERENT
   * `(contentHash, toolchainFingerprint)` pairs whose naive join produces
   * the IDENTICAL composite string, e.g. `("a", "b::c")` vs `("a::b",
   * "c")` under a bare `::`-join) requires exact structural alignment
   * between the two pairs — vanishingly unlikely for two independently
   * drawn ≤12-char random strings to ever construct by chance, so the
   * suites above never actually exercised this failure class (the real
   * bug this fix addresses shipped past both of them). This suite instead
   * CONSTRUCTS the boundary-shift pair by design: `prefix` / `prefix + mid`
   * as the two `contentHash`es and `mid + suffix` / `suffix` as the two
   * `toolchainFingerprint`s — both pairs share the identical flat
   * concatenation `prefix + mid + suffix`, which is exactly the shape any
   * ambiguous separator-based join scheme could collapse to one key.
   */
  it("boundary-shift adversarial pairs sharing an identical flat concatenation NEVER collide, for any join scheme (would have caught the original ':: '-join bug)", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 12 }),
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.string({ maxLength: 12 }),
        fc.string(),
        (prefix, mid, suffix, value) => {
          const cache = new SchedulerCache<string>();
          // Split point A.
          cache.set({ contentHash: prefix, toolchainFingerprint: mid + suffix }, value);
          // Split point B — a DIFFERENT pair (mid has length >= 1, so
          // `prefix !== prefix + mid`), but the same flat concatenation.
          const resultAtSplitB = cache.get({
            contentHash: prefix + mid,
            toolchainFingerprint: suffix,
          });
          expect(resultAtSplitB).toBeUndefined();
          // The genuinely-written pair still hits correctly.
          expect(cache.get({ contentHash: prefix, toolchainFingerprint: mid + suffix })).toBe(
            value,
          );
        },
      ),
      { numRuns: 3000 },
    );
  });

  it("the exact reported counterexample class — (hash:'a', fp:'b::c') vs (hash:'a::b', fp:'c') — never collides", () => {
    const cache = new SchedulerCache<string>();
    cache.set({ contentHash: "a", toolchainFingerprint: "b::c" }, "value-for-a-b-colon-colon-c");
    expect(cache.get({ contentHash: "a::b", toolchainFingerprint: "c" })).toBeUndefined();
  });
});
