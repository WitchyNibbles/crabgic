---
"crabgic": patch
---

Make `resume` skip already-finished work by seeding from the journal — and remove the attempt cache it supersedes.

Nothing updates a stored `WorkUnit.attemptStatus` after intake — only the
journal records transitions — so `driveRun` seeded every unit `pending` on a
re-drive. A `resume` (crash recovery, limit-park re-dispatch) therefore
re-selected units that had already succeeded/failed, re-executing them or
crashing the whole drive at `dispatchAttempt`'s repair-evidence gate
(`RepairEvidenceRequiredError`, uncaught).

`driveRun` now seeds each unit's status from the journal's latest attempt,
scoped to THIS run (`getLatestAttemptForRun`). A re-drive sees the real
state: `computeReadyUnits` advances only `pending` units, so terminal and
parked units are left as the prior drive left them, and the crash is gone at
the root. A unit whose latest status is `dispatched` at drive entry (a prior
drive that crashed mid-flight) is seeded `failed` — neither silently re-run
nor misread as `completed`. The read is run-scoped because work-unit ids are
stable across runs of the same change set, so a workUnitId-only read would
seed a retry RUN from the PRIOR run's journal.

**This replaces the in-memory attempt cache** shipped days earlier (wiring
phase 13's `SchedulerCache` into the run driver, then keying it on the
policy digest). Adversarial review found the cache was now dead: journal
seeding sits upstream of it and, being read from the durable journal, does
the same succeeded-attempt reuse **restart-safely** (the cache was
in-memory and explicitly did not survive a daemon restart) and without a
second mechanism to keep in sync. Rather than ship two mechanisms where one
can never fire — and a cache-hit test that passes even if the cache is a
no-op — the cache layer (`AttemptCacheSeam`, `attempt-cache.ts`, the
dispatcher wiring) is removed. `SchedulerCache` itself remains an offered
phase-13 primitive with its own tests.

The policy-only sandbox dimensions the cache's digest key was guarding
(`allowedWriteScratchPaths`, `allowUnixSockets`) need no special handling
here: a unit that already succeeded committed its work under the authority
in force at the time; a later policy narrowing governs future dispatches,
not a retroactive re-run of completed work — which is exactly what
journal-seeding does.

Remaining scope (one tracked follow-up): actively resuming a parked unit
(needs `resumeAttempt` wired with a reconstructed session), transitioning
run-state on drive settle, and run-scoping `countPriorDispatches` so a retry
as a genuinely new run gets its own repair budget.
