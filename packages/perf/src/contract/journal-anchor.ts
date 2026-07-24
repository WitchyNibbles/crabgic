import type { JournalStore } from "@eo/journal";

/**
 * Recursively searches `value` for a plain object literal with
 * `id === targetId` (pre-order, depth-first — the FIRST such object found
 * while walking `value`'s own structure). Used to locate a specific
 * contract instance embedded ANYWHERE inside a `remote_operation_record`'s
 * decoded `appliedRevision` JSON blob, without coupling this module to any
 * one caller's own result-envelope shape (11's intake pipeline happens to
 * wrap it as `{ value: { provisionalPerformanceContract: {...} } }` today —
 * see this file's own doc comment below — but this function does not
 * assume that exact nesting).
 */
function findObjectById(value: unknown, targetId: string): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findObjectById(item, targetId);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const obj = value as Record<string, unknown>;
  if (obj["id"] === targetId) return obj;
  for (const key of Object.keys(obj)) {
    const found = findObjectById(obj[key], targetId);
    if (found !== undefined) return found;
  }
  return undefined;
}

export interface JournalAnchoredBudgetSnapshot {
  readonly budgetHash: string;
  readonly budgets: readonly unknown[];
}

/**
 * Reads back the EARLIEST journal-committed snapshot of the provisional
 * `PerformanceContract` identified by `provisionalPerformanceContractId`,
 * from 04's own tamper-evident, append-only, hash-chained journal
 * (`@eo/journal`) — the genuine, in-boundary fix for the MAJOR gap an
 * adversarial-validation round found in this module's earlier
 * self-checksum-only design (see `./hash-link.ts`'s own doc comment for
 * the full threat-model writeup).
 *
 * MECHANISM: 11's real intake pipeline
 * (`packages/supervisor/src/intake/intake-pipeline.ts`'s `runIntake`)
 * commits every built `IntakeArtifacts` — which embeds the
 * `provisionalPerformanceContract` this phase cares about — through 04's
 * `IdempotencyRegistry` (`packages/journal/src/idempotency.ts`), which
 * journals it as a `remote_operation_record` entry whose
 * `appliedRevision` field carries `JSON.stringify({ value: result })`.
 * That journal entry is written ONCE, at approval-flow time, into an
 * append-only, hash-chained store — a value committed there cannot be
 * silently rewritten without breaking the chain (already enforced
 * elsewhere in this repo, `@eo/journal`'s own `verifyJournal`/hash-chain
 * codec). This function reads that entry back and treats it as the
 * TAMPER-EVIDENT ground truth, structurally searching every
 * `remote_operation_record`'s decoded payload for a nested object literal
 * carrying `id === provisionalPerformanceContractId` — it does NOT assume
 * any specific `operationId` naming convention (11's own `"intake:" +
 * requestKey` scheme is an implementation detail of 11, not a documented,
 * ledger-governed interface this phase is entitled to hard-code), only
 * that 04's own `RemoteOperationRecordSchema` shape and journal ordering
 * (append order = chronological order, confirmed by
 * `@eo/journal`'s own `queryEntries` implementation) are stable, which
 * `@eo/journal` (04) already documents as its own public contract.
 *
 * "First writer wins" (journal order): if more than one
 * `remote_operation_record` entry happens to embed an object with this
 * exact id (should not normally happen — a provisional contract's id is a
 * fresh UUID per intake), the EARLIEST-appended one is authoritative,
 * mirroring `IdempotencyRegistry`'s own identical "first writer wins"
 * precedent for its `operationId` index.
 *
 * Returns `undefined` when no such entry exists ANYWHERE in the journal —
 * i.e. this `ChangeSet`'s provisional contract was never durably committed
 * through the idempotency registry at all. `./hash-link.ts` treats this as
 * a FAIL-CLOSED condition (never "no anchor means trust the live record"):
 * either the intake flow that produced this `ChangeSet` genuinely never
 * ran through 11's real pipeline (a test/synthetic fixture — this
 * package's own tests journal a fixture anchor explicitly via
 * `../test-support/journal-anchor-fixture.ts` to satisfy this), or the
 * `ChangeSet`'s `provisionalPerformanceContractId` was itself tampered to
 * point at a never-approved, fabricated record with no approval-time
 * commit at all — either way, this phase refuses to enforce a budget it
 * cannot verify was ever actually approved.
 */
export async function findJournalAnchoredBudgetSnapshot(
  journal: JournalStore,
  provisionalPerformanceContractId: string,
): Promise<JournalAnchoredBudgetSnapshot | undefined> {
  for await (const entry of journal.queryEntries({ type: "remote_operation_record" })) {
    if (entry.type !== "remote_operation_record") continue;
    const appliedRevision = entry.payload.appliedRevision;
    if (appliedRevision === undefined) continue;

    let decoded: unknown;
    try {
      decoded = JSON.parse(appliedRevision);
    } catch {
      continue;
    }

    const found = findObjectById(decoded, provisionalPerformanceContractId);
    if (found === undefined) continue;

    const budgetHash = found["budgetHash"];
    const budgets = found["budgets"];
    if (typeof budgetHash === "string" && Array.isArray(budgets)) {
      return { budgetHash, budgets };
    }
  }
  return undefined;
}
