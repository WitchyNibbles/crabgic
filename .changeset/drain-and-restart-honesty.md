---
"crabgic": patch
---

**Shutting the daemon down no longer risks the journal.** `run.dispatch` deliberately leaves its
drive running in the background, and the project lease is the journal's only single-writer
guarantee — but teardown released that lease with the drive still appending. An ordinary SIGTERM
mid-run therefore freed the lease, the next `crabgic` call spawned a second daemon that acquired it,
and two writers on one hash chain produce a duplicate `seq` that the journal classifies as tampering
rather than as a torn tail. Shutdown now closes the control plane, drains the dispatcher, and
releases the lease last — and not at all if something is still writing, because a lease left held by
a departing process is reclaimed safely by the next daemon and a lease handed over under a live
writer is not reclaimed at all. Runs cut off at the drain deadline have their workers terminated and
their end recorded, so a restart sees a finished run instead of one that can never finish.

**A restart with a parked run says what it means.** `crabgic resume` used to report success and do
nothing: the parked unit's engine session is same-daemon state, a restart loses it, and the run
re-parked forever while its change set stayed un-dispatchable. It now refuses with the reason and
the one command that works. Startup recovery no longer mistakes a rate-limit park for a crash — the
park record is the truth about a session that is waiting on purpose — and when it does reap a
genuine crash it attributes the record to the run, so run-scoped and unscoped readers of the journal
can no longer disagree about whether a work unit failed.
