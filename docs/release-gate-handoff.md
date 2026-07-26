# Release-gate work — session handoff

**Rewritten 2026-07-26** against `d992b7f`, replacing the 2026-07-25 text wholesale. The
previous version's headline figures were stale in three ways at once (see "Corrections"
below), which is why this file is a rewrite rather than an edit.

**Status:** the audit below is evidence-backed; the code changes it describes are committed
on `main` and **await a `release-e2e` run to score them**.

This is session state, not a project document. Once its open items are actioned it can be
deleted. The durable analysis lives in `docs/release-gate-remediation-plan.md`.

---

## Where things stand

The authority is a **CI-generated** `release-gate-report.json`, not a local run.
`e2e/release-gate-report.json` is gitignored — regenerate it, never trust a stale copy.

**Last CI-scored state** — `release-e2e` run `30210413115`, generated against exactly
`e1824f7`, with real evidence linkage:

| Verdict | Count |
| ------- | ----- |
| PASS    | 14    |
| FAIL    | 1     |

The single remaining failure is `reproducible-build`, whose four unmet clauses are the
owner's release actions (see "What is left"). Every other checklist item passes on merit.

The starting point of this work was 11 PASS / 4 FAIL (run `30193901916`, at `d992b7f`) —
itself the first run in this repository's history to score the gate from CI with real
evidence linkage, and the one that first turned `arm64-verification` green.

### The four failures that run reported, and how each was resolved

| Item                                   | Root cause found                                                                                                                                                    | State now                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `requirement-traceability`             | Three independent blockers — an emitter-stamping gap, a structural catch-22, and an over-broad remote-binding rule. See below.                                      | **PASSES.** All three fixed and CI-scored.                                             |
| `performance-contracts`                | Both idle budgets passed on merit; the item failed only on 23:75's _second_ obligation, and **nothing in the repository could produce** `perf-contract-rerun.json`. | **PASSES.** Producer built; both idle budgets and the 23:75 re-run evidenced.          |
| `jira-grafana-version-support-windows` | One real finding: Grafana 11.6 left vendor support 2026-06-25, a month before the cut, while the matrix and docker recipe still committed to it.                    | **PASSES.** 11.6 retired, owner-ratified.                                              |
| `reproducible-build`                   | Four clauses unmet: no `CHANGELOG.md`, no `v1.0.0` tag, marketplace `commit` is 40 zeros, package unpublished.                                                      | **Unchanged, by design** — these are the owner's release actions (see "What is left"). |

---

## What was actually wrong, in detail

### `requirement-traceability` — three blockers, not one

**1. The emitter-stamping gap (the big one).** `buildTraceabilityView` (`@eo/gates`) joins
evidence to a requirement on `EvidenceRecord.requirementId` **alone**. Of the eight
harnesses feeding the shared release journal, only `e2e/attestation` stamped it.
`e2e/matrix/orchestration` and `e2e/matrix/connector` accepted an optional `requirementId`
that **no caller ever passed**; `e2e/matrix/git`, `e2e/matrix/installation`, `e2e/live` and
`e2e/release` had no such field at all. Every one of those records was genuine, correctly
tagged, journaled at the right object ID — and invisible to traceability.

Measured against the real corpus: **7 of 16 requirements linked before, 15 of 16 after**.
The sixteenth is roadmap/23's umbrella bullet, which is structurally unlinkable by design.

Each emitter now declares a `REQUIREMENT_ID_BY_GATE_TAG` literal and stamps it by default,
so **no call site changed**. `e2e/attestation/src/requirementStamping.test.ts` reads all six
sources and fails if any literal drifts from `requirementIdForGateTag(corpus, tag)`.

**2. The structural catch-22.** The traceability artifact names the object ID it was
captured against, and the check requires that to equal the candidate being scored — but
committing a regenerated artifact _advances `HEAD` past the ID the new artifact names_. The
two conditions could never hold at once. Gap 16 solves exactly this for the ARM64 and perf
records; this was the one Gap-16-shaped input **with no override**. It now has
`$EO_REQUIREMENT_TRACEABILITY_RECORD`, and `release-e2e.yml` runs the containerized binding
into `$RUNNER_TEMP` and exports it — producer now writes where consumer reads.

**3. The remote-binding rule was over-broad.** The check demanded _every_ one of the 16
criteria bind to a Jira/Grafana resource with a confirmed revision — including "two
independent from-clean-checkout builds produce byte-identical tarball hashes", which has no
remote counterpart. Owner-ratified narrowing: the demand is now scoped to the criteria whose
**subject** is a remote system (`REMOTE_SUBJECT_CRITERIA`), and the check states that scope
on its face. The object-ID half still applies to every requirement without exception.

**A fourth, found while fixing the third.** `requirementLinkability.ts` documents
`unlinkable_umbrella` as "structurally unlinkable BY DESIGN. Not a defect" — and the check
raised it as a **blocking reason anyway**, so the item could not have passed even with all
15 real requirements perfectly traced. The umbrella is now a stated detail, not a blocker.
Every other unlinkable status still blocks.

### `performance-contracts` — the producer never existed

`performanceContracts.ts` has read `perf-contract-rerun.json` since it was written, and
**nothing in this repository ever wrote one**. `perf-conformance.yml` runs 15's matrix on
every push but archives no record, so the item failed for want of an artifact no code path
could produce — the ARM64 consumer-without-producer shape, inverted.

`e2e/attestation/src/perfContractRerun.ts` + its CLI now produce it, re-invoking the entry
point `roadmap/15:112` names by hand ("`perf-conformance` … **the exact entry point 23
re-runs**"), on a host whose quiescence is measured **across the run** rather than sampled
before it. Wired into `release-e2e.yml` and exposed as `npm run probe:perf-contract-rerun`.

> **A category error caught only by running it against the real consumer.** The first
> version recorded one contract per seeded fixture, carrying each fixture's own asserted
> outcome — `block` for the 20%-regression fixture, `inconclusive_blocking` for the noisy
> one. `checkPerformanceContracts` reads `contracts[].outcome` as _the release candidate's_
> verdicts, where `block` means "a regression was found in what we ship". The fixtures'
> `block` is the **correct** decision on a deliberately planted fault. A fully green
> conformance run therefore read at the gate as two blocked contracts. The record now
> carries **one** contract — "15's engine decided every seeded fixture correctly at this
> object ID" — which is `pass`, or there is no record at all.

### `jira-grafana-version-support-windows` — one true finding

Grafana supports each minor for 9 months; 11.6.x left support **2026-06-25**. Retired from
`REQUIRED_SUPPORT_WINDOW_TARGETS`, the provisioning probe targets, the compatibility matrix,
`docs/vendor-support-policy.json`, and the containerized traceability binding (moved to
12.4, pinned to the exact tag its compose file pins). roadmap/23:134 — "fixtures refreshed
if vendor support windows moved" — prescribes precisely this; weakening the check would have
manufactured a green gate over a true finding.

**Not touched:** `packages/connectors-grafana`'s 11.6 capability-discovery fixture. Which
builds the _adapter_ understands is roadmap/20's scope and sits under roadmap/23's own §Out
of scope. `docker/grafana/11.6/` is retained but unreferenced, so existing smoke-test
evidence stays reproducible.

---

## What is left

**Owner release actions** (`reproducible-build`, four clauses). These are deliberately not
automated — roadmap/23's PREPARE-DON'T-PUBLISH decision, and `packages/cli` is
`"private": true` as a belt-and-braces latch that `npm publish` itself refuses:

1. `CHANGELOG.md` via changesets.
2. `v1.0.0` tag.
3. Marketplace entry re-pinned at the release commit (`commit` is currently 40 zeros).
4. Flip `private`, publish with provenance, then the `npm view` re-check.

**Nothing else.** Run `30210413115` scored 14 PASS / 1 FAIL at `e1824f7`; no code is owed.

**Note for the release cut:** the two Gap-16 producers run inside `release-e2e.yml` and
need nothing from an operator on an ordinary dispatch. The perf re-run does sample ambient
host load first and refuses on a busy runner — an honest refusal, reported as "the 23:75
obligation is unevidenced" rather than papered over. If a shared runner is ever too busy,
produce the record on a quiet host (`npm run probe:perf-contract-rerun`) and supply it via
`$EO_PERF_CONTRACT_RERUN_RECORD`, which is exactly what that override is for.

**The roadmap completion ledger — an open gap this session did not close.** Every one of the
**202** exit-criteria checkboxes across all 24 phase files is unticked, though phases 00–07
and others are substantially complete. `CLAUDE.md` makes the roadmap the governing document,
so it currently claims nothing is done. Deliberately **not** mass-ticked here: the ground
rule is "exit criteria are evidence, not claims", and ticking 202 boxes without
per-criterion evidence would be exactly the aspirational bookkeeping the rule forbids. The
honest path is to tick each phase's criteria against its own recorded evidence, phase by
phase — starting with 23, whose 15 scored items already have CI-linked `EvidenceRecord`s.

---

## How to run things

```bash
# Regenerate the gate report end to end (the authoritative check).
S=$(mktemp -d)
export EO_RELEASE_GATE_JOURNAL_DIR="$S/journal"
export EO_RELEASE_CANDIDATE_OBJECT_ID="$(git rev-parse HEAD)"
npm run test:e2e:release-evidence          # all 8 e2e projects, sequentially
node e2e/report/dist/cli.js                # writes e2e/release-gate-report.json

# The two Gap-16 producers (both also wired into release-e2e.yml)
npm run probe:perf-contract-rerun          # writes perf-contract-rerun.json
npx vitest run --config e2e/attestation/vitest.live.config.ts   # needs Docker

# Re-probe vendor support windows (needs network)
npm run probe:support-windows

# Gates
npm run check:e2e-types && npx eslint e2e && npx prettier --check "e2e/**/*.ts"
```

**A developer host without Docker cannot run the full chain**: `e2e/provisioning` stops at
the compose-validation tests, and `&&` ends the chain there. That is a host limitation, not
a failure — CI has Docker, and those two tests pass there.

---

## Gotchas found the hard way

Non-obvious things that cost real time. Worth knowing before touching this area again.

**`requirementId` is the traceability join key, and only that.** `buildTraceabilityView`
matches on it alone. Correct `gateTag`, correct `objectId`, schema-valid record — all
irrelevant if the field is absent. Emitting evidence that cannot link is indistinguishable,
at the gate, from emitting none.

**The release-gate report projects a SUBSET of each `EvidenceRecord`.** `linkedEvidence`
entries carry `evidenceRecordId`/`objectId`/`artifactDigests`/`gateTag`/`exitStatus` — and
**not** `requirementId`. Measuring stamping coverage from the report will therefore show
zero every time, whatever the journal actually contains. Read the journal segments.

**Evidence linking** needs BOTH a matching `gateTag` AND `objectId ===`
`releaseCandidateObjectId`.

**A shared gate tag can only carry one requirement.** `requirementIdForGateTag` returns the
first corpus match, so `git-matrix`, `connector-matrix` and `installation-matrix` — each
listed under two criteria — each credit exactly one, and the others link through a tag of
their own. That the assignment comes out one-to-one is a property worth re-checking if the
corpus order changes.

**Perf measurement.**

- `trySampleProcess` from `@eo/perf` is **async**; not awaiting it yields a Promise whose
  `.stat` is `undefined`.
- `probeQuietHost()` returns a **sampler**, not an assessment — call `finish()` to close the
  interval. It judges the whole span, which is the right question for "on a quiet host".
- The daemon's control socket path must stay under the **108-byte `sun_path` limit**.
- Sample **`VmRSS`**, not `VmHWM` — the high-water mark carries the startup peak into every
  "idle" sample.
- Exclude startup: a window opened at spawn measures module loading, and reported **123% of
  a core** against a 1% budget on the first run.
- `decide()` enforces `MIN_INTERLEAVED_REPETITIONS = 10` per side.

**Test wiring.**

- `e2e/provisioning`'s vitest config includes **`test/**` only**, not `src/**`. A test placed
  in `src/` silently never runs.
- `npm run test:e2e:release-evidence` exports `EO_RELEASE_CANDIDATE_OBJECT_ID` for the whole
  chain, so any test asserting a scenario-local `objectId` must save/delete/restore it.
- **Assert workflow invariants, not headcounts.** `releaseWorkflowWiring.test.ts` pinned
  "exactly 2" consumers of the resolved object ID and went red when two _correct_ consumers
  were added. The property that matters is that no consumer resolves the candidate
  independently.

**API shapes that differ from the obvious guess.**

- `lint(candidate, kind, policy)` — three positional args; `LintOutcome` is a discriminated
  union.
- `nameBranch` is **async** and returns `{status: "named", …}` | `{status: "blocked", …}`.
- `createGitPlumbing()` takes options, not a spawn function.
- Node's `child_process` rejects any argv entry containing `NUL`, so `git log -z` cannot be
  expressed through `execFile`.

**Running TypeScript outside vitest.** The `e2e/*` projects are typechecked `--noEmit` and
executed by vitest, so nothing in them is compiled to `dist/`. A standalone CLI under `e2e/`
needs `tsx`: Node 24's native type stripping does not remap a `./foo.js` specifier onto
`foo.ts`, and every import here is `.js`-extended for `verbatimModuleSyntax`.

**Each `e2e/*` harness is a self-contained TS project** (`rootDir: "."`), so one cannot
import another's module. The established idiom for binding two of them together is to read
the sibling's **source text** and assert against an exported constant — see
`requirementStamping.test.ts` and `releaseWorkflowWiring.test.ts`.

---

## Design notes worth carrying forward

- **Verdicts are data, not test outcomes.** The emitter suites assert that evidence was
  emitted _correctly_ (right tag, right object ID, schema-valid, exit status faithful to the
  verdict) and never assert the verdict itself. If they went red on a FAIL, the
  release-evidence run would abort and the report would be generated from a partial journal
  — failing items would revert to "no evidence" instead of "checked, here is what is wrong".
- **`emitAttestationEvidence` derives `exitStatus` from the verdict** and does not accept it
  as a parameter, so a caller cannot journal a green record for a failing check.
- **Gap-16 producers never fail the release job.** A missing ARM64 record, an unproduced
  perf re-run, an unbound traceability artifact — each is the honest input "this is not
  evidenced for this candidate", which the gate reports with reasons. A job that dies there
  takes every _other_ item's evidence down with it.
- The vendor support-window design splits **mechanical** facts (is the tag published? —
  probed live) from **attested** ones (when does support end? — human-recorded with a cited
  source), because Atlassian and Grafana publish EOL dates as prose.

---

## Corrections — claims in the 2026-07-25 text that were false

Recorded because each was believed and acted on.

**"The gate is at 10 PASS / 5 FAIL."** It was 11/4 at `d992b7f`, from CI.

**"Committed on `main`, not pushed."** Everything was pushed; `origin/main` was level with
`HEAD`.

**"`arm64-verification`: turns green on the first `ubuntu-24.04-arm` leg after this work is
pushed; CI has never run it."** It had run, and it passed.

**"Traceability: the writers, the stamping and a genuine containerized binding now exist.
Remaining work is per-requirement evidence emission."** The stamping existed at one harness
of eight, and "per-requirement evidence emission" understated it: six emitters could not
stamp at all, and two of the three blockers were structural rather than a matter of emitting
more.

**`performance-contracts` "clears when a real twin-worktree re-run writes
`docs/evidence/phase-23/perf-contract-rerun.json`".** True, and it omitted that no producer
existed anywhere in the repository, which is why it had not cleared.
