# Roast round 24 — the fix that re-opened the bug it followed

Read-only review of round 23. Non-degeneracy control executed first and
discriminated four ways (real bwrap PASS, no-op shim FAIL, no bwrap FAIL,
`--bind` control FAIL) before any PASS was trusted.

## Finding 1 (MEDIUM-HIGH) — round 23's reaped gate re-opened round 22's orphan

Round 23 skipped the group kill for an already-reaped child, on the reasoning
that its pid could be recycled — and argued the dangerous case needed "a
descendant **outside** the group". That was wrong, and the commoner case is the
one that suffered: any child that forks and exits (`sh -c 'x & exit'`, a wrapper
script, a shim) is reaped while the grandchild **inside** the group holds the
pipes. The gate skipped the kill and the survivor lived on.

Same grandchild, same 400 ms ceiling; the only difference is whether `sh` had
already exited:

| trial                             | before                                   | after  |
| --------------------------------- | ---------------------------------------- | ------ |
| child reaped, grandchild in group | **survivor wrote its witness 2 s later** | killed |
| child alive, grandchild in group  | killed                                   | killed |

That is round 22's finding 1 verbatim, while the file's own comment still
claimed the protection. **The suite actively enforced the defect**: turning the
gate off failed exactly three tests, all of them round 23's fake-child unit
tests asserting the group form was _not_ used, and nothing anywhere asserted the
absence of the orphan.

The hazard traded away needs a full pid wrap inside the ceiling (~40 s of churn,
against a 30 s and a 10 s ceiling) **and** the recycled pid to become a group
leader. The hazard traded for needs one fork. Gate reverted; the three tests now
assert the opposite, and two real-process tests cover both shapes.

Round 24 also measured live reachability rather than assuming it: real bwrap
does not fork-and-exit (28 trials across 7 ceilings → 0 survivors), so this bit
wrapper-script `bwrap`/`claude`/`git` and any future bounded probe of a forking
command.

## Finding 2 (MEDIUM) — the CI guard checked presence, not confinement

`bwrap --version` asserts bubblewrap exists; the test needs confinement to
_work_. They differ exactly where it matters — Ubuntu 24.04's
`apparmor_restrict_unprivileged_userns`, containers, hardened kernels. bwrap
would install, `--version` would exit 0, `CRABGIC_REQUIRE_BWRAP=1` would be set,
and the test would fail with `expected false to be true` on a required
every-push job, **throwing away the check's own finding**, which names the exact
sysctl.

Round 24 also corrected round 23's reasoning: `release-e2e.yml` and
`engine-live.yml` install bubblewrap but never assert it works, and both are
`workflow_dispatch`-only. Their green history is evidence the image lacks bwrap
— not evidence that bwrap functions on a runner. `ci.yml` is the first place
that assumption becomes load-bearing.

Fixed on both sides: CI now runs the **real confinement argv** and only sets the
require-flag when the sandbox demonstrably works, warning and skipping
otherwise; and the test asserts the evidence before the boolean, so a failure
reads:

```
AssertionError: expected 'bwrap failed to set up the sandbox be…' to contain 'correctly denied'
Received: "… bwrap: No permissions to creating new namespace … (Set the
kernel.unprivileged_userns_clone sysctl to 1 if available.)"
```

## Finding 3 (MEDIUM) — a `TMPDIR` class rounds 21–23 all missed

`isSetupFailure` matched its markers anywhere in stderr, and the marker path is
`TMPDIR`-derived and echoed back by the shell in its own error. Same host, same
second, working sandbox:

```
TMPDIR=.../bwrap:x                        -> passed:false "failed to set up the sandbox"
TMPDIR=.../creating new namespace failed  -> passed:false "failed to set up the sandbox"
TMPDIR=.../benign                         -> passed:true  "correctly denied"
```

Round 18's self-contradicting-evidence defect exactly: it asserted the write was
never attempted while quoting the shell proving it was attempted **and denied**,
then told the owner to reconfigure their kernel.

The discriminator was already in the argv and unused: `$0` is
`eo-sandbox-selftest`, so the shell prefixes its own errors with it, while bwrap
prefixes its own with `bwrap:` at line start. Classification is now per line and
by source. Verified: all three `TMPDIR` values PASS, a real setup-failure shim
still reports UNVERIFIED with the sysctl remedy, and a stderr carrying **both**
kinds of line still reports the setup failure.

## Finding 4 (MEDIUM, latent) — the signal handler destroyed every other handler

`process.removeAllListeners(signal)` plus a synchronous re-raise inside the same
emission aborted any other listener's async shutdown — order did not save it,
because the pre-existing handler was registered first and still lost:

```
{"probeInstalled":false,"exitCode":0,   "gracefulShutdownCompleted":true}
{"probeInstalled":true, "exitSignal":"SIGINT","gracefulShutdownCompleted":false}
```

`boot-supervisor.ts` registers exactly that shape (`await composed.close(); await
lease.release()`), so a SIGTERM would have left the lease held and the socket
open the moment the daemon ran a bounded probe. Latent today — probe use is
confined to `run-doctor.ts` — and a one-line trap for whoever adds the next one.
Now only our own listener is removed, and the signal is re-raised only when
nobody else is handling it.

## Finding 5 (LOW) — SIGQUIT was not forwarded

Ctrl-\ is keyboard-generated exactly like Ctrl-C, and was the one interactive
signal that still orphaned the probe child. One array element.

## Finding 6 (LOW) — residual leaks

Round 23's fix holds (~15,800 → 2 per full run). The two remaining:
`fixture-repo.ts`'s `freshTmpDir` is "tracked for cleanup by the caller" and one
caller does not; `run-dispatcher.test.ts`'s `afterEach` succeeds and a
deliberately-backgrounded drive then recreates the tree. Recorded, not fixed.

## Mutation record

| #   | mutation                                      | result                                         |
| --- | --------------------------------------------- | ---------------------------------------------- |
| Q1  | reinstate round 23's reaped gate              | 4 failed                                       |
| Q2  | `removeAllListeners` + unconditional re-raise | run aborted (the mutant kills the test worker) |
| Q3  | drop SIGQUIT                                  | 1 failed                                       |
| Q4  | drop the `$0` source filter                   | 2 failed                                       |
| Q5  | match `bwrap:` anywhere in the line           | **survived** → test added, then 1 failed       |
| Q6  | change `SHELL_ARGV0`, breaking attribution    | 2 failed                                       |

Q5 survived because every existing case was already excluded by the `$0` filter,
so `startsWith` versus `includes` made no difference to any of them. The added
test covers a line from neither source carrying the marker path.

A drift mutation between the argv element and the classifier (round 18's class)
is not expressible: both read one constant.

## Attacked and could not break

- **Round 23's own new tests all genuinely fire** — the three-rounds-running
  "the fix shipped with a test that cannot fire" pattern did not recur.
- **The registry.** 200 clean + 25 killed + 25 ENOENT + 10 reaped-orphan bounded
  probes: set size 0 at every checkpoint, listener counts exactly 1, no
  `MaxListenersExceededWarning`.
- **Signal mid-spawn is not a window** — `spawn()` and the `add()` are in one
  synchronous block.
- **The re-raise is correct**: exit codes 130 / 143 / 129 = 128 + {2, 15, 1}.
- **Hostile `TMPDIR`, 10 values × {real bwrap, no-op shim} = 20/20 correct**, two
  of them new this round (`"` and `&&`), zero injection artifacts.
- **The fault-matrix `chmod 0o700` masks nothing** — it runs after all
  assertions, and the tests that strip permissions restore in their own
  `finally`.
