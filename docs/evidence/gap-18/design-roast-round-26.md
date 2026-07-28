# Roast round 26 — the guard that was inert for the file it named

Non-degeneracy control executed first, discriminating four ways.

## Finding 1 (HIGH) — `listenerCount === 1` is defeated by the exact consumer it cites

Round 24's fix — "the signal is re-raised only when nobody else is handling it"
— is **inert for `boot-supervisor.ts`**, the file its own comment names.
`runShutdown`'s *first* synchronous statement de-registers its own listener, and
it registered at boot, before any probe, so it runs first. By the time our
handler ran the count was back to 1, so we terminated the process inside their
in-flight teardown:

| run | rc | graceful shutdown completed |
| --- | --- | --- |
| no bounded probe (control) | 0 | 1 |
| one bounded probe | **143** | **0** |
| probe handler registered first (control) | 0 | 1 |

Lease held, socket open — round 24's own defect, reached another way. The test
could not catch it because its stand-in listener never de-registers itself,
which is exactly the one shape that works.

**Fix:** ownership of termination is snapshotted at INSTALL time, not read from
a count at handler time. In the CLI nobody else is listening, so we re-raise (or
Ctrl-C would be swallowed); in the daemon someone was already listening at boot,
so we only sweep. A `resetSignalHandlersForTest` seam exists because
installation happens once per process — without it, whichever test ran first
fixed the answer for every later one, and the branch was untestable.

## Finding 2 (MEDIUM) — `groupStillExists` was dead code with a false rationale

Round 25 added it claiming it narrowed the pid-recycle window, and recorded it
as a known surviving mutant. Round 26 confirmed the observability and **refuted
the justification**: the probe returns true exactly when the hazard is real — a
live group at that pgid is what a recycled pid looks like — and false only when
the kill was already a no-op.

```
innocent group leader pid = 80937
{"bareChildKillCalls":0,"innocentGroupStillAlive":false}
probe DID NOT protect: innocent group was SIGKILLed
```

Removed. The surviving mutant was the clue and should have been read as one.

**Round 26 also tried to remove process groups entirely**, replacing them with a
`/proc` tree walk so that detachment — the root of rounds 22–26 — could go away.
It cannot work: `sh -c 'x & exit'` is reaped within a millisecond, so
`/proc/<pid>/task/<pid>/children` is gone before any sampler can read it, and
the grandchild is reparented beyond reach. Measured at 0/5/10/20/40 ms — the
grandchild was never visible once. A process group outlives its leader, which is
precisely why it is the right primitive. Recorded because the negative result is
the argument for the current design.

## Finding 3 (LOW) — an interrupted `doctor` leaks a marker directory

`finally` is skipped by a signal death, and `process.on("exit")` cannot help
because death by a re-raised signal never fires it:

```
SIGINT / SIGTERM / SIGKILL -> leaked marker dirs delta=1 each
uninterrupted control      -> delta=0
```

Now swept at check start: age-gated at one hour so a concurrent `doctor`'s live
marker survives, capped at 200 entries so a health check cannot become a
filesystem scan, and prefix-scoped. All three properties are mutation-covered.

## Finding 4 (LOW) — the CI guard reproduced the round-20 anti-pattern

It wrote to `/tmp/eo-ci-probe-marker`, a path the runner neither created nor
owns, so its soundness rested on `/tmp` being 1777 by convention. On a runner
where it is not, ordinary DAC would deny the write and the guard would certify a
sandbox it never tested — the round-20 defect the product's own check was
rewritten to avoid. Now `mktemp -d`. Verified non-degenerate: real bwrap denies,
a no-op shim's write succeeds and fails the job.

## Mutation record

| # | mutation | result |
| --- | --- | --- |
| S1 | decide ownership at handler time again | ~~1 failed~~ **CORRECTED — see below** |
| S2 | never sweep stale markers | 1 failed |
| S3 | sweep ignores the age cutoff | 1 failed |
| S4 | sweep ignores the prefix | 1 failed |

## A process failure, recorded because it recurred

Round 25 prescribed `trap ... EXIT INT TERM` after a leftover mutation was
committed. This round the trap fired correctly but the *backup it restored from
did not exist*: another process cleaned the scratchpad directory between the
`cp` and the restore, and two mutations were left in the working tree — one of
which would have made the sweep delete arbitrary `/tmp` directories. Caught by
inspecting the source rather than by any test.

The durable lesson is not "use a trap" but **verify the backup exists before
mutating, and verify the source matches it afterwards**. Every mutation from
here on is followed by `diff -q backup source`, and the batteries above record
that check passing.

## Attacked and could not break

- **The path-stripping classifier.** dash prints `$1` verbatim in every shape
  tried — benign, `bwrap:` in TMPDIR, newline-forged bwrap line, userns phrases,
  trailing slash, `..`, symlinked TMPDIR, and a 3,948-char path. The strip can
  neither splice a `bwrap:` line into existence nor erase a genuine one, because
  the marker path always contains `/eo-sandbox-selftest-<random>` which bwrap's
  diagnostics never quote. 8/8 correct.
- **`$0` across shells.** dash and bash both prefix with `$0` and both classify
  correctly. *Honestly untested: busybox ash*, which uses `applet_name`.
- **The real CLI under signals**, with a SIGKILL control proving the counter
  non-degenerate: SIGINT 130, SIGTERM 143, SIGHUP 129, SIGQUIT 131, all with 0
  survivors; SIGKILL 137 with 1 (the control).
- **Inherited `SIG_IGN`** (`nohup`/background-job shape): libuv restores
  `SIG_DFL` on unregister, so the re-raise still terminates.
- **`--ro-bind / /` over a separately-mounted tmpfs** (`/dev/shm`): denied
  inside, writable outside. A runner with a separate `/tmp` would not fail the
  guard.
- **Regression vs rounds 1–24: 10/10** hostile TMPDIR values correct, zero
  injection artifacts, zero orphans.

## Instrumentation notes carried forward

- `npm run bundle:cli` overwrites the `tsc -b` output in the same
  `packages/cli/dist`; they are mutually destructive.
- `--reporter=basic` is invalid in this vitest version and prints nothing to a
  grep pipeline, which looks exactly like "0 failures".


## CORRECTION (round 27)

The S1 row above is **wrong**, and the error matters more than the row.

S1 was written as `ownsTermination = true`, which the test does catch. The
mutation that matters is the *literal* pre-round-26 predicate — restoring
`if (process.listenerCount(signal) === 1)` — and round 27 measured that as
**73/73 green**, widening to 197/197 across the whole doctor directory. Built to
`dist` and run in a `boot-supervisor`-shaped process it reproduces this round's
own finding-1 evidence verbatim: `rc=143, gracefulShutdownCompleted=0`, twice,
with the entire suite passing.

The cause is the stand-in listener: `const other = (): void => undefined` never
de-registers itself, so the count stays at 2 and `=== 1` is false. **This round
diagnosed exactly that flaw in round 24's test and then reproduced it in the
replacement.** Fixed in round 27 by having the stand-in `process.off` itself
first, as `boot-supervisor.ts` really does; the literal mutation now kills the
test worker outright (0% coverage, red build).

Recorded rather than quietly amended, because a mutation record that claims
coverage it does not have is worse than no record: it is the thing later rounds
reason from.
