# 23 — `npm run check:e2e-types` is red on `main`, and `release-e2e` would fail today

**Phase:** 23 — E2E matrix, security review, packaging, publication
(`roadmap/23-release-hardening.md`)

**Found:** 2026-08-05, while reviewing PR #100. Reproduced independently by two agents on a stashed
tree, so it is not caused by any in-flight branch.

## Gap

```
tsc -p e2e/matrix/orchestration/tsconfig.json --noEmit   →  25 errors
```

All 25 are `TS2345`: `criteriaSeal` is missing from `DispatchAttemptOptions` / `ResumeAttemptOptions`
at the call sites in `target-drift.test.ts`, `worker-crash-recovery.test.ts` and others. Phase 24 made
that member **required** at the scheduler (PR #85, deliberately — an optional field was how the
enforcement hole survived), and `e2e/matrix/orchestration` was never updated to match.

## Why nobody noticed

The root script chains eight projects with `&&`, and `orchestration` is **fourth**. It short-circuits
there, so the connector, live, release and attestation projects are **never typechecked** by this
script. All seven other projects exit 0 — the failure is contained to one, but the script's coverage
is contained to three.

**`.github/workflows/release-e2e.yml:198` runs this script, so a gated release would fail today.**
That workflow is `workflow_call`-reachable and is invoked by tag-triggered `publish.yml`, so this sits
directly on the publication path.

## Remedy

**S.** Thread `criteriaSeal` through the orchestration test call sites, exactly as PR #85 did for the
nine production and test construction sites it found. Then consider whether the script should stop
short-circuiting — `&&` between eight independent typecheck projects means the first failure hides the
other five. A `for` loop collecting failures would report the real state.

Needs no live engine, no Docker and no owner subscription.
