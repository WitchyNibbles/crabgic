# 23 — the release-evidence lanes have no channel that observes them between tags

**Phase:** 23 — Release hardening (`roadmap/23-release-hardening.md`). No single exit criterion is
named: the subject is the **channel** every one of that phase's instruments runs in.

**Found:** 2026-08-07, post-v1.6.0 review, at `5b10f1e257a5ae835fb5edbba1cf3b8e87ca6744`
(`origin/main`).

**Severity:** evidence-channel-only, and **wide**. Nothing has shipped wrong and no merged record is
falsified (measured below). What is missing is the ability of these instruments to regress **loudly**:
each of them can be weakened, or can start failing, with every required check green, and the first
signal arrives at a `v*` tag — inside the publish pipeline, at the most expensive moment there is.

**Effort: M** for the whole remedy, **S** for its first and largest slice. Sized per lane below.

Three findings, surfaced separately in review. They are filed as one record because they are one
shape, and because fixing them one at a time invites the next one to be found the same way.

## Instance 1 — four `check:` scripts are in no workflow

```
$ grep -rn "check:tarball\|check:install-smoke\|check:package-graph\|check:all" .github/
(no output)
```

`npm run check:` appears 12 times under `.github/workflows/`; 11 of those are `run:` steps naming 11
distinct scripts, and none of them is one of these four. Their only invocation path is a human typing
`npm run check:all`, which chains the other three among its eleven links, by hand.

What that leaves unobserved is not cosmetic. `scripts/check-published-tarball.mjs:33` opens
`FORBIDDEN_PATTERNS` — compiled test files, `test-support/` fixtures, TypeScript sources and
`.tsbuildinfo` — and its own header records why: before it existed, "252 of 514 files — 49% of the
package" shipped to consumers, and "`npm publish --dry-run` … never inspects the file list."
`.github/workflows/publish.yml:125` runs exactly that dry run immediately before the real publish.

**Measured, with a line-count-neutral mutation** so nothing reddens for an incidental reason. Rewrite
`"!dist/.tsbuildinfo"` as `"!dist/nothingxxxxx"` in `packages/cli/package.json` — same semantic
weakening, same file length:

| channel                                          | result                                    |
| ------------------------------------------------ | ----------------------------------------- |
| `npm run check:tarball`                          | **FAIL**, EXIT=1 — the guard bites        |
| `npx vitest run --coverage` (the per-push suite) | **654 files / 6869 tests passed**, EXIT=0 |
| all nine `meta-checks` steps                     | EXIT=0, every one                         |

The mutated full-suite counts are **identical** to the pristine run's, so the suite really executed
and really did not care. A tree whose published tarball would ship a 234 kB `.tsbuildinfo` is green
on every required check.

⚠️ **One near-miss, recorded so it is not mistaken for coverage.** Deleting the entry outright (rather
than rewriting it) does redden `check:citation-content`, because `phase-23.json` c16 quotes the SDK
pin line further down the same file and the deletion moves it. That is a line-position ratchet firing
on a line-count change, not a check of the negation patterns; the sanctioned remedy for that class is
`--update-baseline`, which re-pins and lets the change through.

⚠️ **And one honest narrowing of the blast radius.** Since the bundler took over `packages/cli/dist`,
`find packages/cli/dist -name '*.test.js'` returns **0**, so two of the four `FORBIDDEN_PATTERNS`
have no subject in the one published package today and could not be falsified there. That is a
property of the current bundling step that nothing asserts, not a reason the guard is unnecessary.

## Instance 2 — `e2e/release` and `e2e/attestation` are outside every per-push channel

`vitest.config.ts`'s `projects` are every `packages/*` directory plus exactly two hand-declared
entries, `e2e/report` and `scripts`. Neither release-facing harness is among them, so `npm test`
never loads them. `npm run test:e2e` — the plain variant — appears in **no** workflow as a step; its
only mention under `.github/` is a comment. `npm run test:e2e:release-evidence` is a `run:` step at
exactly one place, `.github/workflows/release-e2e.yml:389`, in a workflow whose triggers are
`workflow_dispatch` and `workflow_call`, whose only caller is `.github/workflows/publish.yml:64`,
whose own trigger is `push: tags: v*`.

The three per-push workflows besides `ci.yml` run `packages/*` paths only:
`.github/workflows/gates-conformance.yml:44`, `.github/workflows/perf-conformance.yml:44`,
`.github/workflows/learning-redteam.yml:45`.

Test files with no per-push channel: **19** in `e2e/release`, **20** in `e2e/attestation`, and for
completeness **71** more across the other six harnesses — 110 files whose first execution on any
push is at a tag or a manual dispatch.

This is not a hypothetical. Two things already found in this exact gap, both today:
`23-support-window-confirmation-is-probe-stamped.md` records a reword that broke two
`e2e/attestation` assertions while "the full local gate was green and CI was green on both arches,
15/15, the entire time"; and the sibling record filed alongside this one
(`23-release-gate-summary-asserts-a-release-candidate-moment.md`) records `e2e/release`'s composed-gate
integration case sitting red since the v1.6.0 publish with nothing to say so.

## Instance 3 — the same, restated as the general fact

`e2e/release/src/marketplacePinCheck.ts`'s only production caller is the release-gate summary, so the
marketplace-pin drift `10-marketplace-entry-ahead-of-its-own-pin.md` describes "surfaced once per
release, in the most expensive place to learn anything." `checkVersionSupportWindows` "has **no
production caller**" outside the same channel. Both records reached the same conclusion about
different subjects. This one names the channel.

## Blast radius on the merged corpus — bounded, and measured rather than assumed

The natural worry is that a merged closeout ticked a criterion on a run of one of these unrun checks.
It did not. `phase-01.json` criterion 3 is the only merged criterion whose evidence mentions
`check-package-graph-acyclic`, and the `PASS — 18 workspace packages, dependency graph is a DAG` line
is quoted from an `artifact` citation — the committed transcript
`docs/evidence/phase-01/closeout-c3-tsc-18-packages.txt:43`, captured by hand — not from either of
that criterion's two `ci-run` citations, which name the `typecheck` job (`tsc -b`, whose TS6202 bears
the zero-cycles clause) and the `meta-checks` workspace count. Nothing in that record claims the
acyclicity script runs in CI.

**No merged record is falsified by any of this.** What is affected is the future.

## Not read as worse than it is — two mitigations landed today

Both are the right pattern, and both are partial by construction; measuring how far each reaches is
part of this record rather than a footnote to it.

- **PR #132.** `scripts/check-support-window-freshness.test.mjs:470` dynamically imports
  `e2e/attestation/src/versionSupportWindows.ts` and drives real committed records through the real
  gate, with a one-day-earlier control at `:485`. That is genuine per-push execution of production
  code inside `e2e/attestation`. It covers the freshness threshold; the project's other 19 files
  still run nowhere.
- **PR #130.** `scripts/check-published-tarball.test.mjs:132` asserts the bin-normalization invariant
  against the real `packages/cli/package.json` from inside the per-push `scripts` project, rather
  than adding it to `check:tarball`. The mutation table above ran with that suite green, which is the
  measurement of exactly how far it reaches: `nonNormalizedBinTargets` only.

## Proposed remedy

1. **Add a `meta-checks` step for `check:package-graph`.** Zero new infrastructure, no build needed,
   runs in under a second. **Effort: S.** This is the whole of the cheap slice and should not wait
   for the rest.
2. **Add `check:tarball` (and `check:install-smoke`) to the `unit-test+coverage` job**, after its
   existing `npm run build`, or to a new job that builds once. Both need a completed build;
   `check:install-smoke` additionally packs and installs into a scratch project, so it is the
   expensive one. Measure the added minutes on both arches before committing to it, and if
   `install-smoke` is too costly per-push, put it behind `paths:` on `packages/cli/**` rather than
   dropping it. **Effort: S–M**, mostly measurement.
3. **Give `e2e/release` and `e2e/attestation` a per-push channel.** The cheapest honest form is a new
   workflow (or job) running `node scripts/run-e2e-suites.mjs` for those two projects only, on
   `pull_request` and `push: main`, without `CRABGIC_RELEASE_REBUILD_CHECKOUTS`. Note the constraint
   that has to be designed around rather than ignored: `e2e/release` fails **by construction** on any
   commit whose version is already published or whose tag is elsewhere, which is exactly what the
   sibling record is about — so this step is blocked on that record's fix, or must scope itself to
   the subset of files that are commit-independent. **Effort: M.** Do not adopt the tempting shortcut
   of adding them to `vitest.config.ts`'s `projects`: they are standalone TypeScript projects with
   their own configs and their own coverage settings, and folding them into the root project would
   change the coverage denominator the 80% gate is calibrated against.
4. **Retire `check:all` or make it the CI entry point.** A chain that only a human runs is the exact
   shape this record is about; leaving it as documentation of what _should_ run is worse than
   deleting it. **Effort: S.**

Steps 1, 2 and 4 need no design input. Step 3 needs step 3's own ordering decision and the sibling
record's fix first.

**Ticket-ready:** yes, as four tickets.

## Not claimed

- **Not claimed:** that anything published is wrong. `check:tarball` and `check:install-smoke` were
  both run by hand at the v1.6.0 cut and both passed.
- **Not claimed:** that wiring these in is free. `check:install-smoke` packs a tarball and runs a real
  install; the cost is real CI minutes on two arches, which is why the remedy sizes it rather than
  waving at it.
- **Not claimed:** any figure for how long any of these lanes has been red or degraded. This record
  measures the channel. What the channel currently holds is the sibling record's subject.

**Evidence:** `docs/evidence/phase-23/release-evidence-lane-channels.txt`.
