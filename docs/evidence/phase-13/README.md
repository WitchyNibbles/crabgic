# Phase 13 — Scheduler, task packets, caching, limit parking: evidence

Governing spec: `roadmap/13-scheduler-packets-context.md`. This note maps each exit
criterion to its test/artifact, records deviations from the source material, and lists
carry-forwards for reconcile.

## Adversarial-validation repair pass (2026-07-24)

Independent adversarial validation of the initial build returned FAIL on one MAJOR plus
four MINORs plus one observation. All were fixed strict-TDD (a RED regression test
written and confirmed failing against the pre-fix code FIRST, then fixed to GREEN),
without touching any file outside `packages/scheduler/` and this evidence doc. Summary,
most severe first:

- **MAJOR-1 (`resumeAttempt` bypassed the repair-cap gate; `countPriorDispatches`
  mis-accounted rate-limit-park resumes) — FIXED.** Two compounding defects:
  (a) `resumeAttempt` never called `assertRepairAllowed` at all, so a crash-recovery
  repair — which the roadmap itself routes through `resume` ("same recovery machinery,
  different trigger") — could bypass the absolute 1-initial-plus-2-repairs cap entirely
  by resuming instead of freshly dispatching; (b) `countPriorDispatches` counted EVERY
  `dispatched` transition, including a rate-limit-park resume's own — an external
  throttle, not a failed action — so a parked unit could silently lose a real repair
  slot to its own park/resume cycle. RED regression (`executor.test.ts`'s temporary
  vulnerability-proof test, since replaced by the GREEN tests below): a bare
  pre-fix-shaped `resumeAttempt` call proceeded to `"succeeded"` with the cap already
  exhausted and zero `RepairEvidenceRequiredError`. Fix, two parts:
  1. `resumeAttempt` now takes a REQUIRED `trigger: ResumeTrigger` discriminant
     (`executor.ts`): `{kind: "crashRepair", evidenceKind, evidenceDetail?}` routes
     through the IDENTICAL `assertRepairAllowed` gate `dispatchAttempt` uses (throws
     `RepairEvidenceRequiredError` exactly the same way, proven by
     `executor.test.ts`'s "resumeAttempt with trigger 'crashRepair' IS gated
     identically..." and `executor.e2e.test.ts`'s matching cap-exhaustion test — the
     ORIGINAL crash→repair E2E test was also rewritten to route through this trigger
     for real, closing the "bare side-assertion sitting beside an ungated call"
     test-theater the validator flagged); `{kind: "parkResume"}` skips the gate
     entirely — no evidence required, matching "an external throttle is never a
     repair."
  2. `attempt-policy.ts`'s `countPriorDispatches` now EXCLUDES a `dispatched`
     transition whose `previousStatus` is `parked:rate_limit` (`@eo/journal`'s
     `recordAttempt` already auto-populates `previousStatus` from each work unit's
     latest prior attempt — no new journal write shape needed). Proven by
     `attempt-policy.test.ts`'s "EXCLUDES a 'dispatched' transition whose
     previousStatus is 'parked:rate_limit'" and "a park→resume cycle does NOT
     decrement the available repair budget — the 3-dispatch cap is still reachable
     afterward" (two full park/resume cycles consume zero budget; the cap is still
     exactly 3 REAL dispatches away).
  Also addressed the validator's adjacent ask ("the 'new evidence' gate never verifies
  the evidence is genuinely distinct from the prior attempt's — tighten if cheap"):
  `assertRepairAllowed` gained an optional `evidenceDetail` fingerprint parameter —
  when supplied, a repair citing evidence IDENTICAL (same `evidenceKind` AND identical
  detail text) to the evidence that justified the immediately-prior repair is refused
  (`reason: "evidenceNotDistinct"`, a new `RepairRefusalReason` member); omitting it
  (the pre-existing call shape) skips the check entirely — fully backward-compatible.
  Recorded via the same documented `adjudication_decision`-reuse precedent this phase
  already established for parking timers (guarded `JSON.parse`, never trusts file
  content). Proven by `attempt-policy.test.ts`'s `evidence-distinctness (evidenceDetail)`
  suite (5 tests).

- **MINOR-2 (cache key `::`-join was ambiguous — a proven wrong-fingerprint HIT) —
  FIXED.** `cacheKeyString`'s `${contentHash}::${toolchainFingerprint}` collided:
  `(hash:"a", fp:"b::c")` and `(hash:"a::b", fp:"c")` both produced the identical
  string `"a::b::c"`, serving one pair's value to the OTHER's declared fingerprint —
  refuting this phase's own poisoning-resistance claim. RED regression
  (`cache.test.ts`'s "a boundary-shifted... pair must NEVER collide") reproduced the
  exact collision against the pre-fix `::`-join. Fixed to `JSON.stringify([contentHash,
  toolchainFingerprint])` — JSON string encoding's own quote/backslash escaping makes
  the array's structural comma delimiter unreachable from either string's CONTENT, so
  the composition is unambiguous for arbitrary input, not merely "safe because both
  fields happen to be hex digests." The poisoning property suite
  (`cache.property.test.ts`) gained a dedicated boundary-shift generator (`prefix` /
  `prefix + mid` as the two `contentHash`es, `mid + suffix` / `suffix` as the two
  `toolchainFingerprint`s — both share an identical flat concatenation) that
  CONSTRUCTS the adversarial pair by design rather than hoping two independently-random
  ≤12-char strings collide by chance (verified directly: run against the OLD `::`-join
  scheme, this exact property fails within ~1500 cases; the original weak suites using
  independent random strings never would have).

- **MINOR-3 ("account-wide signals pause globally" was exported but never enforced) —
  FIXED.** `isGloballyPaused` existed but no dispatch path ever consulted it. Added
  `parking.ts`'s `assertNotGloballyPaused` (throws the new `GlobalPauseActiveError`,
  `errors.ts`) and wired it into BOTH `dispatchAttempt` and `resumeAttempt` as the
  FIRST check, before any other gate or engine call. RED regression
  (`parking.test.ts`) confirmed the function didn't exist yet; RED-then-GREEN at the
  executor level confirmed via a temporary sanity check (the gate calls were
  temporarily disabled and re-run — both `dispatchAttempt`'s and `resumeAttempt`'s new
  global-pause tests failed differently without the wiring, then passed once restored,
  proving the tests are load-bearing, not vacuous). Proven by
  `executor.test.ts`'s 3 new tests (`dispatchAttempt`/`resumeAttempt` both blocked
  pre-reset, `dispatchAttempt` proceeds post-reset) plus `parking.test.ts`'s own
  `assertNotGloballyPaused` unit suite (3 tests).

- **MINOR-4 (unguarded `JSON.parse` of on-disk journal content) — FIXED.**
  `getLatestParkTimer` called `JSON.parse(entry.payload.rationale)` unconditionally on
  any `adjudication_decision` entry carrying the park-timer sentinel decision — a
  malformed or foreign entry sharing that decision value would throw an untyped
  `SyntaxError` straight out of `getLatestParkTimer`/`getParkStatus`/
  `isGloballyPaused`. RED regression (`parking.test.ts`, 3 new tests) confirmed the
  raw `SyntaxError`/wrong-shape leak against the pre-fix code. Fixed with a zod-
  validated guarded parse (`parseParkTimerPayload`): invalid JSON or the wrong shape is
  skipped (treated as "no valid timer," never thrown) — "never trust file content."
  The IDENTICAL pattern was proactively applied to the new `evidenceDetail` repair-
  evidence-record parser added for MAJOR-1 (`attempt-policy.ts`'s
  `parseRepairEvidenceRecord`), with its own dedicated malformed-content regression
  test.

- **MINOR-5 (byte budgets measured in JS string `.length`, not true bytes) — FIXED.**
  `budgets.ts` used `rendered.length` (UTF-16 code units) despite the `*Bytes` field
  naming — a field full of multi-byte (non-ASCII) characters could exceed its true
  UTF-8 byte budget while `.length` still reported it as within bounds. RED regression
  (`budgets.test.ts`, 1500 "é" characters — 1500 chars, well under the 2000-char
  budget by `.length`, but 3000 true UTF-8 bytes, genuinely over) confirmed zero
  violations were reported pre-fix. Fixed to `Buffer.byteLength(rendered, "utf8")` for
  measurement and a byte-accurate `Buffer`-based slice for the `diff` excerpt.

- **Observation (fan-out property suite never exercised cross-round in-flight
  serialization) — ADDRESSED.** The existing round-simulation property test marked
  every dispatched unit `"succeeded"` INSTANTANEOUSLY within the same round, so
  `readiness.ts`'s `inFlightUnitIds` guard (blocking a unit from being considered
  ready while a colliding unit is still in flight from an EARLIER round) was only ever
  exercised by hand-built fixtures, never by the property suite. Added a second
  simulation (`fanout.property.test.ts`) giving each dispatched unit a random 1-3-round
  in-flight LIFETIME before completing, asserting the "never concurrent" property over
  the FULL active set (already-in-flight ∪ newly-selected) at every round instant.
  Verified directly that this new property test fails within a handful of cases when
  `readiness.ts`'s in-flight guard is disabled (confirmed, then reverted).

The disclosed NIT-level deviations (router-override-is-a-parameter, Deviation 7; no
path-prefix normalization on owned-paths, not separately called out as a numbered
deviation since `analyzeOverlap`'s own `normalizePlannedPath` — consumed, not
reimplemented, by this phase's readiness engine — already owns that normalization)
remain documented as-is, unchanged by this pass, per the validator's own instruction.

## Exit criterion → evidence mapping

- [x] **Property test over random DAGs + overlap sets: overlapping units never
  concurrent (fast-check suite).**
  `packages/scheduler/src/fanout.property.test.ts`:
  - `selectDispatchSet — property: never selects two colliding units together` —
    2000 cases over random ready-id sets, random collision graphs, random caps;
    asserts the cap is never exceeded and no two selected units ever collide.
  - `readiness + fanout round-simulation — property: random DAGs + overlap sets
    never dispatch a colliding pair concurrently` — 1500 cases; builds a random
    acyclic `dependsOn` DAG (1–7 units) plus a random overlap graph, then
    simulates full round-based execution via `computeReadyUnits` +
    `selectDispatchSet` to completion, asserting NO round's dispatch set ever
    contains a colliding pair and every unit eventually reaches `succeeded`.
  - (post-repair-pass) `simulates OVERLAPPING multi-round in-flight windows...`
    — 1500 cases; each dispatched unit now gets a random 1-3-round in-flight
    LIFETIME (not instantaneous success), and the property is checked over the
    FULL active set — already-in-flight ∪ newly-selected — at every round
    instant, so `readiness.ts`'s `inFlightUnitIds` cross-round guard is
    genuinely exercised (verified directly: this test fails within a handful
    of cases when that guard is disabled).

- [x] **Third attempt without new evidence refused with a typed error; a 06
  schema-violation failure counts as valid evidence exactly once (integration
  suite).**
  `packages/scheduler/src/attempt-policy.test.ts` (unit-level, real
  `@eo/journal` `JournalStore` over a temp dir):
  - `refuses a repair (2nd dispatch) with reason 'noNewEvidence'...`
  - `refuses a 4th dispatch with reason 'attemptsExhausted' even WITH fresh
    evidence — the cap is absolute`
  - `re-checking evidence multiple times before an actual redispatch never
    itself consumes a repair slot (no double-counting)`
  - (post-repair-pass) `evidence-distinctness (evidenceDetail)` suite (5 tests)
    — a repair citing evidence IDENTICAL to the immediately-prior repair's is
    refused with `reason: "evidenceNotDistinct"`.
  `packages/scheduler/src/executor.e2e.test.ts` (integration, fake engine):
  - `refuses a 3rd dispatch attempt WITHOUT new evidence with a TYPED error,
    via dispatchAttempt itself` — proves the REFUSAL is thrown before
    `adapter.spawn` is ever called (`spawnCalled` assertion), then that the
    identical 3rd attempt succeeds once evidence is cited, and a 4th is refused
    regardless of evidence.
  - `a schema-violation failure counts as valid repair evidence exactly once —
    it justifies ONE repair, never more toward the cap` — a schema-violating
    script drives 3 dispatches (1 initial + 2 repairs, each citing
    `"schemaViolation"`), then asserts a 4th dispatch citing the SAME evidence
    kind is refused — citing identical evidence repeatedly never grants extra
    repairs past the cap.
  - (post-repair-pass) `MAJOR-1: a resumeAttempt crashRepair is REFUSED once
    the cap is exhausted — the gate actually blocks the call, not a side
    assertion` — the crash→repair E2E now genuinely routes through
    `resumeAttempt`'s `trigger: {kind: "crashRepair"}` gate (not a bare
    `assertRepairAllowed` side-assertion sitting beside an ungated call), and a
    dedicated cap-exhaustion test proves `adapter.resume` is never even called
    once the cap is hit.
  `packages/scheduler/src/executor.test.ts` (post-repair-pass): `resumeAttempt
  with trigger 'crashRepair' IS gated identically to dispatchAttempt...` and
  `resumeAttempt with trigger 'parkResume' never requires evidence and never
  consumes a repair slot, even after the cap would otherwise be exhausted` —
  the two-trigger distinction (crash-repair IS a repair; rate-limit-park
  resume is NOT) proven directly.

- [x] **Packet budget violations block dispatch with an actionable diff — no
  silent truncation (unit suite).**
  `packages/scheduler/src/budgets.test.ts` — `flags an over-budget objective
  with an actionable diff and never mutates the packet` (`diff` is the exact
  excess tail; `packet.objective` is asserted unchanged);
  `assertPacketWithinBudget › throws PacketBudgetExceededError...`.
  `packages/scheduler/src/budgets.property.test.ts` — fast-check, 1000 cases
  each, objective/gates fields, always-flagged-when-over/never-flagged-when-
  under.
  `packages/scheduler/src/executor.test.ts` — `throws PacketBudgetExceededError
  before ever calling adapter.spawn for an over-budget packet` (proves the
  block happens BEFORE any engine call, not merely that the error type is
  right).

- [x] **Parking E2E completes with the same `session_id`; journal shows the
  full arc; survives a simulated supervisor restart mid-park.**
  `packages/scheduler/src/executor.e2e.test.ts` →
  `E2E: limit-signal → park → simulated clock past reset → resume, surviving a
  simulated supervisor restart` — `parks on limitSignal, then resumes with the
  SAME session_id after a fresh JournalStore instance (simulated restart)...`:
  dispatches, parks on `limitSignal`, asserts `getParkStatus` via a BRAND-NEW
  `JournalStore` instance over the identical on-disk `journalDir` (zero
  in-memory state carried over) both before and after the simulated reset
  instant, then resumes via `resumeAttempt` with the identical `sessionId` to
  `succeeded`. `two concurrently-parked work units from the same project never
  collide on a session_id` covers the adjacent conformance item. Full
  mechanism/unit coverage in `packages/scheduler/src/parking.test.ts`
  (`survives a simulated supervisor restart: a FRESH JournalStore instance...`).

- [x] **Cache hit path byte-identical to cold path; poisoning/partial-match
  property tests green.**
  `packages/scheduler/src/cache.test.ts` — `getOrCompute › returns the cached
  value byte-identical on a hit, without recomputing`.
  `packages/scheduler/src/cache.property.test.ts` — 3000 + 1000 fast-check
  cases: `SchedulerCache — property: hit iff BOTH contentHash and
  toolchainFingerprint match exactly` (no partial-match false positive) and
  `an entry keyed to one fingerprint is NEVER served to a dispatch declaring a
  different one...`. (post-repair-pass) `cacheKeyString` fixed from an
  ambiguous `::`-join to `JSON.stringify([contentHash, toolchainFingerprint])`
  — see Adversarial-validation repair pass, MINOR-2 — plus a dedicated
  3000-case boundary-shift-construction property test and the exact reported
  counterexample as a fixture regression.

- [x] **Shadow-run E2E: mirrored attempt runs to completion in isolation;
  primary attempt's journal/cache/artifacts are provably unmodified
  (diff-based isolation assertion).**
  `packages/scheduler/src/executor.e2e.test.ts` → `E2E: shadow-run alongside a
  live primary — isolation asserted` — dispatches a live primary to
  `succeeded`, snapshots the FULL journal entry list, runs an isolated shadow
  attempt (distinct session/script), then re-snapshots and asserts the diff is
  EXACTLY one new entry (the marker) — no `work_unit_transition`/
  `session_assignment` mutation of the primary. Also asserts a
  pre-populated primary `SchedulerCache`/`ArtifactStore` (never passed to
  `runShadowAttempt` at all) are byte-identical before/after. Unit-level
  isolation proof in `packages/scheduler/src/shadow-run.test.ts` (5 tests,
  incl. same-content-hash-shaped collision resistance for artifacts/cache).

- [x] **Every attempt transition this package records matches a
  `WorkUnitAttemptStatus` member, and every entry it journals matches a
  `JournalEntryType` member (exercised here against 02's discriminated-union
  exhaustiveness harness).**
  `packages/scheduler/src/conformance.test.ts` — `Record<JournalEntryType,
  boolean>`/`Record<WorkUnitAttemptStatus, boolean>` exhaustiveness literals
  (the identical TS mechanism `@eo/contracts`'s own
  `JOURNAL_ENTRY_TYPE_DESCRIPTIONS` uses — `npx tsc -b` fails on a missing or
  stray key), plus runtime assertions that this package's actually-used
  members (`work_unit_transition`, `adjudication_decision`,
  `session_assignment`, `fanout_rationale` / `dispatched`, `succeeded`,
  `failed`, `cancelled`, `parked:rate_limit`) are each contained in the closed
  02 unions.

## Files

New (all under `packages/scheduler/` and `docs/evidence/phase-13/`, except one
`.prettierignore` line — see "Files touched outside packages/scheduler" below):

- `packages/scheduler/package.json`, `tsconfig.json` — dependencies
  (`@eo/contracts`, `@eo/engine-core`, `@eo/git-engine`, `@eo/journal`, `zod`;
  dev: `@eo/testkit`, `fast-check`) and project references.
- `src/errors.ts` — `PacketBudgetExceededError`, `PacketEnvelopeViolationError`,
  `RepairEvidenceRequiredError` + their supporting types.
- `src/budgets.ts` (+ `.test.ts`, `.property.test.ts`) — TaskPacket field-size
  budget enforcement.
- `src/task-packet-builder.ts` (+ `.test.ts`, `.property.test.ts`) — TaskPacket
  builder, packet-⊆-envelope enforcement, ephemeral lesson-preamble slot.
- `src/goldens/generate-golden-packets.ts` (+ `.test.ts`) and
  `goldens/task-packet-{minimal,full}.json` — golden TaskPacket fixtures.
- `src/readiness.ts` (+ `.test.ts`) — readiness engine (deps + overlap).
- `src/fanout.ts` (+ `.test.ts`, `.property.test.ts`) — dispatch-set selection
  (concurrency cap + serialization) + `fanout_rationale` journaling.
- `src/worker-result-validation.ts` (+ `.test.ts`) — engine-agnostic
  `EngineResultEvent` → `WorkerResult` validation (see Deviations).
- `src/attempt-policy.ts` (+ `.test.ts`) — journal-derived repair-evidence
  policy.
- `src/cache.ts` (+ `.test.ts`, `.property.test.ts`) — content-hash +
  toolchain-fingerprint cache.
- `src/artifact-store.ts` (+ `.test.ts`) — bounded artifact store + summary
  projection + benchmark slot.
- `src/router.ts` (+ `.test.ts`) — role → model-alias router.
- `src/parking.ts` (+ `.test.ts`) — limit-parking state machine, journal-derived
  timers (see Deviations).
- `src/shadow-run.ts` (+ `.test.ts`) — isolated mirrored-attempt mechanism.
- `src/executor.ts` (+ `.test.ts`, `.e2e.test.ts`) — `dispatchAttempt`/
  `resumeAttempt`, the evidence seam, and the full-arc fake-engine E2E suite.
- `src/conformance.test.ts` — `JournalEntryType`/`WorkUnitAttemptStatus`
  exhaustiveness (exit criterion #7).
- `src/test-support/minimal-compiled-profile.ts` — test-support-only fixture
  (not exported via the barrel), mirroring
  `packages/supervisor/src/worker-lifecycle/test-support/minimal-compiled-
  profile.ts`.
- `src/index.ts` — public barrel.

## New public interfaces for downstream consumption (14/15/22)

- `dispatchAttempt`/`resumeAttempt` (`executor.ts`) — the dispatch/candidate
  seam 14's TDD evidence protocol keys off (`work_unit_transition`
  `dispatched`/`succeeded` entries). `resumeAttempt` now takes a required
  `trigger: ResumeTrigger` (`{kind: "crashRepair", evidenceKind,
  evidenceDetail?} | {kind: "parkResume"}`, post-repair-pass) — callers
  driving a crash-recovery repair MUST supply `"crashRepair"` with the
  justifying evidence; callers resuming a rate-limit park MUST supply
  `"parkResume"`.
- `buildTaskPacket` (`task-packet-builder.ts`) — 15's risk-detection
  heuristics run over the packet's declared `ownedPaths`.
- `ArtifactStore`/`listBenchmarks` (`artifact-store.ts`) — the benchmark-sample
  slot 15 archives its raw resource-capture samples into.
- `runShadowAttempt` (`shadow-run.ts`) — 22's shadow-run comparator registers
  against this mirrored-dispatch primitive.
- `resolveModelForRole` (`router.ts`), `SchedulerCache`/`getOrCompute`
  (`cache.ts`), `parkWorkUnit`/`getParkStatus`/`assertNotGloballyPaused`
  (`parking.ts`, post-repair-pass).

## Deviations (documented scope decisions)

1. **No `@eo/supervisor` runtime dependency.** The roadmap's "Interfaces
   consumed" section names 11's planning outputs (IntentContract, DAG, roster,
   write ownership, integration order, approval-token verification,
   stop-conditions) but never names `packages/supervisor`'s own registries/
   worker-lifecycle-manager as a dependency of this phase. This package
   consumes the DAG purely as `@eo/contracts` data (`WorkUnit[]`) and does its
   OWN minimal journaling (`session_assignment` before consuming events,
   `work_unit_transition` per outcome) via `@eo/journal`'s existing
   `recordAttempt`/`appendEntry` — mirroring 05's own
   `worker-lifecycle-manager.ts` ordering byte-for-byte without importing that
   package. One-time approval-token verification and stop-condition
   mid-run-halt are NOT reimplemented here (out of scope per the phase file);
   a real integration wires them as preconditions on whatever process drives
   this package's `dispatchAttempt` loop (carry-forward, see below).

2. **`validateWorkerResult` is a package-local copy of 06's algorithm, not an
   import of `@eo/engine-claude`.** This phase's executor must work against
   ANY `EngineAdapter` (the abstract `@eo/engine-core` contract), not
   specifically the Claude adapter; importing `@eo/engine-claude` would add an
   undeclared 13→06(concrete) edge and make the package untestable against the
   fake engine alone. `src/worker-result-validation.ts`'s doc comment
   documents this as intentional parallel logic (same rules, same order, same
   `docs/engine-baseline.md` §5 citation), not a fork of a different
   algorithm.

3. **`TaskPacket` has no dedicated `commands` field to check against the
   envelope.** 02's `TaskPacketSchema` has no `commands` field (only
   `ownedPaths`/free-text `constraints`). `buildTaskPacket`'s `allowedCommands`
   parameter is checked against `envelope.commands` and rendered into
   `constraints` as `Allowed command: <cmd>` lines — the packet's own audit
   trail for command scope, always provably a subset of the envelope. See
   `task-packet-builder.ts`'s file-level doc comment.

4. **`fanout_rationale`'s "expected token cost" is carried as text, not a
   dedicated numeric field.** `FanoutRationalePayloadSchema` (04) has exactly
   one field, `rationale: NonEmptyString` — no numeric token-cost field exists
   on the closed 02/04 schema. The cost estimate is embedded in the rationale
   string itself (`fanout.ts`'s doc comment), matching this repo's established
   "no field shape is pinned anywhere in cited source material" pattern.

5. **Parking timers are journal-derived via a documented reuse of
   `adjudication_decision`, not a new `JournalEntryType` member.**
   `WorkUnitTransitionPayloadSchema` carries only `status`/`previousStatus`/
   `sessionId` — no epoch-timestamp field for a rate-limit reset time.
   `JournalEntryType` is closed at exactly 13 members (interface-ledger Gap 5);
   adding a 14th is out of this phase's authority, and `@eo/contracts`/
   `@eo/journal` may not be edited by this phase's own build constraints. This
   package reuses `adjudication_decision`'s already-generic payload
   (`decision`/`rationale`/`subjectId`) as the timer's carrier — the SAME
   precedent `packages/journal/src/store/repair-chain.ts` already establishes
   for this exact entry type (its own doc comment: "`adjudication_decision`'s
   payload is deliberately generic enough to also carry this package's own
   internal... report"). The real, correctly-typed `work_unit_transition`
   entry (`parked:rate_limit`, carrying `sessionId`) remains the PRIMARY,
   authoritative park record; the `adjudication_decision` entry is a
   documented SUPPLEMENT, never a substitute. See `parking.ts`'s file-level
   doc comment. **Flagged for reconcile**: if a future coordinated resolution
   round ever adds a 14th `JournalEntryType` member for rate-limit-park timers
   specifically, this module's `recordParkTimer`/`getLatestParkTimer` should
   be updated to use it instead of the `adjudication_decision` reuse.
   (Post-repair-pass: `attempt-policy.ts`'s new `evidenceDetail` distinctness
   fingerprint, and MINOR-4's guarded-parse fix, both extend this exact
   precedent to two more call sites — see the Adversarial-validation repair
   pass section above.)

6. **Shadow-run's own journal marker also reuses `adjudication_decision`**
   (`SHADOW_RUN_MARKER_DECISION`), for the identical reason as (5) above — no
   dedicated `JournalEntryType` member exists for "a shadow-run mirrored this
   work unit," and inventing one is out of this phase's authority.

7. **Model-router override source is a plain parameter, not literally read
   from `AuthorizationEnvelope`.** Neither `WorkUnit` nor
   `AuthorizationEnvelope` (02) carries a dedicated model-override field — no
   cited source material pins one. `resolveModelForRole`'s `override`
   parameter is agnostic to where the value came from; it wins unconditionally
   over the role-alias map, satisfying "overrides only via the approved
   envelope" for whatever later wiring threads an envelope-derived override
   string into that parameter. See `router.ts`'s file-level doc comment.

8. **A crash counts as valid repair evidence** (`AttemptEvidenceKind: "crash"`,
   distinct from `"workerResultFailure"`/`"schemaViolation"`/`"gateVerdict"`).
   The roadmap's own text ("crash mid-attempt → repair with fresh diagnostic
   evidence") implies a crash itself is fresh evidence even though it produces
   no `WorkerResult` at all — this package's own minimal-sufficient
   `AttemptEvidenceKind` member for that case, counted exactly once per
   attempt like every other evidence kind (`attempt-policy.ts`'s own
   journal-derived, evidence-kind-independent cap counter makes double-counting
   structurally impossible regardless of which kind is cited).

## Carry-forwards for reconcile

- **11's approval-token verification and mid-run stop-condition halting are
  preconditions on this package's dispatch loop, not reimplemented here** — a
  real supervisor-runtime wiring of `dispatchAttempt`/`resumeAttempt` into an
  actual long-lived process (with 11's registries/stop-conditions consulted
  before each round) is out of this phase's scope per the roadmap file's own
  "Interfaces consumed" list, and is the natural next integration point for
  whichever phase (or a dedicated reconcile pass) wires the supervisor's real
  dispatch runtime.
- **09's `resume <run-id>` CLI backend, limit-parked half** — this package
  supplies `resumeAttempt` + `getParkStatus`/`isGloballyPaused`/
  `parkWorkUnit` (the parked-work-unit re-dispatch half); wiring an actual CLI
  command handler in `packages/cli` to call these is explicitly NOT done here
  per this phase's own constraints ("prefer exporting a backend function from
  @eo/scheduler and note the wiring as a carry-forward... unless trivial" —
  09 already owns the command surface, and no `packages/cli` file was touched
  by this phase).
- **Gap 5's `JournalEntryType`, if ever revisited**: see Deviation 5/6 above —
  a coordinated 14th-member addition (rate-limit-park timer / shadow-run
  marker) would let this package drop its `adjudication_decision` reuse in
  favor of a dedicated, purpose-built entry type.
- **Cache/artifact-store persistence**: both are in-memory-only in this
  build (no eviction policy, no disk persistence) — no source material pins
  either, and this phase's own text is silent on long-lived process
  durability for these two stores specifically (unlike the journal/lease
  primitives, which are explicitly durable). A future phase wiring this
  package into a long-lived supervisor process should decide whether either
  needs disk backing.

## Files touched outside `packages/scheduler/`

- `.prettierignore` — one line added, marking `packages/scheduler/goldens/`
  as machine-generated, byte-stability-pinned artifacts exempt from Prettier's
  own JSON style — identical rationale and pattern to the four pre-existing
  entries for `packages/{contracts,engine-core,engine-claude,supervisor}`'s
  own golden directories (added by the phases that created them).
- `package-lock.json` — synced by `npm install` after adding
  `packages/scheduler`'s new `dependencies`/`devDependencies` (no new
  third-party package was introduced; every dependency was already installed
  for a sibling workspace package).

No other file outside `packages/scheduler/` and `docs/evidence/phase-13/` was
edited. `packages/connectors-jira/` shows as modified/untracked in `git status`
at the time of this build — that is pre-existing, in-flight, uncommitted work
from a concurrent phase (19, Jira Data Center adapter) in this shared working
directory; this phase never touched it, and its own `npx tsc -b` failure
(`Cannot find name 'DcEditionEntry'`) is confirmed unrelated by `git diff
--stat -- packages/connectors-jira` showing only that package's own changes.

## Gate results

Post-repair-pass (current):

- `npx tsc -b packages/contracts packages/testkit packages/engine-core
  packages/journal packages/supervisor packages/engine-claude
  packages/git-engine packages/gateway packages/renderer
  packages/connectors-grafana packages/detect packages/scheduler
  packages/gates packages/perf packages/learning packages/cli
  packages/plugin` — clean, no errors (every package except the concurrently
  in-flight, unrelated `packages/connectors-jira`; see above).
- `npx vitest run --coverage.enabled=false <the same package list>` — **393
  test files, 3260 tests, all passing**, plus one pre-existing, unrelated,
  host-load-flaky timing test in `packages/engine-claude/src/session.test.ts`
  (never touched by this phase; confirmed passing in isolation on re-run —
  see "Files touched outside packages/scheduler" for the identical
  unrelated-concurrent-work caveat pattern). `packages/scheduler` alone: **19
  test files, 160 tests, all green** (up from 135 pre-repair-pass — 25 new
  regression/hardening tests from this pass).
- `npx eslint packages/scheduler/src` — clean.
- `npx prettier --check packages/scheduler` — clean.
- Coverage, scoped to this phase's own new code only (`--coverage.include
  packages/scheduler/src/**`, excluding `*.test.ts`/`test-support/**`):
  **98.39% statements, 95.83% branches, 100% functions, 100% lines** —
  comfortably clears the 80%-line-and-branch ground rule. The residual
  uncovered branches (`attempt-policy.ts`'s/`parking.ts`'s guarded-parse
  `catch` blocks under specific input combinations, and one defensive
  type-narrowing guard on an already-server-filtered `queryEntries` result)
  are unreachable-in-practice belt-and-suspenders checks, documented in their
  own doc comments; the core malformed-JSON and wrong-shape paths of both
  guarded parsers ARE exercised (see MINOR-4 above).
