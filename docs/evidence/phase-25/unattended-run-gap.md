# What an unattended run needs, and what it would cost

**Status:** ~~not run.~~ **Superseded in part, 2026-08-15 — a real run was
dispatched.** See `first-real-dispatch.md`. The standing `EnvelopePolicy` this
document lists as an owner prerequisite **already existed** (written by the
owner's terminal `install` at 18:46); the run was approved, sealed and dispatched
with no human in the sequence, and parked on the **account's rate limit**. The
cost estimate and the convergence question below stand unchanged — the worker
produced no code, so nothing here is measured that was not measured before.

The owner authorized a _small scoped run_ (2026-08-15) and declined the full
pipeline. This document exists so that authorizing it later is a decision about a
known quantity rather than an open-ended one.

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
| **The audit stage firing where a run reaches**               | ~~Blocked on phase 14's gate-registry composition.~~ **Corrected 2026-08-15 — see the note below.** Needs exactly what the first two rows need: an installed manager session, and spend for up to eight domain lenses.      |
| **Guides written by a worker**                               | `buildDocumentationWorkUnit` produces the unit; dispatching it needs the same worker path as any other unit.                                                                                                                |

### Correction, 2026-08-15 — the audit-stage blocker was not real

The row above originally named phase 14's gate-registry composition as a
**non-spend blocker** on the audit stage. That was wrong, and it was wrong in the
way this repository has a rule about: it cited a `docs/deploy-posture.md` row
**that the same document had already superseded**, without reading the amendment
sitting directly beneath it.

What is actually true, each checked against production source rather than against
the posture doc's prose:

- The daemon's one production composition root **does** compose a gate registry —
  `packages/cli/src/daemon/compose-gate-registry.ts`, derived from
  `REQUIRED_SECURITY_FIXTURE_IDS` so a manifest entry auto-registers.
- Production code **does** walk the run onto those states.
  `runPostCompletionPipeline` transitions `verifying` (`:217`), `integrating`
  (`:288`), `final_verifying` (`:364`) and `published_local` (`:454`), and it is
  called from the real dispatcher at `run-dispatcher.ts:950` — not only from
  tests.
- The pipeline's own `audit` stage is planned, not stubbed. `planStageRound`
  branches to the domain roster for it (`pipeline-driver.ts:127`), the e2e stage
  walk reaches it in order, and `stage-round.mjs` fans out one
  `eo-domain-reviewer` per applicable lens with the skipped ones logged by name.

So there was never a code blocker between a run and its audit stage. The gap
collapses into the two rows above it: **an installed manager session and spend.**
Nothing here was fixed to make that true — it was already true when the row was
written, and the row was mistaken.

Recorded rather than quietly edited, because the failure is the interesting part:
a stale citation to a document that had corrected itself in place produced a
blocker that never existed, and a _false_ blocker is worse than a missing one —
it argues against attempting the very thing it was blocking.

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

---

## The prerequisite nobody had noticed: crabgic is not installed on crabgic

Checked 2026-08-15, at the tip of this branch:

- `.claude/` exists and is **empty** — no `agents/`, no `settings.json`
- `.mcp.json` is **absent**, so the gateway MCP server is not registered
- `CLAUDE.md` carries **no managed operating-protocol block**
- `git ls-files` matches **nothing** under `.claude/` or `.mcp.json`

So the plugin has never been installed into this repository. Every surface phase
25 built — `/eo:pipeline`, the eight agents, `pipeline.plan`, `review.submit` —
is **unreachable from an ordinary session in this checkout**. The three live
rounds worked only because the operator dispatched agents directly and called the
handlers through test harnesses.

**This is the actual first step of any unattended run**, and it costs no engine
spend: `crabgic install` writes `.claude/agents/*`, `.mcp.json`, the managed
`CLAUDE.md` block and the `EnvelopePolicy`. Until it runs, "authorize a live
pipeline run" has nothing to authorize — the manager session has no pipeline to
invoke.

It also explains something about the defects. Nine blocking defects were found in
three rounds against a module written the same day, and none of them had been
caught by this repository's own review machinery — because that machinery has
never been pointed at this repository. The product is not dogfooded on itself,
and the first time it was, it found nine.

**Recommended order**, and the reason this document exists rather than a
recommendation buried in a transcript:

1. `crabgic install` in this checkout — no spend, makes the surfaces reachable
2. confirm the `EnvelopePolicy` it writes is what the owner intends
3. only then authorize a scoped unattended run, which now has something to run

---

## RULED 2026-08-16 (R7) — one full staged run is authorized

This document exists so that authorizing the run is a decision about a known
quantity. It has been made. Full wording at
`docs/design/owner-pipeline-conformance.md` §6b.

**Granted: ONE full staged run on a small change set**, driven through every
stage — research, design, design-gate, plan, implement, integrate, audit,
document. It is a grant of engine spend for that run, and **not** a standing
authorization for unattended runs. It touches neither the standing
`EnvelopePolicy` nor ledger Gap 18's argument.

Three of the four rows in the table above are covered by it: reviewers dispatched
by the pipeline rather than by an operator, findings repaired by a dispatched
worker, and the audit stage firing where a run reaches. The fourth — guides
written by a worker — is the `document` stage, and it is in scope too.

**The design gate will stop and wait**, by construction rather than by
convention: `crabgic design approve|reject` is the sole writer of an
`OwnerDesignVerdict` and no gateway tool can record one, so this run cannot
complete without the owner answering exactly once. That is the single human act
inside an otherwise autonomous run, and it is ruling R2 working as ruled.

**What this run is NOT authorized to establish.** Per R5, ruled the same day, a
run whose acceptance criteria were never evaluated must not reach
`published_local`. Until that refusal is built, a `published_local` from this run
carries the same weak guarantee both earlier runs did — see
`published-unverified.md`. Reading this run's terminal state as verification
would be the exact error R5 was ruled to stop.
