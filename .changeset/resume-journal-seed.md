---
"crabgic": patch
---

Stop a re-drive from crashing at the repair-evidence gate — seed unit status from the journal.

Adversarial review of the attempt cache (PR #17, F1) found that the resume
scenarios the cache exists for still deterministically crashed. The root
cause was upstream of the cache: `driveRun` seeded each unit's status from
the stored `WorkUnit.attemptStatus`, and nothing updates that after intake —
only the journal records transitions. So every `resume` (crash recovery,
limit-park re-dispatch) re-seeded every unit `pending`, re-selected units
that had already succeeded/failed/parked, and hit `dispatchAttempt`'s
repair-evidence gate with `evidenceKind: "none"` — which threw
`RepairEvidenceRequiredError`, uncaught, crashing the whole drive.

`driveRun` now seeds each unit's status from the journal's latest attempt,
falling back to the stored status only on a first drive with no history. A
re-drive therefore sees the real state: `computeReadyUnits` advances only
`pending` units, so already-terminal and parked units are left as the prior
drive left them, and the crash is gone at the root. A unit whose latest
journal status is `dispatched` at drive entry (a prior drive that crashed
mid-flight) is seeded `failed`, so it is neither silently re-run nor misread
as `completed` — deliberate re-execution remains 13's evidence-gated
`resumeAttempt` path.

The seed is scoped to THIS run (new `getLatestAttemptForRun`), not every
attempt for the work-unit id. Work-unit ids are stable across runs of the
same change set, so a workUnitId-only read would seed a retry RUN from the
PRIOR run's journal — the same cross-run contamination the attempt-cache key
was run-scoped to avoid (its own review's F2).

Scope, stated honestly — three pieces remain, all tracked as one follow-up:
(1) this does not yet ACTIVELY resume a parked unit (needs `resumeAttempt`
wired with a reconstructed session); a parked run now correctly classifies
`parked` and waits rather than crashing. (2) a drive that settles
failed/blocked still leaves the run record `running` (the dispatcher does
not transition it). (3) a retry as a genuinely NEW run is still refused by
`countPriorDispatches` (workUnitId-only — inherits the prior run's repair
budget); run-scoping that counter is a security-adjacent change deferred for
its own review. The same-run resume crash — the one this fixes — is
independent of all three.
