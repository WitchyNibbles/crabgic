import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, type ProvisionalPerformanceContract } from "@eo/contracts";
import { journalApprovedProvisionalContract } from "../test-support/journal-anchor-fixture.js";
import { createTestJournal, type TestJournal } from "../test-support/test-journal.js";
import { canonicalHash } from "./canonical-hash.js";
import { findJournalAnchoredBudgetSnapshot } from "./journal-anchor.js";

let tj: TestJournal;

beforeEach(async () => {
  tj = await createTestJournal();
});

afterEach(async () => {
  await tj.cleanup();
});

function buildProvisional(
  id: string,
  changeSetId: string,
  budgets: ProvisionalPerformanceContract["budgets"],
): ProvisionalPerformanceContract {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id,
    changeSetId,
    createdAt: "2026-01-01T00:00:00.000Z",
    variant: "provisional",
    budgetSource: "requirement_acceptance_criteria",
    budgets,
    budgetHash: canonicalHash(budgets.map((b) => ({ ...b }))),
  };
}

describe("findJournalAnchoredBudgetSnapshot", () => {
  it("finds a journaled approval-time snapshot by provisional contract id", async () => {
    const provisional = buildProvisional(randomUUID(), randomUUID(), [
      { metric: "cpu_time", threshold: 10, unit: "s" },
    ]);
    await journalApprovedProvisionalContract(tj.store, provisional);

    const anchor = await findJournalAnchoredBudgetSnapshot(tj.store, provisional.id);
    expect(anchor).toBeDefined();
    expect(anchor?.budgetHash).toBe(provisional.budgetHash);
    expect(anchor?.budgets).toEqual(provisional.budgets);
  });

  it("returns undefined when no entry was ever journaled for this id", async () => {
    const anchor = await findJournalAnchoredBudgetSnapshot(tj.store, randomUUID());
    expect(anchor).toBeUndefined();
  });

  it("returns undefined when the journal has entries for OTHER ids only", async () => {
    const other = buildProvisional(randomUUID(), randomUUID(), [
      { metric: "latency", threshold: 100, unit: "ms" },
    ]);
    await journalApprovedProvisionalContract(tj.store, other);

    const anchor = await findJournalAnchoredBudgetSnapshot(tj.store, randomUUID());
    expect(anchor).toBeUndefined();
  });

  it("first writer wins: the EARLIEST journaled entry for an id is authoritative", async () => {
    const sharedId = randomUUID();
    const changeSetId = randomUUID();
    const first = buildProvisional(sharedId, changeSetId, [
      { metric: "cpu_time", threshold: 10, unit: "s" },
    ]);
    const second = buildProvisional(sharedId, changeSetId, [
      { metric: "cpu_time", threshold: 999, unit: "s" },
    ]);
    await journalApprovedProvisionalContract(tj.store, first);
    await journalApprovedProvisionalContract(tj.store, second);

    const anchor = await findJournalAnchoredBudgetSnapshot(tj.store, sharedId);
    expect(anchor?.budgetHash).toBe(first.budgetHash);
  });

  it("gracefully skips a remote_operation_record entry with malformed JSON in appliedRevision", async () => {
    await tj.store.appendEntry({
      type: "remote_operation_record",
      payload: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: randomUUID(),
        remoteMutationPlanId: randomUUID(),
        operationId: "malformed-fixture",
        contentHash: "sha256:whatever",
        status: "recorded",
        appliedRevision: "{not valid json",
        recordedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const provisional = buildProvisional(randomUUID(), randomUUID(), [
      { metric: "cpu_time", threshold: 10, unit: "s" },
    ]);
    await journalApprovedProvisionalContract(tj.store, provisional);

    const anchor = await findJournalAnchoredBudgetSnapshot(tj.store, provisional.id);
    expect(anchor?.budgetHash).toBe(provisional.budgetHash);
  });

  it("ignores remote_operation_record entries with no appliedRevision at all", async () => {
    await tj.store.appendEntry({
      type: "remote_operation_record",
      payload: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: randomUUID(),
        remoteMutationPlanId: randomUUID(),
        operationId: "pending-fixture",
        contentHash: "sha256:whatever",
        status: "pending",
        recordedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const anchor = await findJournalAnchoredBudgetSnapshot(tj.store, randomUUID());
    expect(anchor).toBeUndefined();
  });
});
