---
"crabgic": patch
---

Fix the last two load-sensitive tests, and raise a lease budget that was thinner
than it looked.

Neither had the cause it appeared to have, and one of them was pointing at
production.

**The concurrent-token test was not a concurrency bug — but it was conflating two
claims.** It asserted that exactly one of several overlapping verifications of the
same single-use token succeeds. Under full-suite load it failed _fast_, which
ruled out a timeout: the loser had exhausted its lease-acquire budget while the
winner was still fsyncing, and rejected with a lease error instead of
`ApprovalTokenAlreadyVerifiedError`. Nothing was double-spent — the safe direction
— but "at most one succeeds" is a security property and "exactly one succeeds" is
a liveness one, and folding them into a single assertion made a liveness hiccup
read as a security failure. They are now separate, and the security half is
asserted unconditionally.

**And the budget it exhausted was thin in production too**, which is the part that
was not a test problem: a verification waited only 20 attempts at 10ms — 200ms —
for a concurrent verification of the same token to finish. Raised to 1s, still
well inside the 5s lease TTL so a waiter cannot outlive a dead holder's lease.

**The benchmark-adapter tests were a borrowed timeout.** Every case spawns a real
node process, so its cost is dominated by process startup rather than by the
benchmark inside it: ~1.2s for the whole file alone, competing with hundreds of
other spawns inside a 600-file parallel run, against a fixed 15s budget. Reported
for weeks as a flaky benchmark. Now 60s — about 50x the isolated cost, so the
assertion is decided by the measurement rather than by how busy the machine is.

Measured rather than assumed, both before and after: the suite previously failed
roughly one run in three, from a pool of four distinct tests. Six consecutive
full-suite runs are now clean.
