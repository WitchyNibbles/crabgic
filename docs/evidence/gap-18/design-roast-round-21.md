# Roast round 21 — the confinement probe

Read-only review of the round-20 repair to `packages/cli/src/doctor/checks/sandbox-selftest.ts`.
Every measurement below used the real `createRealProcessProbe` against real
`bwrap 0.9.0`, never a fixture.

## Corpus non-degeneracy control

Mutated the repo source `--ro-bind` → `--bind` (writable), ran the real check
against real bwrap, restored. Result: `passed:false`, "a write to a
read-only-bound path inside bwrap unexpectedly succeeded". **The harness can
produce FAIL, so the baseline PASS is attributable to the read-only bind
specifically.**

## Finding 1 — the marker path was interpolated UNQUOTED (fixed)

`markerPath` derives from `os.tmpdir()`, which honours `TMPDIR`. Any whitespace
truncated the redirect target. This project explicitly targets WSL2, where
`TMPDIR=/mnt/c/Users/<name with space>/AppData/Local/Temp` is ordinary.

Measured with `TMPDIR="/tmp/.../John Smith"` and a sibling `John` present:

| sandbox | before | after |
| --- | --- | --- |
| real bwrap | PASS | PASS |
| **no-op `bwrap` shim** (strips every flag, execs) | **PASS** | **FAIL** "unexpectedly succeeded" |
| no bwrap on PATH | — | FAIL `spawn bwrap ENOENT` |

The round-20 defect reproduced verbatim: the write landed somewhere ordinary
permissions refuse, so the refusal proved nothing. Reproduced again after the
fix by unquoting the built output — the shim PASSED — and killed by the fix.

Secondary, true for *every* whitespace `TMPDIR` with no collision needed: the
probe wrote **outside its own owned directory**, making this function's central
claim false.

The fix is one pair of quotes, coupled to two test assertions that pinned the
unquoted shape — round 19's exact-script assertion and round 20's `/> (\S+);/`
extraction, which silently yielded `""` once the target was quoted. Both moved
in lockstep.

## Finding 2 — an unbounded temp-directory leak (fixed)

`createOwnedMarkerPath` called `mkdtemp` and nothing ever removed the result;
`grep -rn "eo-sandbox-selftest"` across `packages/`, `scripts/` and `e2e/` found
no cleanup anywhere. Measured: 10 direct runs → 10 dirs; 5 runs through the real
`runDoctor()` → 5 dirs; one run of the check's own test file → **+14**; `/tmp`
had accumulated **98** before anyone looked. ~4 KB and one inode per `doctor`
invocation, permanently.

Cleanup now lives in a `finally`, so it survives every refusal branch and any
throw from the probe. An injected `markerPath` is left alone — it is the
caller's to manage. Verified: `doctor` run against the rebuilt bundle, delta 0.

## Finding 3 — `doctor` could hang forever (fixed)

A SIGKILL inside bwrap's ~0–1 ms setup window races `--die-with-parent`'s
`PR_SET_PDEATHSIG`; the in-namespace child can survive holding the stdout pipe,
so Node's `close` never fires. `createRealProcessProbe` had **no timeout**, so
`check.run()` never settled. Measured **2/12 hangs at a 0 ms kill**, with `ps`
showing stuck `bwrap` processes 20+ minutes later. Not a false PASS — an
availability hang. Pre-existing; not a round-20 regression.

`ProcessProbeOptions.timeoutMs` added, opt-in (omitted still waits forever). On
expiry the child is SIGKILLed and the probe resolves `exitCode: -1` with no
write marker — the UNVERIFIED branch. **Fail-closed: a check that timed out has
not demonstrated confinement.**

## Attacked and could not break

- **Discrimination on a well-formed `TMPDIR`.** real bwrap PASS · no-op shim
  FAIL · no bwrap FAIL · `--bind` control FAIL. Shim independently verified
  genuinely no-op. Round 20's core repair is real.
- **`--ro-bind / /` genuinely covers the mkdtemp path.** bwrap 0.9.0 recursively
  remounts submounts read-only; direct writes to `/dev/shm` (tmpfs) and
  `/mnt/c/temp` (9p DrvFs) inside the bind both returned `Read-only file
  system`. Full check under `TMPDIR` = `/dev/shm`, `/run/user/1000`,
  `/mnt/c/temp/...` and unset: PASS under real bwrap, FAIL under the shim in
  every case. The denial is attributable to the bind, not to a mount-coverage
  accident.
- **`createOwnedMarkerPath` failure is honest.** read-only `TMPDIR` →
  `passed:false, "check threw unexpectedly: EACCES ... mkdtemp"`; nonexistent →
  same with `ENOENT`. No false PASS, no hang.
- **SIGKILL matrix, real argv, N=20 per delay, instrumented on the actual
  termination signal: zero false PASSes.** The 2 ms/3 ms passes are *true*
  passes — every one carried `WROTE:<nonzero>`, so the write was genuinely
  attempted and refused before the kill landed. Because the marker follows the
  write in the same shell, a PASS structurally cannot occur without the write
  being attempted.
- **Rounds 1–19: no regression.** The `--ro-bind` argv, marker-after-write
  ordering, `$?` capture, `exit $s`, the `WROTE:0` disagreement branch and the
  setup-failure branch are all intact and all still discriminate under
  execution.

## Mutation record for this round's fixes

Eight mutants, all killed:

| # | mutation | result |
| --- | --- | --- |
| M1 | unquote the marker path | 4 failed |
| M2 | drop cleanup entirely | 2 failed |
| M3 | cleanup, but not in a `finally` | 2 failed |
| M4 | cleanup deletes an injected caller path too | 1 failed |
| M5 | no timer at all (pre-round-21 behaviour) | 2 hung to timeout |
| M6 | timeout resolves `exitCode: 0` (a false PASS) | 2 failed |
| M7 | the check stops passing `timeoutMs` | 1 failed |
| M8 | the child is not killed on expiry | **survived** → test added, then killed |

M8 is the round's own lesson: resolving the promise while leaving the process
running is exactly the failure being fixed, and nothing detected it. The added
test observes a side effect the process performs *after* the ceiling, because
the probe deliberately does not expose the pid.

## Note on the reviewer's own instrumentation

Round 21's first pass reported "9/10 false PASS at 2 ms" and then corrected
itself: `kill()` on an exited-but-unreaped child is a no-op, so the measurement
was of the instrumentation, not the code. It re-measured on the `close` signal.
Worth recording — it is the same class of error rounds 4–8 made repeatedly.
