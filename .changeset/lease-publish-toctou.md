---
"crabgic": patch
---

**Two daemons could hold the same project lease at once.** Claiming a lease created the lease file
and wrote the holder's record into it as two separate steps, so for a sub-millisecond window the
file existed and was empty — and an empty lease file reads as "no holder at all", which grants a
takeover without ever checking whether the recorded process is still running. A second `crabgic`
invocation landing in that window took the lease from a live daemon and both believed they held it.
Two concurrent invocations racing to start the daemon is an ordinary, expected event (two terminals,
a hook alongside a CLI call, a retry overlapping a slow boot), the project lease is the journal's
only single-writer guarantee, and two writers on one hash chain produce a chain the journal
classifies as tampering. Measured at 9 double acquires in 11,000 races on an idle machine.

A lease is now published by writing the complete, fsynced record under a private name and linking
it into place, so the lease path is never visible without its full contents. Two related holes
closed with it: a lease that disappears mid-check now sends the contender back to a claim it can
lose cleanly, instead of a replace that cannot lose and would overwrite whichever process claimed
the lease in between; and a lease file that cannot be read (permissions, an unexpected directory, a
failing disk) is no longer treated as an absent one, which used to hand out the lease on an I/O
error. A genuinely corrupt lease still self-heals, and a live holder is still never displaced.
