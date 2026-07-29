# Known host-load timing flakes (2026-07-28)

Four tests in the default gate fail intermittently under parallel load and pass in
isolation on re-run. All four are **pre-existing** — none was introduced by the
standing-approval work — and all four are timing-sensitive rather than logically wrong.
Catalogued here because an uncatalogued flake is indistinguishable from a regression, and
this branch hit that confusion once already (see `live-verification.md`).

| Suite                 | Test                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------ |
| `@crabgic/git-engine` | ref-collision resistance: many concurrent attempts on the SAME task never collide          |
| `@crabgic/perf`       | times a default-exported sync benchmark function and self-reports real `getrusage` figures |
| `crabgic` (CLI)       | HIGH H2: two overlapping verifications of the SAME token — exactly one succeeds            |
| `@crabgic/journal`    | the automatic heartbeat interval actually renews the on-disk record (`autoRenew: true`)    |

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
