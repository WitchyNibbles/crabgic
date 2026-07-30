---
"crabgic": minor
---

`crabgic status <run-id>` answers "how far has it got?", not just "is it going?".

The run record carries a lifecycle state, so `status` printed one line saying
`running`. For a run spanning several work units across several minutes, that is
the less useful of the two questions an operator has, and the other one — how much
is done, how much is stuck — was already in the journal with nothing reading it.

There is now a progress line under the run line: how many work units have
succeeded, are running, are parked on a rate limit, or have failed.

`--json` is deliberately left alone. That output is literally 05's published
`RunStatusResultSchema` — the raw UDS result, never re-shaped — and the schema is
strict, so the first attempt at this broke a real conformance test. Widening it is
a cross-phase interface decision the ledger governs, and a rendering improvement
does not get to smuggle a key in; the restraint is now pinned by its own test.

It is **derived, never stored**. The journal is the record and this is a fold over
it, so the progress view cannot drift from what actually happened — there is no
second copy to disagree. Later entries win per work unit, which is what makes it
current status rather than a history.

And it reports what the journal has SEEN, which is deliberately not the same as
what the plan contains: a work unit never dispatched has no entry and cannot be
counted. So the line says "work units seen", and when none have been seen it says
nothing at all rather than "0 of 0" — a denominator this cannot know would look
authoritative and be wrong. An unrecognised status is printed rather than dropped,
because a status the renderer has never heard of is exactly the thing worth
seeing.
