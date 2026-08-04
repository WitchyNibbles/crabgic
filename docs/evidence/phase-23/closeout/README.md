# Phase-23 criteria-closeout evidence (2026-08-04)

Produced by the per-criterion closeout pass for `roadmap/23-release-hardening.md`, at
`3dec9bf2caa6b94bd817aee414f9458c37750fd9`. Everything here is evidence, not claim: the record
itself lives at `docs/evidence/criteria-closeout/phase-23.json` and cites these files.

## The two archived release-gate reports, committed verbatim

Both were downloaded from GitHub Actions on **2026-08-04**, post hoc, and are byte-for-byte the
artifacts those runs uploaded — nothing here was regenerated. They are committed because workflow
artifacts expire and this phase's every tick leans on them.

| File                                     | Run                                                                                      | Artifact id | Mode    | Verdict         | Links / distinct records |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- | ----------- | ------- | --------------- | ------------------------ |
| `release-gate-report-final-6b9dd7b.json` | [30581930006](https://github.com/WitchyNibbles/crabgic/actions/runs/30581930006) (publish) | 8775098257  | `final` | PASS, 15/15     | 160 / 105                |
| `release-gate-report-final-2435cb9.json` | [30250453824](https://github.com/WitchyNibbles/crabgic/actions/runs/30250453824) (release-e2e) | 8646862319  | `final` | PASS, 15/15     | 158 / 103                |

sha256 of the committed files, as retrieved:

```text
4168ed03e0b9278949d22f7dfe759d76314c348301750a2dcefb857e6eb2dbb9  release-gate-report-final-6b9dd7b.json
2b4c3e6d2f107ad679d07fae22f717372bc7eebee1aca2f6610799cbed7a8bcb  release-gate-report-final-2435cb9.json
```

Two things a reader should carry away from the table rather than from prose elsewhere.

- **160 belongs to the v1.5.0 report, not to run 30250453824.** `roadmap/README.md`'s completion
  ledger and `roadmap/23`'s own §Exit criteria header both attributed it to the earlier run; both
  now carry a dated correction beside the original text.
- **Run 30250453824's checkout was not its candidate.** Its `head_sha` is `dbb83fd`, two commits
  ahead of the `2435cb9` every one of its records is stamped with. `c1-c15-checkout-candidate-skew.txt`
  measures what those two commits change and why it is load-bearing rather than cosmetic.

## The committed `e2e/release-gate-report.json` is a different, older thing

The file at the repository root path is a **stale interim snapshot** whose `overallVerdict` is
`FAIL`. It is scaffolding, not the scored artifact, and a reader opening it will see the opposite of
what this phase's criteria claim. That is exactly why the two real reports are committed here under
distinct names.

## Transcripts

Each carries a UTC timestamp, the HEAD it ran at, the verbatim command and the exit status. One is
deliberately RED and says so.

| File                                     | What it establishes                                                                                                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `c1-generator-fail-closed.txt`           | The release-gate generator's never-PASS-by-default path, green; then **deliberately RED** — mutating the zero-evidence branch to PASS reddens 11 tests; then the mutation reverted and the tree proven clean. |
| `c8-c10-live-and-matrix-lanes.txt`       | The `e2e/live` sweep lane and the connector and installation matrix lanes, re-run at this HEAD. None of them runs in any per-push CI channel.           |
| `c9-git-matrix-attribution.txt`          | The git-invariance and neutral-rendering lane, re-run at this HEAD, including the fail-first attribution vectors.                                       |
| `c6-c7-live-gap.txt`                     | What the orchestration matrix actually drives (a fake engine), what its "supervisor restart" actually is, and the absence of any live Jira channel.     |
| `c1-c15-checkout-candidate-skew.txt`     | The two commits between `2435cb9` and `dbb83fd`, and the concrete consequence for the marketplace-pin clause.                                           |
| `c15-registry-ground-truth.txt`          | `npm view` against the real registry — versions, dist-tags and the SLSA provenance attestation on both 1.0.0 and 1.5.0. Read-only queries only.         |
| `lane-and-channel-audit.txt`             | Which CI channel, if any, executes each release lane — including the two workflows with **zero** runs in this repository's entire history.              |

## What this pass did not run, and would not

No `@live` suite, no `CRABGIC_LIVE=1`, no `engine-live` dispatch, no `jira-datacenter-smoke`
dispatch, no `release-e2e` dispatch, no tag push, no publish. Every CI fact above was read from runs
that already existed; every registry fact was a read-only query. Where a criterion needed one of
those channels, it was left unticked with a defect record rather than closed on a substitute.
