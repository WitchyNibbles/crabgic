# 25 — the stage loop's own schema strips the server's per-lens reviewer out of the plan

**Phase:** 25. Surface: `packages/plugin/workflows/stage-loop.mjs`'s `PLAN_SCHEMA`.

**Found:** 2026-08-18, on the first round dispatched through the FIXED loop.

**Severity: blocking.** Every lens is refused; no round can run.

**Effort: XS.** One declared property.

## What happens

```
pipeline[0] failed: lens completeness carries no reviewer — pipeline.plan is older
                    than this workflow
```

The server is not old. Called directly, `pipeline.plan` returns every lens with its
routing intact:

```json
{"lens":"completeness","obligations":[…],"reviewer":"eo-reviewer"}
```

`PLAN_SCHEMA` declared each lens as `{lens, obligations}` and nothing else. A
structured-output schema **drops every property it does not name**, so `reviewer` was
removed from the plan the moment the planning agent returned it — before
`crabgic-stage-round` ever saw it.

⚠️ **The loop's own docblock names this hazard and the schema implemented it by
omission**: "Return exactly what the tool returned. Do not add lenses, remove lenses, or
edit an obligation list — the plan is the server's answer, and editing it is the one way
this loop can be made to lie about what was reviewed." An incomplete schema is a silent
edit.

## Why it stayed hidden until now

Defect `25-stage-loop-cannot-dispatch-a-round.md` meant the loop never actually passed its
own plan to `stage-round`: the dispatch was an English instruction to an agent that could
not carry it out, and the agents that got a round running did so by calling `pipeline.plan`
themselves — with the field intact. **Fixing the dispatch is what surfaced this**: the
first time the loop handed its own plan through, the truncation became visible.

That is worth stating plainly, because it looks like a regression and is not one. The plan
had been lossy the whole time; nothing had ever consumed it faithfully.

## The error message was also wrong, and is corrected

`reviewerFor` blamed an old server. It now names both possibilities — an old
`pipeline.plan`, or a caller whose schema dropped the field — because the first diagnosis
sent a reader to the wrong component.

## Remedy

Declare `reviewer` on the lens item and make it REQUIRED, so a plan that genuinely lacks
routing fails at the schema rather than several steps later inside another workflow.
`stage-loop-workflow.test.ts` now asserts that `PLAN_SCHEMA` declares every lens property
`stage-round` reads.

**Ticket-ready:** yes.

## Not claimed

- **Not claimed** that `reviewerFor` is wrong to refuse. Refusing rather than defaulting to
  a reviewer is correct — its own comment says "defaulting is what produced the defect" —
  and only its explanation needed fixing.
- **Not claimed** that any round ran with the wrong reviewer. The refusal is fail-closed:
  no lens was dispatched at all.
