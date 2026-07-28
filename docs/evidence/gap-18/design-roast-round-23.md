# Roast round 23 — detachment, signals, and a test that could not fire

Read-only review of round 22's repairs. Non-degeneracy control executed first
and produced FAIL **three independent ways** (no-op shim, no bwrap on PATH, and
a `--ro-bind` → `--bind` mutation) before any PASS was trusted.

## Finding 1 (MEDIUM) — `detached: true` made probe children immune to Ctrl-C

Round 22 made a bounded child a process-group leader so the expiry kill could
reach the tree. A detached child is not in the terminal's foreground group and
never receives SIGINT — and the group kill lived only in a timer, which dies
with the CLI. So the user could interrupt `crabgic doctor` and leave a probe
running, reparented to init.

Measured end-to-end against the real bundle with a `bwrap` whose `--version`
hangs, SIGINT delivered to the CLI:

| build | probe alive pre-SIGINT | survivors post-SIGINT |
| --- | --- | --- |
| handler install removed (the defect) | 1 | **1** |
| fixed | 1 | **0** (twice) |

Real bwrap's `--die-with-parent` masks this for the confinement probe, but the
**presence** probe carries no such flag — that is the orphan in the trace — and
any non-real `bwrap` escapes both.

**Fix:** bounded children are tracked, and SIGINT/SIGTERM/SIGHUP kill every
tracked group before removing the handler and re-raising, so the CLI still dies
exactly the way the user asked. `exit` sweeps too. The `detached` decision is now
a single `const` shared by the spawn option and the registry, so they cannot
drift — round 23 found that making `detached` unconditional left the suite green
while producing the worst combination: an unbounded child leading its own group
and never registered for the sweep.

## Finding 2 (MEDIUM) — the stream-destroy backstop had no test that could fire

Deleting `child.stdout?.destroy(); child.stderr?.destroy()` left the suite 44/44
green, **including the test written for exactly that line**: the group kill
already reaps every pipe holder, so the pipes close naturally either way.

The backstop is load-bearing against a descendant that leaves the group:

```
WITH the destroys:     activeResources: ["Timeout"]                      rc=0
WITHOUT:               ["PipeWrap","PipeWrap","Timeout"]                 rc=124
```

`rc=124` is round 22's finding 2 verbatim — every check has reported, `bin.ts`
has set `process.exitCode`, and the CLI never exits. Now guarded by a test using
a `setsid` grandchild, which is the case the destroys exist for.

## Finding 3 (LOW–MEDIUM) — the group kill could signal a recycled process group

The window is exactly when `close` has not fired but the child has been reaped:
a descendant outside the group holds the pipes, the child's group is empty, and
the pid is free for reuse. Constructed inside a PID namespace by writing
`ns_last_pid`, `process.kill(-pid)` SIGKILLed an unrelated `sleep 400` that had
inherited the number. Poorly exploitable on a real host — it needs a
group-escaping descendant plus a full pid wrap inside the ceiling (~40 s
measured, against a 30 s and a 10 s ceiling) — but the state is observable for
free at the moment the timer fires, and the bare-child fallback already covers
the reaped case. Now gated on `exitCode === null && signalCode === null`.

## Finding 4 (LOW) — the only real-sandbox test reported a green tick asserting nothing

`"PASSES on a host whose sandbox genuinely denies the write"` early-`return`ed
when `bwrap` was absent, with no skip. And `ci.yml`'s `unit-test+coverage` job
installed no bubblewrap, while `release-e2e.yml` and `engine-live.yml` both
install it explicitly — which is what shows the runner image lacks it. So the
round-18 defect class (`echo RAN` → `echo RUN` survived 5260 tests) was guarded
in the main CI by **nothing**, and reported green.

Fixed on both sides. CI now installs bubblewrap, asserts `bwrap --version`
succeeds, and sets `CRABGIC_REQUIRE_BWRAP=1`. The test now:

```
bwrap present            -> passes, with assertions
bwrap absent, local      -> 1 skipped        (visible, not a false green)
bwrap absent, CI flag    -> hard failure
```

## Finding 5 (LOW) — a cleanup failure leaks silently

20 runs with cleanup forced to fail left 20 directories with no counter, warning,
or field on `DoctorFinding` to carry one. Round 23 could not construct a
production-reachable cause (`rm` on a 0700 directory we own, `force: true`
swallowing ENOENT), so this is recorded as a latent hazard rather than fixed —
along with the observation that `marker.cleanup()` has no ceiling of its own, so
a hung unlink on NFS/FUSE would hang the check. Neither was reproducible on this
host.

## Mutation record

| # | mutation | result |
| --- | --- | --- |
| P1 | drop the signal-handler install | 1 failed |
| P2 | never release a settled child | 2 failed |
| P3 | drop the reaped gate | 3 failed |
| P4 | drop the stream-destroy backstop | 1 failed |
| P5 | `detached` unconditional (round 23's surviving M7) | 2 failed |
| P6 | signal handler does not kill children | **survived** |
| P7 | handlers installed per call | 1 failed |
| P8 | children never registered | 2 failed |

P6 is the round's own lesson repeating for the third time: the registry was
maintained, the handler was installed, and nothing checked that it did the one
thing it exists for. Manual end-to-end proof does not survive a refactor, so it
is automated now — a real child process taking a real SIGINT, because sending
one to the vitest worker would kill the run. P6 then died.

## Attacked and could not break

- **The argument-passing fix — 18/18 correct.** Nine hostile `TMPDIR` values
  (space, `x'; echo WROTE:2; exit 2; '`, `O'Brien`, embedded newline, `$(id -u)`,
  backtick, `a;id -u;b`, leading `-`) × {real bwrap, no-op shim}: bwrap PASSed
  all nine, the shim FAILed all nine, no injection artifact anywhere. Repeated
  on real WSL2 drvfs (`/mnt/c/temp/...`), the configuration the comments cite.
- **Shell portability.** `dash` and `bash`: a leading-dash path and a literal
  `--` both handled. Only an empty `$1` degenerates, and it is unreachable.
- **Partial-read race on stream destroy.** 20 MB racing the ceiling:
  `{"wanted":20000000,"got":20000000,"lost":0}`.
- **The setsid race at spawn.** `timeoutMs` ∈ {0,1,2,5,20} ms: the group exists
  before the kill can land.
- **Non-sandbox write-failure causes.** `ulimit -f 0` → SIGXFSZ → "never
  reported running", fail-closed. `TMPDIR` nonexistent/read-only → honest
  `mkdtemp` error, fail-closed.
- **Full executed branch matrix, 8/8**, and the leak fix over 30 real runs → 0
  directories left.

## Out of scope, and larger than this file

`/tmp` holds **~15,800** leaked `eo-*` directories from other suites (8,164
`eo-derive-`, 5,022 `eo-policy-`, 522 each `eo-release-pack-out-{a,b}-`, 334
`eo-xdg-`). Round 21's leak class was fixed in this check only; it is alive and
much larger elsewhere in the repo. Recorded here for a separate pass.
