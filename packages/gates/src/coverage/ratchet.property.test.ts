import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createTestJournal } from "../test-support/test-journal.js";
import { getCoverageRatchetFloor, recordCoverageObservation } from "./ratchet-store.js";

/**
 * roadmap/14 §Test plan, "Property": "fast-check over randomized
 * coverage-history sequences — the ratchet floor is monotonic
 * non-decreasing regardless of insertion order."
 */

const observationArb = fc.record({
  linePct: fc.float({ min: 0, max: 100, noNaN: true }),
  branchPct: fc.float({ min: 0, max: 100, noNaN: true }),
});

const PROJECT_ID = "property-test-project";

describe("coverage ratchet — property: final floor is order-independent (componentwise max of the whole history)", () => {
  it("for any permutation of the same observation sequence, the final floor is identical", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(observationArb, { minLength: 1, maxLength: 15 }),
        async (observations) => {
          async function replay(order: readonly (typeof observations)[number][]) {
            const tj = await createTestJournal();
            try {
              for (const obs of order) {
                await recordCoverageObservation(tj.store, PROJECT_ID, obs);
              }
              return await getCoverageRatchetFloor(tj.store, PROJECT_ID);
            } finally {
              await tj.cleanup();
            }
          }

          const expectedLine = Math.max(...observations.map((o) => o.linePct));
          const expectedBranch = Math.max(...observations.map((o) => o.branchPct));

          const forward = await replay(observations);
          const reversed = await replay([...observations].reverse());
          const shuffled = await replay(
            [...observations].sort(() => Math.random() - 0.5),
          );

          for (const floor of [forward, reversed, shuffled]) {
            expect(floor?.linePct).toBeCloseTo(expectedLine, 5);
            expect(floor?.branchPct).toBeCloseTo(expectedBranch, 5);
          }
        },
      ),
      { numRuns: 40 },
    );
  });

  it("the floor never decreases across a monotonically-applied random sequence (also checked incrementally)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(observationArb, { minLength: 2, maxLength: 20 }),
        async (observations) => {
          const tj = await createTestJournal();
          try {
            let priorFloor: { linePct: number; branchPct: number } | undefined;
            for (const obs of observations) {
              const result = await recordCoverageObservation(tj.store, PROJECT_ID, obs);
              if (priorFloor !== undefined) {
                expect(result.floorAfter.linePct).toBeGreaterThanOrEqual(priorFloor.linePct);
                expect(result.floorAfter.branchPct).toBeGreaterThanOrEqual(priorFloor.branchPct);
              }
              priorFloor = result.floorAfter;
            }
          } finally {
            await tj.cleanup();
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  it("property (MINOR-3): two projects' interleaved histories on the SAME journal never contaminate each other's final floor", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(observationArb, { minLength: 1, maxLength: 10 }),
        fc.array(observationArb, { minLength: 1, maxLength: 10 }),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 40 }),
        async (projectAObservations, projectBObservations, interleavingBits) => {
          const tj = await createTestJournal();
          try {
            let ai = 0;
            let bi = 0;
            for (const useA of interleavingBits) {
              if (useA && ai < projectAObservations.length) {
                await recordCoverageObservation(tj.store, "project-a", projectAObservations[ai]!);
                ai += 1;
              } else if (bi < projectBObservations.length) {
                await recordCoverageObservation(tj.store, "project-b", projectBObservations[bi]!);
                bi += 1;
              }
            }
            // Drain whatever wasn't reached by the interleaving-bit budget.
            for (; ai < projectAObservations.length; ai += 1) {
              await recordCoverageObservation(tj.store, "project-a", projectAObservations[ai]!);
            }
            for (; bi < projectBObservations.length; bi += 1) {
              await recordCoverageObservation(tj.store, "project-b", projectBObservations[bi]!);
            }

            const floorA = await getCoverageRatchetFloor(tj.store, "project-a");
            const floorB = await getCoverageRatchetFloor(tj.store, "project-b");
            expect(floorA?.linePct).toBeCloseTo(
              Math.max(...projectAObservations.map((o) => o.linePct)),
              5,
            );
            expect(floorB?.linePct).toBeCloseTo(
              Math.max(...projectBObservations.map((o) => o.linePct)),
              5,
            );
          } finally {
            await tj.cleanup();
          }
        },
      ),
      { numRuns: 25 },
    );
  });
});
