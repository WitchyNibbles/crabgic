---
"crabgic": patch
---

Give phase 13's scheduler cache its production caller, because resume needed it.

Measured first, per the house rule: nothing ever updates a stored
`WorkUnit.attemptStatus` after intake — the journal alone records
transitions — so a re-drive of a run re-seeds every unit `pending`, and an
already-succeeded unit was either re-executed with a real engine worker or,
once its dispatch was journaled, refused outright by 13's repair-evidence
gate. Meanwhile `SchedulerCache` shipped in phase 13 with zero production
callers: its exit criterion was satisfiable by unit tests alone, and was.

Now `driveRun` takes an optional `AttemptCacheSeam` and the daemon's
dispatcher passes one per daemon lifetime: a SUCCEEDED attempt's outcome is
cached and a re-drive reuses it — no adapter, no worktree, no engine
process, and no journal entry (the first attempt's transition is already the
durable record; a duplicate would double-count spend in `status`).

The key is `hashAttemptContent(runId, packet)`: every packet field except
the per-attempt random `id` (hashing that would make every key unique and
the cache a control that looks installed and is not), **scoped to the run**
— adversarial review caught that a runId-free key let a retry run of the
same change set on an untouched repo silently absorb a cancelled run's
work, invisible to `status <new-run>` and with no invalidation API to force
re-execution. Run-scoped, a hit can only return work the same run already
did; a retry run always re-executes.

Scope, stated honestly (the review tightened every clause here): same RUN,
same DAEMON (in-memory; 13 deferred persistence — restart-safe re-dispatch
remains the ledger's carry-forward), succeeded outcomes only. And what this
does NOT fix: a re-driven unit that previously failed or parked is still
REFUSED by the repair-evidence gate, because the `parkResume`/repair
triggers live on `resumeAttempt`, which has no production caller — the same
shipped-but-unwired class this change closes for the cache, now tracked as
its own follow-up.
