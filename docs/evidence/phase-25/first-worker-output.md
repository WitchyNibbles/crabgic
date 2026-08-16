# The first worker output — and the three defects behind it

**2026-08-16.** Run `97fb3b10-be7d-4edd-b777-a2e5ff66d00c`, ChangeSet
`2b6e9d18-7c40-4a55-9e31-8f0d24b7a611`, one work unit: close the three
clean-code advisories in `packages/cli/src/review/admissibility.ts`.

**An autonomous crabgic worker wrote code for the first time.** The run then
failed, for reasons unrelated to the code it wrote. All four facts below are
from the journal and the worker's own transcript.

## What changed: the parking defect

Every previous dispatch parked 3–12 seconds in and never came back. This one ran
**4 minutes 45 seconds** and never parked:

```
06:32:03.768  work_unit_transition  dispatched
06:36:48.176  work_unit_transition  failed
```

The cause is recorded in `fix(scheduler): only a REFUSAL parks a worker` —
`consumeEvents` parked on any `limitSignal`, and `rate_limit_event` is routine
usage telemetry carrying `status: "allowed"`.

## What the worker produced

35 insertions, 3 deletions, confined to its one owned path. It closed all three
advisories, and on two of them did better than the brief:

- **The header's bound count.** Asked to make the count match, it instead found
  that the fourth bound — monotonicity — is enforced by the **envelope**, not by
  this module, and said so. Naming it here "would claim ownership of a guarantee
  this file cannot see, let alone check."
- **`touches`' one-directional containment.** It supplied the missing rationale
  correctly: the reverse direction would let a finding about an ANCESTOR of a
  written path (`packages/`, when the write set names `packages/cli/src/review/`)
  count as in scope, "re-admitting exactly the unbounded-subsystem shape §4.3
  exists to close".
- **`unrunObligations` accepting unissued answers.** Here it **refused the
  requirement**, arguing the current behaviour is correct: the bound is that
  every ISSUED obligation is answered and "has never claimed the converse", and
  rejecting a superset would make a pure function depend on a checklist shape
  owned by the server. Documented rather than changed.

That third one matters twice over: it is a worker declining to implement an
acceptance criterion it judged wrong — desirable in a colleague, and a thing the
criteria machinery must therefore be able to catch. It was not caught here,
because the run failed earlier for an unrelated reason.

## Defect 1 — the worker could not run a single command

From its own structured output, verbatim:

> Could not run npm run test/build/git status/diff to verify because the Bash
> tool's sandbox failed to initialize for the entire session ("Failed to create
> bridge sockets") — flagged this to the user as a caveat.

The envelope granted exactly four commands (`npm run test`, `npm run build`,
`git status`, `git diff`). **None of them could execute**, for the whole session,
on this WSL2 host.

This is structural, not incidental: three of the work unit's eight acceptance
criteria required a test to exist and pass. A worker that cannot run a command
cannot satisfy them, cannot verify its own diff, and cannot be held to a
"tests first" criterion by any gate downstream. Every run on a host with this
sandbox failure produces unverified work by construction.

## Defect 2 — the attempt failed on a schema violation

The worker returned `{"outcome": "succeeded", "summary": "…"}`. `WorkerResult`
additionally requires `schemaVersion`, `id` and `workUnitId`
(`packages/contracts/src/contracts/worker-result.ts`), so
`validateWorkerResult` rejected it as a `schemaViolation` 29 ms after the
structured output arrived.

The worker was not told the shape it owed, or was told incompletely. Either way
the failure is the harness's, not the model's: a contract the caller never
publishes cannot be met.

## Defect 3 — that failure reached the journal with no reason

The `schemaViolation` branch records the `failed` transition and **journals
nothing about why**:

```
{"status": "failed", "previousStatus": "dispatched", "sessionId": "…"}
```

No `adjudication_decision`, no diagnostics. The diagnostics exist — they are
returned to the caller in-memory and discarded.

The seal-refusal branch **twelve lines below it** does the opposite, and its
comment states the rule the sibling branch breaks:

> Journaled BEFORE the `failed` transition … a crash between the two must leave
> the REASON behind, not a bare `failed` nothing accounts for.

An operator meeting this sees a run that failed for no stated cause. Recovering
the reason took reading the executor's branches and the worker's raw transcript.

## Ordering

Defect 2 is what failed this run; defect 1 is what would have failed the next
one; defect 3 is what made both expensive to find. Fixing 3 first is the cheapest
— it is the one that makes the other two announce themselves.
