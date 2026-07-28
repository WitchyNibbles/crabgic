# Roast round 25 — a committed mutant, and a fix that was inert

Read-only review of round 24. Non-degeneracy control executed first and
discriminated **five** ways (real bwrap PASS, no-op shim FAIL, writable `--bind`
FAIL, bwrap absent FAIL, userns-denied FAIL).

## Finding 1 (HIGH) — `SHELL_ARGV0` was never passed as `$0`

Round 24's finding-3 fix declared `SHELL_ARGV0`, documented it as "used by the
argv and by the classifier", and the argv shipped the literal `"sh"`. So
`startsWith("eo-sandbox-selftest:")` could never match a real shell, and the
classifier silently degraded to the unguarded form. Three of four marker
`TMPDIR`s still produced a false setup-failure on a healthy host:

```
creating new namespace failed     -> passed:false "bwrap failed to set up the sandbox…"
user namespaces are not permitted -> passed:false
unprivileged_userns_clone         -> passed:false
benign                            -> passed:true
```

Round 24's record claims "Verified: all three `TMPDIR` values PASS." That was
measurably false, and round 18's self-contradicting-evidence defect was intact.

**The tests were green because their fixtures encoded a host that did not
exist** — they wrote `eo-sandbox-selftest:` as the shell prefix while the argv
sent `sh`. Correcting only the prefix in those fixtures failed 2 of them
immediately.

**Provenance, recorded because the process failure matters more than the bug:**
this arrived as a leftover mutation. A round-24 mutation batch hit the tool's
2-minute timeout at its last mutation, so the `cp` restore never ran and the
mutant was committed. Mutation runs now restore under a shell `trap ... EXIT INT
TERM` rather than a trailing command.

The lasting fix is the test, not the anecdote: nothing asserted the wiring. Two
now do — one on the argv, one executing the real argv's shell portion and
reading what `sh` actually prints. The fixtures derive their prefix from the
exported constant, so a fixture can no longer disagree with the product.

## Finding 2 (HIGH) — round 24's CI fix was inert for the runner it was written for

The workflow guard is correct — on a namespace-denied runner it warns and leaves
`GITHUB_ENV` empty — but the test's skip was gated on `bwrapPresent`, i.e.
`bwrap --version` exit 0, which is **true** on exactly that runner. The early
return was unreachable and the flag never consulted:

```
× PASSES on a host whose sandbox genuinely denies the write
  → expected 'bwrap failed to set up the sandbox be…' to contain 'correctly denied'
```

Verbatim the failure round 24 said it was eliminating. It changed the failure
*message*, not whether it failed. `ubuntu-latest` is Ubuntu 24.04, which
restricts unprivileged userns by default, so this is the likely case.

Fixed: a setup-failure verdict now skips unless `CRABGIC_REQUIRE_BWRAP=1`, in
which case it throws quoting the evidence. Verified in all three states —
normal 40/40, userns-denied 1 skipped, userns-denied + flag a hard failure
naming the sysctl.

## Finding 3 (MEDIUM-HIGH) — the signal sweep was one-shot

`process.off` ran unconditionally and `signalHandlersInstalled` is sticky, so a
process that *survives* the signal — which round 24's `listenerCount` guard
exists to allow — lost the sweep forever. Measured with a daemon whose SIGHUP
handler reloads: probe #1's child swept, probe #2 (started after the first
SIGHUP) survived the second. The handler is now removed only on the path that
ends the process.

## Finding 4 (MEDIUM) — nothing pinned the re-raise

Deleting `process.off(signal, handler)` survived all 26 tests, and its absence
is not cosmetic:

```
unmutated: SIGINT -> rc=130 (128+2), 0 survivors
mutant:    SIGINT -> rc=2, "✗ sandbox.selftest: the sandboxed shell never
                            reported running (exit -1)"
```

An interrupted run silently became a substantive **failing health verdict**.

The test written for it initially could not fire either: it spawned
`node_modules/.bin/tsx`, a **wrapper process**, so the signal landed on tsx and
the test measured tsx's disposition. Switched to `node --import tsx`, one
process, the process under test. The mutant then died.

## Finding 5 (MEDIUM) — the risk figure justifying round 24's revert was wrong by ~5.5x

The comment claimed the traded-away pid-recycle hazard needs "~40s of churn
against a 30s and a 10s ceiling". That was a single-threaded number. Under
ordinary parallel churn (`pid_max=99999`): **13,747 pids/s, a full wrap every
~7.2s, three wraps inside one 30s ceiling**, and 60% of live processes were
group leaders — so the second conjunct is common too.

The conclusion stands (the orphan is certain and immediate; the collision
additionally requires landing on exactly this pid) but the stated reasoning was
false, and rounds 4–8 each went wrong reasoning from a stale paragraph exactly
like it. The comment now carries the measured numbers, and exposure is narrowed
with a `kill(-pid, 0)` existence probe that skips the group kill when the group
has already gone — the only case in which the pid was free to be reused.

**Honest limitation:** that probe is not covered by a test, and cannot easily be.
Removing it is unobservable — killing a nonexistent group throws ESRCH and falls
through to the same bare-child fallback — so it narrows a race window rather
than changing any reachable behaviour. Recorded as a surviving mutant rather
than papered over with a test that would assert nothing.

## Finding 6 (MEDIUM) — a newline in `TMPDIR` defeats per-line attribution

A directory name containing a newline splits the shell's own error, so the
continuation line carries no `$0` prefix. Verified independent of finding 1: it
still failed with the `$0` fix applied. Per-line attribution cannot work on a
line the attacker composed, so the **known marker path is removed from stderr
before anything is classified** — that deletes the injected content with it,
whatever it contains, because bwrap's setup diagnostics never quote the marker
path (a setup failure happens before the inner command is exec'd).

## Finding 7 (LOW) — a describe asserting the opposite of the code

`killProcessTree — the group kill is not used on a reaped child` carried round
23's rationale for a gate round 24 reverted, sitting directly above the sibling
describe asserting the opposite, with a body covering only the live-child case.
Renamed and rewritten.

## Mutation record

| # | mutation | result |
| --- | --- | --- |
| R1 | argv0 back to `"sh"` (the committed mutant) | 2 failed |
| R2 | do not strip the marker path before classifying | 1 failed |
| R3 | unconditional `process.off` (one-shot sweep) | 1 failed |
| R4 | never re-raise | 1 failed *(after the helper was fixed — see finding 4)* |
| R5 | skip the group-existence probe | **survived, by design** — see finding 5 |
| R6 | the sweep does nothing | 1 failed |

## Attacked and could not break

- **The "swallowed Ctrl-C" hypothesis is falsified.** `listenerCount` for all
  four signals under plain `node` and `npx tsx`: all zero. No wrapper installs a
  competing listener, so the guard always re-raises for the CLI.
- **The SIGKILL/signal matrix**, with a SIGKILL control proving the counter
  non-degenerate: all four forwarded signals give correct exit codes and 0
  survivors. (Round 25's first attempt signalled the wrong pid because `setsid`
  forks — caught before it was trusted.)
- **CI shell syntax** under GitHub's exact `bash -e`: `bash -n` clean, `-e` does
  not abort on a failing `if` condition, `GITHUB_ENV` written correctly, both
  branches exercised.
- **Hostile `TMPDIR` injection, 10/10 correct**; zero injection artifacts.
- **Zero marker-directory leaks** across ~40 check runs.

## Instrumentation note carried forward

`--reporter=basic` is not valid in this vitest version: it fails at startup and
prints nothing to a grep pipeline, which looks exactly like "0 failures".
