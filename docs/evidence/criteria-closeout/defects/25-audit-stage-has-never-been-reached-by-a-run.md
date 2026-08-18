# 25 — the audit stage has never fired at a stage a run reached

**Criterion (verbatim):**

> The `audit` stage fires at a stage a production run **reaches**, evidenced by a journaled
> run that gets there — not by a harness-level fixture. If phase 14's gate-registry
> composition has not landed, this criterion stays unticked and says so, rather than being met
> by a handler nothing calls.

**Phase:** 25 — owner-pipeline conformance. Surface: the `audit` stage in
`packages/contracts/src/contracts/pipeline-stages.ts`, and the gate-registry composition it
depends on.

**Found:** 2026-08-18, assembling phase 25's closeout record. The criterion predicted this
state in its own text, so this record exists to say so on the record rather than to report
a surprise.

**Severity: the criterion's own bar, not a fault in the stage.** Nothing is wrong with the
`audit` stage as built. What is missing is the only evidence its exit criterion accepts.

**Effort: L**, and none of it is this record's to spend — the size belongs to phase 14's tranche.

## Why it stays unticked

The criterion admits exactly one kind of evidence and refuses the substitute:

- evidence must be "a journaled run that gets there";
- "not by a harness-level fixture";
- and it names the blocker itself: "If phase 14's gate-registry composition has not landed,
  this criterion stays unticked and says so".

That is the state. `docs/design/owner-pipeline-conformance.md` §3b records the `audit` row
as **"server half run, dispatch half unrun"**: `pipeline.plan` issues the stage with its
domain roster and names the lenses it skips, and no reviewer has ever answered one of its
rounds through `crabgic-stage-loop`.

## What the underlying blocker is

`14-gate-registry-never-composed.md` is the record for the tranche this waits on, and its
scope is wider than this box: the composition root admits a gate into the daemon process
only if it executes no stack command, and the daemon composes no coverage report to hand
one. The perf/tdd/coverage/flake/scanner gates land with it.

⚠️ **This record does not restate that one and must not be read as a duplicate.** The
distinction is which claim is unproven: `14-` is about gates that do not fire; this is about
a review STAGE whose exit criterion accepts only a reached run as evidence. Fixing `14-`
is necessary for this box and is not sufficient — an authorized run still has to reach the
stage afterwards, and R7's run is parked four stages earlier at the owner-gated
`design-gate`.

## Remedy

None available here. The box is ticked by phase 14's composition landing and then by a run
reaching `audit` and journaling it — in that order.

**Effort: L for the blocker, S for this box afterwards.** The L is phase 14's gate-registry
composition and is sized in that record, not invented here. The S is what remains once it
lands: an authorized run driven to the `audit` stage, and its journal exported as the
citation. Sized rather than left as "blocked", because an unsized defect is one nobody can
schedule — but the L is not this record's to spend.

**Ticket-ready:** as one ticket behind phase 14's, never before it.

## Not claimed

- **Not claimed** that the `audit` stage is untested. Its roster, its lens partition and its
  skip reasons are unit-tested; what no test can supply is a reached run.
- **Not claimed** that this is a regression. The stage has never been reached, so nothing
  worked and then stopped.
- **Not claimed** that a harness fixture would be a cheaper path to the same assurance. The
  criterion excludes it explicitly, and this repository has the `14-gate-registry-never-composed`
  shape on record as the reason why.
