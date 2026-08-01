import { randomUUID } from "node:crypto";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, type EvidenceRecord } from "@crabgic/contracts";
import type { ReleaseGateChecklistItemSpec } from "./checklist.js";
import { generateReleaseGateReport } from "./generator.js";
import { createTestJournal, type TestJournal } from "./test-support/test-journal.js";

/**
 * roadmap/23-release-hardening.md §Test plan, "Property": "fast-check over
 * random checklist/evidence-set combinations — the generator NEVER reports
 * PASS when any required linked EvidenceRecord is absent; the report is
 * idempotent (re-running against the same journal segment yields the same
 * verdict)."
 *
 * One real `@crabgic/journal` `JournalStore` is shared across every `fc.assert`
 * iteration (constructing a fresh temp-dir store per iteration was measured
 * at only ~26% faster, and pays for it with 150 extra mkdtemp + recursive-rm
 * pairs — filesystem *metadata* churn, which is the wrong thing to add when
 * the failure mode being fixed is contention during a parallel full-suite
 * run); each iteration instead uses its OWN freshly-generated
 * `randomUUID()` release-candidate object ID, which fully isolates one
 * iteration's journaled evidence from every other iteration's — the
 * generator only ever matches evidence whose `objectId` equals the exact
 * candidate id passed in for that run.
 *
 * `skipFsync: true`: between them these two properties journal ~1600
 * `EvidenceRecord`s, every one of them mere SETUP for the assertions below,
 * and each one costing two fsyncs on the real durable append path. Measured
 * for the first property alone (150 cases, 984 appends, no coverage): 4287ms
 * with fsync vs 1820ms without — 85% of its wall time was fsync, and fsync
 * is precisely the operation that degrades worst when ~20 suites run
 * concurrently, which is how this file came to sit at 18.5s against a 20s
 * timeout. Nothing this file asserts depends on crash durability; the
 * fsync-ordering contract is owned and proven by `@crabgic/journal`'s own
 * kill-harness suite. See `./test-support/test-journal.js` for exactly what
 * stays real (all of it, bar the two syscalls).
 */

let tj: TestJournal;

beforeEach(async () => {
  tj = await createTestJournal({ skipFsync: true });
});

afterEach(async () => {
  await tj.cleanup();
});

function fixtureRecord(objectId: string, gateTag: string, exitStatus: number): EvidenceRecord {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: randomUUID(),
    changeSetId: randomUUID(),
    command: "prop-fixture",
    exitStatus,
    toolchainFingerprint: "prop-toolchain@1",
    capturedAt: new Date().toISOString(),
    artifactDigests: ["sha256:" + "c".repeat(64)],
    objectId,
    gateTag,
  };
}

/** N synthetic checklist items, each with its own unique dedicated tag. */
function syntheticChecklist(n: number, tagPrefix: string): readonly ReleaseGateChecklistItemSpec[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${tagPrefix}-item-${String(i)}`,
    description: `synthetic item ${String(i)}`,
    required: true,
    requiredGateTags: [`${tagPrefix}-tag-${String(i)}`],
  }));
}

// Per synthetic checklist item: whether ANY evidence is journaled for it at
// all, and if so, how many green/negative records back it.
const itemEvidencePlanArb = fc.record({
  hasEvidence: fc.boolean(),
  greenCount: fc.integer({ min: 0, max: 3 }),
  negativeCount: fc.integer({ min: 0, max: 3 }),
});

describe("generateReleaseGateReport — property: never PASS on missing/incomplete evidence", () => {
  it("for any random combination of checklist items x evidence sets x scoring mode, PASS implies >=1 linked green EvidenceRecord and zero linked negative ones", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(itemEvidencePlanArb, { minLength: 1, maxLength: 8 }),
        fc.constantFrom("interim", "final"),
        async (plans, scoringMode) => {
          const candidate = randomUUID();
          const tagPrefix = `prop-${randomUUID()}`;
          const checklist = syntheticChecklist(plans.length, tagPrefix);

          for (const [index, plan] of plans.entries()) {
            if (!plan.hasEvidence) continue;
            const tag = `${tagPrefix}-tag-${String(index)}`;
            for (let g = 0; g < plan.greenCount; g += 1) {
              await tj.store.appendEntry({
                type: "evidence_pointer",
                changeSetId: randomUUID(),
                payload: fixtureRecord(candidate, tag, 0),
              });
            }
            for (let r = 0; r < plan.negativeCount; r += 1) {
              await tj.store.appendEntry({
                type: "evidence_pointer",
                changeSetId: randomUUID(),
                payload: fixtureRecord(candidate, tag, 1),
              });
            }
          }

          const report = await generateReleaseGateReport({
            journal: tj.store,
            releaseCandidateObjectId: candidate,
            scoringMode,
            checklist,
          });

          expect(report.items).toHaveLength(plans.length);
          report.items.forEach((item, index) => {
            const plan = plans[index]!;
            const totalMatched = plan.hasEvidence ? plan.greenCount + plan.negativeCount : 0;

            // THE core fail-first invariant: PASS is reachable ONLY when
            // >=1 record was matched AND none of them were negative.
            if (item.verdict === "PASS") {
              expect(totalMatched).toBeGreaterThan(0);
              expect(plan.hasEvidence && plan.negativeCount === 0).toBe(true);
            }

            // Zero matched evidence NEVER produces PASS, in EITHER mode.
            if (totalMatched === 0) {
              expect(item.verdict).not.toBe("PASS");
              expect(item.verdict).toBe(scoringMode === "final" ? "FAIL" : "EVIDENCE-PENDING");
            }

            // Any negative match forces FAIL, regardless of mode or how
            // many green matches also exist.
            if (plan.hasEvidence && plan.negativeCount > 0) {
              expect(item.verdict).toBe("FAIL");
            }
          });

          // Overall verdict never PASSes unless every single item did.
          if (report.overallVerdict === "PASS") {
            expect(report.items.every((i) => i.verdict === "PASS")).toBe(true);
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});

describe("generateReleaseGateReport — property: idempotent over the same journal segment", () => {
  it("re-running against the identical journal content + inputs yields a byte-identical report", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(itemEvidencePlanArb, { minLength: 1, maxLength: 6 }),
        fc.constantFrom("interim", "final"),
        async (plans, scoringMode) => {
          const candidate = randomUUID();
          const tagPrefix = `idem-${randomUUID()}`;
          const checklist = syntheticChecklist(plans.length, tagPrefix);

          for (const [index, plan] of plans.entries()) {
            if (!plan.hasEvidence) continue;
            const tag = `${tagPrefix}-tag-${String(index)}`;
            for (let g = 0; g < plan.greenCount; g += 1) {
              await tj.store.appendEntry({
                type: "evidence_pointer",
                changeSetId: randomUUID(),
                payload: fixtureRecord(candidate, tag, 0),
              });
            }
            for (let r = 0; r < plan.negativeCount; r += 1) {
              await tj.store.appendEntry({
                type: "evidence_pointer",
                changeSetId: randomUUID(),
                payload: fixtureRecord(candidate, tag, 1),
              });
            }
          }

          const fixedNow = () => "2026-01-01T00:00:00.000Z";
          const first = await generateReleaseGateReport({
            journal: tj.store,
            releaseCandidateObjectId: candidate,
            scoringMode,
            checklist,
            now: fixedNow,
          });
          const second = await generateReleaseGateReport({
            journal: tj.store,
            releaseCandidateObjectId: candidate,
            scoringMode,
            checklist,
            now: fixedNow,
          });

          expect(second).toEqual(first);
        },
      ),
      { numRuns: 100 },
    );
  });
});
