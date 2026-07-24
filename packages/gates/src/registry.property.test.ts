import { randomUUID } from "node:crypto";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestJournal, type TestJournal } from "./test-support/test-journal.js";
import { createGateRegistry } from "./registry.js";
import { GATE_RISK_TAGS, type GateRiskTag } from "./risk-tags.js";
import type { GateContext } from "./types.js";

/**
 * roadmap/14 §Test plan, "Property": "fast-check over randomized
 * gate-registration order — dispatch is tag-keyed, never order-dependent."
 */

let tj: TestJournal;

beforeEach(async () => {
  tj = await createTestJournal();
});

afterEach(async () => {
  await tj.cleanup();
});

const tagArb = fc.constantFrom(...GATE_RISK_TAGS);
let nameCounter = 0;
const gateSpecArb = fc.record({
  tag: tagArb,
  name: fc.string({ minLength: 1, maxLength: 8 }).map((s) => {
    nameCounter += 1;
    return `${s}-${String(nameCounter)}`;
  }),
});

describe("GateRegistry — property: registration order never affects fireByTag's result SET for a given tag", () => {
  it("for any permutation of the same registration list, fireByTag(tag) returns the identical set of names", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(gateSpecArb, { minLength: 1, maxLength: 12, selector: (g) => g.name }),
        fc.constantFrom(...GATE_RISK_TAGS),
        async (specs, queryTag) => {
          const expectedNames = specs
            .filter((s) => s.tag === queryTag)
            .map((s) => s.name)
            .sort();

          async function buildAndFire(order: readonly (typeof specs)[number][]): Promise<string[]> {
            const registry = createGateRegistry();
            for (const spec of order) {
              registry.register(spec.tag as GateRiskTag, spec.name, async () => ({
                passed: true,
                command: "prop-stub",
                exitStatus: 0,
                toolchainFingerprint: "prop@1",
                artifactDigests: [],
                detail: "ok",
              }));
            }
            const context: GateContext = {
              stage: "verifying",
              changeSetId: randomUUID(),
              objectId: "prop-obj",
              journal: tj.store,
            };
            const results = await registry.fireByTag(queryTag, context);
            return results.map((r) => r.name).sort();
          }

          const forward = await buildAndFire(specs);
          const reversed = await buildAndFire([...specs].reverse());

          expect(forward).toEqual(expectedNames);
          expect(reversed).toEqual(expectedNames);
        },
      ),
      { numRuns: 100 },
    );
  });
});
