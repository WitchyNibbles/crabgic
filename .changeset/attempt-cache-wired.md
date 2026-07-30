---
"crabgic": patch
---

Give phase 13's scheduler cache its production caller, because resume needed it.

Measured first, per the house rule: nothing ever updates a stored
`WorkUnit.attemptStatus` after intake — the journal alone records
transitions — so `crabgic resume` (crash recovery, limit-park re-dispatch)
seeds every unit `pending` and a re-drive either re-executed an
already-succeeded unit with a real engine worker, or — once that unit had a
journaled dispatch — was refused outright by 13's repair-evidence gate. The
resume the product advertises could not actually resume past completed work.
Meanwhile `SchedulerCache` shipped in phase 13 with zero production callers:
its exit criterion was satisfiable by unit tests alone, and was.

Now `driveRun` takes an optional `AttemptCacheSeam` and the daemon's
dispatcher passes one (per daemon lifetime, salted with the accepted engine
range): a SUCCEEDED attempt's outcome is cached under the packet's content
hash — every field except the per-attempt random `id`, which would have made
every key unique and the cache a control that looks installed and is not —
and a same-daemon re-drive reuses it. A hit stands up no adapter, no
worktree, no engine process, and journals nothing (the first attempt's
transition is already the durable record; a duplicate would double-count
spend in `status`). Only successes are cached: failed, crashed, parked and
cancelled attempts genuinely re-execute, and repair re-dispatch stays 13's
evidence-gated path.

Scope, stated honestly: the cache is in-memory (13 deferred persistence), so
this covers exactly the same-daemon resume scenarios. A re-drive after a
daemon restart still re-executes; restart-safe re-dispatch remains the
ledger's separate carry-forward.
