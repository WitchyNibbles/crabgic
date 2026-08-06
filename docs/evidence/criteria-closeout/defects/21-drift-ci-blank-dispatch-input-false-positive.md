# 21 — drift-ci reads an unsupplied workflow input as an observed version of `""`, so the scheduled job's steady state is a two-connector false positive

**Phase:** 21 — Connector evidence integration & drift CI (`roadmap/21-connector-evidence-integration.md`), work item 5 / `.github/workflows/drift-ci.yml`

**Not a criterion blocker.** Exit criterion 3 is ticked in `docs/evidence/criteria-closeout/phase-21.json` on CI run [30743998864](https://github.com/WitchyNibbles/crabgic/actions/runs/30743998864), which supplies both dispatch inputs explicitly and produces exactly one `DriftProposal` and a red check. This defect was found while producing that run and is filed so the finding is not lost. The criterion it sits under, for context:

> Drift-CI job run against an intentionally bumped fixture produces exactly one `DriftProposal` artifact and a red CI check, with zero pinned-fixture/config changes applied by the job itself. Evidence: CI job log + before/after repo-state diff.

**Found:** 2026-08-02, criteria-closeout pass batch 4, against `main` @ `30f931eab97b8360102498d4b766513be67241d0`.

## Gap

`.github/workflows/drift-ci.yml:112-115` sets both override variables unconditionally:

```
        env:
          JIRA_OBSERVED_VERSION: ${{ inputs.jira_observed_version }}
          GRAFANA_OBSERVED_VERSION: ${{ inputs.grafana_observed_version }}
```

An optional `workflow_dispatch` string input that the caller omits — and every input on the `schedule` trigger, where the `inputs` context is empty — evaluates to the empty string, and GitHub Actions sets the variable to `""` rather than leaving it unset. `packages/gates/src/drift/cli.ts:139-146` then reads:

```
  const snapshots = buildPinnedFixtureSnapshots({
    ...(process.env["JIRA_OBSERVED_VERSION"] !== undefined
      ? { jira: { version: process.env["JIRA_OBSERVED_VERSION"] } }
      : {}),
```

`"" !== undefined`, so the override is taken and the observed version becomes `""`. `compareDriftFixture` compares `snapshot.pinnedVersion !== snapshot.observedVersion` (`drift-proposal.ts:63`), `"1000.0.0" !== ""` is true, and the connector is reported as drifted with a proposal recommending `update pinned jira fixture from 1000.0.0 to ` — a fixture update to an empty version string.

**Measured, not inferred.**

- Run [30743929773](https://github.com/WitchyNibbles/crabgic/actions/runs/30743929773) (dispatch, `jira_observed_version=1001.0.0` only): the step's env block prints the name `GRAFANA_OBSERVED_VERSION:` followed by nothing, then the log reads `drift-ci: 2 DriftProposal(s) written to /home/runner/.local/state/crabgic/drift-ci/drift-proposals.json — human review required.` Grafana was never bumped. (The blank values are quoted by description rather than reproduced literally, because the log lines end in trailing whitespace that no rendering preserves.)
- The one historical scheduled run, [30256034367](https://github.com/WitchyNibbles/crabgic/actions/runs/30256034367) (2026-07-27), job 89944730673: its env block prints both `JIRA_OBSERVED_VERSION:` and `GRAFANA_OBSERVED_VERSION:` with empty values. It is green only because it is the first sample and `DEFAULT_DRIFT_DEBOUNCE_THRESHOLD` is 2 (`packages/gates/src/drift/debounce.ts:12`), and because its debounce cache had expired by the time of this pass, so no run has yet been the _second_ consecutive scheduled sample.

So the weekly job's steady state, once two scheduled runs land inside the cache retention window, is a permanently red check carrying two spurious `DriftProposal`s — for both connectors, every week, forever. The debounce mitigation the roadmap's §Risks section relies on ("require repeated failing runs before emitting a `DriftProposal`, not a single sample") does not help, because this failure is deterministic rather than flaky: it repeats by construction.

No unit test catches it. `packages/gates/src/drift/cli.test.ts` sets the env vars to real values or deletes them; it never sets one to `""`, which is the state CI is always in.

### Search trail

- Dispatched `drift-ci` three times at main `30f931ea` while evidencing exit criterion 3; the two-proposal result on the second was the trigger.
- `gh api repos/WitchyNibbles/crabgic/actions/jobs/89944730673/logs` for the 2026-07-27 scheduled run's env block (its `gh run view --log` is no longer served).
- `git show dbb83fd:.github/workflows/drift-ci.yml` — the `env:` block is unchanged since that run.
- Read `packages/gates/src/drift/cli.ts`, `pinned-fixtures.ts`, `drift-proposal.ts`, `debounce.ts`, and `cli.test.ts`.

## Severity

**evidence-channel-only**, trending to operational noise. Nothing unsafe happens — the job still applies zero pinned-fixture or config changes, which the repo-state diff in `docs/evidence/phase-21/closeout-c3-repo-state-diff.txt` confirms — but a scheduled check that is always red for a reason unrelated to real drift is a check nobody will read, which defeats the whole point of the job and of the debounce rule.

## Proposed remedy

Treat blank as absent, in the one place that reads the environment:

```
const jira = process.env["JIRA_OBSERVED_VERSION"]?.trim();
...(jira !== undefined && jira !== "" ? { jira: { version: jira } } : {})
```

This is the same override-then-fallback shape `docs/interface-ledger.md` Gap 16 already pins for `CRABGIC_*` record overrides ("unset **or blank** falls back"), so the repo has a settled convention for it and this would be following it rather than inventing one. Add the failing-first test `cli.test.ts` is missing: `JIRA_OBSERVED_VERSION=""` must produce zero proposals and a non-red result.

Optionally also give `buildPinnedFixtureSnapshots` a rejection for an empty `version` override, so the bad value cannot re-enter through a different caller.

**Effort sizing: S.** One conditional, one unit test, no contract change, no live system. Verification is a single `workflow_dispatch` with no inputs, which must come back green.

**Ticket-ready:** yes.

## Remedied 2026-08-06

`packages/gates/src/drift/cli.ts` now reads both overrides through
`observedVersionOverride(variable)`, which trims and treats blank as absent — the
`unset or blank falls back` shape `docs/interface-ledger.md` Gap 16 already pins for `CRABGIC_*`
record overrides, so this follows the repo's settled convention rather than inventing one.

The failing-first test this record identified as missing is in `packages/gates/src/drift/cli.test.ts`,
as an `it.each` over `["empty string", ""]` and `["whitespace only", "   "]`. It drives **two**
consecutive `runDriftCiCli` runs against the same persisted debounce state with
`debounceThreshold: 2`, because one sample could not have distinguished this defect from the
debounce merely not having tripped yet — the steady state is what was broken, and the steady state
is what is now asserted: `redCheck === false` on both runs and an empty proposals file.

Red-then-green, measured: reverting the helper to the bare `process.env[variable]` read fails both
new cases, 8 pass. Restored, 10 pass. CI run
[31083396959](https://github.com/WitchyNibbles/crabgic/actions/runs/31083396959) job 92557176556
line 574 shows `src/drift/cli.test.ts (10 tests)`, against 8 for the same file in the same job at
`main` `8c9cc56`.

**Not done, and deliberately so:** the optional second half — rejecting an empty `version` in
`buildPinnedFixtureSnapshots` — is not implemented. The fix is placed at the single point that
reads the environment, which is where the bad value enters. A rejection one layer down would be
defence in depth, not a second fix, and it is left as such.

**Verification the workflow itself is not re-run here.** This record proposed "a single
`workflow_dispatch` with no inputs, which must come back green" as the verification. That dispatch
is not part of this change: the unit cases reproduce the exact environment shape
(`JIRA_OBSERVED_VERSION=""`) deterministically, and a dispatch would confirm the same thing more
slowly. Whoever wants the belt-and-braces confirmation can dispatch `drift-ci` with no inputs.
