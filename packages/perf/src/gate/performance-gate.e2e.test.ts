import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CURRENT_SCHEMA_VERSION,
  EvidenceRecordSchema,
  type ProvisionalPerformanceContract,
} from "@eo/contracts";
import { createGateRegistry } from "@eo/gates";
import { canonicalHash } from "../contract/canonical-hash.js";
import { journalApprovedProvisionalContract } from "../test-support/journal-anchor-fixture.js";
import { createTestJournal, type TestJournal } from "../test-support/test-journal.js";
import { createPerformanceGateHandler } from "./performance-gate.js";

/**
 * Integration test — roadmap/15 §Test plan, Integration: "gate fires at
 * `final_verifying` and emits a schema-valid EvidenceRecord 14's framework
 * can read." Registers this phase's own handler into a FRESH
 * `createGateRegistry()` (14's public API — never a `packages/gates` edit)
 * under the `performance` tag, exactly the "no new dependency edge"
 * pattern (interface-ledger Gap 1's aggregation precedent).
 */

let tj: TestJournal;

beforeEach(async () => {
  tj = await createTestJournal();
});

afterEach(async () => {
  await tj.cleanup();
});

function validProvisional(changeSetId: string): ProvisionalPerformanceContract {
  const budgets: ProvisionalPerformanceContract["budgets"] = [
    { metric: "cpu_time", threshold: 100, unit: "s" },
  ];
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: randomUUID(),
    changeSetId,
    createdAt: "2026-01-01T00:00:00.000Z",
    variant: "provisional",
    budgetSource: "requirement_acceptance_criteria",
    budgets,
    budgetHash: canonicalHash(budgets.map((b) => ({ ...b }))),
  };
}

describe("E2E: performance gate registered into 14's registry, fired at final_verifying", () => {
  it("fires through the registry's fireByTag('performance', ...) and emits a schema-valid EvidenceRecord", async () => {
    const changeSetId = randomUUID();
    const provisional = validProvisional(changeSetId);
    await journalApprovedProvisionalContract(tj.store, provisional);

    const registry = createGateRegistry();
    registry.register(
      "performance",
      "eo-perf-twin-worktree-benchmark",
      createPerformanceGateHandler({
        getProvisionalContract: async () => provisional,
        getMeasurements: async () => ({
          entries: [
            {
              budget: provisional.budgets[0]!,
              baseSamples: Array(12).fill(10),
              candidateSamples: Array(12).fill(10.05),
              pathSensitivity: "sensitive",
              hasAbsoluteBudget: true,
            },
          ],
          artifactDigests: ["sha256:raw-samples-digest"],
        }),
        toolchainFingerprint: "node@24.0.0",
      }),
    );

    const results = await registry.fireByTag("performance", {
      stage: "final_verifying",
      changeSetId,
      objectId: "integrated-candidate-obj",
      journal: tj.store,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.verdict.passed).toBe(true);
    expect(results[0]?.tag).toBe("performance");

    const evidence = results[0]?.evidence;
    expect(evidence).toBeDefined();
    expect(EvidenceRecordSchema.safeParse(evidence).success).toBe(true);
    expect(evidence?.gateTag).toBe("performance");
    expect(evidence?.objectId).toBe("integrated-candidate-obj");
    expect(evidence?.changeSetId).toBe(changeSetId);

    // The registry itself journaled the evidence_pointer entry — confirm
    // it's readable back from the real journal (the "… journal entry"
    // exit-criterion phrasing).
    const entries: unknown[] = [];
    for await (const entry of tj.store.queryEntries({ type: "evidence_pointer" })) {
      entries.push(entry);
    }
    expect(entries).toHaveLength(1);
  });

  it("MAJOR FIX — a deliberate post-approval budget widening that ALSO recomputes its own budgetHash consistently still fails the journal-anchored hash-link check and BLOCKS, with the block itself journaled as evidence", async () => {
    const changeSetId = randomUUID();
    const original = validProvisional(changeSetId);
    // Genuinely journaled at "approval time" — the tamper-evident anchor.
    await journalApprovedProvisionalContract(tj.store, original);

    const widenedBudgets: ProvisionalPerformanceContract["budgets"] = [
      { metric: "cpu_time", threshold: 999_999, unit: "s" },
    ];
    const tampered: ProvisionalPerformanceContract = {
      ...original,
      budgets: widenedBudgets,
      // The adversary ALSO recomputes budgetHash consistently — the exact
      // vector the old self-checksum-only check missed.
      budgetHash: canonicalHash(widenedBudgets.map((b) => ({ ...b }))),
    };

    const registry = createGateRegistry();
    registry.register(
      "performance",
      "eo-perf-twin-worktree-benchmark",
      createPerformanceGateHandler({
        getProvisionalContract: async () => tampered,
        getMeasurements: async () => ({
          entries: [
            {
              budget: tampered.budgets[0]!,
              baseSamples: Array(12).fill(10),
              candidateSamples: Array(12).fill(10),
              pathSensitivity: "sensitive",
              hasAbsoluteBudget: true,
            },
          ],
          artifactDigests: [],
        }),
        toolchainFingerprint: "node@24.0.0",
      }),
    );

    const results = await registry.fireByTag("performance", {
      stage: "final_verifying",
      changeSetId,
      objectId: "integrated-candidate-obj",
      journal: tj.store,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.verdict.passed).toBe(false);
    expect(results[0]?.verdict.detail).toMatch(
      /hash-link check failed \(journal_anchor_mismatch\)/,
    );
    expect(EvidenceRecordSchema.safeParse(results[0]?.evidence).success).toBe(true);
  });
});
