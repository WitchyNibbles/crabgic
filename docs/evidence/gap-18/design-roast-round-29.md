# Roast round 29 — the rotation was uncovered, and it did not rotate

Controls executed first: four-way against reality, plus a harness control
(dropping the staleness gate → 2 failed) and confirmation of round 28's finding 3
(a single-file run exits 1 on the coverage threshold even when green, so verdicts
are gated on the `Tests` line **and** the exit code).

## Finding 1 (HIGH) — the anti-starvation mechanism survived being deleted

`rotatingOffset()` → `return 0` left the whole doctor directory at **206/206**.
Coverage reported the function at 100% because it was *executed* by 17 tests and
*asserted by none*: every test passed an explicit offset, so nothing exercised
the default. Confirmed against a mutated `dist` with 600 prefix entries — the
victim at index 500 survived 15 real runs.

That is the **third round running** in which the headline fix shipped without
coverage (round 27 finding 1, round 28 finding 2, this).

## Finding 2 (HIGH) — the offset advanced per wall-clock second, not per run

Round 28 derived it from `Math.floor(Date.now()/1000)`. Measured:

```
runs = 297 in 60.2s  ->  DISTINCT start positions visited = 61
=> the window advances 0.2054 entries per run
```

So convergence is bounded by **elapsed wall clock**, not invocations: a script
looping `doctor` 1,000 times covers ~40 of 20,000 positions, and a 20,000-entry
`TMPDIR` needs ~5.4 hours of elapsed time during which doctor is being called.

## Finding 3 (MEDIUM) — periodic invocation locked the offset entirely

`start = t mod N` confines a fixed period `P` to a coset of `gcd(P, N)`.
Executed at N=900 with a 15-minute timer: **5,000 runs visited exactly one start
value**, and the victim was never reached. The docblock's "reached by a later run
rather than never" was false in the literal sense.

**Fix for 1–3:** a cursor persisted at `<tmpdir>/.eo-sandbox-selftest-sweep-cursor`
advances by exactly one scan window **per invocation**. The clock survives only
as the fallback for a run that cannot read the cursor, and that fallback now
advances within the process too — round 29 measured that a constant there is
undetectable and it is not harmless: where the cursor can never be written, every
run takes the fallback and a constant one is round 27's starvation restored.

## Finding 4 (LOW) — `join` sat outside the try, on a public destructive API

`sweepStaleMarkerDirs(1.5)` made `entries[i]` `undefined`, `join` threw, and the
throw escaped through `createOwnedMarkerPath` → `resolveMarker`, which runs
*before* `run()`'s try/finally — so the framework reported `check threw
unexpectedly`. Round 22's defect class, on the one line round 22 did not cover.
`join` is inside the try now, and the offset is normalised rather than trusted.

The normalisation is not redundant with the try: without it every index is
fractional, every lookup is `undefined`, every iteration is swallowed, and the
sweep **silently does nothing** — which no "did not throw" assertion can
distinguish from working. The test asserts the sweep still removes.

## Mutation record

| # | mutation | result |
| --- | --- | --- |
| W2/X4 | the **literal** round-28 source (clock, no cursor) | 1 failed, exit 1 |
| X1 | `rotatingOffset()` → `return 0` | survived → test rewritten → 1 failed |
| X3 | trust the offset argument | 4 failed, exit 1 |
| X2 | the fallback stops advancing (`+= 0`) | **survived** — recorded, not papered over |

X1 survived its first replacement test because that test seeded only
**removable** entries, where a constant offset still converges — the window
empties and the next run sees new entries at the same index. This is round 28's
finding 2 recurring inside round 29's own fix, caught by mutation rather than by
review, and fixed by seeding an unremovable wall.

**X2 is left surviving deliberately.** With a wall of `SCAN_LIMIT + 20` the
window covers 400 of 421 entries, so a fixed start still reaches the victim for
most placements; distinguishing "advances by a window" from "advances by zero"
would need a wall several times `SCAN_LIMIT` and a correspondingly slow test.
The property that matters — the fallback is not constant — is pinned by X1.
Recorded rather than covered by a test that would assert nothing.

## Attacked and could not break (round 29's own battery)

- **Round 28's mutation record is honest**: the literal round-27 loop → 1 failed.
- **Hostile `TMPDIR`, 14/14 correct**, including the negative direction: a
  hostile `TMPDIR` does not rescue a no-op shim (3/3 still FAIL).
- **Branch coverage against reality**: `WROTE:0`, setup-failure, and the
  unattributable-refusal branch all reached with real bwrap and real shims.
- **Signal matrix**: INT 130 / TERM 143 / HUP 129 / QUIT 131 with 0 survivors
  each; KILL 137 uncatchable.
- **Symlinks**: `stat` follows, `rm` does not — a symlinked victim tree keeps its
  contents, the link is unlinked.
- **Cost**: `readdir` dominates and is linear (~1.1 µs/entry); 200,000 entries
  cost 219–341 ms, of which 183 ms is the bare `readdir`.

## Instrumentation notes from round 29, carried forward

- Node's `fs.readdir` returns **sorted** results (libuv's `uv_fs_scandir` sorts)
  while `ls -U` and Python's `os.listdir` return hash order. A conclusion that
  the tests were order-dependent was drawn from the latter and discarded — it
  would have been a false HIGH.
- `setsid` + `wait` reports `rc=0` for every signal including SIGKILL. Degenerate.
