# 25 — the verdict envelope is rediscovered by hitting the refusal, once per stage

**Phase:** 25. Surface: `packages/plugin/workflows/stage-loop.mjs`'s submit step.

**Found:** 2026-08-18, after the same repair happened three times in a row.

**Severity: blocking on first contact, then self-repairing.** Every submitting agent hits a
refusal that discards a whole round's work, works out why, and fixes it by hand. The round
survives only because the agent is careful.

**Effort: XS.** Six field names in a prompt.

## What happens

`ReviewVerdictSchema` (`packages/contracts/src/contracts/review-verdict.ts:183`) requires
`schemaVersion`, `id`, `createdAt`, `stage`, `artifactRef` and `round`. `stage-round.mjs`'s
reviewers produce `lens`, `verdict`, `answeredObligations`, `attestations` and `findings` —
none of the six. So a verdict submitted as handed over is refused:

```
invalid review verdict: expected 1; expected string ×4; expected number
```

⚠️ **The refusal discards the WHOLE verdict** — the attestations and findings with it. A
round's real review work is lost to a missing constant.

Observed once per stage, by a different agent each time:

| stage      | what the agent reported                                                                                                                                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `research` | "the first submit was rejected with 'invalid review verdict' because ReviewVerdictSchema additionally requires schemaVersion=1, id (uuid), createdAt, stage, artifactRef and round; those envelope fields were added mechanically" |
| `clarify`  | supplied by the caller directly, having watched the previous stage fail                                                                                                                                                            |
| `design`   | "the verdict objects as handed to me lacked the envelope fields … the first attempt was rejected … so schemaVersion 1, a fresh uuid id, createdAt, stage \"design\", artifactRef … and round 2 were added per verdict"             |

Each agent recovered correctly and each stated plainly that no reviewer content was edited.
That is the right behaviour, and it is not a substitute for the instruction being present.

## Root cause

The loop knows all six values — `stage` and `artifactRef` are its own arguments, `round` is
its own counter, `schemaVersion` is a constant — and never said so. `id` and `createdAt`
genuinely need the agent, because a workflow script cannot call `Math.random()` or
`Date.now()` (they throw, so a resumed run cannot diverge from its journal).

So the fix is not to move the work, but to stop it being a discovery: the prompt now names
every field, gives the three the loop knows, and says the envelope is the LOOP's facts
rather than the reviewer's judgement — because a submitter told to add fields to a verdict
it was also told to submit verbatim could reasonably hesitate.

## Remedy

Name the six fields in the submit prompt, with `stage`, `artifactRef` and `round`
interpolated from the loop's own state, and require a fresh `id` per lens — a reused id
would make the server treat two lenses' verdicts as one document.

**Ticket-ready:** yes.

## Not claimed

- **Not claimed** that any verdict was submitted wrong. Every agent that hit this repaired
  it and said so; no reviewer content was edited in any of the three stages.
- **Not claimed** that `ReviewVerdictSchema` should be relaxed. Those fields are what make a
  verdict a record rather than a message, and `id`/`createdAt` cannot come from the script.

## Remediated 2026-08-18 — PR #151

The loop's submit step names all six fields `ReviewVerdictSchema` requires —
`schemaVersion`, `id`, `createdAt`, `stage`, `artifactRef`, `round` — states that a fresh
`id` is needed per lens, and says the envelope is the loop's own facts rather than the
reviewer's judgement.

**Pinned by** `packages/plugin/src/stage-loop-workflow.test.ts`, under
`describe("the submit step supplies the verdict envelope")` — three assertions over the
submit prompt's text.

⚠️ **A bound this addendum will not overstate.** That test's field list is a literal copied
into the test, not read from `ReviewVerdictSchema`. If a seventh required field is ever
added to the schema, the test stays green and the loop rediscovers the refusal exactly as
this record describes. The remedy that would close it — deriving the list from the schema —
is not built, and is the honest residue of this record.
