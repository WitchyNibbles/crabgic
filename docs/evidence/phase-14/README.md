# Phase 14 — Quality & security verification gates: evidence

Governing spec: `roadmap/14-quality-security-gates.md`. This note maps each exit
criterion to its test/artifact, records deviations from the source material, and
lists carry-forwards for reconcile. Format follows `docs/evidence/phase-13/README.md`.

## Summary

- Files: 43 new source/test files under `packages/gates/src/`, one new CI workflow
  (`.github/workflows/gates-conformance.yml`), this evidence doc, plus edits to
  `packages/gates/package.json`/`tsconfig.json` (dependencies/references) and
  `package-lock.json` (synced, no new third-party packages).
- Tests: **29 test files, 124 tests, all passing** (post-repair-pass; 113 before it —
  11 new regression tests from the adversarial-validation round below).
- Coverage (this phase's own new code, `packages/gates/src/**/*.ts` excluding
  `*.test.ts`/`test-support/**`): **94.1% statements, 86.44% branches, 100%
  functions, 97.83% lines** — clears the ≥80% line+branch ground rule
  comfortably.
- `npx tsc -b` (whole monorepo): clean.
- `npm run lint` (whole monorepo, ESLint): clean.
- `npm run format` (whole monorepo, `prettier --check .`): clean.
- Whole-repo suite (`npx vitest run`, all 18 packages): **467 test files, 3820
  tests, all passing** — `packages/detect` (12) and `packages/scheduler` (13)
  untouched by this pass (`git status` confirms zero diff in either), both
  still fully green (59 test files, 356 tests).

## Adversarial-validation repair pass (2026-07-24)

A fresh adversarial validator gave phase 14 PASS-WITH-MINORS — all 8 exit criteria
verified non-vacuous, blast radius clean, no schema edits, deviations sound — but
flagged 5 genuine fail-open/scoping gaps unacceptable in a phase whose entire purpose
is fail-closed enforcement. All 5 were fixed strict-TDD (a RED regression test written
and confirmed failing against the pre-fix code FIRST, then fixed to GREEN), without
touching any file outside `packages/gates/` and this evidence doc. Summary, most
severe first:

- **MINOR-1 (`fireFinalCandidateVerification` failed OPEN on an empty registry) —
  FIXED.** `final-candidate.ts` called `registry.fireAll(context)` WITHOUT
  `requireAtLeastOne: true`; with zero registered gates, `fireAll` returned `[]`, and
  `allGatesPassed([])` is vacuously `true` (`[].every(...)`) — the final integrated
  candidate would "pass" having verified NOTHING. RED regression
  (`final-candidate.test.ts`, "an EMPTY registry must fail CLOSED...") confirmed the
  promise resolved to `[]` instead of rejecting against the pre-fix code. Fixed by
  passing `{ requireAtLeastOne: true }`, so a genuinely empty/mis-wired registry now
  throws `NoGatesRegisteredError` instead.

- **MINOR-2 (greenfield 80% floor was poisonable) — FIXED.** `coverage-gate.ts`
  applied the absolute 80% check ONLY when `floorBefore === undefined`, but
  `recordCoverageObservation` appends the observation UNCONDITIONALLY (even a failing
  one) — so after ONE failing greenfield run (e.g. 50%), the raw floor became 50, and
  every subsequent run in the 50–79% band passed forever (never a regression relative
  to its own newly-lowered floor, and the `floorBefore === undefined` branch never
  fired again). RED regression (`coverage-gate.test.ts`, "a project that fails
  greenfield once must NOT then be able to pass in the 50-79% band indefinitely")
  reproduced exactly this: 50% correctly failed, then 60% wrongly passed against the
  pre-fix code. Fixed: the enforcement floor is now `max(rawRatchetFloor, 80)` on BOTH
  axes, computed on EVERY firing, not merely "when no floor exists yet" — a project
  must reach ≥80% at least once before ordinary ratchet behavior takes over unassisted
  (at which point the clamp is a no-op, since the raw floor is already ≥80). A third
  run at 85%/85% in the same test proves ratchet behavior resumes correctly once the
  minimum is genuinely met.
  **Named carry-forward (explicitly recorded per the validator's instruction):** the
  roadmap's own In-scope clause "changed instrumentable code reaches 80%" (diff/
  changed-line coverage, as distinct from AGGREGATE line/branch coverage) is
  UNIMPLEMENTED in this build. No adapter or gate in `packages/gates` computes a
  per-diff coverage delta; `createCoverageGate` enforces aggregate `linePct`/
  `branchPct` only. This is an explicitly-deferred gap, not a silent omission — see
  "Carry-forwards for reconcile" below.

- **MINOR-3 (coverage ratchet had no project scoping) — FIXED.**
  `coverage/ratchet-store.ts` read ALL `adjudication_decision` entries carrying the
  ratchet decision string with no `projectId` filter, despite the spec/interface
  saying "persists the monotonic coverage floor PER PROJECT" — two projects sharing
  one journal would cross-contaminate: a brand-new project B's genuinely-first, low
  observation would misread project A's unrelated high floor as its own. RED
  regression (`ratchet-store.test.ts`, "two projects sharing one journal must NOT
  contaminate each other's ratchet floor") confirmed `floorBefore` was wrongly defined
  (90, from an unrelated project) for project B's first-ever observation against the
  pre-fix code. Fixed: every `RatchetObservation` now carries a required `projectId`;
  `getCoverageRatchetFloor`/`recordCoverageObservation` both take `projectId` and
  filter reads by it. `CoverageGateInput` gained a required `projectId` field
  (documented: use `ProjectProfile.id`, `@eo/contracts`, when available; any other
  stable caller-supplied identifier is otherwise accepted — this gate has no
  `ProjectProfile` dependency of its own). Proven by a dedicated unit isolation test,
  a gate-level isolation test (`coverage-gate.test.ts`), and a NEW fast-check property
  (`ratchet.property.test.ts`, "two projects' interleaved histories on the SAME
  journal never contaminate each other's final floor" — 25 randomized cases over
  interleaved dual-project histories).

- **NIT-1 (security parser exceptions propagated instead of failing closed) — FIXED.**
  Only `resolveDigestPinnedTool` was wrapped in try/catch in `security-gate.ts`;
  `parseSemgrepReport`/`parseGitleaksReport`/`parseOsvScannerReport` ran OUTSIDE it —
  a report carrying an unexpected shape (e.g. a severity string outside semgrep's own
  `z.enum(["ERROR","WARNING","INFO"])`) threw a `ZodError` straight out of the async
  `GateHandler`, REJECTING the firing rather than blocking it. RED regression
  (`security-gate.test.ts`, 3 tests — one per adapter) confirmed each of
  semgrep/gitleaks/osv-scanner's malformed-report case threw uncaught against the
  pre-fix code. Fixed: a new `verdictFromParseAttempt` wrapper is now the SOLE call
  site for all three parsers — any parser exception is caught and converted into a
  blocking (`passed: false`) verdict with a `"report parsing failed — failing CLOSED"`
  detail, never a thrown/rejected firing.

- **NIT-2 (TDD gate didn't enforce red-before-green ordering) — FIXED.**
  `tdd-gate.ts`'s `createTddGate` called `hasRedBaseline` WITHOUT the `beforeSeq`
  cutoff the helper already supported, so it never verified a red baseline PRECEDED
  the candidate under verification — worse, since a genuine `captureRedBaseline` call
  and this SAME gate's own prior FAILING verdict (also journaled with `gateTag: "tdd"`
  and a nonzero `exitStatus` whenever no baseline was found) are structurally
  indistinguishable in the journal, a gate that fired once (failing, no real baseline
  ever captured) and fired AGAIN later reporting green would incorrectly treat its OWN
  earlier failing verdict as a legitimate red baseline. RED regression
  (`tdd-gate.test.ts`, "the gate's OWN prior failing verdict must NOT retroactively
  satisfy its own red-baseline precondition...") reproduced this with ZERO
  `captureRedBaseline` calls at all — firing #2 wrongly passed against the pre-fix
  code. Fixed: `TddGateInput` gained a required `beforeSeq: number` (the candidate's
  own dispatch-boundary seq — e.g. the `work_unit_transition: dispatched` entry 13's
  executor journals immediately before consuming any events); `createTddGate` now
  calls `hasRedBaseline(journal, requirementId, beforeSeq)`. A companion positive test
  ("a red baseline captured strictly BEFORE the supplied dispatch boundary DOES
  satisfy a later green firing...") proves legitimate red-then-green pairs still pass.

## Exit criterion → evidence mapping

- [x] **`gates-conformance` CI job blocks correctly on all seven seeded fixtures
  independently: coverage regression, flaky-then-passing test, planted secret,
  vulnerable dependency, SAST finding, disabled-check diff, missing green
  `engine-live` record.**
  `packages/gates/src/gates-conformance.test.ts` — 7 independent `it()` blocks,
  each with its own fresh journal/capability-store/registry so no fixture's
  pass/fail masks another's:
  1. coverage: a recorded 82% floor followed by a 79% run blocks.
  2. flake: a rerun-then-pass result on an unquarantined test is marked
     `unstable` and blocks.
  3. gitleaks: a planted AWS-shaped test key (`AKIA...`) blocks.
  4. osv-scanner: a known-CVE test double (`CVE-2024-22222`, CRITICAL) blocks.
  5. semgrep: an `ERROR`-severity SQL-injection-shaped finding blocks.
  6. root-cause detector: a commented-out `assert(...)` in a diff, configured
     `blocking: true`, blocks.
  7. engine-conformance: a never-tested engine version with no journaled green
     `engine-live` record fails closed.
  Wired as its own named CI job in `.github/workflows/gates-conformance.yml`
  (push/PR-triggered, no secrets/live host needed — entirely fixture-based).

- [x] **Coverage ratchet floor is monotonic non-decreasing across a simulated
  multi-`ChangeSet` history (fast-check property report, CI-archived).**
  `packages/gates/src/coverage/ratchet.property.test.ts` — two properties,
  100/30 randomized cases respectively:
  - "final floor is order-independent (componentwise max of the whole
    history)" — replays the SAME observation sequence forward, reversed, and
    shuffled against three independent fresh journals; asserts all three
    yield the identical final floor (`Math.max` of every `linePct`/`branchPct`
    ever observed).
  - "the floor never decreases across a monotonically-applied random
    sequence" — asserts, incrementally after every single observation, that
    `floorAfter >= priorFloor` on both axes.
  Deterministic (non-property) regression fixture:
  `packages/gates/src/coverage/ratchet-store.test.ts` — "a recorded floor of
  82% followed by a new run of 79% blocks (regressed=true) and the floor does
  not drop"; also `packages/gates/src/coverage-gate.test.ts`'s identical
  scenario wired through the registered gate handler.

- [x] **`Requirement → EvidenceRecord → exact object ID` resolves in both
  directions for a fixture `ChangeSet` (named integration test).**
  `packages/gates/src/requirement-resolution.test.ts` — fires a gate against a
  fixture `Requirement` + object id, then proves FORWARD (the `Requirement`'s
  `evidenceRecordIds` names the `EvidenceRecord`, whose `.objectId` is the
  exact object under test) and REVERSE (`findEvidenceForRequirement`, given
  only the `requirementId`, recovers the same `EvidenceRecord` — and hence the
  same object id — via a journal scan alone, no `Requirement` record needed).

- [x] **A rerun-until-pass result is marked `unstable`; an explicit quarantine
  suppresses blocking until its recorded expiry, after which it reverts to
  blocking (flake-registry expiry test).**
  `packages/gates/src/flake-gate.test.ts` — 6 tests: clean first-pass (not
  unstable); rerun-then-pass unstable+blocking when unquarantined;
  rerun-then-pass unstable+ALLOWED when an active quarantine exists; an
  EXPIRED quarantine reverts to blocking even for a rerun-then-pass result;
  genuine failure (fail, fail-again) blocks and is NOT marked unstable; a
  bare failure with no rerun evidence blocks.
  `packages/gates/src/flake/quarantine-registry.test.ts` — the registry
  primitive directly: never-quarantined, active, expired (reverts), and
  "returns the LATEST entry when quarantined more than once."

- [x] **TDD gate rejects a fixture attempt lacking a red-before-green
  `EvidenceRecord` pair for the same `Requirement`.**
  `packages/gates/src/tdd-gate.test.ts` — 8 tests: fails closed with no red
  baseline ever captured; passes once a red baseline was journaled first and
  the candidate is green; reports "still failing" (not passed) when a red
  baseline exists but the candidate hasn't gone green; `captureRedBaseline`
  refuses a "red" baseline that already passes (`RedBaselineNotFailingError`);
  `workUnitId` carries through to the journal entry; `hasRedBaseline`
  respects a `beforeSeq` cutoff; a red baseline recorded for a DIFFERENT
  requirement does not satisfy this requirement's gate.

- [x] **A stub external gate registers into the registry and fires at
  `final_verifying` with zero code change inside `packages/gates` (registry-
  extensibility conformance test).**
  `packages/gates/src/registry.test.ts` → "external extensibility — work item
  6 / registry-extensibility conformance test": a locally-defined
  `registerExternalGate` function (simulating 15/21) calls the SAME public
  `register()` API used everywhere else in this package, under the
  `performance` tag (15's own tag, which this package's own gates never
  populate), and fires successfully via both `fireByTag` and `fireAll` at
  `final_verifying` — zero lines inside `registry.ts`/any other module needed
  touching.

- [x] **Every emitted `EvidenceRecord` round-trips as a
  `JournalEntryType.evidence_pointer` entry through 02's discriminated-union
  exhaustiveness check.**
  `packages/gates/src/conformance.test.ts` — a `Record<JournalEntryType,
  boolean>` exhaustiveness literal (the identical `npx tsc -b`-enforced
  mechanism `@eo/contracts`'s own `JOURNAL_ENTRY_TYPE_DESCRIPTIONS` and
  `@eo/scheduler`'s `conformance.test.ts` both use — a missing/stray key fails
  the build), naming this package's own 2 actually-used members
  (`evidence_pointer`, `adjudication_decision`); plus a direct round-trip
  test: fires a gate, reads the journal back, `EvidenceRecordSchema.parse`s
  the journaled payload, and asserts it is structurally identical to what
  `fireByTag` returned.

- [x] **Final-candidate re-verification fires against the truly-integrated
  object ID rather than trusting a cached per-work-unit result (integration
  test with a deliberately stale per-work-unit pass).**
  `packages/gates/src/final-candidate.test.ts` — a stateful gate handler
  passes ONLY for a designated "stale per-work-unit" object id; a
  `verifying`-stage firing against that stale id legitimately passes and is
  journaled; `fireFinalCandidateVerification` is then called against a
  DIFFERENT ("truly-integrated, regressed") object id and correctly reports
  overall failure — proving no code path reuses/trusts the earlier passing
  `EvidenceRecord` (the stale passing record is asserted to still exist,
  untouched, in the journal — the failure comes from a genuine re-fire, not
  from erasing history). `packages/gates/src/final-candidate.e2e.test.ts`
  wraps the identical scenario through `@eo/scheduler`'s real
  `dispatchAttempt` + `FakeEngineAdapter`, proving the "dispatched as its own
  `TaskPacket` through 13's executor" half of work item 6.

- [x] **`engine-conformance` gate fails closed on the missing-green-record
  fixture, and a matching green `engine-live` record's run ID round-trips
  into the fixture `ChangeSet`'s `EvidenceRecord` — named test
  `engine-conformance-binding.test`, run in the `gates-conformance` CI job.**
  `packages/gates/src/engine-conformance-binding.test.ts` (exact file name per
  the exit criterion) — 4 tests: fails the gate with no green record for the
  attempt's engine version; a matching fixture green record's `runId`/
  `suiteDigest` round-trip into the FIRED gate's own emitted `EvidenceRecord`
  (`artifactDigests` contains `engine-live-run-id:<runId>` and
  `engine-live-suite-digest:<digest>`); a green record for a DIFFERENT engine
  version does not satisfy the gate; a non-green (`exitStatus != 0`) record
  never satisfies the lookup. Wired into `.github/workflows/gates-
  conformance.yml` as its own named step.

## Work items → files

1. **Gate framework core** — `types.ts` (`GateContext`/`GateVerdict`/
   `GateHandler`), `risk-tags.ts` (13-tag vocabulary: 9 `IntentContract`
   sections + `tdd`/`coverage`/`flake`/`engine-conformance`), `evidence.ts`
   (`emitEvidence`/`findEvidenceForRequirement`), `registry.ts`
   (`createGateRegistry`: register/list/fireByTag/fireAll), `errors.ts`.
   Tests: `risk-tags.test.ts`, `evidence.test.ts`, `registry.test.ts`,
   `registry.property.test.ts` (order-independence, 100 fast-check cases).
2. **TDD-evidence gate** — `tdd-gate.ts` (`captureRedBaseline`,
   `hasRedBaseline`, `createTddGate`) + `tdd-gate.test.ts`.
3. **Coverage** — `coverage/{types,lcov-adapter,istanbul-adapter,go-cover-
   adapter,pytest-cov-adapter,adapter-selection,ratchet-store}.ts` (+ their
   `.test.ts`/`ratchet.property.test.ts`), `coverage-gate.ts` +
   `coverage-gate.test.ts`.
4. **Security** — `security/{types,tool-resolution,semgrep-adapter,gitleaks-
   adapter,osv-scanner-adapter,root-cause-detector,category-selection}.ts`
   (+ tests), `security-gate.ts` + `security-gate.test.ts`.
5. **Flake** — `flake/quarantine-registry.ts` + test, `flake-gate.ts` +
   `flake-gate.test.ts`.
6. **Final-candidate orchestration** — `final-candidate.ts`
   (`fireFinalCandidateVerification`, `allGatesPassed`) + `final-
   candidate.test.ts` + `final-candidate.e2e.test.ts` (real `@eo/scheduler`
   `dispatchAttempt` + `FakeEngineAdapter`), `test-support/minimal-compiled-
   profile.ts` (test-support only, mirrors sibling packages' identical file).
7. **`engine-conformance` binding gate** — `engine-conformance-gate.ts`
   (`findGreenEngineLiveRecord`, `createEngineConformanceGate`) + the named
   `engine-conformance-binding.test.ts`.

Cross-cutting: `conformance.test.ts` (JournalEntryType exhaustiveness +
EvidenceRecord round-trip), `requirement-resolution.test.ts` (bidirectional
resolution, named integration test), `gates-conformance.test.ts` (the 7-fixture
seeded-fault matrix), `test-support/test-journal.ts` (test-support only),
`index.ts` (public barrel).

## What is fixture-modeled vs live

Per the task brief's explicit instruction, honesty about fixture-vs-live is
required (matching phases 19/20's "cassette-modeled-not-live" disclosure
precedent):

- **`engine-conformance` gate**: entirely fixture-modeled. This package never
  spawns a live Claude Code engine and never imports `@eo/engine-claude`. It
  reads the journal for an `evidence_pointer` entry matching the EXACT shape
  06's `packages/engine-claude/src/live/live-harness.ts`'s
  `writeLiveRunRecord` produces (verified by reading that file directly:
  `command: "engine-claude:@live conformance suite"`, `exitStatus: 0`,
  `toolchainFingerprint` ending `"engine <version>"`, an `artifactDigests`
  entry shaped `"live-run-record.json#suiteDigest=<digest>"`, `objectId` =
  the live run's `runId`). All test fixtures journal this shape directly via
  `journal.appendEntry` — no real `@live` suite ever runs as part of this
  phase's tests or CI job.
- **Security-scanner binaries (semgrep/gitleaks/osv-scanner)**: modeled as
  PARSERS over fixture tool-output (hand-authored JSON/array literals shaped
  like each real tool's actual report format), plus the digest-pin
  resolution/fail-closed logic against a REAL `@eo/detect` `CapabilityStore`
  (a real, temp-directory-backed store — not mocked — exercising the actual
  `findLatestByName`/digest-comparison code path). No `semgrep`/`gitleaks`/
  `osv-scanner` binary is ever invoked.
- **Root-cause policy detector**: fully live/real — pure TypeScript regex
  logic over diff text, no external tool.
- **Coverage adapters**: fully live/real parsers — they parse real-shaped
  LCOV/istanbul-JSON/go-cover-profile/coverage.py-JSON text against hand-
  built fixture strings, but no actual `npm test -- --coverage`/`go test
  -cover`/`pytest --cov` process is invoked by this phase's tests (the raw
  tool INVOCATION is 13's TaskPacket-dispatch concern; this phase parses
  whatever output that invocation produces).
- **Coverage ratchet + flake quarantine**: fully live/real — real `@eo/journal`
  `JournalStore` instances over temp directories, real append/query.
- **Final-candidate `TaskPacket` dispatch**: real `@eo/scheduler`
  `dispatchAttempt` call, against `@eo/testkit`'s `FakeEngineAdapter` (not a
  live engine) — the same "fake engine" idiom every other phase's E2E suite
  (03/06/13) already uses for exactly this purpose.

## Deviations (documented scope decisions)

1. **Risk-tag count: 9 `IntentContract` sections, not 11.** This worker's own
   task brief describes the vocabulary as "IntentContract's 11 section
   names"; the actual, shipped `@eo/contracts` schema
   (`packages/contracts/src/contracts/intent-contract.ts`) has exactly 9
   (`scope, non-goals, audience, compatibility, security, performance,
   observability, rollout, acceptance`) — and that file's own doc comment
   already states it is "reconfirmed by roadmap/14 ... which keys its
   risk-tag vocabulary off this exact list." `risk-tags.ts` follows the
   authoritative schema (9 + 4 defaults = 13 total tags), not the miscounted
   prose, and documents the discrepancy inline. This mirrors the exact class
   of error interface-ledger Gap 5 rejected ("one resolver's proposed list
   contained 14 distinct tokens while claiming '13 members'") — i.e. trusting
   the shipped source of truth over a prose count.
2. **`engine-conformance`'s command-string match is a documented magic-string
   coupling, not a shared exported constant.** `06`'s `live-harness.ts`
   hardcodes `"engine-claude:@live conformance suite"` as a literal inline
   (not exported); this phase must NOT edit `packages/engine-claude` (out of
   scope), so `engine-conformance-gate.ts` re-declares the identical literal
   locally, with an explicit doc-comment citation of the exact source file/
   line it must stay byte-identical to. **Carry-forward**: a future
   coordinated reconcile pass could promote this to a shared exported
   constant (e.g. from `@eo/contracts`, alongside `GATEWAY_MCP_SERVER_NAME`'s
   own precedent) so the two packages can never silently drift.
3. **No dedicated `JournalEntryType` member for coverage-ratchet or flake-
   quarantine state — both reuse `adjudication_decision`'s generic payload.**
   Identical, explicitly-cited precedent to `@eo/scheduler`'s `parking.ts`/
   `shadow-run.ts`/`attempt-policy.ts` (interface-ledger Gap 5: the union is
   closed at exactly 13; a 14th member requires a new coordinated resolution
   round, never a unilateral addition by this phase). Guarded, zod-validated
   `JSON.parse` throughout (never trusts file content), mirroring those same
   modules' own MINOR-4-class fix.
4. **Go-cover's `branchPct` mirrors its `linePct` (statement coverage).**
   `go tool cover`'s standard profile format has no branch-decision record
   the way LCOV's `BRDA:` or istanbul's `branches` metric carry — there is no
   distinct branch-level datum in this format to compute a separate value
   from. Documented in `coverage/go-cover-adapter.ts`'s own doc comment.
5. **`final-candidate.ts` has no dependency on `@eo/scheduler`.** It is the
   pure gate re-fire primitive (`fireFinalCandidateVerification`/
   `allGatesPassed`); the "dispatched as its own `TaskPacket` through 13's
   executor" wiring is proven in a SEPARATE E2E test
   (`final-candidate.e2e.test.ts`) that itself depends on `@eo/scheduler`,
   rather than baking a scheduler dependency into the primitive itself —
   avoids inverting the 13→14 dependency direction the roadmap's own
   dependency graph establishes.
6. **Security-adapter severity mappings are this phase's own minimal-
   sufficient choices** (semgrep `ERROR→critical/WARNING→medium/INFO→low`;
   gitleaks always `critical`; osv-scanner passes through OSV's own
   `database_specific.severity` band, mapping `MODERATE→medium` and any
   unrecognized value to `high` — never silently dropped) — no source
   material pins an exact mapping table for any of the three tools.
7. **`GateVerdict.unstable` is an optional field on the shared verdict shape**,
   set only by the flake gate — the smallest-sufficient way to surface "never
   silently green" through the SAME single-emission `emitEvidence` pipeline
   every other gate uses, rather than a flake-specific parallel evidence path.
8. **(Post-repair-pass) `CoverageGateInput`/`recordCoverageObservation`/
   `getCoverageRatchetFloor` all require a `projectId` string, caller-supplied
   — this gate has no dependency on `ProjectProfile` itself** (avoiding a new
   `packages/gates` → `@eo/contracts`'s `ProjectProfile` coupling beyond what
   it already imports), so it cannot resolve a project identity on its own;
   the natural value is `ProjectProfile.id` when a caller has one resolved.
9. **(Post-repair-pass) `TddGateInput.beforeSeq` is REQUIRED, not optional** —
   deliberately forces every caller to supply a genuine dispatch-boundary seq
   rather than silently defaulting to "count everything," which would
   silently reintroduce NIT-2's exact gap for any caller that forgot to pass
   it.

## Carry-forwards for reconcile

- **Changed-line (diff) coverage is UNIMPLEMENTED (named carry-forward, NIT/
  MINOR-2 adversarial-validation round).** roadmap/14 §In scope, "Coverage"
  bullet, states both "≥80% line+branch on greenfield projects" AND "changed
  instrumentable code reaches 80%" as in-scope guarantees. This build
  implements ONLY the first (aggregate line/branch coverage, ratcheted,
  project-scoped — `coverage-gate.ts`/`coverage/ratchet-store.ts`). No
  adapter or gate anywhere in `packages/gates` computes a PER-DIFF coverage
  delta (i.e. "of the lines this specific `ChangeSet` touched, what fraction
  are covered" — as distinct from the whole-project aggregate this build
  measures). A future phase/reconcile pass implementing this would need: (a)
  a diff/changed-line-set input (this phase's own `security/root-cause-
  detector.ts` already demonstrates parsing unified-diff `+`-prefixed added
  lines, a reusable starting point), (b) a coverage adapter capable of
  per-line (not just aggregate) hit/miss data (LCOV's own `DA:<line>,<hits>`
  records already carry this — `coverage/lcov-adapter.ts` currently discards
  the per-line detail after aggregating), and (c) a THIRD gate check
  (alongside the existing greenfield-minimum and ratchet-regression checks)
  scoped to the changed-line subset specifically. Flagged explicitly here
  rather than left as a silently-absent in-scope guarantee, per the
  adversarial validator's instruction.
- **Shared constant for `ENGINE_LIVE_COMMAND`** (Deviation 2 above) — promote
  the magic-string coupling between this package and `@eo/engine-claude`'s
  `live-harness.ts` to a shared exported constant in a future coordinated
  pass.
- **A 14th `JournalEntryType` member for gate/flake/ratchet evidence**, if a
  future coordinated resolution round ever revisits interface-ledger Gap 5's
  closed-at-13 posture (Deviation 3) — this package's `adjudication_decision`
  reuses for the coverage ratchet and flake quarantine would migrate to it.
- **Real scanner-binary invocation** (semgrep/gitleaks/osv-scanner) and a real
  `@live` engine-conformance run are explicitly out of this phase's scope
  (per the task brief) and remain a phase-23/deployment-time concern, exactly
  as 06's own `@live` suite and 19/20's cassette-modeled connector fixtures
  already establish as precedent.
- **Which component resolves and supplies the attempt's dispatching engine
  version** to `createEngineConformanceGate`/`EngineConformanceGateInput` at
  real dispatch time (13's own `TaskPacket`/attempt-record has no
  `engineVersion` field today — only `WorkUnit.session_id`) is left to
  whichever phase wires this gate into a live dispatch loop; this phase
  supplies the gate as a pure function of an already-known `engineVersion`
  string, per its own out-of-scope boundary ("this phase reads already-
  approved... it never spawns a worker or picks a model role").

## Files touched outside `packages/gates/`

- `.github/workflows/gates-conformance.yml` — new CI job, the exact named
  standalone-runnable seeded-fault matrix + `engine-conformance-binding.test`
  step, fixture-only (no secrets/live host), push/PR-triggered.
- `package-lock.json` — synced by `npm install` after adding
  `packages/gates`' `dependencies`/`devDependencies` (`@eo/detect`,
  `@eo/engine-core`, `@eo/scheduler`, `@eo/journal`, `@eo/contracts`, `zod`;
  dev: `@eo/testkit`, `fast-check`) — no new third-party package was
  introduced; every dependency was already installed for a sibling workspace
  package.

No other file outside `packages/gates/`, `docs/evidence/phase-14/`, and the
one named CI workflow file was edited. `.prettierignore` required no new
entry — this phase introduced no machine-generated golden/fixture files with
a byte-stability contract (all fixtures in this phase's tests are inline
object/string literals, not committed JSON artifacts).

## Gate results

Post-repair-pass (current):

- `npx tsc -b` (whole monorepo, all 18 workspace packages): clean.
- `npx eslint packages/gates/src` and `npm run lint` (whole monorepo): clean.
- `npx prettier --check packages/gates` and `npm run format` (whole
  monorepo): clean.
- `npx vitest run packages/gates --coverage.enabled=false`: **29 test files,
  124 tests, all passing** (up from 113 pre-repair-pass — 11 new
  regression/hardening tests from this pass).
- `npx vitest run` (whole repo, all 18 packages): **467 test files, 3820
  tests, all passing.** `packages/detect` (12) and `packages/scheduler` (13)
  confirmed untouched (`git status` shows zero diff in either) and both
  fully green in isolation (59 test files, 356 tests).
- Coverage, scoped to this phase's own new code
  (`--coverage.include packages/gates/src/**/*.ts`, excluding
  `*.test.ts`/`test-support/**`): **94.1% statements, 86.44% branches, 100%
  functions, 97.83% lines.** Residual uncovered branches are documented
  defensive/unreachable guards (e.g. a `catch`'s rethrow-if-unexpected-error-
  type branch after `resolveDigestPinnedTool`, which by construction only
  ever throws the two typed errors already handled) — the same class of
  belt-and-suspenders gap phase 13's own evidence doc discloses for its
  guarded-parse `catch` blocks.
- **Confirmed fail-closed (adversarial-validation round):** an empty/mis-
  wired gate registry now throws `NoGatesRegisteredError` from
  `fireFinalCandidateVerification` rather than vacuously "passing" (MINOR-1);
  a greenfield project that fails its first coverage run can no longer pass
  indefinitely in the 50–79% band (MINOR-2); a malformed/adversarial security
  report now blocks rather than crashing the firing (NIT-1).
