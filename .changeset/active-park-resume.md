---
"crabgic": minor
---

Actively resume a rate-limit-parked unit once its reset window passes (same-daemon).

When a worker hit an account/rate limit it was parked with its session
retained, but nothing ever continued it: `driveRun` seeded the unit
`parked:rate_limit`, `computeReadyUnits` (which only advances `pending`
units) skipped it, and the run sat `parked` forever. The unit could not even
be re-dispatched fresh — its original dispatch counts toward the repair
budget, so the gate would refuse it.

`driveRun` now, when no fresh unit is ready, resumes every parked unit whose
reset window has passed (`getParkStatus.readyToResume`) via a new
`resumeParkedUnit` seam — 13's `resumeAttempt({kind:"parkResume"})` path,
which skips the repair gate (a rate-limit park is an external throttle, not a
failed action) and folds the outcome back like a fresh dispatch. The daemon
dispatcher implements the seam by RETAINING each unit's adapter and
reconstructing the session's `SessionRef` from it, so the resume runs on the
same adapter instance that spawned the session — continuing with full
authority rather than the read-only fallback a stranger adapter would get.

The retained adapters are keyed per-RUN at the dispatcher level
(`retainedByRun`), so they survive ACROSS this daemon's re-drives of the run.
A unit parked while its reset window is still in the future ends its drive
`parked`; the `crabgic resume <runId>` path re-drives once the window passes
and finds the same adapter waiting. (A per-`drive()` map would be empty on
that later drive — the feature's whole point is that it is not.) `getParkStatus`
is run-scoped when a `runId` is in hand: work-unit ids are stable across runs
of the same change set, so an unscoped read could report another run's park
(and session id — which the retaining adapter would miss, silently
downgrading the resume to read-only).

Honestly scoped: **same-daemon only.** `retainedByRun` lives in the daemon
process's memory, so a daemon restart loses it; a re-drive after restart finds
no adapter and the seam declines (returns `undefined`, leaving the unit
parked) rather than resume into a read-only session that could not complete
the work. Restart-safe session resume remains the ledger's separate
carry-forward. Live end-to-end verification that a real engine session
continues with write authority after a `parkResume` is owed as a live probe,
following this repo's wiring-plus-owed-probe pattern; the wiring, the
across-drive retained-adapter reuse, and the read-only-fallback avoidance are
unit-proven (a fresh adapter's `resume` throws for an unknown session, so the
passing test could only have used the retained one).
