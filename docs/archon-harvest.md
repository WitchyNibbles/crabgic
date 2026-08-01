# Archon harvest — candidate work, not a ruling

**Status: proposal.** Nothing here is settled. Each item below needs a roadmap phase (or an
`docs/interface-ledger.md` ruling) before any of it is implemented; this file exists so the
findings survive, not to authorise work.

## Why this exists

Archon (`WitchyNibbles/archon`) was a sibling harness descended from the same devgod
lineage, solving the same problem on a heavier substrate: Postgres as completion authority,
a `claude -p` CLI transport, and a governance overlay merged into consumer repositories. On
2026-08-01 it was audited and frozen as a donor codebase (see its `STATUS.md`), and effort
consolidated here.

It got further than crabgic on several axes and made mistakes crabgic has not made yet.
Both are worth keeping. What follows was checked against this repository rather than
assumed — several organs turned out to be already present, and one turned out to be
something crabgic should deliberately _not_ take.

## Summary

| #   | Organ                                                   | Status here                                                            | Recommendation                                                 |
| --- | ------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | Sealed, tamper-checked acceptance criteria              | Absent for criteria; **the mechanism already exists for perf budgets** | **Harvest — highest value.** Extend crabgic's own pattern      |
| 2   | Out-of-band notifications (park / block / complete)     | Absent                                                                 | Harvest the design, if unattended operation is a goal          |
| 3   | Full-screen watch dashboard + terminal-injection safety | Partial (`status --watch` is a line-append stream)                     | Harvest the **safety** idea now; the dashboard only if wanted  |
| 4   | Context/token economy instrumentation                   | Partial (turns + USD only)                                             | Harvest the schema; treat archon's own results as unproven     |
| 5   | Per-role effort dimension + per-session pinning         | Model routing present, **no effort dimension**                         | Harvest the engine fact and the pinning discipline             |
| 6   | Park episode counters                                   | Deliberately excluded here                                             | **Do not harvest** unless notifications land first             |
| 7   | 33-agent / 52-skill specialist corpus                   | 5 agents, 6 skills, deliberately lean                                  | **Do not harvest.** Archon's own audit called much of it inert |
| 8   | Honest-residual security doctrine                       | Practised here already                                                 | Adopt explicitly in `docs/threat-model.md`                     |

---

## 1. Sealed acceptance criteria — the one with real teeth

> **Phase spec exists:** `roadmap/24-sealed-acceptance-criteria.md`. Scoping that spec
> found the gap is deeper than tamper-exposure: `Requirement` records are not persisted at
> all after intake, so the phase is store + seal + verify, not seal alone.

Archon's finding, arrived at the hard way: if the agent that implements a task can also
edit that task's acceptance criteria, "done" means nothing. It responded with a completion
seal — a hash over normalised criteria taken at activation, verified before completion, and
fail-closed on mismatch. Its own review gate then caught the flaw in the first version (the
check was reachable only through an optional parameter, so the daemon path skipped it) and
the fix was to make the parameter required, so the type system forces every caller to
thread it. A later round closed the deletion case: a missing seal on a task created after a
source-constant epoch is treated as tampering rather than as "never sealed."

**In crabgic today:** `Requirement.acceptanceCriteria`
(`packages/contracts/src/contracts/requirement.ts:48`) is a plain string array with no hash
and no verification anywhere. The `AuthorizationEnvelope` canonical hash deliberately covers
capability content only — paths, commands, network destinations, credentials, turn caps —
so criteria sit outside the seal. Amendment detection exists
(`packages/gates/src/material-amendment-guard.ts`) but watches the _upstream tracker_ for
milestone drift; it does not model an implementer editing its own bar.

**Why this is the highest-value item: crabgic already built the mechanism.**
`packages/perf/src/contract/hash-link.ts` and `journal-anchor.ts` do exactly this for
performance budgets — self-checksum, then journal anchor, with `no_journal_anchor` and
`journal_anchor_mismatch` as distinct fail-closed outcomes. The work is extending a proven
local pattern to a second subject, not importing a foreign one.

Take the sequencing lesson with it: make the verification parameter required rather than
optional, and treat a missing seal after a cutover epoch as tamper.

## 2. Notification spine

Absent here. Nothing in `packages/` sends an outbound alert; the plugin's hook manifest
declares only `PostToolUse` and `Stop` (`packages/plugin/src/hooks-manifest.ts:34`), with no
`Notification` hook, and the only push is the in-band UDS event stream that `--watch`
consumes. That is fine while a human watches the terminal, and it is the binding constraint
the moment a run is expected to survive unattended.

Archon's design, worth copying whether or not its code is:

- **Claim-then-confirm delivery.** Insert `pending`, then mark sent or failed — never
  optimistically record `sent` before the transport returns.
- **A partial unique index** over the live states (`pending`, `sent`) rather than a full
  unique constraint, so a failed delivery does not poison the dedupe key forever.
- **A TTL-memoised transport health probe that fails toward attempting** — only a definitive
  "unavailable" suppresses a send, so a flaky probe never silently swallows alerts.
- **A reaper for stranded `pending` rows and a pruner for old `failed` ones**, both periodic
  rather than start-only.
- **Surface the degraded state to the operator** instead of failing quietly.

Note the dependency: dedupe keys are what make episode counters (item 6) necessary. Without
notifications, crabgic does not need them.

## 3. Terminal output is an injection boundary

`crabgic status <run-id> --watch` is a line-append event stream, not a refreshing
dashboard, and `--watch` is deliberately not honoured for the all-runs form
(`packages/cli/src/output/status-renderer.ts`, `commands/real-handlers.ts:89-91`). Whether a
full-screen dashboard is worth building is a product question.

The safety lesson is worth taking regardless, and it is cheap. Rendering worker-authored
text — task titles, park reasons, decision labels — into a terminal is a transport
boundary for untrusted input. Archon's answer was a branded `SafeCell` type produced only by
its sanitiser, which makes interpolating a raw string into rendered output a **compile
error**; the sanitiser strips C0/C1 control bytes (killing ESC/CSI/OSC sequences including
OSC 8 hyperlinks and OSC 52 clipboard writes) plus Unicode bidi and zero-width spoofers.

Crabgic already renders worker-authored text to terminals today. The branded-type trick
turns a review-time discipline into a compiler-enforced one, which is exactly the kind of
mechanisation `docs/security-posture.md` favours.

## 4. Context and token economy

Crabgic measures `{turnsUsed, totalCostUsd}` per attempt
(`packages/contracts/src/contracts/worker-result.ts:64-73`, `.strict()`) — no token counts,
no cache-hit rate, no context headroom. `packages/scheduler/src/budgets.ts` caps prompt
bytes per task-packet field, which is a different thing from context accounting, and
`maxTurnsPerAttempt` is the only ceiling. There is no budget-triggered handoff.

Archon built the fuller version — compaction of stale tool outputs, distilled subagent
returns under a cap, budget-triggered handoff, never-run-out continuation. **Take the schema
and the concepts; do not take its conclusions.** Its own final audit found three of six
"mechanised" economy labels overstated, with two of the primitives having zero production
call sites, and its Sonnet-vs-Opus routing decision rested on a two-turn toy sample it
honestly flagged as such. The lesson is as much about labelling as about measurement.

## 5. Effort as a first-class dimension

`packages/scheduler/src/router.ts` resolves a model per role
(`architect|planner|integration_review|security_review` → opus, `chore|mechanical_chore` →
haiku, default sonnet) with envelope override taking precedence. There is **no effort
dimension in code** — the status line displays effort read from the Claude Code session
payload, but nothing routes on it.

Two findings are worth importing before anyone adds one:

- **Pin model and effort once per session, not per turn.** Archon measured a mid-session
  switch costing a full cache write (~35.7K tokens observed). Escalation should therefore
  happen only at a fresh-session boundary, never against a live resume.
- **A failure-escalation ladder** (effort high → xhigh → max, then model sonnet → opus) is a
  cheap answer to a stuck unit, but only under that pinning rule.

Anything engine-touching here must cite `docs/engine-baseline.md` and its pinned range —
archon's measurement is a starting hypothesis to re-verify, not a fact to inherit.

## 6 & 7. What crabgic should deliberately NOT take

**Park episode counters.** Crabgic excludes re-park from dispatch counting on purpose —
`countPriorDispatches` skips a `dispatched` whose `previousStatus` was `parked:rate_limit`,
so a rate-limit park never burns the repair budget. Archon needed episode numbering to stop
dedupe-key collisions across park → resume → re-park; that is a _notification_ problem.
Importing the counters without the notification spine would add state for no benefit.

**The 33-agent, 52-skill corpus.** Crabgic ships 5 subagents and 6 skills, manifest-validated,
with every subagent denied write-capable tools and the `approve` skill forced to
`disable-model-invocation: true` so a model cannot satisfy its own approval gate. That is a
better-enforced surface than a larger one. Archon's own audit found that 17 of its subagent
specialties were "spec without behaviour" with no consumers outside plumbing, that reviewer
roles held `Bash` while their prose forbade code changes ("advisory theatre"), and that its
skill router was polluted by ~100 irrelevant injected skills. Growth here should be
evidence-driven, one role at a time.

## 8. The doctrine worth keeping

Archon's most valuable export is not code. Over six recorded iterations its own gate kept
catching its own author's security fix, and the honest conclusion it eventually wrote down
was that same-uid unforgeability is impossible: any file or environment scheme leaves a
`/proc/<daemon>/environ` residual, so what it had was defence-in-depth and detectability,
not a wall. It then labelled the residual in its rules rather than hiding it, and recorded
the real closure (separate uid, container, or database write-separation) as owned and
deferred.

Crabgic already practises this — `roadmap/README.md` refusing to tick 186 criteria from
general confidence is the same instinct. Worth stating outright in `docs/threat-model.md`:
**name the ceiling you cannot reach instead of claiming a wall you do not have.**

## Provenance

Archon is frozen at `feature/archon-evolution` (pushed 2026-08-01), tip
`b5ba775`, with `f8c6402` preserving two finished-but-ungated slices. Its
`STATUS.md` records what is and is not trustworthy there. Its Phase 2 ledger
(`.archon/work/product-state.md`) is the primary source for the seal, gate-trust and economy
histories summarised above.
