# Known host-load timing flakes (2026-07-28)

Four tests in the default gate fail intermittently under parallel load and pass in
isolation on re-run. All four are **pre-existing** — none was introduced by the
standing-approval work — and all four are timing-sensitive rather than logically wrong.
Catalogued here because an uncatalogued flake is indistinguishable from a regression, and
this branch hit that confusion once already (see `live-verification.md`).

| Suite                 | Test                                                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@crabgic/git-engine` | ref-collision resistance: many concurrent attempts on the SAME task never collide                                                                               |
| `@crabgic/perf`       | times a default-exported sync benchmark function and self-reports real `getrusage` figures                                                                      |
| `crabgic` (CLI)       | HIGH H2: two overlapping verifications of the SAME token — exactly one succeeds                                                                                 |
| `@crabgic/journal`    | the automatic heartbeat interval actually renews the on-disk record (`autoRenew: true`)                                                                         |
| `@crabgic/git-engine` | control-clone crash/recovery (`control-clone.crash.test.ts`) — see the 2026-08-07 row note below                                                                |
| `@crabgic/supervisor` | idle resource budget over a sustained idle window with the REAL 5s-paced scheduler (`idle-budget.integration.test.ts`) — see the 2026-08-07 sighting note below |
| `crabgic` (CLI)       | run-dispatcher reports a settle-transition failure through `onDriveError` rather than crashing (`run-dispatcher.test.ts`) — see the seventh-row note below      |

Each was observed failing once during this branch's work, re-run in isolation, and passed.
The pattern is the same in all four: a real wall-clock interval or a concurrency window
that a loaded host stretches past its tolerance.

## Why this is a real cost, not a footnote

A gate that goes red for reasons unrelated to the change under test teaches its readers to
re-run rather than investigate — and the moment that habit forms, a genuine regression gets
the same shrug. The catalogue is the minimum honest response; the fix is to make each of
these four either deterministic (inject the clock) or explicitly tolerant of a slow host,
which is work for whoever owns those phases.

**Not deferred silently:** during this branch a flaky test really was mistaken for a
regression it had caused, on one sample from each of two branches. That is the concrete
cost of leaving these unlabelled.

Round 32 note: this file said "Five tests" above a table of four and then referred to
"all four" twice. A catalogue of flakes exists so a reader can tell a known flake from a
regression at a glance, and one that cannot count its own rows invites the reader to
assume a fifth is missing and re-run rather than investigate — the exact habit the section
above argues against. Corrected to four; the table was always the authority.

Round 32 re-confirmed row 3 (`HIGH H2`) directly: it failed once in a full-suite run and
passed 3/3 in isolation immediately afterwards.

## Fifth row, added 2026-08-07 — and its provenance, stated rather than implied

The table above is now **five** rows. The prose above it still says "Four tests" and "all four"; that
text is left verbatim, and this section is the correction — the same handling this file's own Round
32 note applied when it last miscounted itself. **The table has always been the authority; it now has
five rows and the reader should count them rather than trust either sentence.**

⚠️ **Provenance of the new row, and it is weaker than every other row here.**
`control-clone.crash.test.ts` (`@crabgic/git-engine`) was observed failing during the 2026-08-06/07
remediation wave in **local pre-push runs, by two independent agents; no CI run id was captured**,
and no committed artifact or PR body records the failing run. Both sightings were on a loaded host
running the full suite. That is thinner evidence than rows 1–4, every one of which was observed,
re-run in isolation and seen to pass — so this row is a **catalogue entry, not a verdict**: it says
"if you see this red under parallel load, you are not the first", and it does not assert the test is
wrong. It must not be cited as evidence that the suite is flaky, and the first agent to reproduce it
should replace this paragraph with a run id.

**A second, sharper caution earned in the same wave and recorded here because this file is where a
reader lands when a pre-push run goes red:** a `git push` run as a BACKGROUND harness task has its
pre-push hook — and therefore the suite — killed by the task lifecycle, and the result presents as a
failing test. Before adding any sighting to this table, check whether the push was backgrounded. The
ruling is in `docs/verification-playbook.md`.

**Remedy, same shape as the other four rows' fix note:** inject the clock, or widen the tolerance so
a slow host cannot stretch the window past it. S-sized, and it belongs to whoever owns that phase.

**Cross-reference, both directions.** `docs/verification-playbook.md` keeps its own known-load-flake
list, and the two have drifted. Its `lease.test.ts` `onLeaseLost`/`autoRenew` entry and this file's
`@crabgic/journal` heartbeat row are **the same `autoRenew` real-timer family** recorded twice under
different names. Its `command-runner.test.ts` zero-CPU entry has no row here. Three fast-check
property timeouts seen this wave — `engine-core`'s footguns property, `gates`' coverage-ratchet
property and `engine-claude`'s session property, all timeouts under concurrent load and never
assertion failures — are now listed there and are deliberately **not** given rows here, because none
was re-run in isolation to confirm it passes. Neither list is authoritative alone; add a new sighting
to both.

## Sighting added 2026-08-07 (the v1.6.0 pre-cut gate) — `@crabgic/supervisor` idle budget

Seen red once in a full `npm test` run taken immediately after `npm run build` on the developer host:
`expected 0.011960719041278295 to be less than 0.01`, i.e. the measured CPU fraction over the idle
window came in at 1.196% against a <1% budget, with RSS well inside its own budget. Re-run in
isolation three times immediately afterwards: **3/3 green**. The branch carrying the sighting touches
only `e2e/`, `docs/`, `roadmap/` and `.changeset/` — nothing under `packages/supervisor` — so the
failure cannot be attributed to the diff it appeared under.

**The table above is now SIX rows.** The 2026-08-07 section headed "Fifth row" says it is five and
is left verbatim; this is its correction, the same handling that section itself applied to the
"Four tests"/"all four" prose above it. The table has always been the authority — count it.

This row is a verdict of the same strength as rows 1-4 rather than a catalogue entry: it was
observed, re-run in isolation, and seen to pass. The shape is the family this file already
describes — a real wall-clock window whose measurement a loaded host stretches past its tolerance —
and the same remedy applies: widen the tolerance or measure against something a co-tenant build
cannot inflate. Added to `docs/verification-playbook.md`'s list in the same pass, per the
cross-reference rule below.

### Second sighting of the same row, 2026-08-07 — and the mechanism above is amended

**A fourth breach was observed during review of PR #133: `1.0137%`**, in a full-suite run under
concurrent external load. Two further breaches were reported in the same review at **1.075%** and
**1.159%**; a repo-wide grep finds no transcript, run id or row for either, so they are listed as
**UNVERIFIED** and nothing rests on them.

⚠️ **And a FIFTH, captured first-hand while writing this entry — `1.6977%`, the largest this arm has
ever produced, 1.42× the 1.196% above.** `expected 0.01697674418604651 to be less than 0.01` at
`idle-budget.integration.test.ts:46`, in a plain `npx vitest run --coverage` full-suite run
(2 failed | 652 passed of 654) with **no artificial load** — `pgrep` for the load generators returned
0 and `/proc/loadavg` read `6.47 16.96 20.59`, a machine settling rather than working. Re-run in
isolation three times immediately afterwards: **3/3 green**, at 0.1074 / 0.0277 / 0.0819%, themselves
a 3.9× spread. Verbatim capture in `docs/evidence/phase-05/idle-budget-load-sensitivity.txt` §5c.

⚠️⚠️ **A SIXTH, twenty minutes later and far larger — `3.2330%`**
(`expected 0.03233044636908727 to be less than 0.01`, 1 failed | 6868 passed), in the pre-push hook
for the very commit recording the fifth. **2.7× the 1.196% this section opens with.**

⇒ **THIS ROW'S FREQUENCY DESCRIPTION IS NOW WRONG AND IS THE POINT.** "Seen red once", above, is
left verbatim. On the developer host on 2026-08-07 the arm breached in **two of three consecutive
plain full-suite runs** — red 1.6977%, green, red 3.2330% — none under artificial load, with the
readings growing rather than clustering near the bound. ⚠️ **But CI is GREEN at the same commit** — both
`unit-test+coverage` jobs passed at `14636b0` (4m16s x64, 3m36s arm, 15/15 checks). The rate is a
property of the **developer host**, not the runners. **Do not treat this row as an occasional
timing flake any more, and do not read it as a CI problem either.** At that rate it is a gate that does not work, and re-running it is not a
disposition. Severity in the defect record is raised accordingly.

⚠️ **The sentence above — "a real wall-clock window whose measurement a loaded host stretches past
its tolerance" — stays verbatim and is half wrong.** It is the right family and the wrong mechanism,
and the difference changes the remedy. Measured, and written up in full at
`docs/evidence/phase-05/idle-budget-load-sensitivity.txt`:

- `vitest.config.ts` sets no `pool`, so Vitest 4.1.10 resolves `pool = "forks"` with `isolate: true`.
  **Every test file runs in its own forked process**, and the metric is `getrusage(RUSAGE_SELF)` over
  wall clock — so a co-tenant _build_ or a co-tenant _test file_ cannot enter the numerator at all.
  What can: machine-level CPU contention, and this worker's own coverage/GC overhead.
- Machine contention does move it, and by a lot: three unloaded runs vs three under 32 busy loops on
  16 cores gave means 0.0663% → 0.1226%, **1.85× with no overlap between the arms**.
- But contention alone is **not sufficient** to breach: a full 654-file suite run _under_ those 32
  busy loops put the arm at **0.0961%**, well inside budget.
- And the disposition every sighting has used — "re-ran in isolation, 3/3 green" — is drawn from the
  **wrong part of the distribution**. The isolated channel spans **11.9×**
  (0.0284% here → 0.3293% at `docs/evidence/phase-05/closeout-c6-idle-budget.txt:20`, an isolated
  run with coverage off, committed 2026-08-01) and has produced **zero breaches in 15 captured
  samples**, while the full suite breached in **two of five** uncontended ones. Every non-breach full-suite
  figure ever recorded sits inside the isolated band.

⇒ **Do not read a green isolated re-run as clearing this row.** The honest summary is that the 1%
figure is a spec number transcribed from the roadmap (traceable to one commit, `42c9afe`) sitting
above a distribution nobody has characterised. Filed with a sized remedy as
`docs/evidence/criteria-closeout/defects/05-idle-budget-arm-not-calibrated-for-its-channel.md`; the
remedy that matches the measured mechanism is a dedicated CI step on a runner doing nothing else, not
a wider tolerance.

### Seventh row, added 2026-08-07 — `crabgic` (CLI) run-dispatcher settle-transition

**The table above is now SEVEN rows.** Failed once in the same plain full-suite run that produced the
1.6977% reading above:

```
FAIL |crabgic| src/daemon/run-dispatcher.test.ts >
  createRealRunDispatcher — dispatch > reports a settle-transition failure
  through onDriveError rather than crashing
AssertionError: expected false to be true
 ❯ src/daemon/run-dispatcher.test.ts:837:81
```

Re-run in isolation three times immediately afterwards: **61 passed (61)** each, exit 0. So this is a
**verdict** of the same strength as rows 1-4, not a catalogue entry — observed, re-run in isolation,
seen to pass. It was in **neither** list before today.

### Also observed in those contended runs — the fast-check family, confirmed

The same two deliberately-contended full-suite runs failed 3 files / 6 tests and 5 files / 6 tests
respectively, **none of them the idle-budget arm**: `@crabgic/engine-core`'s
`src/footguns/{property,smuggling,anchor-forms,mcp-deny}.test.ts` and `@crabgic/perf`'s
`src/stats/decision-engine.property.test.ts`, all as timeouts rather than assertion failures. That is
the "three fast-check property timeouts under concurrent load" family the cross-reference section
below already names, now reproduced deliberately rather than seen in passing, and it is a **larger**
set than the three recorded there.
