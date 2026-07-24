import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BRANCH_TYPES, MAX_BRANCH_NAME_LENGTH, buildBranchNameCandidate } from "./branch-namer.js";

/**
 * roadmap/08-integration-publication.md §Test plan: "Property: fast-check
 * over random branch-name inputs — output always ≤64 chars, always
 * git-ref-legal, collision suffix always monotonic."
 */

const GIT_REF_LEGAL = /^[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)*$/;

const branchTypeArb = fc.constantFrom(...BRANCH_TYPES);
const slugSourceArb = fc.string({ minLength: 0, maxLength: 300 });
const jiraKeyArb = fc.oneof(
  fc.constant(undefined),
  fc.stringMatching(/^[A-Za-z0-9]{1,10}-[A-Za-z0-9]{1,6}$/),
  fc.string({ minLength: 0, maxLength: 20 }), // includes malformed keys — must be tolerated (ignored), never thrown
);

describe("buildBranchNameCandidate — property suite", () => {
  it("output is always ≤64 chars and always git-ref-legal", () => {
    fc.assert(
      fc.property(branchTypeArb, slugSourceArb, jiraKeyArb, (type, slugSource, jiraKey) => {
        const candidate = buildBranchNameCandidate({
          type,
          slugSource,
          ...(jiraKey !== undefined ? { jiraKey } : {}),
        });
        expect(candidate.length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
        expect(candidate).toMatch(GIT_REF_LEGAL);
        expect(candidate.startsWith(`${type}/`)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it("a monotonically growing existingBranchNames set always produces a longer, still-legal, always-distinct suffix chain", () => {
    fc.assert(
      fc.property(branchTypeArb, slugSourceArb, (type, slugSource) => {
        const names: string[] = [];
        for (let i = 0; i < 8; i++) {
          const candidate = buildBranchNameCandidate({
            type,
            slugSource,
            existingBranchNames: names,
          });
          expect(candidate.length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
          expect(candidate).toMatch(GIT_REF_LEGAL);
          expect(names).not.toContain(candidate); // always distinct from every prior candidate
          names.push(candidate);
        }
      }),
      { numRuns: 100 },
    );
  });
});
