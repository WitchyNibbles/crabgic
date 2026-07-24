import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, type ProvisionalPerformanceContract } from "@eo/contracts";
import type { GateContext } from "@eo/gates";
import { canonicalHash } from "../contract/canonical-hash.js";
import { journalApprovedProvisionalContract } from "../test-support/journal-anchor-fixture.js";
import { createTestJournal, type TestJournal } from "../test-support/test-journal.js";
import { createPerformanceGateHandler } from "./performance-gate.js";

const CHANGE_SET_ID = randomUUID();

let tj: TestJournal;

beforeEach(async () => {
  tj = await createTestJournal();
});

afterEach(async () => {
  await tj.cleanup();
});

function makeContext(): GateContext {
  return {
    stage: "final_verifying",
    changeSetId: CHANGE_SET_ID,
    objectId: "integrated-candidate-obj",
    journal: tj.store,
  };
}

function validProvisional(
  budgets: ProvisionalPerformanceContract["budgets"],
  budgetSource: ProvisionalPerformanceContract["budgetSource"] = "requirement_acceptance_criteria",
): ProvisionalPerformanceContract {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: randomUUID(),
    changeSetId: CHANGE_SET_ID,
    createdAt: "2026-01-01T00:00:00.000Z",
    variant: "provisional",
    budgetSource,
    budgets,
    budgetHash: canonicalHash(budgets.map((b) => ({ ...b }))),
  };
}

describe("createPerformanceGateHandler", () => {
  it("passes when the candidate is well within budget", async () => {
    const provisional = validProvisional([{ metric: "cpu_time", threshold: 100, unit: "s" }]);
    await journalApprovedProvisionalContract(tj.store, provisional);
    const handler = createPerformanceGateHandler({
      getProvisionalContract: async () => provisional,
      getMeasurements: async () => ({
        entries: [
          {
            budget: provisional.budgets[0]!,
            baseSamples: Array(12).fill(10),
            candidateSamples: Array(12).fill(10.1),
            pathSensitivity: "sensitive",
            hasAbsoluteBudget: true,
          },
        ],
        artifactDigests: ["sha256:artifact-1"],
      }),
      toolchainFingerprint: "node@24.0.0",
    });

    const verdict = await handler(makeContext());
    expect(verdict.passed).toBe(true);
    expect(verdict.exitStatus).toBe(0);
  });

  it("blocks on a proven statistical regression", async () => {
    const provisional = validProvisional([{ metric: "cpu_time", threshold: 100, unit: "s" }]);
    await journalApprovedProvisionalContract(tj.store, provisional);
    const handler = createPerformanceGateHandler({
      getProvisionalContract: async () => provisional,
      getMeasurements: async () => ({
        entries: [
          {
            budget: provisional.budgets[0]!,
            baseSamples: Array(12).fill(10), // zero-variance -> noise bound 0
            candidateSamples: Array(12).fill(15), // 50% regression, way beyond 10%
            pathSensitivity: "sensitive",
            hasAbsoluteBudget: false,
          },
        ],
        artifactDigests: [],
      }),
      toolchainFingerprint: "node@24.0.0",
    });

    const verdict = await handler(makeContext());
    expect(verdict.passed).toBe(false);
    expect(verdict.exitStatus).toBe(1);
  });

  it("blocks on an absolute-budget breach even with negligible statistical regression", async () => {
    const provisional = validProvisional([{ metric: "cpu_time", threshold: 5, unit: "s" }]);
    await journalApprovedProvisionalContract(tj.store, provisional);
    const handler = createPerformanceGateHandler({
      getProvisionalContract: async () => provisional,
      getMeasurements: async () => ({
        entries: [
          {
            budget: provisional.budgets[0]!,
            baseSamples: Array(12).fill(10),
            candidateSamples: Array(12).fill(10), // same as base, zero regression
            pathSensitivity: "sensitive",
            hasAbsoluteBudget: true, // but 10 > absolute budget of 5
          },
        ],
        artifactDigests: [],
      }),
      toolchainFingerprint: "node@24.0.0",
    });

    const verdict = await handler(makeContext());
    expect(verdict.passed).toBe(false);
  });

  it("FAIL-CLOSED (naive vector): a tampered provisional (budgets changed, hash left stale) blocks via the hash-link check, and still returns a recordable verdict (never throws out of the handler)", async () => {
    const original = validProvisional([{ metric: "cpu_time", threshold: 10, unit: "s" }]);
    await journalApprovedProvisionalContract(tj.store, original);
    const tampered: ProvisionalPerformanceContract = {
      ...original,
      budgets: [{ metric: "cpu_time", threshold: 999, unit: "s" }],
    };
    const handler = createPerformanceGateHandler({
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
    });

    const verdict = await handler(makeContext());
    expect(verdict.passed).toBe(false);
    expect(verdict.detail).toMatch(/hash-link check failed \(self_consistency_mismatch\)/);
  });

  it("MAJOR FIX — FAIL-CLOSED (deliberate widening vector): a widened budget with a consistently-recomputed hash still blocks via the journal anchor", async () => {
    const original = validProvisional([{ metric: "cpu_time", threshold: 100, unit: "s" }]);
    await journalApprovedProvisionalContract(tj.store, original);

    const widenedBudgets: ProvisionalPerformanceContract["budgets"] = [
      { metric: "cpu_time", threshold: 100_000, unit: "s" },
    ];
    const deliberatelyTampered: ProvisionalPerformanceContract = {
      ...original,
      budgets: widenedBudgets,
      budgetHash: canonicalHash(widenedBudgets.map((b) => ({ ...b }))),
    };

    const handler = createPerformanceGateHandler({
      getProvisionalContract: async () => deliberatelyTampered,
      getMeasurements: async () => ({
        entries: [
          {
            budget: deliberatelyTampered.budgets[0]!,
            baseSamples: Array(12).fill(10),
            candidateSamples: Array(12).fill(10),
            pathSensitivity: "sensitive",
            hasAbsoluteBudget: true,
          },
        ],
        artifactDigests: [],
      }),
      toolchainFingerprint: "node@24.0.0",
    });

    const verdict = await handler(makeContext());
    expect(verdict.passed).toBe(false);
    expect(verdict.detail).toMatch(/hash-link check failed \(journal_anchor_mismatch\)/);
  });

  it("FAIL-CLOSED: no journal anchor at all for this ChangeSet's provisional contract blocks the verdict rather than throwing", async () => {
    const provisional = validProvisional([{ metric: "cpu_time", threshold: 100, unit: "s" }]);
    // Deliberately never journaled.
    const handler = createPerformanceGateHandler({
      getProvisionalContract: async () => provisional,
      getMeasurements: async () => ({
        entries: [
          {
            budget: provisional.budgets[0]!,
            baseSamples: Array(12).fill(10),
            candidateSamples: Array(12).fill(10),
            pathSensitivity: "sensitive",
            hasAbsoluteBudget: true,
          },
        ],
        artifactDigests: [],
      }),
      toolchainFingerprint: "node@24.0.0",
    });

    const verdict = await handler(makeContext());
    expect(verdict.passed).toBe(false);
    expect(verdict.detail).toMatch(/hash-link check failed \(no_journal_anchor\)/);
  });

  it("critical-path noise >15% produces an inconclusive-blocking (passed: false) verdict", async () => {
    const provisional = validProvisional([{ metric: "cpu_time", threshold: 100, unit: "s" }]);
    await journalApprovedProvisionalContract(tj.store, provisional);
    const highVarianceBase = [1, 200, 5, 180, 10, 150, 20, 140, 30, 130, 40, 120];
    const handler = createPerformanceGateHandler({
      getProvisionalContract: async () => provisional,
      getMeasurements: async () => ({
        entries: [
          {
            budget: provisional.budgets[0]!,
            baseSamples: highVarianceBase,
            candidateSamples: highVarianceBase,
            pathSensitivity: "critical",
            hasAbsoluteBudget: false,
          },
        ],
        artifactDigests: [],
      }),
      toolchainFingerprint: "node@24.0.0",
    });

    const verdict = await handler(makeContext());
    expect(verdict.passed).toBe(false);
    const detail = JSON.parse(verdict.detail) as { outcome: string };
    expect(detail.outcome).toBe("inconclusive_blocking");
  });

  it("MINOR-1 (defense-in-depth): fewer than the methodology floor's samples per side REFUSES (rejects, no verdict), never returns a normal pass/block", async () => {
    const provisional = validProvisional([{ metric: "cpu_time", threshold: 100, unit: "s" }]);
    await journalApprovedProvisionalContract(tj.store, provisional);
    const handler = createPerformanceGateHandler({
      getProvisionalContract: async () => provisional,
      getMeasurements: async () => ({
        entries: [
          {
            budget: provisional.budgets[0]!,
            baseSamples: Array(5).fill(10), // below MIN_INTERLEAVED_REPETITIONS (10)
            candidateSamples: Array(5).fill(10),
            pathSensitivity: "sensitive",
            hasAbsoluteBudget: true,
          },
        ],
        artifactDigests: [],
      }),
      toolchainFingerprint: "node@24.0.0",
    });

    await expect(handler(makeContext())).rejects.toThrow(/too_few_repetitions/);
  });
});
