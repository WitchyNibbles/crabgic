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

---

# Round 2 — the fixes reviewed, and the server closing the loop

**Same authorization.** Two reviewers ran against the FIXED module. Round 1's
five claims were listed in their prompts as already on record, so re-raising
them would count for nothing.

## Round 2 found two blocking defects in round 1's fixes

Both verified independently as failing tests before any change:

| #   | Defect                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6   | **The degenerate-write-set guard tested emptiness, not matchability.** An absolute, traversal-bearing or glob write set survives normalization as non-empty garbage, makes every finding inadmissible, and closes the stage — round 1's vacuous closure through a different input. `AuthorizationEnvelope` and `TaskPacket` both type owned paths as bare strings, and this repository's own fixtures use glob and absolute spellings. |
| 7   | **The identity key sorted but did not deduplicate.** `['a.ts']`, `['a.ts','./a.ts']` and `['a.ts','a.ts']` are one finding under the scope bound and three keys under the identity bound. A reviewer re-raising the same claim with one extra repetition each round is novel every round — the twelve-round non-termination this module exists to bound, reachable without anyone trying to game it.                                   |

**A fix is not exempt from review because it was a fix.** That is what round 2 is
for, and it earned its keep on the first attempt.

## The server closed the loop, not the operator

Round 1's weakness was that the manager read the findings and decided what to do.
Round 2 and 3 went through `submitLiveRound`, which transcribes a reviewer's
verdict into the real `review.submit` and returns the handler's answer. It
contains no closure rule and its own tests pin that it does not acquire one.

**Round 2** — findings raised, undispositioned:

> `stageClosable: false` — "an obligation went unanswered:
> implement-task-done-criteria-met; 2 admissible finding(s) have no disposition,
> and a stage may not advance holding one at any severity; 2 admissible novel
> finding(s) this round"

**Round 3** — the same findings, now fixed and dispositioned:

> `stageClosable: false` — "an obligation went unanswered:
> implement-task-done-criteria-met"

Two of the three blockers cleared on their own terms: the findings were no longer
novel, and no longer undispositioned. **Neither clearance was asserted by the
operator** — both came back from the handler. What remains is a judged criterion
that needs a signed attestation, which is exactly what it is supposed to require.

## What this still does not demonstrate

The reviewers were dispatched by the manager rather than by the `stage-loop`
workflow, and the code fixes were written by the manager rather than by an
envelope-bounded worker. A run where workers repair their own findings unattended
is the wider authorization the owner declined for this round, and nothing here
claims it.

## Round 2, security lens — the round-2 guard was itself incomplete

The security reviewer arrived later and reviewed the round-2 fixes. Three more
findings, two blocking, all verified independently before any change:

| #   | Defect                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 8   | **The glob guard recognised `*` and nothing else.** `?`, braces and brackets survived it, so those write sets closed the stage with every finding refused as pre-existing code. `packages/engine-core/src/compiler/owned-path.ts` **already defined the full metacharacter set for exactly this input** — the fix had reimplemented a weaker subset of a function a few metres away. |
| 9   | **A mixed write set silently dropped its bad entries.** The guard returned as soon as ONE entry was usable, so an actor spelling one owned path literally and the rest as globs keeps arbitrary _authorized_ trees permanently out of review scope, with findings about them misfiled as debt and never reopened. The function's own docblock stated the rule it broke.              |
| 10  | _(advisory)_ A **glob-bearing finding path** was admitted: it names no file, evades the pathless refusal, and every spelling mints a distinct identity key.                                                                                                                                                                                                                          |

The reviewer also caught a test whose comment claimed it covered "an absolute,
traversal-bearing or glob write set" while its loop exercised only the first two
— and the glob case it named was the one still exploitable. That mismatch was
mine, in a test written the same round.

`GLOB_METACHARACTER_PATTERN` is now exported from `engine-core` and imported
here, so there is one definition rather than two.

## What three rounds actually showed

Each round found real defects **in the previous round's fixes**:

- round 1: five blocking defects in the module
- round 2 (correctness): two blocking defects in round 1's fixes
- round 2 (security): two blocking defects in round 2's fixes

That is the loop doing its job, and it is also the honest answer to whether the
bounds converge: they had not, after three rounds, on a module of this size. The
runaway guard exists for exactly that, and the residual disclosed in ledger Gap
19 — that termination is reachable but not proved — is not theoretical.
