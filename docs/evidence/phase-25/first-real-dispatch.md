# The first real dispatch — measured, 2026-08-15

**Status:** dispatched, running, **parked on the account's rate limit.** Not
completed. What follows is what the journal recorded, not what the run was
expected to do.

**Run** `08f1f1dd-b246-403e-b6b8-325d16fc26d5` ·
**ChangeSet** `9f2a1c40-5b7e-4a31-9c62-3d8e07b41f55` · repo `HEAD` at `734da33`

## Why this run could happen at all

`unattended-run-gap.md` listed a standing `EnvelopePolicy` as the prerequisite
only the owner could supply. **It already existed** — the owner's terminal
`install` wrote it at 18:46 the same day, and nobody checked:

```
~/.local/state/crabgic/47ea4ed1d22b4abf/envelope-policy.json
  allowedPathPrefixes: [packages, docs]
  allowedCommands:     [npm run test, npm run build, git status, git diff]
  maxWorkerTurnsPerAttempt: 40
```

`doctor` reports `policy.standing` PASS against it. The blocker was stale, in the
same way the audit-stage blocker in that document was stale: a state file was
asserted absent without being looked at.

## The work

The three clean-code advisories the first live round raised against
`packages/cli/src/review/admissibility.ts` and recorded **unfixed** — the header
claiming four bounds and labelling three, `touches`' unexplained one-directional
containment, and `unrunObligations` silently accepting an unissued answer. One
work unit, three requirements, eight acceptance criteria, owned paths confined to
that module and its test.

Chosen deliberately: real, already documented as owed, small, and inside the
standing policy's granted prefixes — so the run tests the machinery rather than
the envelope.

## What the journal recorded

Twenty entries. The load-bearing ones, in order:

| Entry                                    | What it proves                                                        |
| ---------------------------------------- | --------------------------------------------------------------------- |
| `draft → awaiting_approval`              | intake assembled the contract, DAG and envelope                       |
| `policy_contained` (approval)            | **approved with no prompt and no token** — the standing policy did it |
| `criteria_sealed`                        | 3 acceptance-criteria sets sealed AT approval, before any dispatch    |
| `awaiting_approval → ready`              | the readiness gate passed with every requirement mapped to a unit     |
| `policy_contained` (dispatch)            | dispatch authorized by the same policy                                |
| `ready → running`                        | the daemon took the run                                               |
| intake freeze at `HEAD@734da33`          | the base revision is pinned, not inferred later                       |
| worker session `19aee8b5` **dispatched** | a real envelope-bounded worker started                                |
| `dispatched → parked:rate_limit`         | the account's quota, not a crabgic refusal                            |
| `rate_limit_park_timer` `resetsAt` 21:30 | park recorded with its own reset, adapter retained                    |
| **`parked:rate_limit → dispatched`**     | `resume` continued the SAME session against the retained adapter      |
| `dispatched → parked:rate_limit` again   | quota still exhausted; new `resetsAt` 02:50                           |

**No human approved anything in that sequence.** That is the half of the owner's
"from this point no human feedback is needed" that this run does demonstrate.

## The gap it found: nothing calls `resume`

The park is correct and the resume is correct — `resume` re-dispatched the same
session and the retained adapter worked exactly as designed
(`run-dispatcher.ts`: adapters are kept "ONLY while the run is parked, so a later
`resume` can continue the session").

**What is missing is the caller.** The timer is recorded in the journal; nothing
reads it back and fires. An unattended run that meets a rate limit therefore
parks and stays parked until a human — or a manager loop that does not yet exist
— calls `resume`. Both times, that was the operator.

For the owner's condition this is the sharper finding of the two:

- ✅ approval, sealing, dispatch and the worker itself need no human
- ❌ **surviving a rate limit does**, and a long run will meet one

The remedy is a resume driver that reads `rate_limit_park_timer` and re-dispatches
at `resetsAt` — a scheduler concern, small, and not a spend question. It is not
implemented here because implementing it against a live parked run would have
meant changing the code under test while it ran.

## Two smaller observations, recorded rather than fixed

- `crabgic status` showed `updatedAt` frozen at the park (19:27:32Z) across five
  further journaled transitions. The run record's timestamp is not advancing with
  its own work-unit transitions, so an operator watching `status` sees a run that
  looks stuck when it is not.
- `doctor` reports `hermeticity.selftest` as failing with "self-test did not
  execute". Reproduced by hand: the probe isolates `HOME`, which strips
  subscription credentials, so `claude` returns
  `"Not logged in · Please run /login"` and the probe can **never** execute on a
  subscription-auth host. The check is honest — it refuses to claim absence
  evidence it does not have — and structurally unpassable on the auth mode this
  product ships for.

## What this run does NOT show

It has produced **no code**. The worker was dispatched twice and rate-limited
twice; it has not written, tested or completed anything. Every claim above is
about the machinery that got it there, and none is about the quality or
convergence of worker output — which stays exactly as unmeasured as it was.
