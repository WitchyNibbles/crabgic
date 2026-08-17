# 25 — concurrent stage-loop runs share one un-namespaced scratchpad path

**Phase:** 25. Surface: `packages/plugin/workflows/stage-loop.mjs`'s submit step (the agent
prompt), and the session scratchpad convention it inherits.

**Found:** 2026-08-17, owner ruling **R7**'s staged run, by a submitting agent that refused
to proceed.

**Severity: blocking for any concurrent use.** Two stage-loop runs in one session write
their reviewer verdicts to the same file. A review verdict submitted for the wrong change
set or the wrong round is the exact failure the whole review surface exists to prevent.

**Effort: S.** Scope the path by run.

## What happened

Two `crabgic-stage-loop` invocations overlapped in one session — `wf_a5bb520b-f17` (44
agents) and `wf_88fa5aa6-73c` (43 agents), both ending within 40 seconds of each other.
Their submitting agents both staged verdicts at the session scratchpad's
`verdicts.json`.

One agent noticed and stopped:

> while I was preparing the submission, my scratchpad copy of the three verdicts was
> rewritten by a writer that is not me, with materially different content
> (assumption-audit flipped approve -> revise carrying a blocking finding …). I did NOT
> submit the rewritten content — I submitted the three verdicts verbatim from the
> dispatching task message. A human should determine who rewrote … since the two differ on
> whether this stage should close.

⚠️ **The agent's handling was exactly right and is the reason this is a near-miss rather
than a corrupt review record.** It refused to submit content it could not attribute, fell
back to the payload it had been handed directly, and escalated to a human rather than
choosing between two candidate truths. It also correctly declined to call this the
server's escalation: "NOT the server's escalate — the server returned escalate=false."

## Root cause, and what it is NOT

Two files survive in the scratchpad — `verdicts.json` (22:58) and
`verdicts-authoritative.json` (22:35) — written by agents of different runs. The writer
"that is not me" was another of this session's own concurrent runs.

**Not an intrusion, and not a security finding.** Same session, same uid, same session
scratchpad, no privilege boundary crossed. It is an ordinary collision on a shared path,
and it is filed because in THIS pipeline a collision is a correctness hazard rather than a
nuisance: the colliding payload was a set of review verdicts that disagreed about whether a
stage should close.

## Remedy

Scope the staging path by run: the submit prompt should name a file unique to the loop's
own run (the workflow run id is available to the script) rather than a shared basename.
Better still, do not stage verdicts on disk at all — they are already in the agent's task
message, which is the copy the agent correctly fell back to.

**Ticket-ready:** yes.

## Not claimed

- **Not claimed** that any wrong verdict reached the server. Every round of both runs
  reported `lensesSubmitted: 3` with the same closure reason, and the agent that noticed
  submitted the verbatim payload from its own dispatch.
- **Not claimed** that concurrent stage-loop runs are otherwise supported. Running two at
  once was this operator's doing, not a documented mode; the defect is that the collision
  is silent rather than refused.
