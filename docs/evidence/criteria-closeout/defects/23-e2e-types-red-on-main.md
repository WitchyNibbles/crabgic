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

## Remedied 2026-08-06

Both halves of the remedy are done, and the second turned out to matter more than the first.

**The 25 errors.** `criteriaSeal` is threaded through every affected call site in
`e2e/matrix/orchestration` — 25 sites across 9 files, `dispatchAttempt` and `resumeAttempt` alike.
They take one shared `UNSEALED_CRITERIA_SEAL` constant (`e2e/matrix/orchestration/src/criteriaSeal.ts`)
rather than 25 copies of a literal, so the reasoning lives in one place: these scenarios build a
`TaskPacket` directly and never run intake, so there are no persisted `Requirement` records for a
seal to cover, and `approvalSeal` stays `undefined` because they exercise dispatch, crash recovery
and resume — never acceptance.

Per the playbook's own ruling that `as never` / `as any` casts are exactly where a requiredness fix
survives, `grep -rn 'as never\|as any\|as unknown as'` was run over the affected sites: none found,
and none introduced.

**The short-circuit, which was the bigger finding.** `check:e2e-types` was eight `&&`-chained `tsc`
invocations, and `e2e/matrix/orchestration` is the fourth. So the four projects **after** it —
`e2e/matrix/connector`, `e2e/live`, `e2e/release`, `e2e/attestation` — had never been typechecked
at all for as long as this was red. Nobody knew whether they were clean; they are.
`scripts/check-e2e-types.mjs` now runs each project independently and reports every failure, with
the same non-zero exit if any fails. All eight PASS.

That is the part this record's remedy listed as "then consider whether", and it is what turns a
one-off fix into something that cannot recur silently: with the chain, one red project conceals the
rest, including in `release-e2e.yml`.

Suite still green after the change: `e2e/matrix/orchestration`, 14 files / 41 tests.
