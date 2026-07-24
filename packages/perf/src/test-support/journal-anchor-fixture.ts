/**
 * Test-support-only helper (not part of this package's public barrel) —
 * journals a `remote_operation_record` entry embedding a
 * `ProvisionalPerformanceContract`, mimicking exactly the SHAPE 11's real
 * intake pipeline commits via `@eo/journal`'s `IdempotencyRegistry`
 * (`packages/supervisor/src/intake/intake-pipeline.ts`'s `runIntake` +
 * `packages/journal/src/idempotency.ts`'s `#persist`: `appliedRevision:
 * JSON.stringify({ value: result })`, where `result` (`IntakeArtifacts`)
 * embeds `provisionalPerformanceContract`). Used by every test in this
 * package that needs `../contract/journal-anchor.ts`'s
 * `findJournalAnchoredBudgetSnapshot` to find a genuine, tamper-evident
 * "approved" anchor for a `ProvisionalPerformanceContract` fixture, without
 * this package depending on `@eo/supervisor` itself (only on `@eo/journal`'s
 * own public `remote_operation_record` entry shape).
 */
import { randomUUID } from "node:crypto";
import { CURRENT_SCHEMA_VERSION, type ProvisionalPerformanceContract } from "@eo/contracts";
import type { JournalStore } from "@eo/journal";

export async function journalApprovedProvisionalContract(
  journal: JournalStore,
  provisional: ProvisionalPerformanceContract,
): Promise<void> {
  const id = randomUUID();
  await journal.appendEntry({
    type: "remote_operation_record",
    payload: {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id,
      remoteMutationPlanId: id,
      operationId: `test-fixture-intake:${provisional.changeSetId}`,
      contentHash: "sha256:test-fixture-content-hash",
      status: "recorded",
      appliedRevision: JSON.stringify({
        value: { provisionalPerformanceContract: provisional },
      }),
      recordedAt: new Date().toISOString(),
    },
  });
}
