---
name: pipeline
description: Drive the staged pipeline end to end — ask the server what stage comes next, dispatch its reviewers, submit their verdicts, and repeat until the stage closes. Use whenever a run is between stages, or when you are unsure what to do next.
disable-model-invocation: false
---

# /eo:pipeline

The loop that runs the whole pipeline. **You do not decide what comes next, and
you do not decide when a stage is done.** Both answers come from the server; this
skill is how you ask for them and act on the answer.

## The loop

```
pipeline.plan  →  dispatch  →  review.submit  →  repeat
```

**Run `crabgic-stage-loop` and it does all four for you**, round after round,
until the stage closes or the runaway guard stops it. Pass
`{completedStages, stackEvidence, artifactRef, changeSetId}`. It returns
`closed` or `stalled` with the reason, plus every round it ran. Use the manual
steps below when you need to see a single round, or when something went wrong
and you are working out where.

1. **Ask what to run.** Call `pipeline.plan` (gateway MCP) with the stages already
   complete and the project's `StackEvidence`. It returns the next stage, the
   lenses that apply, the obligation checklist each lens owes an answer about, the
   round budget, and every lens that did NOT apply with its reason.

   It refuses a completion set with a hole in it, naming the stage that was
   jumped. If you get that error you skipped a stage — go back and run it.

2. **Dispatch.** Run the `crabgic-stage-round` workflow, passing the plan verbatim
   as `args` plus `artifactRef` and `round`. It fans out one `eo-domain-reviewer`
   per applicable lens and puts every finding to an independent skeptic before
   returning it.

   Pass the plan **as it came back**. Editing it — dropping a lens, trimming an
   obligation list — is the one way this loop can be made to lie.

3. **Submit.** Call `review.submit` once per lens verdict. The server merges the
   findings with everything on record, reopens debt this change set touches, and
   returns `stageClosable`. **It never takes closure from you.**

4. **Repeat or advance.** If `stageClosable` is false, read `closureReason` and
   run another round. If it is true, add the stage to your completed set and go
   back to step 1.

## When a stage closes

A stage closes on a round that raises **no admissible novel finding**, with every
obligation answered and every finding dispositioned. Severity plays no part: a
new advisory holds a stage open exactly as a blocker does.

A finding counts only if it concerns a path this change set writes and has not
been raised before. Anything else is recorded as debt and reopens when that code
is next touched — real, answered, and not holding this stage open.

The round number is bounded by a runaway guard, not by the closure rule. Reaching
it means the loop **stalled**, not that it finished, and `escalate` says so.

## The two stages that do not work this way

- **`clarify`** closes on the owner's answers — all nine contract sections
  answerable, every requirement carrying testable acceptance criteria. Use
  `AskUserQuestion`, not a review round.
- **`design-gate`** closes on the owner's recorded verdict and on **nothing
  else**. No reviewer verdict, no attestation and no derivation opens it, and
  there is no tool you can call that records one — it is
  `crabgic design approve|reject`, which the owner types. Render the design, say
  you are waiting, and wait. Do not nudge, and do not re-ask.

Both are returned with `ownerGated: true` and a round budget of one. There is no
loop to run on a human.

## What the stages produce

| stage       | producer             | artifact submitted to `review.submit` |
| ----------- | -------------------- | ------------------------------------- |
| `research`  | `eo-researcher`      | `research`                            |
| `design`    | `eo-architect`       | `design`                              |
| `plan`      | `eo-planner`         | `plan`                                |
| `implement` | dispatched worker    | — (gates decide)                      |
| `audit`     | `eo-domain-reviewer` | —                                     |
| `document`  | `eo-documenter`      | `documentation`                       |

Submitting the artifact is **not** claiming a criterion. You supply the thing
under review; the server decides what it adds up to. A criterion it cannot derive
needs an attestation naming who asserts it, why, and where to look — a bare
string in `metCriteria` counts for nothing and comes back in
`unattestedCriteria`.

## Writes go through workers, never through you

Every stage that produces a file — the implementation, the guides — is an
envelope-bounded worker in its own worktree. `eo-documenter` plans the guides;
a worker writes them. The reviewers are all read-only by declared tool set, not
by convention.

## Do not stop to ask permission

The pipeline is autonomous after the design gate. The only things that halt it
are the stop conditions, and under an autonomy document two of them take a
declared default and journal it instead of stopping. `expanded_authority` always
halts — nothing can widen the model's own authority, and that is not
configurable.
