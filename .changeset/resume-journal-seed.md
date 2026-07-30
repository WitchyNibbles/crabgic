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

`driveRun` now seeds each unit's status from the journal's latest attempt
(`getLatestAttempt`), falling back to the stored status only on a first
drive with no history. A re-drive therefore sees the real state:
`computeReadyUnits` advances only `pending` units, so already-terminal and
parked units are left as the prior drive left them, and the crash is gone at
the root. A unit whose latest journal status is `dispatched` at drive entry
(a prior drive that crashed mid-flight) is seeded `failed`, so it is neither
silently re-run nor misread as `completed` — deliberate re-execution remains
13's evidence-gated `resumeAttempt` path.

Scope, stated honestly: this makes re-drives correct and crash-free for
succeeded/failed/terminal units. It does NOT yet ACTIVELY resume a parked
unit (that needs `resumeAttempt` wired with a reconstructed session — a
separate follow-up) — a parked run now correctly classifies `parked` and
waits, rather than crashing.
