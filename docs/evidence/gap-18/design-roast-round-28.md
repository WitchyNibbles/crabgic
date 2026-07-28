# Roast round 28 — the fix that made the thing it warned about

Non-degeneracy control executed first (five-way), plus a control on the mutation
harness itself.

## Finding 1 (HIGH) — round 27 traded starvation for an unbounded per-run scan

`swept` counted only **successful** removals, so entries that can never be
removed never advanced the cap: every `doctor` run re-`stat`ed and re-`rm`ed
every prefix entry in `TMPDIR`, forever, outside the confinement ceiling.

| `TMPDIR` contents | round 27 | the code it replaced | factor |
| --- | --- | --- | --- |
| 20,000 unremovable stale | **7,282–7,600 ms** | 104 ms | **70×** |
| 100,000 fresh prefix entries | **5,183–5,402 ms** | 99 ms | **53×** |

`entriesLeft` was constant across runs, so the cost was permanent rather than
amortised. The unremovable case is *exactly* the scenario round 27 named as its
motivation — it made that scenario reachable and made its cost unbounded in one
edit — while the docblock went on promising that "a directory with thousands of
entries cannot turn a health check into a filesystem scan".

**Fix:** bound both dimensions. A run examines at most `SCAN_LIMIT = 400`
entries and removes at most `MAX_STALE_MARKER_SWEEP = 200`; starvation is
defeated by a **rotating start offset** rather than by an unbounded search, so an
entry behind a wall of unremovable ones is reached by a later run. The offset is
a parameter, so the property is testable without depending on the clock.

Measured after, same 20,000 unremovable entries: **222 / 213 / 215 ms** — 34×
faster, and the residual is the `readdir` itself.

## Finding 2 (HIGH) — round 27's test could not detect its own defect

The literal round-27-vs-round-26 mutation left `sandbox-selftest.test.ts` at
50/50 and the whole doctor directory at **204/204**. Its test seeded only
*removable* stale directories, where both loops behave identically; starvation
needs unremovable entries in front, and nothing seeded any. Round 27's rows `U3`
and `U5` were paraphrases, not the prior code.

This is round 27's own finding 1 — "a paraphrased mutation gives false
confidence" — reproduced inside round 27's own fix, one round later. The
replacement tests seed unremovable entries, which is the only shape that
separates the two loops, and the literal round-27 loop now fails.

## Finding 3 (methodology) — a worker-killing mutation shows zero "failed" lines

```
Tests  24 passed (30)      Errors  1 error      VITEST-EXIT-CODE=1
grep -Ec "FAIL|failed" -> 0
```

A battery that greps for "failed" reads that as SURVIVED. Batteries must gate on
the exit code as well — with the caveat, measured here, that a single-file run
also exits 1 on the coverage threshold, so neither signal is sufficient alone:
the `Tests` line discriminates assertion failures, the exit code discriminates
aborted runs.

Hygiene corollary: each worker-killing run leaks an `eo-process-probe-*` dir
because `afterEach` never runs. Four were found, two dating from round 27's own
battery.

## Finding 4 (informational) — the cap test pins shape, not magnitude

`MAX_STALE_MARKER_SWEEP = 25` and `= 5000` both leave the test green, because it
is written against the exported constant. Expected, and recorded so nobody reads
it as bounding the value.

## Mutation record

| # | mutation | result |
| --- | --- | --- |
| V1 | the **literal** round-27 loop (unbounded scan) | 1 failed, exit 1 |
| M3 | literal removal of the structural parent check | 1 failed |
| M4 | drop `isUnattributableRefusal` | 3 failed |
| M6 | literal pre-round-27 reset | 1 failed |

12 mutations across the round, each with a verified-non-empty durable backup, an
anchor asserted to occur exactly once, `trap ... EXIT INT TERM`, and a post-restore
`diff -q`: **12/12 SAME**.

## Attacked and could not break

- **The round-27 attributability guards held under every attack.** Real bwrap
  wording is identical on ext4 `/tmp`, tmpfs `/dev/shm` and DrvFs `/mnt/c`. A
  14-shape hostile-`TMPDIR` matrix through the real check: **14/14 correct**,
  zero injection artifacts — the three errno phrases, `bwrap:`, newline + errno,
  newline + forged `bwrap:` line, space, apostrophe, `$(id -u)`, trailing slash,
  symlinked TMPDIR, tmpfs, DrvFs, benign. The strip is complete because dash
  echoes `$1` verbatim.
- **No filesystem here makes a live marker look stale**: mtime skew 4 ms (/tmp),
  1 ms (/dev/shm), 71 ms (DrvFs) against a one-hour cutoff.
- **`options.markerPath` still has no non-test caller**, so `owned` is always
  true in production and the structural guard is never silently inert.
- **Signal matrix through the real CLI**: INT 130, TERM 143, HUP 129, QUIT 131,
  0 orphans each; KILL 137 with 1 (uncatchable). 12 concurrent real runs: 0
  leaks. Full doctor directory: 204/204.
