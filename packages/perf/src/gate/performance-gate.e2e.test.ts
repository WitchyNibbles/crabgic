import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CURRENT_SCHEMA_VERSION,
  EvidenceRecordSchema,
  type ProvisionalPerformanceContract,
} from "@crabgic/contracts";
import { createGateRegistry } from "@crabgic/gates";
import { canonicalHash } from "../contract/canonical-hash.js";
import { journalApprovedProvisionalContract } from "../test-support/journal-anchor-fixture.js";
import { createTestJournal, type TestJournal } from "../test-support/test-journal.js";
import { approvedEnvelopeFor } from "../test-support/approved-envelope-fixture.js";
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
        // DOES-NOT-FAIL CONTROL for the Gap 22 binding, through the REAL
        // registry: a correctly-bound approved envelope still passes.
        getApprovedEnvelope: async () => approvedEnvelopeFor(provisional),
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

    // STRING-COLLISION CONTROL (playbook: when you assert on a verdict string,
    // check the opposite outcome does not contain it). The passing detail is
    // `JSON.stringify({ outcome, enforcedContractId, decisions })` and carries
    // no reason literal at all — so the failure cases' regexes below cannot
    // match a PASS, and this assertion reddens the moment that stops being
    // true.
    expect(results[0]?.verdict.detail).not.toContain("hash-link check failed");
    expect(results[0]?.verdict.detail).not.toContain("envelope_hash_mismatch");
    expect(results[0]?.verdict.detail).not.toContain("no_envelope_budget_binding");

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
        // Bound to the ORIGINAL approved budget hash — check 5 would fire too;
        // the reason staying `journal_anchor_mismatch` is the order proof that
        // this phase's merged evidence keeps its meaning.
        getApprovedEnvelope: async () => approvedEnvelopeFor(original),
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

  it("NEW BINDING (ledger Gap 22) — an envelope signed over budget A beside an intake-committed contract carrying budget B blocks through the registry with reason envelope_hash_mismatch, journaled as evidence", async () => {
    // The half of roadmap/15's exit criterion the journal anchor cannot bear.
    // NOTHING here is tampered: the contract is self-consistent, genuinely
    // journal-anchored at approval time, and never edited afterwards. The
    // approval the human actually signed simply covers a different budget set.
    const changeSetId = randomUUID();
    const carryingB = validProvisional(changeSetId);
    await journalApprovedProvisionalContract(tj.store, carryingB);

    const budgetsA: ProvisionalPerformanceContract["budgets"] = [
      { metric: "cpu_time", threshold: 1, unit: "s" },
    ];
    const signedOverA = approvedEnvelopeFor(carryingB, {
      provisionalBudgetHash: canonicalHash(budgetsA.map((b) => ({ ...b }))),
    });

    const registry = createGateRegistry();
    registry.register(
      "performance",
      "eo-perf-twin-worktree-benchmark",
      createPerformanceGateHandler({
        getProvisionalContract: async () => carryingB,
        getApprovedEnvelope: async () => signedOverA,
        getMeasurements: async () => ({
          entries: [
            {
              budget: carryingB.budgets[0]!,
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
    expect(results[0]?.verdict.detail).toMatch(/hash-link check failed \(envelope_hash_mismatch\)/);
    expect(EvidenceRecordSchema.safeParse(results[0]?.evidence).success).toBe(true);

    // The criterion's "+ journal entry" conjunct, read back from the REAL
    // journal rather than inferred from the returned verdict.
    const entries: unknown[] = [];
    for await (const entry of tj.store.queryEntries({ type: "evidence_pointer" })) {
      entries.push(entry);
    }
    expect(entries).toHaveLength(1);
  });

  it("FAIL-CLOSED through the registry: an unresolvable approved envelope blocks with reason no_envelope_budget_binding", async () => {
    const changeSetId = randomUUID();
    const provisional = validProvisional(changeSetId);
    await journalApprovedProvisionalContract(tj.store, provisional);

    const registry = createGateRegistry();
    registry.register(
      "performance",
      "eo-perf-twin-worktree-benchmark",
      createPerformanceGateHandler({
        getProvisionalContract: async () => provisional,
        getApprovedEnvelope: async () => undefined,
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
      }),
    );

    const results = await registry.fireByTag("performance", {
      stage: "final_verifying",
      changeSetId,
      objectId: "integrated-candidate-obj",
      journal: tj.store,
    });

    expect(results[0]?.verdict.passed).toBe(false);
    expect(results[0]?.verdict.detail).toMatch(
      /hash-link check failed \(no_envelope_budget_binding\)/,
    );
    expect(EvidenceRecordSchema.safeParse(results[0]?.evidence).success).toBe(true);
  });
});
