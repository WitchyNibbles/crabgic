# Roast round 22 — the confinement probe, again

Read-only review of round 21's repairs. Non-degeneracy control executed first:
mutating the repo source `--ro-bind` → `--bind` flipped the real check to
`passed: false`, so every PASS reported below is attributable. The no-op `bwrap`
shim was independently validated (shim → `WROTE:0`; real bwrap → `Read-only file
system` / `WROTE:2`) before being trusted.

## Finding 1 (HIGH) — the round-21 quoting fix was escapable with one character

`marker.path` was interpolated inside single quotes, and single quotes are not an
escape for a string that may contain a single quote. `os.tmpdir()` honours
`TMPDIR`; `mkdtemp` only appends random characters to a `TMPDIR`-derived prefix.

End-to-end through the real CLI bundle, against a no-op shim — **a host with no
sandbox at all**:

| `TMPDIR`                                  | before                                        | after                    |
| ----------------------------------------- | --------------------------------------------- | ------------------------ |
| benign, real bwrap                        | ✓ correctly denied                            | ✓ correctly denied       |
| benign, no-op shim                        | ✗ unexpectedly succeeded                      | ✗ unexpectedly succeeded |
| `x'; echo WROTE:2; exit 2; '`, no-op shim | **✓ correctly denied** (false PASS)           | ✗ unexpectedly succeeded |
| `x'; echo WROTE:2; exit 2; '`, real bwrap | ✓                                             | ✓                        |
| `O'Brien`, real bwrap                     | **✗ Unterminated quoted string** (false FAIL) | ✓ correctly denied       |
| `y'; : > INJECTED; exit 2; '`, no-op shim | **INJECTED created**                          | ✗, no injection          |

So: an **even** number of quotes gave a false PASS, an **odd** number gave a
permanent false FAIL on a healthy host, and `id -u > FILE` inside a payload
really executed — arbitrary command execution, not merely verdict control. The
odd-quote case is not exotic: `TMPDIR=/mnt/c/Users/O'Brien/AppData/Local/Temp`
is exactly the WSL2 configuration round 21 cited as its own justification.

`options.markerPath` is not reachable from any non-test caller (`run-doctor.ts`
passes only `probe`), so `TMPDIR` was the whole attack surface.

**Fix: stop quoting, stop interpolating.** The script is now a constant and the
path arrives as `$1`, a positional argument the shell never re-parses. `;`,
`&&`, `$(…)`, backticks and newlines were already neutralised — only `'`
escaped — and as an argument none of them are parsed at all.

## Finding 2 (MEDIUM) — the timeout's SIGKILL reached one pid, not the tree

Round 21's own test passed only because `dash` held that whole script itself.
One subshell deeper the kill hit `sh` while the grandchild survived, kept the
probe's stdout/stderr pipes open, and `close` never fired. **The hang was not
removed — it was relocated to process exit**, and `bin.ts` sets
`process.exitCode` and relies on a natural exit:

```
$ timeout 12 node hang.mjs 'sleep 300'
RESOLVED after 504ms exit=-1 ; rc=124   # node never exited
activeResources: ["PipeWrap","PipeWrap","Timeout"]
```

Round 21's own test file orphaned two `sleep 300` processes per run — the
round-21 leak class (98 directories) reintroduced as processes.

**Fix:** a ceiling now makes the child a group leader (`detached: true`, only
when `timeoutMs` is supplied, so the default is byte-identical to before), and
expiry kills the whole group with a bare-child fallback. Streams are destroyed
as a backstop for anything escaping the group. Verified: grandchild dead,
`activeResources` empty, node exits `rc=0` where it previously hung at `rc=124`,
zero orphans.

## Finding 3 (MEDIUM) — the presence probe had no ceiling, two lines above the fix

`grep timeoutMs packages/cli/src` found exactly one call site. A `bwrap` shim
sleeping on `--version` hung `doctor` for `wall=28.35s` until killed externally,
with no output and no diagnosis. Now bounded at 10 s:

```
✗ [error] sandbox.selftest: "bwrap --version" failed (exit -1):
  [probe timed out after 10000ms and was killed]        wall=14.79s
```

## Finding 4 (LOW) — a cleanup throw discarded the verdict

The `finally` runs after the return value is computed, and a throw from `rm`
replaced it. A marker directory at 0500 turned a live "confinement is not
holding" into `check threw unexpectedly: EACCES ... unlink`, with a repair step
saying to re-run. Cleanup failing is a leaked temp directory, not a finding
about the sandbox. Now swallowed deliberately.

## Mutation record

| #   | mutation                                  | result       |
| --- | ----------------------------------------- | ------------ |
| N1  | interpolate the path back into the script | 10 failed    |
| N2  | kill only the direct child                | 2 failed     |
| N3  | drop `detached` (the group never exists)  | 1 failed     |
| N4  | presence probe loses its ceiling          | 1 failed     |
| N5  | cleanup throw again replaces the verdict  | **survived** |

N5 survived because the test injected `markerPath` — and that branch
deliberately never calls `rm`, so it could not fire. Rewritten to point `TMPDIR`
at a fresh directory and take the real created-and-cleaned path, plus a
guards-the-guard test asserting `rm` really does throw for that shape. N5 then
died. **Found by mutation-checking the fix, not by the suite going green** — the
suite was 43/43 with the defect live.

## Reviewer instrumentation errors caught in-round

- Round 22 nearly reported a false finding: `kill()` on an exited-but-unreaped
  child is a no-op, so its first SIGKILL matrix measured the harness.
- A new test asserted `PipeWrap` handles were absent, which measured vitest's own
  IPC pipes rather than the probe. Changed to a delta.
- 6 orphaned `sleep 300` processes after a full run were attributed to the two
  deliberately-broken mutation runs (3 tests × N2, N3), not the fixed code; the
  file in isolation leaves delta 0.

## Attacked and could not break

- Every metacharacter other than `'` — already neutralised, and now unparsed.
- `options.markerPath` from a caller: not reachable outside tests.
- `rm` following a symlink / TOCTOU: Node's `rm` unlinks the symlink, victim
  survived; `dir` is `mkdtemp`'s return value and never shell-interpreted.
- Concurrent doctor runs: `mkdtemp` names are unique.
- Real bwrap + timeout reaps the tree via `--die-with-parent` + PID namespace
  (`wall=0.53s`, no leftover `bwrap`) — the current call site was already safe;
  the seam was not.
- `timer.unref()` and the `settled` guard: no double-resolve under any real race.
- Rounds 1–20 branches, all re-verified under execution: real bwrap PASS, no-op
  shim FAIL, `--bind` control FAIL, no bwrap FAIL, the `WROTE:0` disagreement
  branch, the setup-failure branch, and an unresolvable inner `sh` failing closed.
- The leak tests genuinely detect a leak (independently mutation-checked).
