# 05 — the idle-budget arm's `<1%` budget is calibrated for isolation and runs in the full suite

**Phase:** 05 — Supervisor daemon (`roadmap/05-supervisor-daemon.md`, §Exit criteria: "Idle budget
test green with documented numbers (<100 MiB RSS, <1% of one core, 5 s heartbeat)"). The criterion is
ticked and stays ticked: this record is about the instrument's calibration, not about the daemon.

**Found:** 2026-08-07, post-v1.6.0 review, at `5b10f1e257a5ae835fb5edbba1cf3b8e87ca6744`
(`origin/main`).

**Severity:** low, and **not a product defect of any kind**. The cost is exactly the one
`docs/evidence/gap-18/known-gate-flakes.md:24` names: "a gate that goes red for reasons unrelated to
the change under test teaches its readers to re-run rather than investigate — and the moment that
habit forms, a genuine regression gets the same shrug."

**Effort: S** either way. Two remedies sized below; both are small and one of them is two lines.

## What the arm measures

`packages/supervisor/src/idle-budget/idle-budget.integration.test.ts:46` asserts
`cpuFraction < CPU_BUDGET_FRACTION` (`:15`, `0.01`) over a fixed 1 500 ms wall window (`:16`), with
the real 5 s-paced scheduler started at `:25`. The scheduler therefore fires **zero** times inside the
window.

`packages/supervisor/src/idle-budget/resource-probe.ts:37` computes the number as
`(userCPUTime + systemCPUTime) delta / wall delta` — i.e. `getrusage(RUSAGE_SELF)` over wall clock.
That is the CPU of the **whole host process, all threads**, not of the subject. The probe's scope is
deliberate and its header (`resource-probe.ts:1`) states it correctly. What is not stated anywhere is
that the threshold was calibrated against a process containing only this test, and is applied to a
process containing 654 test files' worth of module graphs, V8 GC and v8 coverage collection.

## Measured — the margin is a function of the co-tenants, and the direction is not the obvious one

Every figure is the arm's own `console.log`, captured with `--disable-console-intercept` on a
16-core host. All four channels passed; the interest is the margin.

| channel                                                                         | `cpuFraction`               |
| ------------------------------------------------------------------------------- | --------------------------- |
| A. isolated, one file, three consecutive runs                                   | 0.0827% / 0.0897% / 0.0842% |
| B. one project (`@crabgic/supervisor`, 55 files / 354 tests)                    | 0.0992%                     |
| C. full suite (`vitest run --coverage`, 654 files / 6869 tests, EXIT=0), 2 runs | **0.1571%** and **0.0971%** |
| D. isolated, with 8 busy-loop processes saturating half the host                | 0.0910%                     |

Two things, and the second matters more. **First**, A → C rises — 1.14x on one full-suite sample and
1.84x on the other, against an isolated mean of ~0.0855%. **Second, and the point: the full-suite
figure is not a figure, it is a spread.** Three isolated runs sit inside a 1.08x band; two runs of
the identical command on the identical host sit in a **1.62x** band — wider than the entire gap
between isolation and the full suite. The channel this assertion runs in has variance the channel it
was calibrated in does not, which is precisely why a threshold cannot be picked here from one sample.
Two samples are not a distribution either; they are enough to show one exists.

A → D is flat, and that is the diagnostic result: **external host load barely moves this metric at
all.** Descheduling the process lowers its own CPU delta while the wall denominator keeps running. So
"a loaded host" — the phrase both flake lists use — is the wrong model, and any remedy phrased in
terms of host load or "re-run somewhere quieter" does not address the mechanism.

## The breach, and what is and is not on record

**On record, one breach**, committed and independently readable at
`docs/evidence/gap-18/known-gate-flakes.md:82`: `expected 0.011960719041278295 to be less than 0.01`
— 1.196% against the <1% budget — in a full `npm test` taken immediately after `npm run build`, then
3/3 green in isolation, on a branch touching nothing under `packages/supervisor`. Mirrored at
`docs/verification-playbook.md:922`.

**Not on record, and marked UNVERIFIED rather than repeated as fact:** reviewers during this wave
reported two further breaches of the same arm, at 1.075% and 1.159%, both in full-suite runs and both
clean 3/3 in isolation. A repo-wide grep for those figures returns nothing; they have no committed
transcript, no run id and no flake-list row. This record does not rest on them, and the argument
below is unchanged if they are discounted entirely.

**Not reproduced by this pass.** No breach occurred in any of the seven runs above. 1.196% is a
factor of **14** over the isolated baseline, where the largest isolated-to-full-suite factor I could
measure is **1.84**, so the breach condition is materially heavier than a plain full-suite run on this host —
consistent with the sighting note's own "immediately after `npm run build`", and consistent with the
pressure being in-process. **This record does not claim to have found the breach condition.** It
claims the narrower, sufficient thing: the margin is not a constant, it moves with the process, and
the direction is measured.

## Why "it is already in both flake lists" is not a disposition

The arm is listed twice (`docs/evidence/gap-18/known-gate-flakes.md:16` and
`docs/verification-playbook.md:922`), and both entries are honest. But the catalogue calls itself
"the minimum honest response" and names the fix as owed to "whoever owns those phases"
(`docs/evidence/gap-18/known-gate-flakes.md:26-28`). A budget that holds only when nothing else runs is not a budget for the
channel it actually runs in, and a third sighting handled by a fourth list entry is the catalogue
doing work a re-calibration should be doing.

## Proposed remedy

Either of these closes it; they are alternatives, and the choice is a judgement about what the
criterion's number is _for_.

1. **Scope the arm to an isolated run.** Move the sustained-idle case out of the default `npm test`
   fan-out and give it a channel where it is the only thing in its process — its own CI step
   (`npx vitest run … --coverage.enabled=false`, alongside the existing `gates-conformance` and
   `perf-conformance` per-push steps, which is exactly this pattern), or a dedicated vitest project
   with `fileParallelism: false`. The 1% figure then means what the roadmap says it means, and it is
   measured in a process where that is a fair question to ask. **Effort: S.**

2. **Widen to a MEASURED co-tenant figure, with the measurement recorded.** Not a round number
   picked to make the red go away — take N full-suite samples, record every one in
   `docs/evidence/phase-05/`, and set the bound from the observed distribution with the sampling
   method written beside it. The §Measured table above is the first seven samples of that work, and
   its two full-suite runs already show the spread is wide enough that N must be more than a handful. Keep
   the 1% figure as a **second, isolated** assertion so the roadmap's documented number is still
   asserted somewhere. **Effort: S**, plus the sampling time.

⚠️ **What must not be done, and the reason.** Do not simply raise the constant to 2%. The roadmap
criterion names `<1% of one core` and the phase's evidence documents it; moving the constant without
splitting the isolated assertion out would quietly weaken a documented number to accommodate an
instrument artifact, which is the wording-protocol failure this repository has a rule against. Both
options above preserve the 1% claim; only the shortcut loses it.

Whichever is chosen, add the sighting handling to the record rather than to a third list.

**Ticket-ready:** yes.

## Not claimed

- **Not claimed:** that the daemon's real idle cost is in question. It is not, and RSS was
  comfortably inside its own budget (70–71 MiB against 100 MiB) in every run above.
- **Not claimed:** that 1% is the wrong number. It is very probably right for the **subject** and
  wrong for the **instrument**, and those are different sentences.
- **Not claimed:** the two uncorroborated breach figures.
- **Not claimed:** that this is urgent. Nothing ships wrong.

**Evidence:** `docs/evidence/phase-05/idle-budget-load-sensitivity.txt`.
