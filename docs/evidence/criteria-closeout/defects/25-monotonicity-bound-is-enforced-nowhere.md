# 25 — R4's fourth admissibility bound is documented as living elsewhere, and lives nowhere

**Phase:** 25 — owner-pipeline conformance (`roadmap/25-owner-pipeline-conformance.md`,
work item 6). Surface: `packages/cli/src/review/admissibility.ts`, and the absence of a
counterpart in `packages/scheduler`.

**Found:** 2026-08-18, surveying phase 25's exit criteria for a closeout record. Not raised
by any review round: every test of every bound that DOES exist passes, and the missing one
has no test to fail.

**Severity: medium, and it is a bound on TERMINATION.** Nothing is wrong in what ships. What
is missing is one of the four things owner ruling R4 named as making the review loop's
search space finite. The other three are implemented and tested; this one is documented as
implemented somewhere else, and there is no somewhere else.

**Effort: M**, and it needs a design decision first — see the remedy.

## What R4 ruled, and what the code says about it

`docs/design/owner-pipeline-conformance.md` §4.3 draws **four** admissibility bounds.
`admissibility.ts`'s own header is explicit that it implements three of them and disclaims
the fourth:

> "THIS MODULE implements three of them: scope (BOUND 1), obligation (BOUND 2) and identity
> (BOUND 3). The fourth, monotonicity — a repair may not enlarge the `PlannedWriteSet`, on
> pain of re-entering the plan stage in the open — is enforced where a repair's write set is
> decided, not here"

That disclaimer is careful and correct about its own module. The claim it makes about the
rest of the repository is the defect.

## The measurement

Searched for any enforcement that compares one attempt's write set against an earlier one:

| search                                                                    | result                                                                                                                                                       |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PlannedWriteSet` across `packages/*/src`                                 | 6 files: `admissibility.ts` + its test, `review-verdict.ts` (a doc comment), `git-engine`'s `overlap-analyzer.ts` + its property test, `git-engine/index.ts` |
| `monotonic` across `packages/*/src`                                       | installer settings merge, output-style writer, coverage ratchet, `binomial-bounds.ts`, config precedence, journal crash recovery — none about a repair       |
| `previousWriteSet` / `priorWriteSet` / `writeSetGrew` / subset comparison | no hit in any non-test source                                                                                                                                |
| `ownedPaths` in `packages/scheduler`                                      | budget cap, envelope-subset check, error kind — all WITHIN one attempt                                                                                       |
| `ownedPaths` / `writeSet` in `packages/journal`                           | no hit, so no attempt's write set is even recorded for a later one to be compared against                                                                    |

`git-engine`'s `overlap-analyzer.ts` is the closest thing and it is a different question: it
compares the write sets of **concurrent work units** to order them, not the write sets of
**successive attempts on one work unit** to bound one.

`assertRepairAllowed` (`packages/scheduler/src/attempt-policy.ts`) is where a repair is
gated, and what it gates is the attempt COUNT (`MAX_TOTAL_DISPATCHES`) and evidence
distinctness. It never sees a write set.

## Why this is not merely a missing test

Phase 25's exit criterion asks that "each of the four admissibility bounds is enforced and
independently falsifiable: deleting any one bound reddens its own test and no other's". Three
bounds can meet that today. The fourth cannot, because there is nothing to delete.

⚠️ And the bound is load-bearing for the argument R4 rests on. `admissibility.ts`'s own
"WHAT IS NOT PROVED" paragraph concedes that "a repair writes new code inside the write set,
and new code carries new obligations", so termination "rests on the repair rate exceeding
the new-obligation rate". Monotonicity is what keeps that qualifier honest: it is the clause
that stops the write set itself from growing under repair, which would make the obligation
space grow without bound and the concession unbounded rather than empirical.

## Remedy, and the decision inside it

The bound needs a place to live before it needs a test, and there are two candidates:

1. **In `assertRepairAllowed`**, alongside the attempt count and the evidence-distinctness
   check. It is already the choke point every repair passes, it already reads the journal,
   and a repair whose packet widens `ownedPaths` beyond the previous attempt's would be
   refused there with the same error vocabulary. Requires recording each attempt's
   `ownedPaths` in the journal, which is new state.
2. **In `buildTaskPacket`**, which already refuses an `ownedPaths` wider than the standing
   envelope (`PacketEnvelopeViolationError`). Adding "and no wider than the previous attempt
   for this work unit" is the same shape of check one layer in — but the builder is
   currently a pure function of its options and would have to become journal-aware.

**Option 1 is the smaller change** and keeps the builder pure, at the cost of one new
journaled field. Neither is free, and picking between them is an ordinary engineering call
rather than an owner ruling — this record does not ask for one.

**Ticket-ready:** yes.

## Not claimed

- **Not claimed** that the three implemented bounds are wrong or weakly tested.
  `admissibility.test.ts` names bounds 1, 2 and 3 by number and tests each.
- **Not claimed** that any run has been harmed. No authorized run has yet reached the repair
  path with a widening write set, so this is a missing guard rather than a leaked one.
- **Not claimed** that `overlap-analyzer.ts` should be extended to cover it. Concurrent
  overlap and successive-attempt monotonicity are different questions over the same data
  type, and merging them would give one module two reasons to change.
- **Not claimed** that the criterion can be ticked with three of four bounds. It says four.
