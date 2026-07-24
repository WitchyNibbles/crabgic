import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CURRENT_SCHEMA_VERSION,
  EvidenceRecordSchema,
  type ProvisionalPerformanceContract,
} from "@eo/contracts";
import { createGateRegistry } from "@eo/gates";
import { canonicalHash } from "../contract/canonical-hash.js";
import { MethodologyViolationError } from "../errors.js";
import {
  assertMethodologySound,
  MIN_INTERLEAVED_REPETITIONS,
  type ScheduleStep,
} from "../runner/methodology.js";
import { runTwinWorktreeBenchmark } from "../runner/twin-worktree-runner.js";
import { journalApprovedProvisionalContract } from "../test-support/journal-anchor-fixture.js";
import { createTestJournal, type TestJournal } from "../test-support/test-journal.js";
import { createPerformanceGateHandler } from "../gate/performance-gate.js";

/**
 * `perf-conformance` fixture matrix — roadmap/15 §Interfaces produced:
 * "a named, standalone-runnable CI job: covers 20%-CPU-regression-blocks,
 * 3%-noise-passes, noisy-critical-inconclusive-blocking, and
 * methodology-violation-refusal (too-few-reps, no-interleave). This is the
 * exact artifact 23's 'seeded-fault matrices from 14/15/22' bullet
 * re-invokes." Each fixture gets its own fresh journal/registry (mirroring
 * `packages/gates/src/gates-conformance.test.ts`'s own precedent) so no
 * fixture's pass/fail masks another's. Wired as its own standalone CI job
 * in `.github/workflows/perf-conformance.yml`.
 */

let tj: TestJournal;

beforeEach(async () => {
  tj = await createTestJournal();
});

afterEach(async () => {
  await tj.cleanup();
});

function provisionalWithBudget(
  changeSetId: string,
  threshold: number,
): ProvisionalPerformanceContract {
  const budgets: ProvisionalPerformanceContract["budgets"] = [
    { metric: "cpu_time", threshold, unit: "s" },
  ];
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: randomUUID(),
    changeSetId,
    createdAt: "2026-01-01T00:00:00.000Z",
    variant: "provisional",
    budgetSource: "base_revision_measurement",
    budgets,
    budgetHash: canonicalHash(budgets.map((b) => ({ ...b }))),
  };
}

async function fireOnce(
  provisional: ProvisionalPerformanceContract,
  baseSamples: readonly number[],
  candidateSamples: readonly number[],
  pathSensitivity: "critical" | "sensitive",
) {
  // Genuinely journal this provisional as "approved" — the tamper-evident
  // anchor the gate's hash-link check now requires (adversarial-validation
  // MAJOR fix; see ../contract/hash-link.ts's own doc comment).
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
            baseSamples,
            candidateSamples,
            pathSensitivity,
            hasAbsoluteBudget: false,
          },
        ],
        artifactDigests: ["sha256:conformance-fixture"],
      }),
      toolchainFingerprint: "node@24.0.0",
    }),
  );

  return registry.fireByTag("performance", {
    stage: "final_verifying",
    changeSetId: provisional.changeSetId,
    objectId: "integrated-candidate-obj",
    journal: tj.store,
  });
}

describe("perf-conformance fixture matrix", () => {
  it("fixture 1: a 20% CPU regression on a sensitive path BLOCKS", async () => {
    const changeSetId = randomUUID();
    const provisional = provisionalWithBudget(changeSetId, 1000);
    const base = Array(12).fill(100); // zero-variance base -> noise bound 0
    const candidate = Array(12).fill(120); // +20%, beyond the 10% sensitive-path threshold

    const results = await fireOnce(provisional, base, candidate, "sensitive");
    expect(results[0]?.verdict.passed).toBe(false);
    expect(EvidenceRecordSchema.safeParse(results[0]?.evidence).success).toBe(true);
  });

  it("fixture 2: a 3% regression (within noise/threshold) on a critical path PASSES", async () => {
    const changeSetId = randomUUID();
    const provisional = provisionalWithBudget(changeSetId, 1000);
    const base = Array(12).fill(100); // zero-variance base -> noise bound 0
    const candidate = Array(12).fill(103); // +3%, within the 5% critical-path threshold

    const results = await fireOnce(provisional, base, candidate, "critical");
    expect(results[0]?.verdict.passed).toBe(true);
  });

  it("fixture 3: a noisy critical-path measurement is INCONCLUSIVE and BLOCKING (never quarantined-as-passing)", async () => {
    const changeSetId = randomUUID();
    const provisional = provisionalWithBudget(changeSetId, 1000);
    // High-variance base samples: bootstrap noise bound will exceed 15%.
    const noisyBase = [1, 300, 5, 250, 10, 200, 20, 180, 30, 160, 40, 140];

    const results = await fireOnce(provisional, noisyBase, noisyBase, "critical");
    expect(results[0]?.verdict.passed).toBe(false);
    const detail = JSON.parse(results[0]!.verdict.detail) as { outcome: string };
    expect(detail.outcome).toBe("inconclusive_blocking");
  });

  it("fixture 4a: methodology violation (too few repetitions) REFUSES to produce a verdict", async () => {
    await expect(
      runTwinWorktreeBenchmark({
        baseObjectId: "base-obj",
        candidateObjectId: "candidate-obj",
        benchmarkCommand: "conformance-fixture-bench",
        repetitions: MIN_INTERLEAVED_REPETITIONS - 1,
        dispatchWorktree: async () => ({ worktreePath: "/tmp/wt", sessionId: "s" }),
        measure: async () => 1,
      }),
    ).rejects.toThrow(MethodologyViolationError);
  });

  it("fixture 4b: methodology violation (no interleave — a block design) REFUSES to produce a verdict", () => {
    const blockDesignSchedule: ScheduleStep[] = [
      ...Array.from({ length: MIN_INTERLEAVED_REPETITIONS }, (): ScheduleStep => ({
        kind: "base",
        phase: "measured",
      })),
      ...Array.from({ length: MIN_INTERLEAVED_REPETITIONS }, (): ScheduleStep => ({
        kind: "candidate",
        phase: "measured",
      })),
    ];
    expect(() => assertMethodologySound(blockDesignSchedule)).toThrow(MethodologyViolationError);
  });
});
