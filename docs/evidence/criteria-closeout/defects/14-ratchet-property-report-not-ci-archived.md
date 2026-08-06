# Defect 14-ratchet-property-report-not-ci-archived

**Phase:** 14 — Quality & security verification gates (`roadmap/14-quality-security-gates.md`, exit criterion 2)

**Criterion (verbatim):**

> Coverage ratchet floor is monotonic non-decreasing across a simulated multi-`ChangeSet` history (fast-check property report, CI-archived).

**Found:** 2026-08-02, criteria-closeout pass (batch 2, phase 14), at `eabb65acb723ad1e21cfcbe4869fcfb432fe4625`.

**Severity:** evidence-channel-only. The monotonicity claim itself is proven and executed on every
push; what does not exist is the archived report the criterion names as its channel.

## Gap

The criterion names one evidence channel — a **fast-check property report, CI-archived**. No
workflow in this repository archives any report, of any shape, from the coverage-ratchet property
suite. `actions/upload-artifact` appears five times across the nine workflows and none of the five
is a property-run report:

| Workflow                  | Artifact            | Content                                                      |
| ------------------------- | ------------------- | ------------------------------------------------------------ |
| `ci.yml:167`              | `arm64-run-record`  | the ARM64 leg's `arm64-run-record.json` (phase 23's channel) |
| `drift-ci.yml:73`, `:128` | drift outputs       | phase 21's connector-drift proposals                         |
| `engine-live.yml:56`      | live-run record     | 06's `@live` conformance record                              |
| `release-e2e.yml:397`     | release-gate report | 23's channel                                                 |

`gates-conformance.yml` — the one workflow this phase owns — uploads nothing at all, and does not
run the property suite either (it runs `gates-conformance.test.ts` and
`engine-conformance-binding.test.ts` only).

Per the closeout pass's own rule that a named channel may not be reinterpreted, and following the
merged precedent of `defects/04-journal-crash-suite-ci-job-absent.md` (substance proven, named CI
artifact channel absent → box stays unticked), criterion 2 is left unticked.

### What exists — and it is genuinely non-vacuous

- `packages/gates/src/coverage/ratchet.property.test.ts` — three fast-check properties over a
  **real on-disk `@crabgic/journal` store** (not a fake), the second of which is the criterion's
  own sentence:
  - `:61` `"the floor never decreases across a monotonically-applied random sequence (also checked
incrementally)"`, `:72-73`
    `expect(result.floorAfter.linePct).toBeGreaterThanOrEqual(priorFloor.linePct);` /
    `expect(result.floorAfter.branchPct).toBeGreaterThanOrEqual(priorFloor.branchPct);`, asserted
    **after every single observation**, over `fc.array(observationArb, { minLength: 2, maxLength:
20 })` at `numRuns: 30`.
  - `:20-53` order-independence: the same history is replayed forward, reversed and shuffled
    against three independent fresh journals, and `:47-48` asserts all three land on the
    componentwise `Math.max` of the whole history — the anti-vacuity control that distinguishes
    "monotonic" from "the store just remembers the last value".
  - `:87-133` the two-project non-contamination property (25 runs), which is what makes the
    single-project floors above meaningful on a shared journal.
- `packages/gates/src/coverage/ratchet-store.ts:100-103` — the floor is `Math.max` over the
  project's whole recorded history by construction, so a regression cannot lower it; `:128-130`
  computes `regressed` against the floor _as it stood before this call_.
- Deterministic companions: `packages/gates/src/coverage/ratchet-store.test.ts` (8 tests) and
  `packages/gates/src/coverage-gate.test.ts:118-149` (recorded floor 82% → new run 79% blocks,
  with `:133` asserting the 82% run passed first, so the block is caused by the regression).
- CI **does execute** the suite on every push — `CI` run
  [30741826008](https://github.com/WitchyNibbles/crabgic/actions/runs/30741826008), job
  `unit-test+coverage (ubuntu-latest)`
  ([91480519773](https://github.com/WitchyNibbles/crabgic/actions/jobs/91480519773)), job-log line
  565: `✓  @crabgic/gates  src/coverage/ratchet.property.test.ts (3 tests) 3500ms`.
- `docs/evidence/phase-14/closeout-c2-ratchet-monotonicity.txt` — this pass's own scoped re-run at
  `eabb65a` (3 files, 16 tests, exit 0).

### What is missing

1. **No archived report.** A job-log line saying the suite passed is not the property _report_: it
   carries no case counts, no seeds, no shrink output. If the suite ever regressed to
   `numRuns: 1`, or a property were silently narrowed, the log line would look identical. The
   channel the criterion names exists precisely to make that visible after the fact, and GitHub
   log retention (90 days) is shorter than the repository's own evidence horizon.
2. **No report emitted at all.** Vitest is invoked with the default reporter in every workflow;
   nothing writes a fast-check summary to a file that could be uploaded.

### Search trail

1. `grep -rn "CI-archived\|CI archived" roadmap/ docs/ --include=*.md` — exactly two hits: the
   criterion itself (`roadmap/14-quality-security-gates.md:75`) and
   `docs/evidence/phase-14/README.md:145` restating it. No third party ever names this channel.
2. `grep -rn "upload-artifact" .github/workflows/` — five hits, enumerated in the table above;
   none is a property report and none is in `gates-conformance.yml`.
3. `git log --all -S"upload-artifact" -- .github/workflows/gates-conformance.yml` — empty. No
   commit on any branch has ever put an upload step in this phase's own workflow.
4. Read `.github/workflows/gates-conformance.yml` in full: two `npx vitest run` steps, neither of
   which names `ratchet.property.test.ts`, and no `--reporter` flag or output redirection.
5. `docs/evidence/phase-14/README.md`'s own exit-criterion row for this box (`:144-160`) marks it
   `[x]` and restates the criterion including the words "CI-archived" (`:145`), but everything it
   then cites is a test file or a deterministic regression fixture — it names no artifact, no
   workflow and no run. The phase's build record ticked this box without ever addressing its
   channel.
   That row is also **semantically stale** in a second way, which is why this pass quotes the
   tests and not the README: it says "two properties, 100/30 randomized cases respectively"
   (`:146-147`), while the file at HEAD carries **three** properties at `numRuns` 40, 30 and 25
   (`ratchet.property.test.ts:52`, `:82`, `:130`). It was never otherwise: the whole
   `packages/gates/src/coverage/` directory was swallowed by `.gitignore` in the phase's own
   commit `d0bee2f` and first landed in `e431710`, already in its present three-property form
   (`git log --all -S"numRuns: 100" -- packages/gates/src/coverage/ratchet.property.test.ts` is
   empty on every branch). The README describes a file this repository has never contained.

**This is an original overclaim in the plan, not drift.** `git log -L75,75:roadmap/14-quality-security-gates.md`
shows the criterion's wording has never been edited since the roadmap was first committed, and no
archival step for it has ever existed.

### Related observation, not part of this defect

The criterion says "across a simulated multi-`ChangeSet` history", but `recordCoverageObservation`
(`packages/gates/src/coverage/ratchet-store.ts:121-126`) takes `(journal, projectId, summary)` and
has no `changeSetId` parameter at all — the property replays a sequence of coverage _observations_
standing in for successive ChangeSets. That reading is fair given the word "simulated", and it is
recorded here only so the next reader does not have to rediscover that no `ChangeSet` identity is
carried in the ratchet history. Whoever lands the remedy may wish to name observations by
`changeSetId` at the same time; it is not required to close the box.

## Proposed remedy

Wire the channel the criterion names, in this phase's own workflow, where it belongs:

1. Add a third step to `.github/workflows/gates-conformance.yml`:

   ```yaml
   - name: coverage-ratchet monotonicity property report
     run: |
       npx vitest run packages/gates/src/coverage/ratchet.property.test.ts \
         --coverage.enabled=false --reporter=verbose \
         2>&1 | tee ratchet-property-report.txt
   ```

2. `actions/upload-artifact@v4` that file with `if-no-files-found: error` — the convention
   `ci.yml`'s ARM64 record step already uses — so "CI-archived" becomes literally true.
3. Optionally set `fc.configureGlobal({ verbose: 1 })` (or pass `verbose` in each `fc.assert`
   options object) so the archived report records case counts and seeds rather than only a pass
   line; that is what makes the artifact worth more than the log.
4. Then re-run this closeout for criterion 2 only, and cite the green run plus the artifact.

Cost is one green run of an already-existing 7-second suite; the job it joins currently takes
~1m5s.

**Effort:** S. **Needs CI:** yes (one workflow edit plus one run to produce the first artifact).
**Needs live engine:** no. **Needs owner input:** no.

**Ticket-ready:** yes.

## Remedied 2026-08-06

Steps 1, 2 and 4 are done. `gates-conformance.yml` gained a
`coverage-ratchet monotonicity property report` step and an `actions/upload-artifact@v4` with
`if-no-files-found: error`, so "CI-archived" is now literally true. Artifacts from run
[31087616366](https://github.com/WitchyNibbles/crabgic/actions/runs/31087616366):
`ratchet-property-report-ubuntu-latest` (964 bytes) and
`ratchet-property-report-ubuntu-24.04-arm` (966 bytes).

**One deviation from the remedy, forced by the matrix:** the artifact name is per-arch. This job runs
`[ubuntu-latest, ubuntu-24.04-arm]`, and two legs uploading to one artifact name would fail the
second upload — the remedy's single `ratchet-property-report` name would have made the job red.

**Step 3 was attempted and deliberately abandoned, which is the part worth recording.** The remedy
suggested `fc.configureGlobal({ verbose: 1 })` "so the archived report records case counts and seeds
rather than only a pass line; that is what makes the artifact worth more than the log." A first draft
set a `CRABGIC_FASTCHECK_VERBOSE` env var in the workflow and carried a comment saying exactly that.

Two things were wrong with it. **Nothing reads that variable** — it was an inert control with a
comment vouching for it, the precise shape this repository keeps finding. And fast-check's verbose
mode does not print per-case counts on **success**; it enriches the counterexample on **failure**.
So the claim would have been false even had the variable been wired.

The variable was removed and the workflow now states plainly what the artifact does contain: a
per-property pass line with duration, a header pinning run/commit/runner, and — on failure —
fast-check's counterexample and seed. Anyone who wants case counts in the archive has to change the
test file, and should record that they measured what fast-check actually emits before claiming it.
