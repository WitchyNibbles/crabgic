# Defect 04-journal-crash-suite-ci-job-absent

**Phase:** 04 — Event journal, snapshots, idempotency, leases (`roadmap/04-journal-idempotency-leases.md`, exit criterion 1)

**Criterion (verbatim):**

> 1k randomized kill-iteration run (`runKillHarness` over the append/chain/snapshot path): zero undetected corruption; recovery always converges to the last valid chained entry — evidence: `journal-crash-suite` CI job artifact.

**Found:** 2026-08-02, criteria-closeout pass (batch 2, phase 04), at `af46e007c1363d4838d74e2eea0d531e4d6bb4f3`.

**Severity:** evidence-channel-only.

## Gap

The criterion names one evidence channel — a **`journal-crash-suite` CI job artifact**. No CI job
by that name exists, has ever existed, or produces any artifact. The criterion's _substance_ (1000
randomized real-`SIGKILL` iterations, zero undetected corruption, recovery always converging) is
genuinely demonstrated, twice, but only by **local transcripts**. Per the closeout pass's own rule,
a nonexistent job name is a defect rather than a synonym for the `test` job that happens to run the
same suite at a 40x-smaller scale, so the box stays unticked.

### What exists

- `packages/journal/src/crash-fixtures/crash-suite.test.ts` — the real thing, and non-vacuous:
  - `:112` `expect(report.allConverged).toBe(true);` and `:108-111`
    `expect(failed, …).toHaveLength(0);` over `runKillHarness`, with `:113`
    `expect(report.results).toHaveLength(ITERATION_COUNT);` pinning that every planned iteration
    actually ran.
  - `:51-64` `buildPlans` randomizes mode (append/snapshot), prior-entry count, and which single
    internal step to `SIGKILL` at, across `durablyAppendLine`'s 7 real steps and
    `durablyWriteFileAtomic`'s 8.
  - The anti-vacuity control is in the same file: `:119-137`, a seeded truncate+rewrite append
    variant (`CRABGIC_CRASH_FIXTURE_BROKEN=1`) for which `:135`
    `expect(report.allConverged).toBe(false);` — the scaffolding is shown to have teeth before it
    is trusted.
  - `crash-suite-rotation.test.ts` runs the same shape over a genuinely re-rotating segment path.
- `docs/evidence/phase-04/exit-criteria-crash-suite.txt` — the 2026-07-18 large-scale capture,
  1000/1000 iterations, ~94s.
- `docs/evidence/phase-04/closeout-c1-crash-suite-1k.txt` — this pass's own re-run at
  `af46e00`, `CRABGIC_CRASH_SUITE_ITERATIONS=1000`.
- CI **does** execute this suite on every push — `CI` run
  [30720547145](https://github.com/WitchyNibbles/crabgic/actions/runs/30720547145), job
  `unit-test+coverage (ubuntu-latest)`
  ([91423926933](https://github.com/WitchyNibbles/crabgic/actions/jobs/91423926933)), job-log line
  723: `✓  @crabgic/journal  src/crash-fixtures/crash-suite.test.ts (2 tests) 7865ms`.

### What is missing

Two things, and they are separable:

1. **No job named `journal-crash-suite`.** `.github/workflows/` holds nine workflows — `ci`,
   `drift-ci`, `engine-live`, `gates-conformance`, `jira-datacenter-smoke`, `learning-redteam`,
   `perf-conformance`, `publish`, `release-e2e` — and none defines such a job.
2. **No CI run at 1k scale, and no artifact.** `crash-suite.test.ts:29` reads
   `CRABGIC_CRASH_SUITE_ITERATIONS` and defaults to **25**. Nothing in `ci.yml` sets that variable,
   so every CI execution of this suite runs 25 iterations, not 1000 — 2.5% of the criterion's
   named scale. No workflow uploads a crash-suite artifact of any kind.

### Search trail

1. `grep -rn "journal-crash-suite" .` — three hits, all of them restatements of the criterion, none
   a workflow: `roadmap/04-journal-idempotency-leases.md:84`, `docs/evidence/phase-04/README.md:33`,
   and a verbatim copy of the criterion in the source comment at
   `packages/journal/src/crash-fixtures/crash-suite.test.ts:15`.
2. `git log --all -S"journal-crash-suite" -- .github/` — **empty**. The string has never appeared
   anywhere under `.github/` in any commit on any branch.
3. `git log --all -S"journal-crash-suite" --oneline` — two commits, both of which only _write the
   claim_: `7bb4065` ("chore: baseline planning docs…", the repository's first commit, which
   introduced the roadmap file) and `3602ae6` ("feat: phase 04 event journal, snapshots,
   idempotency, leases", which copied the criterion into the test's doc comment).
4. `git ls-tree -r 7bb4065 --name-only | grep '^\.github'` — **empty**; `.github/workflows/ci.yml`
   was first added later, in `e6aa458` (phase 01's CI skeleton).
5. `git log -L84,84:roadmap/04-journal-idempotency-leases.md` — one commit, `7bb4065`. The
   criterion's wording has never been edited.

**This is therefore an original overclaim in the plan, not drift.** The job name was written into
the roadmap at the repository's first commit, before any CI existed at all; phase 01's CI skeleton
never created it, and phase 04's implementation satisfied the substance locally and left the
channel unrealized. Nothing was removed or renamed out from under the criterion — there is no
earlier state in which it was true.

### Why this is not merely bookkeeping

The 25-iteration default is what CI actually enforces, and the phase's own validation round records
that scale gaps in this suite hide real defects: `docs/evidence/phase-04/README.md` §"MAJOR 1"
states that "the 1000-iteration crash suite never rotated segments, so this path had zero
coverage", and the rotated-journal repair defect that hid there destroyed committed entries and
duplicated `seq`. A 1k run is a materially different search of the fault space from a 25-iteration
one, and today only a human running it by hand ever performs one.

## Proposed remedy

Wire the channel the criterion names, at the scale it names, on a cadence that does not tax every
push:

1. Add `.github/workflows/journal-crash-suite.yml` — job name `journal-crash-suite`, triggers
   `workflow_dispatch` + `schedule` (nightly) + `push` on paths `packages/journal/**`.
2. One step, with a `--reporter=verbose` log redirected to a file:

   ```
   CRABGIC_CRASH_SUITE_ITERATIONS=1000 npx vitest run --coverage.enabled=false packages/journal/src/crash-fixtures/
   ```

3. `actions/upload-artifact@v4` that file, `if-no-files-found: error` (the convention `ci.yml`'s
   ARM64 record step already uses), so "CI job artifact" is literally true.
4. Then re-run this closeout for criterion 1 only and cite the green run + artifact.

Runtime is the gating consideration, and it is now measured rather than guessed — see
`docs/evidence/phase-04/closeout-c1-crash-suite-1k.txt` for the wall-clock of a 1000-iteration run
at `af46e00`. A nightly/dispatch trigger keeps it off the every-push path either way.

**Effort:** S. **Needs CI:** yes (one new workflow + one dispatch to produce the first green run).
**Needs live engine:** no. **Needs owner input:** no.

**Ticket-ready:** yes.

## Related, not part of this defect

- `packages/journal/src/crash-fixtures/crash-suite.test.ts:11-28` carries a verbatim copy of this
  criterion in its doc comment. It is a second, unversioned copy of the roadmap text and will drift
  from it; whoever lands the remedy should reconcile it in the same change.
- `docs/evidence/phase-04/README.md`'s exit-criteria row 1 quotes the criterion with the tail
  "recovery always converges" where the roadmap says "recovery always converges to the last valid
  chained entry". That README is a historical build record and was deliberately left unedited by
  this pass.

## Remedied 2026-08-06

All four proposed remedy steps are done. `.github/workflows/journal-crash-suite.yml` is the job the
criterion names, with `if-no-files-found: error` on the upload so "CI job artifact" cannot be
satisfied by an empty one.

First green run: [31087614384](https://github.com/WitchyNibbles/crabgic/actions/runs/31087614384),
job 92570706911. Its log line 235 reads `# iterations: 1000` — the 1k scale is what ran, not a
default — and line 242 shows the suite passing in `189976ms`. The artifact
`journal-crash-suite-report` is present at 1038 bytes.

The runtime this record asked to be treated as the gating consideration is now measured **on the
runner** rather than locally: **190s**, against the 258s local capture. Comfortably inside the
45-minute timeout, and the nightly/dispatch/journal-paths trigger keeps it off the every-push path
either way.

Two deviations from the remedy as written, both deliberate and both stated in the workflow itself
rather than left to look like oversights:

1. **Trigger set.** The remedy proposed `workflow_dispatch` + `schedule` + `push` on
   `packages/journal/**`. It is `pull_request` on those paths rather than `push`, because a
   `push`-on-branches trigger would not have produced a run on the PR that introduced the workflow —
   there would have been no green run to cite until after merge, which is the wrong order for an
   evidence-based close.
2. **Single runner**, not the arch matrix the main CI job uses. The criterion names one job and one
   artifact, and durability of the append/chain/snapshot path under kill is not
   architecture-specific.

The related item this record flagged is also done: `crash-suite.test.ts`'s doc comment carried a
second unversioned copy of the criterion plus a now-false instruction to capture the 1k run by hand
into a file under `docs/evidence/`. It now points at the workflow, and says explicitly that the
quoted criterion is a second copy meant to agree with the roadmap.

Not done: the record's other related item — `docs/evidence/phase-04/README.md`'s exit-criteria row 1
quoting the criterion with a truncated tail. That file is a historical build record and is left
unedited, as this record itself noted.
