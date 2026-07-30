---
"crabgic": patch
---

Transition a run out of `running` when its drive ends in failure, so the change set is retryable.

`beginDriving` discarded `driveRun`'s result and only released the in-flight
claim — so a drive that ended `blocked`, tripped the round backstop, or threw
left the run `running` forever. `findLiveRunForChangeSet` treats `running` as
in-flight, so that change set could never be re-dispatched: a failed run
wedged the change set with no recovery short of a daemon restart (review F5).

`beginDriving` now captures the drive's outcome and moves the run to its
terminal state on the FAILURE paths: `blocked → blocked`, the round-backstop
`roundLimit → failed`, and a thrown drive `→ failed`. These are absorbing
states, so the existing "retry after the prior run ended failed/blocked"
path unblocks. The transition tolerates the run having reached an absorbing
state independently — a `run.cancel` racing the settle leaves the run
`cancelled`, making the drive's own transition an illegal edge, which is
expected and swallowed.

`completed` and `parked` deliberately stay `running`: a completed DAG's
successor is `verifying`, owned by the verification pipeline (not yet wired)
rather than invented here, and a completed run must not be retried anyway; a
parked run is resumable and must stay in-flight for `resume` to reach it.
