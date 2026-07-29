# Roast round 30 — the anti-starvation cursor was a write primitive

Round 29's fix persisted a rotation cursor at
`$TMPDIR/.eo-sandbox-selftest-sweep-cursor`, deliberately not marker-prefixed
"so the sweep never deletes its own cursor" — which also means the sweep never
deletes anything an **attacker** leaves at that name. `TMPDIR` is world-writable
and shared, the name is a compile-time constant, and both ends of the cursor
followed whatever was found there.

Controls executed first: the identical staging **without** the planted object
(1s, exit 2, 1198 bytes of normal output), and a rebuild-and-re-attack pass
after each fix.

## Finding 1 (HIGH) — `doctor` overwrote an arbitrary file, and passed

```
ln -s $VICTIM $TMPDIR/.eo-sandbox-selftest-sweep-cursor
TMPDIR=... node packages/cli/dist/bin.js doctor
```

```
victim before: PRECIOUS
victim after : 1785303771
cursor still a symlink: yes
✓ [error] sandbox.selftest: bwrap is present and a write to a read-only-bound
                            path was correctly denied
```

An arbitrary-file-overwrite primitive as the invoking uid, from a health check,
**silently** — the same run reported the sandbox as healthy. Measured through the
**bundled binary**, not the source. This is round 4's defect class (a symlink
attack on the policy writer) re-admitted at a new path one round after the code
that introduced it.

## Finding 2 (HIGH) — a FIFO hung `doctor` forever

```
mkfifo $TMPDIR/.eo-sandbox-selftest-sweep-cursor
-> rc=124  wall=25s  output bytes=0
```

Killed by an external timeout, **zero** bytes of output, no diagnosis. `readFile`
blocks in `open(2)` until a writer appears, and it is awaited from
`createOwnedMarkerPath` → `resolveMarker`, which runs **before** `run()`'s
try/finally and carries no ceiling of its own — the presence probe and the
confinement probe below it are both bounded, this was not. That is round 22's
"`doctor` must never hang" property, on the line round 29 added.

The stuck worker was confirmed in the kernel, not inferred: `/proc/<pid>/task/*/wchan`
read `wait_for_partner`, the FIFO open-wait.

## Finding 3 (refuted, recorded anyway) — the device hang that wasn't

Hypothesis: a symlink to `/dev/zero` never reaches EOF, so `readFile` never
settles. **False.** Measured: `outcome=settled after 1106ms, peak RSS 684 MiB` —
it throws once past the max buffer length. Recorded as a ~700 MiB transient
allocation inside a health check, **not** promoted to a hang. A round that
reports its refutations is the only kind whose HIGHs mean anything.

## Finding 4 (MEDIUM) — the same class in the drift CLI, plus a comment doing a mitigation's job

Swept the codebase for the class rather than waiting for it to be reported
again: `grep` for `tmpdir()` uses that are not `mkdtemp`.
`packages/gates/src/drift/cli.ts` pinned **both** default outputs at fixed names
under `os.tmpdir()`. Driven through the real exported `runDriftCiCli()` with no
options:

```
ln -s $ATTACKER_DIR $TMPDIR/eo-drift-ci
-> files written THROUGH the symlink: [ 'debounce-state.json', 'drift-proposals.json' ]

ln -s $VICTIM $TMPDIR/eo-drift-ci/debounce-state.json
-> victim after: {"do":"not clobber me","jira:1000.0.0":0,"grafana:13.1.0":0}
```

The module's own comment claimed the scheduled workflow "points both paths at
`runner.temp` explicitly", which would have confined this to local runs. **It
does not and never did** — `.github/workflows/drift-ci.yml` invokes the CLI with
no arguments and hard-codes the DEFAULT paths in its cache and artifact steps.
A stale comment was doing the work of a mitigation, and the scheduled job was
exposed too. The comment is corrected in place rather than quietly dropped.

## The fix, and why it is two layers

Both cursors move to `$XDG_STATE_HOME/crabgic/`, which no other account can
write, so the class is gone **by construction** rather than defended primitive
by primitive. The opens are hardened anyway, and that is not redundant:
`XDG_STATE_HOME` is itself environment-controlled and can be pointed at a shared
directory, and homes can be group-writable or on NFS.

- `O_NOFOLLOW` refuses a planted symlink at open time rather than detecting one
  afterwards (the policy store's round-4 lesson).
- `O_NONBLOCK` is what stops the FIFO blocking.
- `fstat` on the **descriptor**, so the inode checked is the inode used.
- `nlink === 1` refuses a hardlink, which `O_NOFOLLOW` does not cover.
- No `O_TRUNC` in the flags — truncation is a write, and must not happen to
  anything the checks would go on to reject.

The drift defaults are resolved **per call**, not pinned at import: a constant
derived from the environment cannot be corrected by the environment, and one
derived from the throwing env reader would fail at _import_ time wherever `HOME`
is unset, breaking consumers that pass explicit paths and never touch the
default. The workflow's three paths move with the default, because a cache step
pointed at a path the job no longer writes fails **silently** and would have
disabled the debounce that step exists to provide.

## Mutation record

| #   | mutation                                    | result                                  |
| --- | ------------------------------------------- | --------------------------------------- |
| M0  | unmutated                                   | green control, 65/65 then 68/68         |
| M1  | cursor back in `TMPDIR` (the round-29 site) | 3 failed                                |
| M2  | drop `O_NOFOLLOW`                           | 1 failed                                |
| M3  | drop `O_NONBLOCK`                           | **hangs the worker**, exit 124          |
| M5  | state dir `0o700` → `0o777`                 | 1 failed                                |
| M6  | never persist the cursor                    | 2 failed                                |
| M4  | drop the descriptor checks                  | **survived** → tests written → 1 failed |
| M7  | constant offset when no state home          | **survived** → test written → 1 failed  |
| M8  | `O_TRUNC` in the open flags                 | **survived** → killed by the same test  |
| M4a | drop only `nlink === 1`                     | 1 failed                                |
| M4b | drop only `stats.uid === uid`               | **survived** — see below                |
| M4c | drop only `isFile()`                        | **survived** — see below                |

Three survivors on the first pass, and they are round 29's finding 1 recurring:
the checks were _executed_ by every test and _asserted_ by none. Every hostile
object the other tests plant is already refused by a **flag** — a symlink by
`O_NOFOLLOW`, a writerless FIFO by `ENXIO`, a directory by `EISDIR` on the
operation itself — so nothing reached the descriptor checks at all. Only a
**hardlink** opens as a perfectly ordinary regular file this uid owns and still
is not ours to write, and nothing planted one.

Two tests close them: a hardlink at the cursor path (asserted neither
overwritten **nor truncated**, which is what kills M8), and a wall of
`3 × SCAN_LIMIT` **unremovable** entries with `HOME` unset, so every run takes
the clock fallback and a constant one never reaches the victim behind the wall.
Removable entries cannot separate the two — the window empties and the next run
sees new entries at the same index — which is round 28's finding about round
27's test and round 29's about its own, now avoided by construction.

**M4b is left surviving deliberately.** Distinguishing `stats.uid === uid`
requires a file owned by a _different_ account at a path this one can open, and
this environment has one uid and no privilege to create another. Recorded rather
than covered by a test that would assert nothing.

**M4c is left surviving deliberately, and the arm is kept.** No mutation
distinguishes `isFile()` because every reachable non-regular object is already
stopped downstream — `ftruncate` returns `EINVAL` on a FIFO, `read` returns
`EISDIR` on a directory — so the arm is _currently_ redundant. It is kept
because that redundancy is incidental to another call's error behaviour: a
future reorder that writes before truncating would make it load-bearing, and the
property "the cursor is a regular file" belongs where it is decided, not in the
error code of an unrelated syscall. The composite behaviour is pinned by a test
that attaches a **reader** to the FIFO — the one hostile object that gets past
`ENXIO` — and asserts nothing is written into it.

## Methodology — the harness failed before the code did

The first battery restored the source from a `mktemp` copy via an `EXIT` trap.
It was killed with `SIGKILL`, so the trap never fired and it left the source
**mutated**; every case after that ran against a source nobody had checked, and
three of them reported "hang" for mutations that cannot hang. **Those rows are
discarded as uninterpretable rather than reported.** A later `git checkout` of
the same file then destroyed the (uncommitted) fix outright.

Three rules fell out, and the second battery follows all three:

1. **Commit the fix before mutating it.** Restore from git, not from a temp copy
   whose lifetime depends on a trap firing.
2. **Verify the restore** (`git diff --quiet`) before the next case, and fail the
   battery loudly if it is dirty. An unverified restore silently compounds.
3. **Bound every case and reap the workers.** M3 does not merely fail an
   assertion — it leaves a libuv thread blocked in `open(2)` forever, so the
   worker never exits and an unbounded battery stalls on the first hang. This is
   round 28's finding 3 (a worker-killing mutation shows zero "failed" lines)
   with a second failure mode: a worker-_hanging_ mutation shows no lines at all.

`Promise.race` against a timer is the only assertion shape that can **fail** on
a hang; a plain `await` just times the test out with no diagnosis, which is the
symptom rather than a report of it.

## Instrumentation notes carried forward

- `pkill -f <pattern>` matches the invoking shell's own command line when that
  line contains the pattern. It killed the shell that ran it. Kill by pid.
- A command substitution around a `timeout`-ed command does not return when the
  timeout fires if an orphaned grandchild still holds the pipe — the same
  process-group lesson round 30's own `edcef56` applied to the probe.
- `/proc/<pid>/task/*/wchan` reading `wait_for_partner` is the direct evidence
  that a process is blocked in a FIFO open, rather than merely slow.
