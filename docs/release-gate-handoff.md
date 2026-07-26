# Release-gate work — session handoff

**Written:** 2026-07-25 against `5e2c6b5`. **Substantially revised 2026-07-26** after a
remediation round that audited, redesigned and rebuilt five blockers.
**Status:** committed on `main`, not pushed.

This is session state, not a project document. Once its open items are actioned it can be
deleted. The durable analysis lives in `docs/release-gate-remediation-plan.md`.

---

## Where things stand

`e2e/release-gate-report.json` (gitignored — regenerate it, don't trust a stale copy):

| Verdict          | Count |
| ---------------- | ----- |
| PASS             | 10    |
| FAIL             | 5     |
| EVIDENCE-PENDING | 0     |

Started at 7 PASS / 8 EVIDENCE-PENDING. **The count went DOWN from 11 PASS on purpose**: two
items were passing while asserting more than they verified, and making them honest is the
point of the gate. Every item now either passes or fails for a stated, actionable reason.

### The five remaining failures

| Item                                   | Why it fails                                                                                                                                                                                                             | Action                                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `jira-grafana-version-support-windows` | **Real finding.** Grafana 11.6 left vendor support 2026-06-25, a month before this cut, while `docs/compatibility-matrix.md` and `docker/grafana/11.6/` still commit to it.                                              | **Deferred by the owner** — to become a future task. Do not "fix" it by weakening the check.                                   |
| `arm64-verification`                   | No ARM64 CI run has been archived yet. The ingest path now exists (it did not before — see the correction below).                                                                                                        | Nothing further to build. Turns green on the first `ubuntu-24.04-arm` leg after this work is **pushed**; CI has never run it.  |
| `requirement-traceability`             | Most requirements are `unlinkable_no_emitting_harness` — no harness journals evidence under any of their gate tags. One is `unlinkable_umbrella` by design (roadmap/23's bullet ABOUT the report, mapped to `tags: []`). | The writers, the stamping and a genuine containerized binding now exist. Remaining work is per-requirement evidence emission.  |
| `performance-contracts`                | Both idle budgets **PASS on merit** (RSS 66.27 MiB / 100 MiB; CPU 0.000% / 1%). The item fails on the OTHER obligation roadmap/23 books against it: 15's PerformanceContract re-run (23:75) is unevidenced.              | Owner-ratified. Clears when a real twin-worktree re-run writes `docs/evidence/phase-23/perf-contract-rerun.json` (see Gap 16). |
| `reproducible-build`                   | Five of criterion 23:136's seven clauses were never checked. Now they are: no `CHANGELOG.md`, no `v1.0.0` tag, marketplace `commit` is 40 zeros, nothing published.                                                      | **Deliberate.** These are the owner's release actions, out of scope this round. The item is now honest rather than green.      |

---

## The one genuinely open question — RESOLVED (2026-07-25)

**The supervisor idle-RSS contract was flaky at its boundary**: 104.7 MiB, then 113.9 MiB, then
under budget, against `roadmap/05`'s <100 MiB. It passed at the last gate run by luck.

**Answer: neither remedy the question offered.** Not a regression, not a stale number. The
daemon was eagerly importing an engine it never uses while idle. Full analysis, with the
measurement table, is in `docs/release-gate-remediation-plan.md` §"Resolution: the idle-RSS
breach was an eager engine import". In short:

- Idle RSS is **byte-identical flat** over 16 s (`101816 kB` at every sample) → never a leak;
  the whole footprint is module loading, and the "flakiness" was variance across boots.
- Bare Node 24.18.0 floor is **41.2 MiB**; journal+supervisor+contracts reach **65.5 MiB**;
  adding `run-dispatcher.js` jumps to **108.2 MiB** — it statically imports `@eo/engine-claude`
  → `@anthropic-ai/claude-agent-sdk`, **+40.9 MiB alone**. `resolveWorkerAuthMaterial` lived in
  that same module and is called at startup, so resolving a token pulled the engine in too.
- Fixed by moving auth resolution to `worker-auth.ts` and deferring the dispatcher import to
  first `dispatch()` (`lazy-run-dispatcher.ts`). Idle RSS is now **65.6–66.2 MiB across five
  boots — ~34% headroom**, spread down from 8.4 MiB to 0.6 MiB.

**05's documented budget stands unchanged — no spec amendment, so no owner decision was
needed.** The RSS contract now passes on merit: `supervisor-idle-rss` scores `pass` at a 66.1 MiB
mean against the 104,857,600-byte budget, with a bootstrap noise bound of **0.00%**.

Two non-blocking notes carried into the remediation plan: the Node `>=24` floor alone eats 41%
of the budget, and two zod majors (v3 hoisted, v4 under `engine-claude`) both load once the
engine does.

### CORRECTION — `performance-contracts` still FAILs, on its CPU half

An earlier draft of this file recorded 12 PASS / 3 FAIL with `performance-contracts` green. That
does not reproduce. Re-measured three consecutive times at `a1ae9cc` on a verified-quiet host
(load/core 0.01–0.02, 98.6–98.7% idle), the item FAILs every time, and the RSS fix above is not
what is wrong with it:

| Contract              | Outcome                 | Mean                 | Budget    | Noise bound |
| --------------------- | ----------------------- | -------------------- | --------- | ----------- |
| `supervisor-idle-rss` | `pass`                  | 66.1 MiB             | 100 MiB   | 0.00%       |
| `supervisor-idle-cpu` | `inconclusive_blocking` | 0.00233 (0.23% core) | 0.01 (1%) | **100.00%** |

**Both budgets are genuinely met.** The daemon idles at 0.23% of a core against a 1% budget. The
gate cannot say so because of how the series is shaped, not how big it is: an idle daemon's
CPU-tick series over a ~17 s window is 16 zero samples and one 0.0397 blip (the 5 s heartbeat
firing once). `computeNoiseBoundPct` bootstraps a **relative** delta of the resampled mean, which
against a 94%-zero series saturates at 100% — far past
`CRITICAL_PATH_INCONCLUSIVE_NOISE_THRESHOLD_PCT` (15), so `decide()` returns
`inconclusive_blocking` before the absolute-budget comparison is ever reported. The RSS series is
smooth, so the same machinery scores it cleanly.

Two structural points about this seam, worth having before anyone changes it:

- `decideReleaseContracts` passes `baseSamples === candidateSamples`, so `regressionPct` is
  identically 0 and the entire A/B apparatus is inert here. `decide()` is built for twin-worktree
  benchmark comparison; this contract is an **absolute idle budget over a sparse counter**, which
  is a different question wearing the same interface.
- The check's own detail line reports `observed max`, while `decide()` acts on the **mean**. That
  is why the line reads "observed max 0.0398 against budget 0.01" and yet no absolute-budget
  breach fired — they are two different statistics. Reporting one and deciding on the other is
  its own defect, independent of the noise problem.

Deliberately **not** fixed here: dropping the CPU contract, widening the noise threshold, or
switching `pathSensitivity` off `critical` would each manufacture a green gate, and the remedy is
a design decision about what statistic an absolute idle budget should be decided on.

> **RESOLVED 2026-07-26 — this section is history, kept for the reasoning.** The remedy was none
> of the three rejected options: the whole `packages/perf` route was the defect, because
> `roadmap/15:38` and `roadmap/05:38` both say the supervisor idle budget is "not a
> PerformanceContract, never routed through `packages/perf`". CPU is now decided on whole-window
> utilization and RSS on the max sampled current-RSS, compared absolutely, with no bootstrap noise
> gate. Both contracts now score `pass` on merit — measured 66.27 MiB / 100 MiB and 0.000% / 1%.
> The report-vs-decide mismatch is fixed too: each detail line names the statistic it was decided
> on. `performance-contracts` still FAILs, but on the separate 23:75 obligation, not on this.

---

## Inventory of what landed

Modified:

- `.github/workflows/ci.yml` — ARM64 matrix leg now writes and uploads a run record.
- `.github/workflows/drift-ci.yml` — runs the vendor support-window probe weekly.
- `e2e/matrix/git/src/evidence.ts`, `e2e/matrix/installation/src/evidence.ts` — added the
  `$EO_RELEASE_CANDIDATE_OBJECT_ID` fallback (see Gotchas — the single highest-impact fix).
- `e2e/matrix/git/test/evidence.test.ts`, `e2e/matrix/installation/test/evidence.test.ts` —
  control the env var explicitly, plus regression tests.
- `package.json` — wired `e2e/attestation` into `test:e2e`, `test:e2e:release-evidence` and
  `check:e2e-types`; added `probe:support-windows`, and `tsx` as the devDependency that runs
  it. The script was authored against a `tsx` this repo did not depend on, so
  `npm run probe:support-windows` failed with `tsx: not found` — and because the drift-ci step
  is `continue-on-error` with `if-no-files-found: warn`, the weekly probe would have failed
  silently and green.
- `packages/cli/src/bin/supervisord.ts` — boots via the lazy dispatcher and `worker-auth.js`,
  keeping the engine out of the daemon's boot graph.
- `packages/cli/src/daemon/run-dispatcher.ts` — `resolveWorkerAuthMaterial` moved out (to
  `worker-auth.ts`); the now-unused `readFile` import dropped.

New:

- `packages/cli/src/daemon/worker-auth.ts` + `worker-auth.test.ts` — engine-free credential
  resolution, previously untested anywhere.
- `packages/cli/src/daemon/lazy-run-dispatcher.ts` + `lazy-run-dispatcher.test.ts` — defers the
  engine import to first dispatch. **This is the idle-RSS fix.**
- `e2e/attestation/` — the release-cut attestation harness (13 test files, 148 tests).
- `e2e/provisioning/src/supportWindows.ts`, `supportWindowsCli.ts` + their tests — the vendor
  support-window prober.
- `docs/vendor-support-policy.json` — human-attested, source-cited vendor support-end dates.
- `docs/evidence/phase-23/vendor-support-windows.json` — probe output (regenerable).
- `docs/release-gate-remediation-plan.md` — the audit and plan.
- `docs/release-gate-handoff.md` — this file.

---

## How to run things

```bash
# Regenerate the gate report end to end (the authoritative check).
S=$(mktemp -d)
export EO_RELEASE_GATE_JOURNAL_DIR="$S/journal"
export EO_RELEASE_CANDIDATE_OBJECT_ID="$(git rev-parse HEAD)"
npm run test:e2e:release-evidence          # all 8 e2e projects, sequentially
node e2e/report/dist/cli.js                # writes e2e/release-gate-report.json

# Individual projects
npx vitest run --config e2e/attestation/vitest.config.ts
npx vitest run --config e2e/provisioning/vitest.config.ts

# Re-probe vendor support windows (needs network)
npm run probe:support-windows

# Gates
npm run check:e2e-types && npx eslint e2e && npx prettier --check "e2e/**/*.ts"
```

Last full verification: prettier + eslint + `check:e2e-types` clean; attestation 148 tests
(94.4% statements / 83.7% branches), provisioning 53, git 36, installation 46; full
release-evidence chain exit 0.

---

## Gotchas found the hard way

Non-obvious things that cost real time. Worth knowing before touching this area again.

**Evidence linking.** `e2e/report`'s generator links an `EvidenceRecord` to a checklist item
only when BOTH the `gateTag` matches AND `objectId` equals the report's
`releaseCandidateObjectId`. `e2e/matrix/git` and `e2e/matrix/installation` were stamping their
throwaway repo's own object ID, so their evidence was **structurally unlinkable** — genuine,
green, and invisible to the gate forever. Emitting evidence that cannot link is
indistinguishable, at the gate, from emitting none.

**`requirementId` is the traceability join key.** `EvidenceRecord.requirementId` is optional in
02's schema and was `undefined` at essentially every emission site, and 21's
`buildTraceabilityView` matches evidence to a requirement on that field alone. Traceability
could never have linked anything regardless of evidence volume.

**Perf measurement.**

- `trySampleProcess` from `@eo/perf` is **async**. Not awaiting it yields a Promise whose
  `.stat` is `undefined`.
- The daemon's control socket path must stay under the **108-byte `sun_path` limit**. A
  conventional `mkdtemp(tmpdir(), "eo-perf-release-")` root plus a 32-char project hash
  overruns it, and the daemon dies with `listen EINVAL` before it can be sampled. Hence the
  terse `eo-p` prefix and 9-char hash.
- Sample **`VmRSS`**, not `VmHWM`. The high-water mark is cumulative since process start, so it
  carries the startup peak into every "idle" sample.
- Exclude startup. A window opened at spawn measures module loading and socket bind — the first
  run reported **123% of a core** against a 1% budget, which is true about booting and false
  about idling.
- `decide()` enforces `MIN_INTERLEAVED_REPETITIONS = 10` per side and refuses below it. One
  whole-window average is not a sample series.

**Test wiring.**

- `e2e/provisioning`'s vitest config includes **`test/**` only**, not `src/**`. A test placed in
  `src/` silently never runs — caught here only by a coverage drop to 54%.
- `npm run test:e2e:release-evidence` exports `EO_RELEASE_CANDIDATE_OBJECT_ID` for the whole
  chain, so any test asserting a scenario-local `objectId` must save/delete/restore it, or it
  asserts one thing locally and another in CI.

**API shapes that differ from the obvious guess.**

- `lint(candidate, kind, policy)` — three positional args, and `LintOutcome` is a discriminated
  union (`{ok: true}` | `{ok: false, findings}`).
- `nameBranch` is **async** and returns `{status: "named", branchName}` | `{status: "blocked", …}`.
- `createGitPlumbing()` takes options, not a spawn function.
- `renderPrTitle` / `renderPrBody` / `renderReviewComment` take domain fields
  (`{type, outcome}` / `{outcome, validation, risk, tracking}` / `{finding, evidence, action}`).
- Node's `child_process` rejects any argv entry containing `NUL`, so `git log -z` cannot be
  expressed through `execFile`.

**Running TypeScript outside vitest.** The `e2e/*` projects are typechecked with `--noEmit` and
executed by vitest, so nothing in them is ever compiled to `dist/`. A standalone CLI under
`e2e/` therefore needs a TS runner — `node file.ts` will not do, because Node 24's native type
stripping does not remap a `./foo.js` specifier onto `foo.ts`, and every import in these
projects is written `.js`-extended for `verbatimModuleSyntax`. Hence the `tsx` devDependency.

---

## Design notes worth carrying forward

- **`e2e/attestation/` exists** because the seven items it covers attest to properties of the
  release candidate's own committed state (docs, journal, traceability, platform coverage)
  rather than exercising a subsystem against live infrastructure — which is precisely why no
  matrix harness covered them.
- **Verdicts are data, not test outcomes.** The emitter suite asserts that evidence was emitted
  _correctly_ (right tag, right object ID, schema-valid, exit status faithful to the verdict)
  and never asserts the verdict itself. If it went red on a FAIL, the release-evidence run would
  abort and the report would be generated from a partial journal — failing items would revert to
  showing "no evidence" instead of "checked, here is what is wrong".
- **`emitAttestationEvidence` derives `exitStatus` from the verdict** and does not accept it as
  a parameter. A caller cannot journal a green record for a failing check.
- The vendor support-window design splits **mechanical** facts (is the tag published? — probed
  live) from **attested** ones (when does support end? — human-recorded with a cited source),
  because Atlassian and Grafana publish EOL dates as prose, and scraping prose then calling it
  verified evidence is exactly what this phase forbids.

---

## Corrections (2026-07-26) — claims in the 2026-07-25 text that were false

An audit of all five blockers, followed by an adversarially-reviewed redesign, found that several
statements in the original version of this file were wrong. They are corrected above; recorded here
because each was believed and acted on.

**"ARM64: mechanism is complete end to end … Nothing to build."** False. The producer existed and
the consumer did not. There were zero `download-artifact` steps, zero `gh run download` calls and
zero `workflow_run` triggers repo-wide; `arm64Verification.ts` read a path that no workflow, script
or test ever wrote. The ingest step is now in `release-e2e.yml`.

**"Traceability: environment-blocked … Corpus and evidence-linking are done."** Wrong in both
halves. It was never purely environment-blocked: `stampJiraRemoteResource`,
`stampGrafanaRemoteResource` and `recordEvidencePointer` had **zero production callers** anywhere —
roadmap/21 work item 1 was never built, so a live tenant would have produced zero pointers. And
evidence-linking was not done: `requirementId` was stamped at exactly one emission site. Both are
now built, and a real containerized Grafana binding produced a genuine pointer.

**"The gate is at 11 PASS / 4 FAIL."** Two of those passes were over-claims. `reproducible-build`
scored four inputs while three of its own computed preparers were ignored, so five of its seven
clauses went unverified. `performance-contracts` measured one of the two obligations roadmap/23
books against it.

**`docs/release-gate-remediation-plan.md:175-177`** carried the same wrong ARM64 claim and is
corrected there.

### The finding that mattered most, and was in no blocker list

`.gitignore`'s `coverage/` was **unanchored**, so git matched a directory of that name at any
depth — silently untracking the 15 real source files in `packages/gates/src/coverage/`. Proven
both directions with `git archive` + `tsc -b`: HEAD failed with 12 × `TS2307`, the fix builds
clean. Consequences: **CI was red on every leg**, so the ARM64 record step (guarded `if: success()`
after `npm run build`) could never have fired, and `arm64-verification` was unreachable regardless
of the ingest gap. The repo built locally and only locally.

`reproducible-build` did not catch it because its default populator copies the already-built
`dist/` into both clean exports instead of rebuilding per checkout — it proved packer determinism,
not build determinism. A rebuilding populator is now wired behind `EO_RELEASE_REBUILD_CHECKOUTS=1`.

### The second-most important, also unlisted

`release-e2e.yml` set no `EO_RELEASE_GATE_JOURNAL_DIR` and ran `npm run test:e2e` rather than
`test:e2e:release-evidence`. Every harness therefore took the `mkdtemp` fallback in its own
`testJournal.ts` and wrote to a journal deleted on cleanup, while the generator read
`DEFAULT_JOURNAL_DIR`. **A CI-generated report would have linked zero evidence for every one of the
15 items.** Every PASS on record came from local runs. Now wired at job level.

---

## What this round changed

- **Idle budget no longer routes through `packages/perf`**, which `roadmap/15:38` and
  `roadmap/05:38` both forbid by name. CPU is now decided on whole-window utilization
  (`totalTicks / (HZ × elapsedWallSeconds)`) and RSS on the max sampled current-RSS, both compared
  absolutely. The old `inconclusive_blocking` was a bootstrap **relative** noise bound saturating
  at 100% against a 94%-zero series — never a budget breach.
- **`reproducible-build` enforces its own description**, and the all-zero placeholder SHA is
  rejected by the marketplace schema (a test previously asserted the real file was "SHA-pinned"
  and passed on 40 zeros).
- **ProviderRegistry is populated** — Jira and Grafana registered from the composition root, with
  durable file-backed plan-payload and rollback-snapshot stores replacing in-memory `Map`s, and a
  per-connection Grafana registry (`envelopeId` is per-authorization, so one long-lived adapter was
  architecturally wrong). No `ExternalConnection` contracts change: `roadmap/19:16` forbids it and
  `JiraConnectionConfig` already carried the mechanism.
- **Gap 16** in `docs/interface-ledger.md` now pins the phase-23 evidence-record convention (path,
  `EO_*` override, `.strict()` schema read through `safeParse`, malformed ⇒ FAIL not throw), with
  the coordinated additions in roadmap/01, /15 and /23.

Verified at the close of the round: `tsc -b` 0, `check:all` 0, `check:e2e-types` 0, eslint 0,
prettier clean, **556 test files / 4638 tests passing** (95.4% statements, 87.9% branches), and a
clean-checkout build of the full tree (1913 files exported, `tsc -b` 0).

**Note on the traceability artifact.** `docs/evidence/phase-23/requirement-traceability.json` pins
`objectId` to the commit it was generated against, so it goes stale the moment HEAD moves — the
same catch-22 the ARM64 record has. Regenerate it with
`npx vitest run --config e2e/attestation/vitest.live.config.ts` (needs Docker) at the object ID
actually being scored, or supply it out-of-tree per Gap 16.
