# 25 — `crabgic-stage-loop` cannot dispatch a round, in any environment

**Phase:** 25 — owner-pipeline conformance (`roadmap/25-owner-pipeline-conformance.md`
work item 7, "the multi-round loop").

**Found:** 2026-08-17, driving owner ruling **R7**'s full staged run — the first time
`crabgic-stage-loop` was invoked for a real stage rather than unit-tested.

**Severity: blocking.** The loop is the piece that ties `pipeline.plan`,
`crabgic-stage-round` and `review.submit` together. It ships, it installs, its file is
byte-identical in the plugin cache — and it cannot run a single round. Every stage of
the owner's pipeline that closes on review is unreachable through the shipped surface.

**Effort: S.** One dispatch site, plus a required argument.

## What happens

`stage-loop.mjs` dispatches an AGENT and asks it to run the sibling workflow:

```
Run the `crabgic-stage-round` workflow for round 1 of the `research` stage,
passing this plan verbatim as its args …
```

A subagent has no workflow runtime. `crabgic-stage-round` is a workflow SCRIPT whose
body depends on the runtime globals `agent`/`parallel`/`phase`/`log`, which only the
orchestrating session provides. The agent has no tool that can execute one.

Measured, on the real loop, driving stage `research` of change set
`7d3f8a21-6c94-4e5b-a83f-2b410d97e6c5`:

```
escalate: true
escalationReason: "Could not run the crabgic-stage-round workflow: this subagent
  context has no workflow runtime and no Task/agent-dispatch tool. … invoking it via
  the Skill tool returns \"Unknown skill: crabgic-stage-round\", and ToolSearch
  surfaces no workflow-execution or subagent-spawn tool."
lensesSubmitted: 0   (of 3 planned)
```

⚠️ **The dispatched agent behaved correctly and that is worth recording.** It refused to
fabricate verdicts, refused to review the artifact itself, and refused to re-implement
the fan-out by hand — naming, as its reason, that hand-rolling it would re-plant the
lens-to-reviewer routing that commit `0e4512b` had just consolidated. The loop failed
safe. It still failed.

## Root cause, isolated by probe

Two calls from a workflow SCRIPT body, run against this environment:

| call                                                         | result                                                                             |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `workflow("crabgic-stage-round", …)`                         | **THREW** — "no workflow with that name. Available: deep-research, code-review"    |
| `workflow({ scriptPath: "…/workflows/stage-round.mjs" }, …)` | **RESOLVED** — returned `{stage:"probe",dispatched:0,ownerGated:true,verdicts:[]}` |

So composing the two workflows is possible and supported — one level of nesting is
allowed — but only **from the script body, by path**. Two things follow:

1. **A plugin workflow is not in the name registry.** `crabgic-stage-round` cannot be
   resolved by name from anywhere, so any design that reaches it by name is broken
   wherever it runs. This is not a local misconfiguration.
2. **The dispatch belongs in the script, not in an agent.** Scripts compose workflows;
   agents make tool calls. `stage-loop.mjs` had the two responsibilities the wrong way
   round.

## Why the unit tests did not catch it

`packages/plugin/src/stage-round-workflow.test.ts` and its sibling assert the SCRIPTS'
own logic — the round-counting, the guard, the owner-gated short-circuit, the refusal on
a missing `changeSetId`. They do not execute the composition, because executing it needs
a workflow runtime that a vitest process does not have.

That is the same shape as defect `14-gate-registry-never-composed.md`: every ingredient
tested, the composition never exercised. The loop's own docblock says "a paragraph in a
skill telling the manager to repeat … is the same 'prose a model may skip'". The
replacement had the same property one level down — a dispatch instruction written in
English, addressed to an agent that could not carry it out.

## Remedy

**Call the sub-workflow from the script body, by path.**

```js
const roundResult = await workflow({ scriptPath: stageRoundPath }, roundPlan);
const dispatched = await agent(`… submit ${JSON.stringify(roundResult.verdicts)} …`);
```

`stageRoundPath` is a REQUIRED argument, refused when absent, for the same reason
`changeSetId` is: the loop cannot know where the plugin is installed, and guessing a
path would silently run some other file or fail in a way that looks like a review that
found nothing.

The split also puts each responsibility where it can be discharged: the script composes,
the agent calls `review.submit`.

**Ticket-ready:** yes.

## Not claimed

- **Not claimed** that `stage-round.mjs` is wrong. Its own logic is correct and the probe
  ran it successfully; only the way it was reached was broken.
- **Not claimed** that this was ever observed working. It was invoked for the first time
  on 2026-08-17 — `first-staged-round-live.md` records the previous round dispatching the
  lenses from the manager instead, and names the loop as "still unexercised in a real
  round".
- **Not claimed** that the fix makes the whole pipeline autonomous. Two stages remain
  owner-gated by design, and the loop returns immediately for both.

## Remediated 2026-08-17 — PR #146

The round is dispatched from the SCRIPT body — `await workflow({ scriptPath: stageRoundPath }, roundPlan)`
— and `stageRoundPath` is a required argument, refused when absent rather than guessed.

**Pinned by** `packages/plugin/src/stage-loop-workflow.test.ts`, under
`describe("the round dispatch (defect 25-stage-loop-cannot-dispatch-a-round)")`: it asserts
the dispatch is by `scriptPath` and never by name, that an agent is never asked to run the
sibling workflow, that a missing `stageRoundPath` is refused, and that a failed dispatch is
distinguished from a round that found nothing.

⚠️ **What this did NOT make true.** Fixing the dispatch is what exposed
`25-plan-schema-strips-the-lens-reviewer.md`: the loop could then reach the lenses and
refused every one of them. A defect that hides another is not a defect half-fixed, but the
first round after this PR still ran zero lenses.
