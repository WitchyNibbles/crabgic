# What an unattended run needs, and what it would cost

**Status:** not run. The owner authorized a _small scoped run_ (2026-08-15) and
declined the full pipeline. This document exists so that authorizing it later is
a decision about a known quantity rather than an open-ended one.

## What has been demonstrated

Three live rounds against one module, six subagent invocations, ~180k subagent
tokens. Recorded in `live-review-round-1.md`:

- `pipeline.plan` issues a real stage, lens roster and obligation checklist
- real reviewers return admissible findings with reproductions that survive
  independent verification — **nine blocking defects across three rounds**
- `review.submit` computes closure server-side; two blockers cleared on their
  own terms without the operator asserting either

## What has NOT been demonstrated, precisely

Four things, each with what it needs:

| Gap                                                          | What it needs                                                                                                                                                                                                               |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reviewers dispatched by the pipeline, not by an operator** | The manager invokes `crabgic-stage-loop` instead of an operator spawning agents. Needs an interactive manager session with the plugin installed. Cost: one stage's lenses per round, same as today.                         |
| **Findings repaired by workers, not by an operator**         | A dispatched, envelope-bounded worker in its own worktree writes the fix. Needs `crabgic run` against a real ChangeSet with an approved envelope, and engine spend per attempt (initial + up to two repairs per work unit). |
| **The audit stage firing where a run reaches**               | Blocked on phase 14's gate-registry composition — no production code moves a run to `verifying`/`final_verifying`. See `docs/deploy-posture.md`, gate-registry row. This is not a spend question.                           |
| **Guides written by a worker**                               | `buildDocumentationWorkUnit` produces the unit; dispatching it needs the same worker path as any other unit.                                                                                                                |

## The honest cost estimate

For one small real change set, research through documentation:

- research: 1 agent, plus web fetches
- design panel: up to 6 domain lenses, 1 round minimum
- plan: 2 lenses
- implement: 1 worker per work unit, plus 4 evaluators per round
- audit: up to 8 domain lenses
- document: 1 worker, plus 2 lenses

**At one round per stage that is roughly 25–30 invocations.** Three rounds on one
400-line module produced defects every time, so one round per stage is optimistic
rather than typical.

## The result that should inform the decision

Every one of the three rounds found real defects **in the previous round's
fixes**. The bounds did not converge on a single module in three rounds.

That is the loop working as designed, and it is also the measured answer to
ledger Gap 19's disclosed residual: termination is _reachable_, not proved. An
unattended run inherits that property — it will terminate on the runaway guard
rather than on convergence unless the repair rate exceeds the new-obligation
rate, which nothing has yet measured.

**Authorizing an unattended run is therefore also a decision to fund finding out
whether it converges.** That is the honest framing, and it is why this is the
owner's call rather than an implementation detail.
