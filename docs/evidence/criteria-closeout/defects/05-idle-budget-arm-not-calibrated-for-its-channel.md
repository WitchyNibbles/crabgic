# 05 — the idle-budget arm's `<1%` is a spec number over an uncharacterised distribution

**Phase:** 05 — Supervisor daemon (`roadmap/05-supervisor-daemon.md`, §Exit criteria: "Idle budget
test green with documented numbers (<100 MiB RSS, <1% of one core, 5 s heartbeat)"). The criterion is
ticked and stays ticked: this record is about the instrument, not about the daemon.

**Found:** 2026-08-07, post-v1.6.0 review, at `5b10f1e257a5ae835fb5edbba1cf3b8e87ca6744`
(`origin/main`).

**Severity:** **raised 2026-08-07 from low to blocking-the-gate**, still **not a product defect of
any kind**. The cost named at `docs/evidence/gap-18/known-gate-flakes.md:24` — "a gate that goes red
for reasons unrelated to the change under test teaches its readers to re-run rather than
investigate" — is no longer occasional here. ⚠️ **On this host today the arm breached in two of three
consecutive plain full-suite runs, at 1.6977% and 3.2330%, with no artificial load in any of them.**
The second is **2.7× the previously recorded maximum**. Every earlier description of this arm's
frequency — "seen red once", "three times in one week" — understates what is now measurable. A test
that fails roughly two runs in three is not a flake to catalogue; it is a gate that does not work.

**Effort: S** either way. Two remedies sized below.

> ⚠️ **This record was rewritten 2026-08-07 after review of PR #133 refuted its first mechanism.**
> The withdrawn claims and their refutations are kept in
> `docs/evidence/phase-05/idle-budget-load-sensitivity.txt` §0 rather than deleted, because the
> refutation is more instructive than the original. In brief: the first draft blamed co-tenancy
> _inside_ the vitest worker process, which cannot happen; claimed external host load does not move
> the metric, which measurement refutes; and claimed the isolated channel is the quiet one, which the
> repository's own committed evidence had already refuted before this pass began.

## What the arm measures

`idle-budget.integration.test.ts:46` asserts `cpuFraction < CPU_BUDGET_FRACTION` (`:15`, `0.01`) over
a fixed 1 500 ms wall window (`:16`), with the real 5 s-paced scheduler started at `:26`.

The scheduler fires **exactly once** inside that window, not zero times: `heartbeat-scheduler.ts:45`
is `tick(); // one immediate sample…` inside `start()`, and the 5 s interval never elapses inside
1.5 s.

`resource-probe.ts:37-45` computes the number as `(userCPUTime + systemCPUTime) delta / wall delta` —
`getrusage(RUSAGE_SELF)` over wall clock. **This is the CPU of the whole worker process, all threads
(V8 GC and compiler threads, libuv's pool), over 1.5 s in which the subject does almost nothing.** So
the numerator is overwhelmingly the worker's own overhead: v8 coverage collection, GC, and the module
graph of the one file it is running.

**It cannot see any other test file.** `vitest.config.ts` sets no `pool`; Vitest 4.1.10 resolves
`pool = "forks"` with `isolate: true`, so every test file runs in its own forked child process, and
`RUSAGE_SELF` does not cross a process boundary. Any account of this metric that appeals to "the
other 653 test files in this process" is describing something that does not exist.

**Where the 1% came from — not from a measurement.**
`git log -S "CPU_BUDGET_FRACTION = 0.01"` over that file returns exactly one commit, `42c9afe`
("feat: phase 05 supervisor daemon and UDS control plane"), the phase's own implementation commit.
The constant was **transcribed from the roadmap criterion's words**, which is the right thing to have
done for a spec number — and it means the threshold has never been calibrated against the
distribution of the instrument that checks it.

## Measured — and the received story is inverted

| channel                                                    | `cpuFraction`             |
| ---------------------------------------------------------- | ------------------------- |
| isolated, coverage OFF, 3 files — **committed 2026-08-01** | **0.3293%**               |
| isolated, coverage OFF, 1 file, **32 busy loops**          | 0.1007 / 0.1271 / 0.1399% |
| isolated, coverage OFF, 1 file, no load                    | 0.0284 / 0.0773 / 0.0931% |
| isolated, coverage ON, 1 file — **committed**              | 0.1083%                   |
| isolated, coverage ON, 1 file                              | 0.0827 / 0.0842 / 0.0897% |
| isolated, coverage OFF, 1 file, 8 busy loops (unstarved)   | 0.0910%                   |
| one project (55 files)                                     | 0.0992%                   |
| full suite, local                                          | 0.0971 / 0.1571%          |
| full suite, CI — **committed**                             | 0.1202%                   |
| full suite, local, **under 32 busy loops**                 | 0.0961 / 0.1069%          |

**Two results, and the second is the one that matters.**

**1. External machine contention does move it, cleanly.** Three unloaded runs against three runs
under 32 busy loops (2× `nproc`, so the process is genuinely starved rather than merely sharing):
means 0.0663% → 0.1226%, **1.85×, with no overlap** — the loaded minimum (0.1007%) exceeds the
unloaded maximum (0.0931%). An earlier probe used 8 loops on 16 cores, never starved the process, and
found nothing; that probe proved nothing and its conclusion is withdrawn.

**2. The isolated channel is the noisier one, by a wide margin.**

```
ISOLATED   span 0.0284% -> 0.3293%   = 11.6x
FULL SUITE span 0.0971% -> 0.1571%   =  1.6x
```

The 0.3293% top of that range is `docs/evidence/phase-05/closeout-c6-idle-budget.txt:20` — an
**isolated** run with **coverage off**, the leanest configuration that exists, committed on
2026-08-01 with its command and exit status. It is the **highest non-breach figure on record
anywhere**, and 2.7× the CI full-suite figure at `roadmap/05-supervisor-daemon.md:122` (0.1202%).
Every full-suite figure ever recorded sits _inside_ the isolated channel's own band. Even three
consecutive unloaded runs of one command span 3.3× (0.0284–0.0931%) with nothing changed between
them.

⇒ **The honest statement is not "the full suite is noisy and isolation is quiet". It is: this metric
is noisy in every configuration, and no channel has been sampled enough times to say what its
distribution is.** The budget is a spec number sitting above a distribution nobody has
characterised — which is what makes an occasional breach unsurprising, and what makes "re-ran it in
isolation, 3/3 green" a weak disposition rather than a verdict.

## The breaches

**On record**, committed and independently readable at `docs/evidence/gap-18/known-gate-flakes.md:82`:
`expected 0.011960719041278295 to be less than 0.01` — **1.196%** — in a full `npm test` taken
immediately after `npm run build`; 3/3 green in isolation; the branch touched nothing under
`packages/supervisor`. Mirrored at `docs/verification-playbook.md:922`.

**Observed during review of PR #133**, in a full-suite run under concurrent external load:
**1.0137%**. Attributed to the review rather than claimed first-hand, and added to both flake lists
in this commit per `docs/verification-playbook.md:929`.

**Reported without an artifact — UNVERIFIED:** 1.075% and 1.159%. A repo-wide grep returns nothing
for either; no transcript, no run id, no flake row. Nothing here rests on them.

**⚠️ REPRODUCED FIRST-HAND BY THIS PASS — 1.6977%, the largest breach on record.** It happened on the
ordinary green-the-branch gate run, with no artificial load at all:

```
$ npx vitest run --coverage
 FAIL |@crabgic/supervisor| src/idle-budget/idle-budget.integration.test.ts
 AssertionError: expected 0.01697674418604651 to be less than 0.01
  ❯ src/idle-budget/idle-budget.integration.test.ts:46:25
 Test Files  2 failed | 652 passed (654)
```

**1.42× the previous maximum (1.196%).** Host state checked rather than assumed: `pgrep` for the
load generators returned **0**, and `/proc/loadavg` read `6.47 16.96 20.59` — nothing consuming CPU,
but a machine still settling from the contended runs below. Re-run in isolation three times
immediately afterwards: **3/3 green**, at 0.1074 / 0.0277 / 0.0819% — themselves a 3.9× spread, which
is exactly why that disposition is weak.

**And again, larger, on the very next full-suite run — `3.2330%`**, in the pre-push hook for the
commit carrying this record (`expected 0.03233044636908727 to be less than 0.01`, 1 failed | 6868
passed). That is **2.7× the previously recorded maximum** and 1.9× the reading twenty minutes
earlier. Three consecutive plain full-suite runs on this host went **red (1.6977%) → green →
red (3.2330%)**, none of them under artificial load. The readings are getting _larger_, not
clustering near the bound.

**And it cuts both ways, which is why both halves are stated.** Two full-suite runs held under 32
busy loops for their whole duration came in at **0.0961%** and **0.1069%** — inside budget by an
order of magnitude — while the **unloaded** run breached at 1.6977%. So deliberate machine contention
is **neither necessary nor sufficient**. This record does not claim to have isolated the mechanism;
it claims, now with a first-hand breach behind it, that the distribution is uncharacterised in every
channel and the threshold was set above it by transcription.

⚠️ Both of the contended runs were nevertheless **red** (exit 1: 3 files / 6 tests, then 5 files / 6
tests) —
and none of the failures was this arm. All were fast-check property **timeouts**:
`packages/engine-core/src/footguns/{property,smuggling,anchor-forms,mcp-deny}.test.ts` and
`packages/perf/src/stats/decision-engine.property.test.ts`. That is the family
`docs/verification-playbook.md` already lists as "three fast-check property timeouts under concurrent
load", reproduced deliberately rather than in passing, and it is a **larger set than the three
recorded there**. Both flake lists are updated in this commit. It belongs in this record only as the
honest answer to "what does contention actually break here" — and the answer is not this arm.

## Why "it is already in both flake lists" is not a disposition

The arm is listed twice (`docs/evidence/gap-18/known-gate-flakes.md:16`,
`docs/verification-playbook.md:922`), and both entries are honest. But the catalogue calls itself
"the minimum honest response" and names the fix as owed to "whoever owns those phases"
(`docs/evidence/gap-18/known-gate-flakes.md:26-28`). Sightings have now accumulated faster than
calibration, and the reason a fourth list entry is not the answer is now measurable rather than
rhetorical: **the disposition each sighting used — "re-ran in isolation, green" — is drawn from the
channel with the widest spread on record.**

## Proposed remedy

Both remedies are better supported now that the pool is known to be `forks`, because it means the arm
**already** gets its own process. What it does not get is a quiet machine or a known co-tenant count.

1. **Give the arm its own CI step on a runner that is doing nothing else.** Not merely "its own
   process" — it has that. Move the sustained-idle case out of the default `npm test` fan-out into a
   dedicated step (`npx vitest run … --coverage.enabled=false`, the pattern `gates-conformance` and
   `perf-conformance` already use), so the co-tenant count is one and is _known_ rather than
   incidental. This is the remedy that actually matches the measured mechanism. **Effort: S.**

2. **Set the bound from a MEASURED distribution, and record the samples.** Not a round number picked
   to make the red go away: take N samples per channel, commit every one under
   `docs/evidence/phase-05/`, and write the sampling method beside the bound. ⚠️ **N must be large.**
   The table above is 18 samples across eight configurations and the isolated channel alone spans
   11.6× — a handful of runs cannot characterise this. Keep the 1% figure as a **second, isolated**
   assertion so the roadmap's documented number is still asserted somewhere. **Effort: S**, plus real
   sampling time.

⚠️ **What must not be done.** Do not raise the constant to 2%. The roadmap criterion names `<1% of
one core` and the phase's evidence documents it; moving the constant without splitting the isolated
assertion out would quietly weaken a documented number to accommodate an instrument artifact — the
wording-protocol failure this repository has a rule against. Both options preserve the 1% claim; only
the shortcut loses it.

Whichever is chosen, the disposition belongs in this record, not in a fifth flake-list entry.

**Ticket-ready:** yes.

## Not claimed

- **Not claimed:** that the daemon's real idle cost is in question. RSS was 68–71 MiB against a
  100 MiB budget in every run above.
- **Not claimed:** that 1% is the wrong number for a daemon. It is a spec number; what is
  unestablished is the distribution of the instrument that checks it.
- **Not claimed:** the two uncorroborated breach figures.
- **Not claimed:** that this pass isolated the _mechanism_. It reproduced a breach (1.6977%, larger
  than any on record) but could not produce one on demand: deliberately contended full-suite runs
  came in at 0.0961% and 0.1069%, while the breach arrived on an unloaded run.
- **Not claimed:** that anything ships wrong. Nothing does — this is an instrument, not the daemon.
  ⚠️ But the earlier "not urgent" is **withdrawn**: at a two-in-three failure rate the arm is
  currently blocking honest pushes, and this record's own commit had to use the sanctioned
  docs-only pre-push bypass because of it.

**Evidence:** `docs/evidence/phase-05/idle-budget-load-sensitivity.txt`.
