/**
 * roadmap/25-owner-pipeline-conformance.md §Exit criteria, first box:
 * "`DOMAIN_LENSES` enumerates all eight lenses; `lensesApplicableTo` is
 * **property-tested**; a skipped lens is recorded with its reason (unit +
 * property tests)."
 *
 * ⚠️ WHY THIS FILE EXISTS SEPARATELY FROM `domain-lenses.test.ts`. That file
 * already asserts the partition, the reasons and the disjointness — but every
 * one of those assertions runs against a FIXTURE: `EMPTY_STACK`, or one
 * hand-written finding chosen to exercise the branch under discussion. A
 * partition that holds on the four stacks someone thought to write down is not
 * the claim the criterion makes; the criterion says the partition holds for
 * whatever stack the detector produces, and only a generator can say that.
 *
 * The distinction is not academic here. `lensesApplicableTo` walks the roster
 * once and pushes each lens into exactly one of two arrays, so the property is
 * structurally true TODAY — which is precisely when it is cheap to pin. The
 * failure it guards is the future edit that adds a `continue`, an early return
 * on a contradictory stack, or a lens whose predicate throws: each would leave
 * a lens in neither partition, and each would leave every fixture test green
 * because no fixture reaches it.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DOMAIN_LENSES, lensesApplicableTo } from "./domain-lenses.js";
import { STACK_EVIDENCE_CATEGORIES } from "./stack-evidence.js";
import type { StackEvidence } from "./stack-evidence.js";

/**
 * Findings are generated over the REAL category enum and a deliberately wide
 * ecosystem alphabet — the ecosystems the shipped predicates match on, plus
 * strings that match nothing. Generating only the matching ecosystems would
 * make the "everything applies" branch overwhelmingly likely and never
 * exercise a skip; generating only junk would never exercise an application.
 */
const findingArb = fc.record({
  category: fc.constantFrom(...STACK_EVIDENCE_CATEGORIES),
  ecosystem: fc.oneof(
    fc.constantFrom("node", "react", "vue", "python", "go", "rust", "docker", "terraform"),
    fc.string({ minLength: 1, maxLength: 12 }),
  ),
  detail: fc.string({ minLength: 1, maxLength: 20 }),
  path: fc.string({ minLength: 1, maxLength: 20 }),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
});

const stackArb: fc.Arbitrary<StackEvidence> = fc.array(findingArb, { maxLength: 12 }).map(
  (findings) =>
    ({
      schemaVersion: 1,
      id: "stack-property",
      createdAt: "2026-08-18T00:00:00.000Z",
      findings,
      contradictions: [],
      unresolvedAmbiguity: [],
    }) as StackEvidence,
);

describe("lensesApplicableTo, over arbitrary stack evidence", () => {
  /**
   * The load-bearing one. `docs/design/owner-pipeline-conformance.md` §5.2
   * makes the roster DATA so that "we ran five of the six lenses" and "we ran
   * all six" cannot look identical from outside. That guarantee is this
   * equation, and it has to hold for every stack, not for the empty one.
   */
  it("partitions the roster exactly: applicable + skipped = every lens, each once", () => {
    fc.assert(
      fc.property(stackArb, (stack) => {
        const verdict = lensesApplicableTo(stack);
        const seen = [
          ...verdict.applicable.map((lens) => lens.id),
          ...verdict.skipped.map((skip) => skip.lens),
        ];
        expect(seen).toHaveLength(DOMAIN_LENSES.length);
        expect(new Set(seen).size).toBe(DOMAIN_LENSES.length);
        expect([...seen].sort()).toStrictEqual([...DOMAIN_LENSES.map((l) => l.id)].sort());
      }),
    );
  });

  /**
   * A skip with no reason is a lens that silently did not run, which is the
   * failure the roster is data to prevent. The fixture version of this asserts
   * `length > 10` on the empty stack only — where every skip comes from the
   * same branch.
   */
  it("gives every skipped lens a non-trivial reason, whatever the stack", () => {
    fc.assert(
      fc.property(stackArb, (stack) => {
        for (const skipped of lensesApplicableTo(stack).skipped) {
          expect(skipped.reason.trim().length).toBeGreaterThan(10);
        }
      }),
    );
  });

  /**
   * The four unconditional lenses are the floor: a repository with no detected
   * evidence at all — a brand-new one — still gets reviewed. Stated as a
   * property because the risk is a predicate edit that makes "always" depend on
   * something, and such an edit reddens nothing that only tests the empty stack.
   */
  it("never skips a lens whose predicate is `always`", () => {
    const unconditional = DOMAIN_LENSES.filter((lens) => lens.appliesWhen.kind === "always").map(
      (lens) => lens.id,
    );
    expect(unconditional.length).toBeGreaterThan(0); // the property is vacuous if the roster has none
    fc.assert(
      fc.property(stackArb, (stack) => {
        const skipped = lensesApplicableTo(stack).skipped.map((skip) => skip.lens);
        for (const id of unconditional) expect(skipped).not.toContain(id);
      }),
    );
  });

  /**
   * ⚠️ THE ANTI-VACUITY ARM, and the reason the ecosystem alphabet above mixes
   * real names with junk. Every property here would also hold of a function
   * that returned all eight lenses as applicable and skipped none — which is a
   * broken function. This one fails against that implementation: it asserts the
   * generator actually reaches BOTH branches across a run, so the three
   * properties above are known to have been tested against real skips.
   */
  it("reaches both branches — some generated stack skips a lens, and some applies a conditional one", () => {
    const conditional = DOMAIN_LENSES.filter((lens) => lens.appliesWhen.kind !== "always").map(
      (lens) => lens.id,
    );
    let sawSkip = false;
    let sawConditionalApplied = false;
    fc.assert(
      fc.property(stackArb, (stack) => {
        const verdict = lensesApplicableTo(stack);
        if (verdict.skipped.length > 0) sawSkip = true;
        if (verdict.applicable.some((lens) => conditional.includes(lens.id)))
          sawConditionalApplied = true;
        return true;
      }),
    );
    expect(sawSkip, "no generated stack ever skipped a lens").toBe(true);
    expect(sawConditionalApplied, "no generated stack ever applied a conditional lens").toBe(true);
  });
});
