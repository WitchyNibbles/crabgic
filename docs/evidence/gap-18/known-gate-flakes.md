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

This row is a verdict of the same strength as rows 1-4 rather than a catalogue entry: it was
observed, re-run in isolation, and seen to pass. The shape is the family this file already
describes — a real wall-clock window whose measurement a loaded host stretches past its tolerance —
and the same remedy applies: widen the tolerance or measure against something a co-tenant build
cannot inflate. Added to `docs/verification-playbook.md`'s list in the same pass, per the
cross-reference rule below.
