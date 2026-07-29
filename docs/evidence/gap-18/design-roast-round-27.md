# Roast round 27 — a false entry in a mutation record

Non-degeneracy control executed first, discriminating five ways, plus a control
on the mutation harness itself (deleting the re-raise → 1 failed).

## Finding 1 (HIGH) — round 26's headline fix had no coverage, and its record said otherwise

Round 26 recorded `S1 | decide ownership at handler time again | 1 failed`. It
does not fail. S1 was written as `ownsTermination = true`; the mutation that
matters is the **literal** pre-round-26 predicate, and restoring
`if (process.listenerCount(signal) === 1)` measured **73/73 green**, widening to
197/197 across the doctor directory. In a `boot-supervisor`-shaped process it
reproduces round 26's own evidence verbatim:

```
CONTROL (install-time snapshot)  -> rc=0   gracefulShutdownCompleted=1
MUTANT  (handler-time === 1)     -> rc=143 gracefulShutdownCompleted=0   (twice)
```

The cause: the stand-in listener `const other = (): void => undefined` never
de-registers itself, so the count stays at 2 and `=== 1` is false. **Round 26
diagnosed exactly this flaw in round 24's test and then reproduced it in the
replacement.** The stand-in now `process.off`s itself first — what
`boot-supervisor.ts` really does — and asserts that the _other_ party's handler
ran and re-armed. The literal mutation now kills the test worker outright (0%
coverage, red build). Round 26's record is corrected in place rather than
quietly amended.

Context: `createRealProcessProbe` is reachable only from `run-doctor.ts`, and
the daemon's static closure contains no doctor module, so no bounded probe runs
in the daemon today. The defended scenario is currently unreachable, which is
probably why the gap survived two rounds.

## Finding 2 (MEDIUM) — a refusal was not attributable to the sandbox

The verdict read only `WROTE:<n>` and the setup-failure classifier, so a write
that failed because its directory was gone was indistinguishable from one the
bind denied — round 20's defect class, re-admitted. And round 26 introduced a
sweeper for exactly this prefix, which turns concurrent deletion from a
hypothesis into a path.

Measured with a no-op `bwrap` shim, i.e. **no sandbox at all**:

| condition                      | before                                | after                               |
| ------------------------------ | ------------------------------------- | ----------------------------------- |
| shim, marker intact            | `passed:false` unexpectedly succeeded | unchanged                           |
| shim, parent directory deleted | **`passed:true` "correctly denied"**  | `passed:false` "not by the sandbox" |
| real bwrap (control)           | `passed:true`                         | `passed:true`                       |
| real bwrap, parent deleted     | —                                     | `passed:false`                      |

Two guards, because either alone is escapable: the shell's stated reason
(`Directory nonexistent` / `No such file or directory` / `Not a directory`,
matched after the marker path is stripped), and — for a marker we created — a
structural check that its parent still exists, which catches a refusal with no
stderr at all.

## Finding 3 (LOW) — the reset seam leaked `exit` listeners

`resetSignalHandlersForTest` cleared everything except
`process.on("exit", killAllDetachedChildren)`, so each install/reset cycle added
one: twelve cycles, twelve listeners, and a `MaxListenersExceededWarning`
printed into exactly the stderr a mutation battery greps for failures.

## Finding 4 (LOW) — the sweep was starvable

The cap sliced the `readdir` result **before** testing staleness, and `readdir`
order is stable, so a fixed prefix of a fixed set was inspected every run. With
2000 permanently-unremovable prefix entries (another uid's directories on a
sticky `/tmp`, or root-owned leaks from a `sudo` run), a perfectly sweepable
stale directory at index 900 survived 20 consecutive runs. The cap now bounds
the removals, not the search.

## Mutation record

| #   | mutation                           | result                                         |
| --- | ---------------------------------- | ---------------------------------------------- |
| T1  | the literal pre-round-26 predicate | run aborted — the mutant kills the test worker |
| U1  | drop the structural parent check   | 1 failed                                       |
| U2  | drop the stderr reason check       | 3 failed                                       |
| U3  | remove the sweep cap               | **survived** → test added, then 1 failed       |
| U4  | reset leaves the `exit` listener   | 1 failed                                       |
| U5  | sweep ignores staleness            | 1 failed                                       |

Every mutation ran with a **verified-non-empty backup**, under
`trap ... EXIT INT TERM`, and ended with `diff -q backup source` — all reported
`RESTORE-VERIFY: SAME`. That protocol exists because round 26 stranded two
mutations when its backup had been deleted between the `cp` and the restore.

## A test defect found by another test

The corrected ownership test re-armed its stand-in via `setImmediate`, which
fired _after_ the cleanup removed it — leaving one SIGHUP listener behind for
every later test in the file. Caught by the new exit-listener test, not by
review. The re-arm is now gated and drained before cleanup.

## Attacked and could not break

- **`fs.rm` and symlinks.** `stat` follows (so a symlink is judged by its
  target's mtime) but `rm` does not: a victim directory and its contents
  survive, a symlink inside a marker dir is unlinked rather than traversed, and
  a prefix-matching plain file is removed harmlessly.
- **Sweep throwing.** `TMPDIR` at mode 0300 makes `readdir` throw EACCES; caught,
  verdict unaffected.
- **Sweep cost.** 20,000 prefix entries: 66–70 ms for the whole check.
- **Real CLI under real signals**, with SIGKILL as the non-degeneracy control:
  INT 130, TERM 143, HUP 129, QUIT 131, all with 0 orphans; KILL 137 with 1.
- **Hostile TMPDIR, 12/12 correct**; zero injection artifacts.
- **Group-kill property**: `kill(-pid)` → `kill(pid)` fails 8 tests.

## Noted, not ranked

`resetSignalHandlersForTest` is re-exported through `packages/cli/src/index.ts`
and there is no public-API gate in this repo, so nothing flagged the growth.
