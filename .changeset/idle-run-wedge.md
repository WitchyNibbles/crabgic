---
"crabgic": patch
---

**A failed run no longer wedges its change set forever.** An ordinary single-unit failure — or any
DAG that ended all-terminal without succeeding — was reported by the scheduler as a _completion_,
because the stop reason only asked whether anything was still pending or parked, never whether the
terminals were successes. A completion has no run transition to write (its successor is the
verification stage, which is not wired yet), so the run stayed in `running` with every unit
finished: `crabgic status --watch` never terminated, `crabgic run` refused the change set with
"already has run … in flight", and `crabgic cancel` was the only way out. A run's drive now records
how it actually ended — `failed` when a unit failed, `cancelled` when units were cancelled and none
failed — so retrying is just `crabgic run` again, as a fresh run with its own repair budget. This is
the same defect as the 1.5.0 correction's restart-with-a-parked-run case, in its failure-shaped
half, and it reached more than the obvious trigger: mixed success-and-failure DAGs, leaf failures,
runs re-driven after a daemon crash, units stopped by `worker.terminate`, and exhausted repairs all
wedged the same way. An all-succeeded run still waits in `running` for the verification stage;
that deferral is unchanged.

**And `crabgic resume` will not claim to have resumed one.** Resuming a run whose every unit is
already terminal cannot dispatch anything, so it is refused rather than accepted — naming how many
units failed or were cancelled, why waiting cannot help, and the `crabgic cancel` that does work.
This covers runs already wedged by the old behaviour, which the journal replays as `running` after
every restart. Resume still accepts a run with real work left, including one holding a parked unit
whose session this daemon can still reach.
