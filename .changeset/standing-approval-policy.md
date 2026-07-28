---
"crabgic": minor
---

Replace per-ChangeSet approval with a standing `EnvelopePolicy`, and close the loop between an approved change set and a run.

`crabgic install` now derives an authorization policy from the repository, renders it in full, and writes it `0600` into the project's XDG state directory — never the repo, since a committed standing grant is one every clone would carry. Every dispatch is then checked for containment in it: inside, the run proceeds with no prompt and no token; outside, it is refused before a run exists, so fixing the policy and dispatching again just works. The policy also narrows the compiled worker sandbox, which is what makes standing approval sound rather than nominal — without it a worker's allow-listed test command could reach the whole worktree through a child process. Nothing reachable from a manager session can write or widen the policy, and `crabgic doctor` fails a policy that grants nothing.

This also fixes three defects found by auditing the shipped binary. Nothing in the system ever created a run record, so an approved change set had no execution path at all — `run.dispatch` now takes a change set and returns the run id it mints, and `crabgic resume` targets a separate `run.resume`. `crabgic status`, `resume` and `cancel` exited `0` with no output whenever the daemon was not already running, instead of reporting that it was unreachable. And run-lifecycle transitions performed a read-modify-write across an await, so a cancel racing a starting run could write two conflicting states into the journal.

Fresh worktrees now get their dependencies provisioned, without which `npm run test` and `npm run build` — two of the four commands a worker can ever be granted — failed in every worktree. And the manager session is taught two behaviours it did not have: research and clarify with the owner until the contract's sections are all answerable, and adversarially roast its own design, tests and implementation until a round finds nothing new, with a new read-only `eo-roaster` subagent to run those rounds.

Also hardens the standing policy against a local attacker: the writer can no longer be tricked into destroying an arbitrary file through a predictable temporary name, the loader validates the file it actually read rather than the path it was given, and a policy that grants nothing is now reported by `crabgic doctor` instead of passing every structural check while refusing every run.
