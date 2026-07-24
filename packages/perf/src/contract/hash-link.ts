import type { ProvisionalPerformanceContract } from "@eo/contracts";
import type { JournalStore } from "@eo/journal";
import { canonicalHash } from "./canonical-hash.js";
import { findJournalAnchoredBudgetSnapshot } from "./journal-anchor.js";

/**
 * Why `verifyProvisionalBudgetIntegrity` reports `ok: false` — surfaced so
 * `../contract/contract-builder.ts` can throw the right typed error and
 * `../gate/performance-gate.ts` can report an accurate blocking detail.
 */
export type BudgetIntegrityFailureReason =
  "self_consistency_mismatch" | "no_journal_anchor" | "journal_anchor_mismatch";

export interface BudgetIntegrityCheckResult {
  readonly ok: boolean;
  readonly recomputedHash: string;
  readonly reason?: BudgetIntegrityFailureReason;
}

/**
 * The tamper-evidence check roadmap/15 §In scope, "Budget sourcing" bullet
 * requires: "The enforced figure must hash-match the provisional one 11's
 * approval render already committed to (via ChangeSet, 02); a mismatch
 * fails closed rather than silently re-sourcing."
 *
 * ADVERSARIAL-VALIDATION FIX (MAJOR): the ORIGINAL version of this check
 * only recomputed `canonicalHash(provisional.budgets)` and compared it
 * against `provisional.budgetHash` — but BOTH fields live in the SAME
 * mutable `ChangeSet`-referenced record, and the `AuthorizationEnvelope`
 * content hash the approval token actually signs (11's
 * `envelope-builder.ts`) does NOT cover the perf budget. A deliberate
 * post-approval budget widening that ALSO recomputes `budgetHash`
 * consistently (e.g. threshold 200ms → 2000ms, with a freshly-recomputed
 * hash) passed this check undetected — it was a SELF-checksum, not
 * evidence bound to anything an adversary editing the mutable record
 * couldn't also edit. Confirmed empirically before this fix (see
 * `docs/evidence/phase-15/README.md`'s MAJOR-fix section for the exact
 * repro).
 *
 * THE FIX (genuine, in-boundary): 04's own journal (`@eo/journal`) is
 * append-only and hash-chained — tamper-evident BY CONSTRUCTION, already
 * enforced elsewhere in this repo. 11's real intake pipeline durably
 * commits the built provisional `PerformanceContract` through 04's
 * `IdempotencyRegistry` at approval-flow time (`./journal-anchor.ts`'s own
 * doc comment explains the exact mechanism). This function now ALSO reads
 * that journal-committed snapshot back (`findJournalAnchoredBudgetSnapshot`)
 * and compares the CURRENT (possibly-tampered) provisional record's
 * `budgetHash` against it — a post-approval edit to the mutable record
 * cannot rewrite a past, already-chained journal entry, so the two no
 * longer match and this check reports `ok: false`. The original
 * self-consistency check is KEPT as a first, cheap pass (catches the
 * naive "budgets edited, hash left stale" vector without even touching the
 * journal), but it is no longer the ONLY check.
 *
 * Checks run in order, first failure wins:
 *   1. `self_consistency_mismatch` — `canonicalHash(provisional.budgets)`
 *      doesn't even match the record's OWN `budgetHash` field (the naive
 *      vector).
 *   2. `no_journal_anchor` — no `remote_operation_record` entry anywhere in
 *      the journal ever committed this exact provisional contract id.
 *      FAIL-CLOSED (never "no anchor means trust the live record"): either
 *      this `ChangeSet` never genuinely went through 11's real approval
 *      pipeline, or its `provisionalPerformanceContractId` was tampered to
 *      point at a fabricated, never-approved record.
 *   3. `journal_anchor_mismatch` — an anchor WAS found, but its
 *      journal-committed `budgetHash` differs from the current record's
 *      `budgetHash` — the REAL tamper-evidence catch: a deliberate
 *      post-approval widening, even with a consistently-recomputed hash,
 *      cannot match what was chained into the journal at approval time.
 */
export async function verifyProvisionalBudgetIntegrity(
  journal: JournalStore,
  provisional: ProvisionalPerformanceContract,
): Promise<BudgetIntegrityCheckResult> {
  const recomputedHash = canonicalHash(provisional.budgets.map((b) => ({ ...b })));
  if (recomputedHash !== provisional.budgetHash) {
    return { ok: false, recomputedHash, reason: "self_consistency_mismatch" };
  }

  const anchor = await findJournalAnchoredBudgetSnapshot(journal, provisional.id);
  if (anchor === undefined) {
    return { ok: false, recomputedHash, reason: "no_journal_anchor" };
  }

  if (anchor.budgetHash !== provisional.budgetHash) {
    return { ok: false, recomputedHash, reason: "journal_anchor_mismatch" };
  }

  return { ok: true, recomputedHash };
}
