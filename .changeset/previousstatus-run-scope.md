---
"crabgic": patch
---

Run-scope `recordAttempt`'s `previousStatus`, closing a repair-budget off-by-one.

The prior change run-scoped the repair count (`countPriorDispatches`) but
left `recordAttempt`'s `previousStatus` derived across ALL runs of a work
unit. Adversarial review caught the resulting inconsistency: if run A left a
unit's latest transition at `parked:rate_limit` (a rate-limit park that was
never resumed), run B's FIRST dispatch of that same unit inherited
`previousStatus = parked:rate_limit` from run A — which the park-resume
exclusion then wrongly treated as a park-resume and excluded from run B's own
count, letting the unit take a 4th dispatch before the cap fired.

`recordAttempt` now derives `previousStatus` run-scoped (via
`getLatestAttemptForRun`) when a `runId` is given. Within a single run this
is identical to the unscoped read — the within-run park→resume exclusion is
unchanged — so only the cross-run inheritance is removed, aligning
`previousStatus` with the now-run-scoped count. Direction of the old bug was
inflation-only (it never over-refused), so this tightens correctness without
changing any passing behavior.
