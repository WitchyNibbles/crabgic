# First live review round — 2026-08-15

**Authorized by the owner** as a scoped live run ("small scoped run", one stage).
**Subject:** `packages/cli/src/review/admissibility.ts` — the module implementing
ruling R4's admissibility bounds.

## What ran

`pipeline.plan` was called for real with
`completedStages: [research, clarify, design, design-gate, plan]` and returned
the `implement` stage with four lenses and their obligation checklist. Four live
reviewers were dispatched, one per lens, each given only its own question, the
server's obligation list, and the admissibility rules. All four were read-only.

**Spend:** four subagent invocations, ~177k subagent tokens, ~3-4 minutes each.

## What they found

Every one returned `verdict: "revise"` with executed reproductions. Five findings
were confirmed independently before any fix, by writing each as a failing test:

| #   | Lens                  | Class    | Defect                                                                                                                                                                                                                                                                                                                    |
| --- | --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | correctness           | blocking | **An empty write set closed the stage vacuously.** Every finding is inadmissible, so the scope bound degenerates into "nothing can hold this stage open" — and production reaches it: the gateway passes `envelope?.ownedPaths ?? []`. A round with no envelope closed while holding an undispositioned blocking finding. |
| 2   | security, correctness | blocking | **Path traversal defeated the scope bound.** `normalizePlannedPath` does not resolve `..` and `touches` prefix-matches, so `packages/cli/src/review/../../../../etc/passwd` was admitted as in-scope.                                                                                                                     |
| 3   | security, correctness | blocking | **The identity key collided.** Paths were comma-joined and a comma is legal in a path, so one path `"a.ts,b.ts"` keyed identically to two paths `"a.ts"`, `"b.ts"`. A throwaway finding pre-seeds a genuine one's key, which is then silently non-novel.                                                                  |
| 4   | compliance            | blocking | **Pathless findings were told a lie.** The reason said "recorded as debt"; the debt index is keyed by path and provably cannot hold them, so they accumulated undispositioned and unreachable.                                                                                                                            |
| 5   | correctness           | blocking | **An absolute path was reported as "pre-existing code"** — a spelling problem reported as a scope verdict, and the reviewer prompts in this repository ask for absolute paths.                                                                                                                                            |

The security lens also caught that the module's own docblock claimed _"no
combination of field values can forge another key's preimage"_, which finding 3
disproves. That claim is corrected rather than deleted.

Three further advisories from the clean-code lens (the header claims four bounds
and labels three; `touches` containment is one-directional with no stated
rationale; `unrunObligations` silently accepts unissued answers) are recorded
here and not yet fixed.

## What this demonstrates, and what it does not

**Demonstrates:** the pipeline dispatches real specialised reviewers against a
server-issued obligation checklist, and they return admissible findings with
reproductions that survive independent verification. On its first live round it
found five blocking defects in code written the same day, one of them reachable
from production.

**Does not demonstrate:** an unattended end-to-end run. The reviewers were
dispatched by the manager rather than by the `stage-loop` workflow, and their
verdicts were verified and fixed by the manager rather than submitted through
`review.submit` and repaired by workers. That is the next scope of live
authorization, not something this round claims.

## Fixes

All five confirmed defects were fixed with a test written to fail first
(`packages/cli/src/review/admissibility.test.ts`, describe blocks "findings from
the first live review round" and "the vacuous-closure defect the correctness lens
found"). The empty-write-set guard also reddened three pre-existing tests whose
fixtures defaulted to an empty write set — a default that had been exercising the
degenerate path everywhere it was taken.
