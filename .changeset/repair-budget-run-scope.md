---
"crabgic": patch
---

Run-scope the repair-evidence budget, so a retry as a new run isn't refused by a prior run's exhausted count.

Work-unit ids are stable across runs of the same change set, and
`countPriorDispatches` counted `dispatched` transitions by work-unit id
across ALL runs. So a retry of a change set as a genuinely new run inherited
the prior run's repair budget (`MAX_TOTAL_DISPATCHES = 3`) and was refused at
the repair-evidence gate — the last piece keeping a retry-as-new-run from
completing (the journal seed was already run-scoped; this is its
counterpart).

`countPriorDispatches` and `assertRepairAllowed` now take an optional
`runId`; `dispatchAttempt`/`resumeAttempt` thread the run's own id through.
Scoped, the count sees only that run's dispatches; absent (direct
evidence/traceability callers), it is unchanged.

Security intent preserved: the budget exists to stop a REPAIR LOOP within a
run from re-running failing work. A fresh run is a deliberate, containment-
gated, journaled dispatch — a new authorized attempt sequence, not a way to
launder a failed one — so it legitimately gets its own budget. The
park-resume exclusion (a rate-limit park→resume never consumes budget) and
the evidence-distinctness check (deliberately NOT run-scoped — distinct
diagnostic evidence is a property of the work, not the run) are both intact.
