---
"crabgic": minor
---

Decide routine approval by the standing policy, not by asking.

Ledger Gap 18 ruled in July that routine approval moves from _per-envelope, at
dispatch time_ to _per-envelope-class, ahead of time_: `crabgic install` writes
an `EnvelopePolicy`, and work contained in it runs with no prompt and no token.
The dispatcher has enforced that check since PR #1 — but nothing reached the
dispatcher, because `crabgic run` still stopped at a prompt for every change
set. The ruling was implemented at the end of the pipeline and missing at the
front, so the promised experience ("the user types no Crabgic command") was
unreachable in the shipped binary.

`run` now tests the freshly-built envelope for containment before it considers
prompting, and reports one of three outcomes rather than collapsing them:

- **ready, covered by the standing policy** — nobody is asked, no token exists,
  and the authorizing policy digest is journaled so "what was the human standing
  behind when this ran" stays answerable after the fact.
- **escalation** — the envelope reaches outside the policy, or there is no
  readable policy at all. Every escaping dimension is named at once, because the
  owner has to edit a file this process cannot reach, and one refusal should not
  send them into an iterative guessing game. `crabgic approve <digest>` answers
  this at their terminal.
- **not ready** — a requirement no work unit owns. That is a planning gap, not an
  authority question, and prompting for it would ask a human to authorize
  something that would refuse anyway.

Absent and unreadable policies both deny, and are reported differently on
purpose: one means `install` never ran, the other means a file was edited into a
state the schema rejects, and those send an owner to different places.

The `/eo:run` skill drops its "once 11/13 land the drafting flow" placeholder and
describes what actually happens: the manager session drafts the intake request
from the conversation it already had, hands it to the CLI, and reads the verdict.

**And an approved change set now actually starts.** `run.dispatch` — the
operation that creates a run, mints its id and drives the DAG — had exactly one
caller in the repository, and it was a test. Every shipped path stopped at
`ready`, so the entire worker/gate/publication half was real, tested,
unreachable code. `run` and `approve` both dispatch once the change set is
approved, and report the run id. A refused or unreachable dispatch is reported
as what it is — the approval already happened and is durable, so the remedy is
retrying the start, never re-authoring the request.

**The published binary could never spawn its own daemon.** Found by running the
built artifact in a real scratch project — which the diagnostics added a day
earlier are what made visible, instead of the generic "unreachable socket" this
had been reporting since bundling was introduced. `spawnSupervisorDaemon`
resolved one candidate path, correct for the `tsc` layout and wrong for the
published one: esbuild splitting puts that code at the dist root, so it looked
for `packages/cli/bin/supervisord.js`, a path that has never existed. Every
daemon spawn in the published package died with `MODULE_NOT_FOUND` behind
`stdio: "ignore"`, which took `run`'s dispatch, `status`, `resume` and `cancel`
with it. Both layouts are now checked, an absent daemon names every candidate it
looked in, and `check:install-smoke` asserts the CLI's own resolver finds the
daemon inside a real installed tarball — the only place that claim can be
tested, and the same lesson the plugin-asset defect taught in 1.0.0.

**Re-running intake no longer throws.** Intake is idempotent by design, so a
second `crabgic run` on the same request replays a ChangeSet the standing
approval already advanced — and the transition then threw `ready -> ready` out
of the command, after journaling a second authorization for work that was
already authorized. A replay now re-checks containment (so a policy narrowed
since is still caught) and reports the existing approval without recording a
duplicate.
