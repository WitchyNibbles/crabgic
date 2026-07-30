---
"crabgic": patch
---

Make the release gate gate something, and fix two flaky tests at their causes.

**Every release after the first shipped unscored.** `release-e2e` — the workflow
that produces the `ReleaseGateReport` — was `workflow_dispatch`-only, so it ran
when somebody remembered to ask, and between 2026-07-27 and 2026-07-30 nobody
did: v1.1.2, v1.2.0, v1.3.0 and v1.4.0 all published while the single PASS on
record had been scored against the v1.0.0 candidate. For a product whose whole
claim is that it reports honestly, the gate being the one artifact nobody
re-checks was the worst possible place to carry that debt.

It is now a reusable workflow, and `publish.yml` calls it on the tagged commit in
`final` scoring mode with the publish job waiting on the result. `final` matters:
`interim` resolves missing evidence to EVIDENCE-PENDING, which is right
mid-development and wrong at a release cut. npm refuses to republish a version
that has ever existed, so ordering the gate before the publish is the difference
between a bad release being blocked and a bad release being permanent. The
binding is guarded by tests that read the real workflow files, because the
failure mode here is precisely two files drifting apart with everything green.

**`git worktree add` is now serialized per repository.** Git promises nothing
about running it concurrently against one repository — `add` enumerates
`.git/worktrees/*` and reads each entry's `commondir`, which a concurrent `add`
is in the middle of writing — and the scheduler runs up to four attempts per
round against the same control clone. The unguaranteed thing was a thing
production does. This had been dismissed as a flaky test for weeks; it was a real
reliance on a guarantee that does not exist. Unrelated repositories still proceed
concurrently, and the cost is one short `add` at a time against a fan-out cap of
four.

**A 1000-run property test now owns its own timeout.** The engine-claude session
property costs ~4s in isolation and borrowed the repository's global 20s budget,
which is comfortable alone and not comfortable inside a 595-file parallel run.
Nothing about it was racy — it was a budget, taken from a default that knows
nothing about this test's cost. `numRuns` is unchanged: a flake is not a reason
to test less.

**The README's known gaps say what is actually true.** It cited a
"known-deferred list" that was not in the repository (it is
`e2e/live/src/knownDeferredAllowlist.ts`), and omitted four things that are real:
a worker's gateway calls are not adjudication-journaled, the approval gate stops
an opportunistic agent rather than an evasive one, the standing policy is a
boundary against workers and not against a session running as you, and a project
path long enough to push the daemon's socket past 108 bytes cannot start a
supervisor.

**And one ticked exit criterion now matches its own evidence.** Phase 23's
"zero `NOT_IMPLEMENTED` remains" was ticked while `connection capabilities` still
returns it and the live sweep passes only because an allowlist exempts it — the
tick described something stronger than the evidence produced. The check is
unchanged; the claim now says "outside the recorded deferral allowlist", which is
what it always measured.
