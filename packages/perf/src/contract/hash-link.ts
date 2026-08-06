import type { AuthorizationEnvelope, ProvisionalPerformanceContract } from "@crabgic/contracts";
import type { JournalStore } from "@crabgic/journal";
import { canonicalHash } from "./canonical-hash.js";
import { findJournalAnchoredBudgetSnapshot } from "./journal-anchor.js";

/**
 * Why `verifyProvisionalBudgetIntegrity` reports `ok: false` — surfaced so
 * `../contract/contract-builder.ts` can throw the right typed error and
 * `../gate/performance-gate.ts` can report an accurate blocking detail.
 *
 * The last two were added 2026-08-06 (interface-ledger Gap 22). Splitting
 * "absent" from "bound to something else" is this repo's established shape,
 * twice over — `no_journal_anchor` vs `journal_anchor_mismatch` right here,
 * and `no_approval_seal` vs `approval_seal_mismatch` in
 * `@crabgic/contracts`' `criteria-seal.ts` — because a journal reader must be
 * able to tell "this envelope predates the binding" from "this envelope
 * authorized a different budget set".
 */
export type BudgetIntegrityFailureReason =
  | "self_consistency_mismatch"
  | "no_journal_anchor"
  | "journal_anchor_mismatch"
  | "no_envelope_budget_binding"
  | "envelope_hash_mismatch";

/**
 * The slice of the APPROVED `AuthorizationEnvelope` the binding check needs:
 * the digest the human's approval token signed, and the provisional budget
 * hash that digest covers (`@crabgic/contracts`' `AuthorizationEnvelopeSchema`,
 * ledger Gap 22).
 *
 * A slice rather than the whole record so this check cannot quietly grow into
 * an authority decision — it compares two strings and nothing else.
 */
export type ApprovedEnvelopeBudgetBinding = Pick<
  AuthorizationEnvelope,
  "canonicalHash" | "provisionalBudgetHash"
>;

/**
 * A DISCRIMINATED union (widened from a flat interface 2026-08-06, ledger
 * Gap 22) so that "verified" is not representable without the approved
 * envelope digest that made it verifiable: a passing result carries the exact
 * digest the human's token signed, which `../contract/contract-builder.ts`
 * stamps onto the enforced record. A caller cannot reach the success shape and
 * find no binding there.
 */
export type BudgetIntegrityCheckResult =
  | {
      readonly ok: true;
      readonly recomputedHash: string;
      /** The approved envelope's `canonicalHash` — the digest the approval token signed. */
      readonly approvedEnvelopeHash: string;
      readonly reason?: undefined;
    }
  | {
      readonly ok: false;
      readonly recomputedHash: string;
      readonly reason: BudgetIntegrityFailureReason;
    };

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
 * THE FIX (genuine, in-boundary): 04's own journal (`@crabgic/journal`) is
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
 *   4. `no_envelope_budget_binding` — no approved envelope could be resolved,
 *      or the one resolved carries no `provisionalBudgetHash` at all (an
 *      envelope persisted before this axis existed). FAIL-CLOSED, never "no
 *      binding means trust the record" — the same posture as check 2.
 *   5. `envelope_hash_mismatch` — the approved envelope IS bound, but to a
 *      different budget set than the one about to be enforced.
 *
 * ─── THE GAP 22 FIX (2026-08-06), and why checks 4-5 sit where they sit ───
 *
 * Checks 1-3 all answer the same question: "is this the budget set INTAKE
 * committed?" None of them can answer "is this the budget set a HUMAN
 * approved". They were bound to 04's journal, which is tamper-evident but
 * records what 11 wrote, not what anyone signed. So an approval envelope
 * rendered over budget A, sitting beside a provisional contract carrying
 * budget B, with NO post-approval edit anywhere, passed all three and was
 * enforced. Nothing was tampered with; the wrong thing was committed in the
 * first place, and the signature never covered it.
 *
 * The fix is at the other end: `AuthorizationEnvelopeSchema` now carries
 * `provisionalBudgetHash`, derived by intake from the same
 * `hashProvisionalBudgets` call that stamps the provisional contract, and
 * covered by the envelope's `canonicalHash` — which is precisely what the
 * approval token signs (`@crabgic/contracts`' `approval/token.ts`, subject
 * kind `"envelope_hash"`). Checks 4-5 compare the two.
 *
 * POSITION IS SEMANTICS — first failure wins, so placing 4-5 AFTER the three
 * journal checks is a deliberate ruling, not an ordering accident:
 *
 *  - It preserves the existing evidence's REASONS. A post-approval widening
 *    that also recomputes its own hash disagrees with the envelope too, so if
 *    check 5 ran first that fixture would newly report `envelope_hash_mismatch`
 *    and the merged phase-15 record's `journal_anchor_mismatch` assertions
 *    would go red. Measured, not asserted: see
 *    `docs/evidence/phase-15/envelope-binding-probe-batchE.txt`, probe P2(b).
 *  - It makes the new reason PRECISE. Firing only when the contract is
 *    self-consistent AND anchored AND anchor-matched, `envelope_hash_mismatch`
 *    means exactly "committed at intake, never edited since — and still not
 *    what the human signed": the residual the first three structurally cannot
 *    see.
 *  - Cheapness ordering is preserved: two string compares after the journal
 *    scan cost nothing, and the caller resolved the envelope either way.
 *
 * ─── APPROVAL-TIME POSTURE (a decision, not an omission) ───
 *
 * The defect this closes asked for `contract.approve` to check the binding at
 * approval time as well. It IS checked there, by construction rather than by a
 * second lookup: `contract.approve` verifies the human's token against the
 * digest it derives server-side from the stored envelope (CRITICAL C1), and
 * that digest now covers `provisionalBudgetHash`. A literal
 * provisional-contract lookup inside `runContractApprove` was considered and
 * REFUSED — no durable provisional-`PerformanceContract` registry exists (11's
 * intake registers ChangeSet/envelope/intent-contract/requirements/work-units
 * and nothing else), and reading this file's journal anchor from 11's surface
 * is the 11 → 15 package edge ledger Gap 21 explicitly refuses as a
 * phase-level cycle. The alternatives were a new file-backed registry threaded
 * through `IntakeDeps`/`ContractApproveDeps`/`bootstrap.ts`, or that cycle.
 * Neither buys a guarantee this gate does not already provide: a record
 * tampered BETWEEN intake and approval is caught fail-closed here, by checks
 * 1-5, before anything is enforced.
 */
export async function verifyProvisionalBudgetIntegrity(
  journal: JournalStore,
  provisional: ProvisionalPerformanceContract,
  /**
   * REQUIRED parameter that may hold `undefined`: passing `undefined` is an
   * explicit statement that the caller could not resolve an approved envelope,
   * and it fails closed (check 4). Making it required is the forcing function —
   * every call site must say something about the binding, and none can inherit
   * "no binding" by omission.
   */
  approvedEnvelope: ApprovedEnvelopeBudgetBinding | undefined,
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

  // 4. FAIL-CLOSED on an unbound envelope — never "no binding means trust the
  //    record" (mirrors check 2, and `criteria-seal.ts`'s `no_approval_seal`).
  if (approvedEnvelope?.provisionalBudgetHash === undefined) {
    return { ok: false, recomputedHash, reason: "no_envelope_budget_binding" };
  }

  // 5. The vector the first three structurally cannot see: intake-consistent,
  //    journal-anchored, never edited — and still not what the human's token
  //    signed.
  if (approvedEnvelope.provisionalBudgetHash !== provisional.budgetHash) {
    return { ok: false, recomputedHash, reason: "envelope_hash_mismatch" };
  }

  return { ok: true, recomputedHash, approvedEnvelopeHash: approvedEnvelope.canonicalHash };
}
