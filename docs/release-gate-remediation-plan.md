# Release-gate remediation plan

**Status:** Phase 23 (release hardening). Written 2026-07-25 against release candidate
`5e2c6b5`, after `e2e/attestation/` closed the "no harness reports on this" gap for seven
`RELEASE_GATE_CHECKLIST` items. Every claim below cites the file it was verified against.

## Starting position

`e2e/release-gate-report.json` at `5e2c6b5`, after the attestation harness landed:

| Verdict          | Count | Items                                                                                                                                                                                                                                          |
| ---------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PASS             | 9     | quality-security-perf-learning-gates, security-review-sign-off, crash-recovery-concurrency, jira-grafana-exactly-once, gateway-cli-surface-complete, no-unauthorized-mutation, release-docs-committed, reproducible-build, engine-pin-recorded |
| FAIL             | 5     | requirement-traceability, performance-contracts, demo-branch-evidence-handoff, arm64-verification, jira-grafana-version-support-windows                                                                                                        |
| EVIDENCE-PENDING | 1     | no-engine-attribution                                                                                                                                                                                                                          |

## Headline finding

Four of the five FAILs are **not** missing-checker problems. The underlying subsystems exist,
are built, and are tested. What is missing is that nobody has **executed them against the
release candidate and journaled the result**. Only `jira-grafana-version-support-windows`
requires a genuinely new capability.

## Cross-cutting integration debt

`e2e/attestation/` shipped with three checks reading bespoke JSON artifacts under
`docs/evidence/phase-23/`. That is the wrong seam and is repaid before anything is built on
top of it:

| Defect                                                                         | Reality                                                                                                                                                                                                                                     | Remedy                                                                                     |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `performanceContracts.ts` defines its own `satisfied\|regressed\|skipped` enum | Canonical vocabulary is `PERFORMANCE_OUTCOMES = ["pass", "block", "inconclusive_blocking"]` (`packages/contracts/src/contracts/performance-contract.ts`). `inconclusive_blocking` **is** the "skipped" concept and already blocks by design | Consume `EnforcedPerformanceContract` (`budgets[].measuredValue`, `budgetHash`, `outcome`) |
| Perf / traceability / demo checks read hand-written files                      | The journal (04) is the system's own source of truth and already flows through `EO_RELEASE_GATE_JOURNAL_DIR`                                                                                                                                | Read the journal, as `e2e/report`'s generator does                                         |
| `quietHost: boolean` invented by the perf check                                | No quiet-host concept exists anywhere in `packages/perf`                                                                                                                                                                                    | Build a real probe over the existing `/proc` primitives                                    |
| arm64 check matches `/arm64\|aarch64/i` against evidence **file names**        | Fragile heuristic                                                                                                                                                                                                                           | Structured CI run record: workflow run id, `uname -m`, conclusion, commit SHA              |

## Per-item remediation

### arm64-verification

Already exists: `.github/workflows/ci.yml` runs `ubuntu-24.04-arm` in three job matrices, and
the repository has an `origin` remote, so CI can execute. Missing: nothing binds a green ARM64
leg to the release-candidate object ID.

Remedy: the ARM64 matrix leg emits an `EvidenceRecord`
(`gateTag: release-gate:arm64-verification`, `objectId: $GITHUB_SHA`, `toolchainFingerprint`
carrying `uname -m`), uploaded as an artifact that `release-e2e` ingests. The check requires a
genuinely `aarch64` arch, a successful conclusion, and a SHA equal to the release candidate.

### jira-grafana-version-support-windows

Already exists: container recipes under `docker/`, the `e2e/provisioning` harness
(`composeRunner`, health probes, live tests), and **`.github/workflows/drift-ci.yml`** — a
weekly job whose entire purpose is replaying pinned vendor fixtures and emitting a
`DriftProposal` for human review, debounced, never auto-applying a change. Missing: no vendor
support-window prober exists; the single prior check
(`docs/evidence/phase-23/provisioning/grafana-13.1-tag-check.txt`) was ad hoc.

Remedy: extend drift-ci with a support-window probe class rather than build a parallel
mechanism. Record the vendor's **stated support-end date**, not a `supported` boolean, so
freshness is computed against the release date instead of an invented constant. Must handle
the known open case: the Grafana OSS 13.1 recipe is pinned to a tag the vendor has not
published.

### performance-contracts

Already exists: `createPerformanceGateHandler` (`packages/perf/src/gate/performance-gate.ts`),
`decide` (`packages/perf/src/stats/decision-engine.ts`), `runTwinWorktreeBenchmark`,
`assertMethodologySound` with `MIN_INTERLEAVED_REPETITIONS = 10`,
`buildEnforcedPerformanceContract`, and a real measurement layer (`/proc` parser, process
sampler, rusage, command runner). `perf-conformance.yml` runs the fixture matrix in CI.

Missing: (a) no release-cut invocation; (b) no quiet-host probe — 05 and 15 both defer it and
no implementation exists; (c) no defined release budgets, though 05 supplies concrete absolute
numbers (<100 MiB RSS, <1% core, 5 s heartbeat) that map onto `decide()`'s `absoluteBudget`
path.

Remedy: an `e2e/perf-release/` harness resolving base (previous tag) against candidate (the
release candidate), with a real worktree dispatcher over the control clone and real
measurement via `runCommandWithResourceCapture`, feeding `createPerformanceGateHandler`, with
a quiet-host probe sampling load average and `/proc/stat` idle around every measured
repetition. The supervisor idle-budget re-measurement is a **separate** contract from the
twin-worktree A/B; both are named release obligations.

### demo-branch-evidence-handoff

Already exists: `publishLocal` (invariance digest, attribution re-check,
`PublishedAttributionLeakError`, `listNewlyIntroducedCommits`), `nameBranch`, `renderCommit`,
`attachEvidence` with `IdempotencyRegistry`, `ensureControlClone`, and a real
`evidence <change-set-id>` CLI handler over the journal
(`packages/cli/src/commands/real-handlers.ts`). `e2e/matrix/git` already proves checkout
invariance and attribution-leak refusal.

Missing: an end-to-end demo run — intake to work unit to worktree to commit to CAS ref update
to `publishLocal` to evidence bundle to retrieval.

Remedy: an `@live`-tagged `e2e/demo/` harness over a disposable repository, asserting a local
branch with a neutral name, concise commits, **zero** remote interaction (no remote configured
_and_ a `GitPlumbing` spy proving no push), and a bundle retrievable via
`evidence <change-set-id>`.

**Hard constraint:** roadmap/23's Goal requires this be proven "against the real Claude Code
engine — never a fake-engine substitute", so it needs live engine access and subscription
budget.

### requirement-traceability

Already exists, end to end: `Requirement` with its four bidirectional mapping arrays,
`IntentContract`, `buildIntentContract` producing stable section+title-derived IDs, a durable
registry (the `file-registry.ts` wrapper, added so `contract.approve` could read it across a
process boundary), `EvidenceRecord.requirementId`, `emitEvidence` threading it from
`GateContext`, `recordEvidencePointer`, `buildTraceabilityView`, `remote-verification-gate`,
and connector-side `RemoteResource` stamping.

Missing: (a) no `IntentContract` exists for the release itself — requirements are per-ChangeSet
and the release has never been through intake; (b) `EvidenceRecord.requirementId` is optional
and unset at nearly every emission site, so evidence would not link even if requirements
existed; (c) no remote resources bound, which needs the live Jira/Grafana sandbox.

Decision taken (recommended option A): the requirement corpus for v1.0.0 is the roadmap's own
phase exit criteria. The exit criterion reads "every requirement linked to evidence from the
exact final Git object ID", and the roadmap's exit criteria **are** the release's
requirements. The rejected alternative (B) scoped traceability to intake-driven change sets
only, which would silently leave historical work untraced.

## Additional finding: no-engine-attribution

`e2e/matrix/git/src/evidence.ts` takes `objectId` as a **required caller-supplied value with no
`$EO_RELEASE_CANDIDATE_OBJECT_ID` fallback** — unlike `e2e/live`, `e2e/release`, and
`e2e/matrix/connector`, which all have one. Scenarios therefore stamp throwaway-repository
object IDs that can never match the release candidate, and `no-engine-attribution`, whose only
evidence source is this harness, stays `EVIDENCE-PENDING` forever.

`e2e/matrix/installation` carries the identical defect, masked only because
`release-gate:connector-matrix` independently covers `no-unauthorized-mutation`.

## Sequencing

| Phase | Work                                                                                                           | Status                                                                                                         |
| ----- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| P0    | `objectId` env fallback in git- and installation-matrix emitters                                               | **Done** — `no-engine-attribution` went from 0 linked records to PASS with 24                                  |
| P0    | Integration debt: canonical perf vocabulary, structured ARM64 record, measurement replacing hand-written files | **Done**                                                                                                       |
| P1    | ARM64 evidence binding                                                                                         | **Done** — mechanism complete; the item stays FAIL until a real ARM64 CI run is archived                       |
| P2    | drift-ci support-window probe                                                                                  | **Done** — surfaced a genuine blocker (below)                                                                  |
| P3    | Perf release harness + quiet-host probe                                                                        | **Done** — surfaced a genuine blocker (below)                                                                  |
| P4    | Demo run                                                                                                       | **Done** — a real `publishLocal` run, item now PASSes                                                          |
| P5    | Requirement traceability                                                                                       | **Partly done** — corpus and evidence linking built; remote-revision binding needs a live Jira/Grafana sandbox |

## Outcome

The gate moved from **9 PASS / 5 FAIL / 1 EVIDENCE-PENDING** to **11 PASS / 4 FAIL / 0
EVIDENCE-PENDING**, measured at `a1ae9cc`. Nothing is unreported any more: every item is now
either proven or failing for a stated, actionable reason.

(An earlier draft of this section recorded 12 PASS / 3 FAIL. That count does not reproduce:
`performance-contracts` FAILs on its CPU half for a methodology reason, not a budget breach —
see §"Correction: `performance-contracts` fails on a statistic, not a budget" below.)

Two of the remaining failures are **real product findings**, not unfinished harness work — they
are the gate doing its job:

1. **Supervisor idle RSS breaches 05's budget.** Measured on a verified-quiet host (load
   0.03/core, 97.8% idle) after excluding startup: **104.7 MiB and 113.9 MiB across
   consecutive runs, against a 100 MiB budget**. The daemon sits at the limit and crosses it
   run to run. Either the daemon regressed or 05's number is stale; shipping v1.0.0 while
   claiming <100 MiB idle RSS would be false.
   **RESOLVED — see "Resolution: the idle-RSS breach was an eager engine import" below.**
   It was neither a regression nor a stale number: the budget is met with 34% headroom once
   the daemon stops loading the engine it never uses while idle.
2. **Grafana 11.6 is out of vendor support.** Support ended **2026-06-25**, a month before
   this release cut, while `docs/compatibility-matrix.md` and `docker/grafana/11.6/` still
   commit to it. The probe also mechanically re-confirmed that `grafana/grafana-oss:13.1.0`
   is still unpublished (Docker Hub 404).

`arm64-verification` fails only because no ARM64 CI run has been archived yet; the emitting
step and the check are both in place and it turns green on the first green `ubuntu-24.04-arm`
leg.

> **CORRECTED 2026-07-26 — the paragraph above was false.** The emitting step and the check were
> in place; the step that INGESTS the artifact was never written, so the check read a path nothing
> produced. And CI could not have emitted anything anyway: it was red on every leg because of the
> `.gitignore` defect fixed in `e431710`. Both are addressed; see §"Round 2" at the end of this
> document.

## Resolution: the idle-RSS breach was an eager engine import

The open question was framed as a binary — **regression** (fix the code) or **stale** (an
owner-level spec amendment to 05's number). It was neither. Three measurements settled it, in
the order the handoff proposed, on Node 24.18.0.

**Idle RSS is flat, so this was never a leak.** Sampled once a second for 16 s, the daemon held
`VmRSS: 101816 kB` — byte-identical at every sample. Nothing grows while idling; the entire
footprint is established during startup and then held. "Flaky at the boundary" was variance
_across process instances_, not drift within one.

**The runtime floor is 41.2 MiB.** A bare `node -e 'setInterval(()=>{},1000)'` sits at
~42,200 kB across five runs. That is 41% of the whole budget before any crabgic code exists.

**Decomposing the module graph found the actual cost.** Importing the daemon's dependencies
one at a time:

| Stage                                              |   RSS | Delta     |
| -------------------------------------------------- | ----: | --------- |
| bare Node runtime floor                            |  41.2 | —         |
| `+ @eo/journal`, `@eo/contracts`, `@eo/supervisor` |  65.5 | +24.3     |
| `+ ../daemon/run-dispatcher.js`                    | 108.2 | **+42.7** |

That last import is the whole breach. `run-dispatcher.ts` statically imports
`@eo/engine-claude`, which pulls `@anthropic-ai/claude-agent-sdk` — **+40.9 MiB on its own**.
The daemon paid it at every boot for two reasons: the dispatcher factory was constructed
eagerly, and `resolveWorkerAuthMaterial` — called at startup — happened to live in that same
module, so merely resolving a token dragged the engine in.

An idle daemon serves `status`/`cancel`/`evidence`/`registry`. None of them touch the engine.
So the budget was never unreachable; the daemon was loading ~41 MiB it had no use for, which
is precisely what 05's own summary rules out: it "holds its own idle footprint to a fixed,
CI-measured budget **so running it costs nothing when there is no work**."

**The fix**, in `packages/cli`:

- `src/daemon/worker-auth.ts` (new) — `resolveWorkerAuthMaterial` moved out of the
  engine-importing module. It needs only `readFile`/`join`; `WorkerAuthMaterial` is a
  type-only import, erased under `verbatimModuleSyntax`. It also had **no test coverage
  anywhere** before this, and now has five cases.
- `src/daemon/lazy-run-dispatcher.ts` (new) — defers `import("./run-dispatcher.js")` to the
  first `dispatch()`. Safe because `dispatch` was always async and resolves on _ownership_,
  not completion, so a one-time module load is immaterial against a run measured in hours.
  It builds exactly one real dispatcher, memoizing the promise rather than the result: the
  real dispatcher keeps per-instance in-flight state to stay idempotent per run, so two
  instances could start competing drivers over the same work units.
- `src/bin/supervisord.ts` — rewired to both, keeping `run-dispatcher.js` out of the boot
  graph entirely (verified against the built `dist/bin/supervisord.js`).

**Result — measured the same way, five consecutive boots:**

| Before (eager)           | After (lazy)                         |
| ------------------------ | ------------------------------------ |
| 99.8 / 108.2 / 100.2 MiB | 66.2 / 65.6 / 66.1 / 66.0 / 65.8 MiB |

The budget now holds with **~34% headroom**, and run-to-run spread collapses from 8.4 MiB to
0.6 MiB — so the RSS contract passes on merit rather than by luck. **05's documented number
stands unchanged; no spec amendment is needed.** (The `performance-contracts` gate ITEM still
fails, on its separate CPU contract — see the correction below. Nothing in this section is
retracted: `supervisor-idle-rss` scores `pass` with a 0.00% noise bound.)

Two notes carried forward, neither blocking:

- The `>=24` Node floor consumes 41% of the budget. The headroom above is real, but the
  budget is only ever ~59 MiB of application space, and a future Node major moves that floor
  without any code change.
- Two zod majors are installed (v3.25.76 hoisted, v4.4.3 nested under `engine-claude`) and
  both load once the engine does — ~13 MiB combined. Irrelevant to the idle budget now that
  the engine is lazy, but it is duplicated resident memory in any process that dispatches.

## P5: what was built, and what remains

Built (`e2e/attestation/src/releaseRequirements.ts`):

- The requirement corpus is now DERIVED from roadmap/23's own `## Exit criteria` checkbox list
  — 16 requirements, each with a deterministic UUIDv5-style id (necessary because
  `EvidenceRecord.requirementId` is `IdSchema`). No hand-written corpus, so the traceability
  claim is not circular.
- Each criterion is mapped to the `release-gate:*` tags whose evidence satisfies it. The map is
  explicit rather than slug-derived, because a criterion's wording and its gate slug are not
  mechanically related ("No user checkout … modified" is tagged `no-unauthorized-mutation`).
  An unmatched criterion gets no tags and is reported, never silently traced.
- `EvidenceRecord.requirementId` is now stamped at emission. This was gap (b) in the audit: the
  field is optional in 02's schema and was `undefined` at essentially every emission site, and
  21's `buildTraceabilityView` matches evidence to a requirement on that field alone — so
  traceability could never have linked anything, no matter how much evidence existed.
- The check now assembles its inputs from the shared release journal and computes the view via
  21's real `buildTraceabilityView`.

Remaining, and genuinely environment-blocked: the criterion's second half — "linked to evidence
from the exact final Git object ID **and remote (Jira/Grafana) revisions**". Binding a
requirement to a confirmed remote revision needs a live Jira Cloud tenant, and no credentials
exist in this environment. Every requirement therefore reports `bound to no remote
(Jira/Grafana) resource`.

Weakening the check to pass without remote bindings would manufacture a green gate for a
property that was never verified, so the item stays FAILing.

## Correction: `performance-contracts` fails on a statistic, not a budget

Measured three consecutive times at `a1ae9cc` on a verified-quiet host (load/core 0.01–0.02,
98.6–98.7% idle), `performance-contracts` FAILs every time. Both underlying budgets are met;
the gate cannot say so.

| Contract              | Outcome                 | Mean                 | Budget    | Bootstrap noise bound |
| --------------------- | ----------------------- | -------------------- | --------- | --------------------- |
| `supervisor-idle-rss` | `pass`                  | 66.1 MiB             | 100 MiB   | 0.00%                 |
| `supervisor-idle-cpu` | `inconclusive_blocking` | 0.00233 (0.23% core) | 0.01 (1%) | **100.00%**           |

The daemon idles at **0.23% of a core against a 1% budget** — four times under, not over. What
blocks is the SHAPE of the series, not its magnitude. Over a ~17 s window an idle daemon
produces 16 zero CPU samples and one 0.0397 blip, the 5 s heartbeat firing once.
`computeNoiseBoundPct` (`packages/perf/src/stats/bootstrap-ci.ts`) bootstraps a **relative**
delta of the resampled mean; against a 94%-zero series that saturates at 100%, far past
`CRITICAL_PATH_INCONCLUSIVE_NOISE_THRESHOLD_PCT` (15), so `decide()` returns
`inconclusive_blocking` at its noise gate — which sits AFTER the absolute-budget check but is
reached because the mean never breached the budget in the first place. The RSS series is smooth,
so the identical machinery scores it at 0.00% noise.

Two structural observations, both prerequisites to fixing this properly:

1. **The A/B apparatus is inert on this contract.** `decideReleaseContracts` passes
   `baseSamples === candidateSamples`, so `regressionPct` is identically 0. `decide()` is built
   to compare a candidate against a base in a twin-worktree benchmark. An absolute idle budget
   over a sparse counter is a different question wearing the same interface, and only `decide()`'s
   `absoluteBudget` path carries any meaning for it. Routing it through the noise gate imports a
   precondition — a well-conditioned continuous series — that an idle-CPU measurement structurally
   cannot satisfy.

2. **The check reports one statistic and decides on another.** `checkPerformanceContracts`
   renders `observed max` in its detail line while `decide()` acts on the mean. Hence the reading
   "observed max 0.0398 against budget 0.01" printed beside an outcome that is not a budget
   breach. Whatever is done about the noise gate, these two should be the same statistic, or the
   detail line should name which is which.

Deliberately NOT done here, because each manufactures a green gate rather than earning one:
dropping the CPU contract, raising the noise threshold, or demoting `pathSensitivity` below
`critical`. The remedy is a decision about what statistic an absolute idle budget is decided on —
plausibly the mean (or a high percentile) against the budget with no noise gate at all, since
`assertMethodologySound`'s sample-count floor is the methodology guard that actually applies to a
single-sided absolute measurement.

## Round 2 (2026-07-26): the five blockers, audited and rebuilt

Five parallel audits, an adversarially-reviewed design, and three waves of build-and-validate
(each work package developed, then independently re-verified by a validator that ran its own
mutation battery and refused to approve until it could not break the result).

**Two claims in this plan's own Outcome section were wrong**, and are corrected here:

- `:175-177` said of ARM64 that "the emitting step and the check are both in place". The emitting
  step was; **the ingesting step never existed**. Zero `download-artifact`, zero `gh run download`,
  zero `workflow_run` triggers repo-wide, and `arm64Verification.ts` read a path nothing wrote.
- The 11 PASS / 4 FAIL tally counted two items that were passing while asserting more than they
  verified.

**The finding that preceded all five**, and appeared in no blocker list: `.gitignore`'s `coverage/`
was unanchored, silently untracking the 15 source files in `packages/gates/src/coverage/`. A clean
`git archive` of HEAD failed `tsc -b` with 12 × `TS2307` while the same tree built locally. CI had
been red on every leg, which alone made `arm64-verification` unreachable — the record step is
guarded `if: success()` after `npm run build`. Fixed in `e431710`.

The reason `reproducible-build` never caught it is itself the §"Cross-cutting integration debt"
pattern one level up: its default populator copies the built `dist/` into both clean exports rather
than rebuilding per checkout, so it proved packer determinism and called it build determinism.

### Per-item disposition

| Item                                   | Before                                             | After                                                                                                |
| -------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `performance-contracts`                | `inconclusive_blocking` on a bootstrap noise bound | Both idle budgets PASS on merit; item FAILs on the separate 23:75 obligation                         |
| `reproducible-build`                   | PASS, 5 of 7 clauses unchecked                     | FAIL, all 7 checked, reasons quotable                                                                |
| `arm64-verification`                   | FAIL, ingest path absent                           | FAIL, ingest path built; needs a push and a green CI leg                                             |
| `requirement-traceability`             | FAIL, "environment-blocked"                        | FAIL with a real diagnostic taxonomy; writers + stamping + a genuine containerized binding now exist |
| `jira-grafana-version-support-windows` | FAIL, owner-deferred                               | Unchanged, still owner-deferred                                                                      |

Net **10 PASS / 5 FAIL**, down from 11 PASS. The drop is the gate becoming honest.

### On the traceability evidence source

`roadmap/23:56` forbids fakes and cassettes as phase 23's own final verdict basis while allowing
"live or containerized". The binding is therefore a **real Grafana OSS container**, reached through
the repo's established two-seam test pattern — `resolveHostAddresses` answering a TEST-NET-3
address that `ssrf-guard` does not block, with the dial pinned to loopback and TLS terminated
against a disposable self-signed CA supplied as `customCaRef`.

**No production guard was modified**: `ssrf-guard.ts` and `external-connection.ts` are byte-identical.
An earlier draft of the design claimed this work required "defeating the SSRF guard"; that was
wrong, and the adversarial review caught it before any code was written. The artifact states its own
provenance on its face so no reader can mistake it for a live-SaaS binding.

---

# Amendment — 2026-07-26: what the first CI-scored run showed, and the round that followed

The analysis above closed at **10 PASS / 5 FAIL**, scored locally. The `release-e2e` job then
ran for the first time with the shared journal wired end to end (run `30193901916`, generated
`2026-07-26T08:06Z` against exactly `d992b7f`, linking **160 EvidenceRecords**). It scored
**11 PASS / 4 FAIL**, and `arm64-verification` **passed** — closing the item this document
predicted would clear on the first `ubuntu-24.04-arm` leg after the work was pushed. The
figures above are therefore superseded, not wrong: they were accurate when taken, and the
missing input was a CI run rather than more code.

Auditing the four remaining failures against that run found the causes below. Each was
verified by execution, not inspection.

**`requirement-traceability` had three independent blockers, of which this document named
one.** The emitter-stamping gap was larger than "stamped at exactly one emission site"
conveyed: two harnesses accepted a `requirementId` **no caller ever passed**, and four had no
such field at all — six of eight emitters could not stamp. Measured against the real corpus,
**7 of 16 requirements linked; 15 of 16 after wiring**. Beyond that:

- The artifact had **no Gap-16 override**, alone among the records read that way, so
  "artifact is in the tree" and "artifact matches the candidate" were unsatisfiable together
  and the item was unclearable by construction. It now has
  `$EO_REQUIREMENT_TRACEABILITY_RECORD`, produced into `$RUNNER_TEMP` by `release-e2e.yml`.
- The check demanded a Jira/Grafana binding of **every** criterion, including ones with no
  remote counterpart at all. Owner-ratified narrowing to the criteria whose subject is a
  remote system; the scope is stated in the report rather than applied silently.
- `unlinkable_umbrella` — documented in `requirementLinkability.ts` as "structurally
  unlinkable BY DESIGN. Not a defect" — was raised as a **blocking reason** anyway, so the
  item could not have passed even with all 15 real requirements traced.

**`performance-contracts` was owed a producer, not a run.** This document recorded it as
clearing "when a real twin-worktree re-run writes `perf-contract-rerun.json`" and did not
note that **no code path in the repository could write one**. `perf-conformance.yml` runs
15's matrix every push and archives nothing. The producer now exists
(`e2e/attestation/src/perfContractRerun.ts`, `npm run probe:perf-contract-rerun`), invoking
the entry point `roadmap/15:112` names as "the exact entry point 23 re-runs", and measuring
host quiescence **across** the run rather than before it. Verified end to end: the item now
scores **PASS on merit** at `d992b7f`, with both idle budgets clean (66.16 MiB / 100 MiB;
0.000% / 1%).

> One design error worth recording, caught only by running the producer against the real
> consumer rather than against its own tests: the first version recorded one contract per
> seeded fixture, carrying each fixture's asserted outcome. `checkPerformanceContracts` reads
> `contracts[].outcome` as _the release candidate's_ verdicts, where `block` means a
> regression in what ships — while the fixtures' `block` is the **correct** decision on a
> planted fault. A fully green conformance run read at the gate as two blocked contracts. The
> record now carries one contract, `pass`, or no record at all.

**`jira-grafana-version-support-windows` was a true finding, and is now actioned.** Grafana
11.6 left vendor support 2026-06-25. Retired from the supported matrix, the provisioning
probe, `docs/vendor-support-policy.json` and the containerized binding (moved to 12.4) —
which is what roadmap/23:134 prescribes for a moved support window. Item now **PASSes on
merit**. `packages/connectors-grafana`'s 11.6 capability fixture is untouched: adapter
compatibility is roadmap/20's scope and roadmap/23's explicit §Out of scope.

**`reproducible-build` is unchanged and remains the owner's.** Four clauses — `CHANGELOG.md`,
the `v1.0.0` tag, the marketplace SHA pin, publication — are release actions, with
`packages/cli`'s `"private": true` as the deliberate latch.

**Still open, and not closed by this round:** every one of the **202** exit-criteria
checkboxes across the 24 roadmap phase files is unticked. Ticking them without per-criterion
evidence would be the aspirational bookkeeping `roadmap/README.md`'s own ground rule forbids,
so the ledger gap is recorded here rather than papered over.
