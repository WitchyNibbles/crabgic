import { posix } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { analyzeOverlap, type PlannedWriteSet, type RenamePair } from "./overlap-analyzer.js";

/**
 * WI7 Property test — roadmap/07-git-control-repo-worktrees.md Test plan:
 * "rename-aware overlap analyzer over random path-set pairs with injected
 * renames — never misses a true collision, never flags a disjoint pair."
 * ≥1000 fast-check cases, each checked against an independent reference
 * model computed directly in the test (not the module under test).
 *
 * MAJOR 3 fix (2026-07-18 adversarial validation round): the ORIGINAL
 * reference model here shared the exact-equality flaw the module under
 * test had (both compared raw, unnormalized strings), and `pathArb` only
 * ever generated already-canonical single-char paths — so this suite
 * structurally could not catch a spelling-equivalent false negative
 * (`./a` vs `a`, `a/` vs `a`, `a//b` vs `a/b`). Fixed on BOTH ends:
 * `normalizeReference` below is a SEPARATELY-AUTHORED normalizer (built on
 * `node:path`'s own `posix.normalize`, not a copy of
 * `overlap-analyzer.ts`'s hand-rolled segment filter — genuinely
 * independent logic, not just a separate function name), and `pathArb` now
 * draws from several equivalent spellings of the same canonical letter.
 */

const CANONICAL_LETTERS = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

// Every variant below canonicalizes to the SAME bare letter (verified by the
// "MAJOR 3 fix" property test below, which cross-checks arbitrary variant
// PAIRS of the identical letter) — the doubled-internal-slash case
// (`a//b` vs `a/b`, a genuinely different two-segment path) is instead
// covered by an explicit fixture in `./overlap-analyzer.test.ts`.
type SpellingVariant = (letter: string) => string;
const SPELLING_VARIANTS: readonly SpellingVariant[] = [
  (l) => l,
  (l) => `./${l}`,
  (l) => `${l}/`,
  (l) => `./${l}/`,
  (l) => `${l}/.`,
  (l) => `././${l}`,
];

const pathArb: fc.Arbitrary<string> = fc
  .tuple(fc.constantFrom(...CANONICAL_LETTERS), fc.constantFrom(...SPELLING_VARIANTS))
  .map(([letter, spell]) => spell(letter));

/**
 * Independent reference normalizer — uses node's own `posix.normalize`
 * (collapsing `.` segments and `//`) plus a manual trailing-slash strip,
 * deliberately a DIFFERENT mechanism from `overlap-analyzer.ts`'s own
 * hand-rolled segment-filter normalizer, so this property suite never
 * silently validates the module under test against itself.
 */
function normalizeReference(rawPath: string): string {
  const normalized = posix.normalize(rawPath);
  if (normalized === ".") return "";
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function effectiveTouched(set: PlannedWriteSet): Set<string> {
  const touched = new Set<string>();
  for (const p of set.paths) touched.add(normalizeReference(p));
  for (const r of set.renames ?? []) {
    touched.add(normalizeReference(r.from));
    touched.add(normalizeReference(r.to));
  }
  return touched;
}

const plannedWriteSetArb: fc.Arbitrary<PlannedWriteSet> = fc
  .record({
    unitId: fc.uuid(),
    paths: fc.array(pathArb, { minLength: 0, maxLength: 4 }),
    renames: fc.array(fc.record({ from: pathArb, to: pathArb }) as fc.Arbitrary<RenamePair>, {
      minLength: 0,
      maxLength: 2,
    }),
  })
  .map((r) => ({ unitId: r.unitId, paths: [...new Set(r.paths)], renames: r.renames }));

describe("analyzeOverlap — property: correctness against an independent reference model (WI7)", () => {
  it("collides === (touched sets intersect), for every random pair, ≥1000 cases", () => {
    fc.assert(
      fc.property(plannedWriteSetArb, plannedWriteSetArb, (setA, setB) => {
        const verdicts = analyzeOverlap([setA, setB]);
        expect(verdicts).toHaveLength(1);
        const verdict = verdicts[0]!;

        const touchedA = effectiveTouched(setA);
        const touchedB = effectiveTouched(setB);
        const expectedCollidingPaths = [...touchedA].filter((p) => touchedB.has(p)).sort();
        const expectedCollides = expectedCollidingPaths.length > 0;

        expect(verdict.collides).toBe(expectedCollides);
        expect([...verdict.collidingPaths].sort()).toEqual(expectedCollidingPaths);
      }),
      { numRuns: 1000 },
    );
  });

  it("never misses a true collision: a shared path (possibly only via a rename) is ALWAYS flagged", () => {
    fc.assert(
      fc.property(plannedWriteSetArb, plannedWriteSetArb, pathArb, (setA, setB, sharedPath) => {
        const forcedA: PlannedWriteSet = { ...setA, paths: [...setA.paths, sharedPath] };
        const forcedB: PlannedWriteSet = { ...setB, paths: [...setB.paths, sharedPath] };
        const verdicts = analyzeOverlap([forcedA, forcedB]);
        expect(verdicts[0]!.collides).toBe(true);
        expect(verdicts[0]!.collidingPaths).toContain(normalizeReference(sharedPath));
      }),
      { numRuns: 1000 },
    );
  });

  it("MAJOR 3 fix: never misses a collision even when the two units spell the SAME canonical path differently", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.constantFrom(...CANONICAL_LETTERS),
        fc.constantFrom(...SPELLING_VARIANTS),
        fc.constantFrom(...SPELLING_VARIANTS),
        (unitA, unitB, letter, spellA, spellB) => {
          const verdicts = analyzeOverlap([
            { unitId: unitA, paths: [spellA(letter)] },
            { unitId: unitB, paths: [spellB(letter)] },
          ]);
          expect(verdicts[0]!.collides).toBe(true);
          expect(verdicts[0]!.collidingPaths).toEqual([normalizeReference(letter)]);
        },
      ),
      { numRuns: 1000 },
    );
  });

  function pathArbForLetters(letters: readonly string[]): fc.Arbitrary<string> {
    return fc
      .tuple(fc.constantFrom(...letters), fc.constantFrom(...SPELLING_VARIANTS))
      .map(([letter, spell]) => spell(letter));
  }

  it("never flags a genuinely disjoint pair (touched sets share nothing), including spelling-variant paths", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.array(pathArbForLetters(["a", "b", "c", "d"]), { maxLength: 3 }),
        fc.array(pathArbForLetters(["e", "f", "g", "h"]), { maxLength: 3 }),
        (unitA, unitB, pathsA, pathsB) => {
          const verdicts = analyzeOverlap([
            { unitId: unitA, paths: pathsA },
            { unitId: unitB, paths: pathsB },
          ]);
          expect(verdicts[0]!.collides).toBe(false);
          expect(verdicts[0]!.collidingPaths).toEqual([]);
        },
      ),
      { numRuns: 1000 },
    );
  });
});
