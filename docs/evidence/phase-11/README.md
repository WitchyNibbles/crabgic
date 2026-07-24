# Phase 11 — Intake, IntentContract, approval envelope flow: evidence

Governing spec: `roadmap/11-intake-contract-approval.md`. This note maps each exit
criterion to its test/artifact, records deviations from the source material, and closes
out (or explicitly defers, with reason) the two carry-forwards named in this phase's
brief.

## Adversarial-validation repair pass (2026-07-24)

Independent adversarial validation of the initial build found the approval-safety gate
was bypassable and flagged 7 findings (1 CRITICAL, 1 HIGH, 2 MEDIUM, 3 LOW). All 7 were
fixed TDD (failing test first) without touching any file outside
`packages/supervisor`/`packages/cli`. Summary, most severe first:

- **CRITICAL C1 (confused deputy) — FIXED.** `contract-approve-handler.ts`'s
  `runContractApprove` used to take `changeSetId`/`digest`/`token` as three
  independent caller inputs and verify the token against the CALLER's own `digest`,
  never confirming it actually belonged to that `changeSetId`'s own envelope — a
  valid token minted for ChangeSet A's envelope could flip a DIFFERENT ChangeSet B
  to `ready`. Fix: a new `packages/supervisor/src/registries/authorization-
  envelopes-registry.ts` durably stores every built `AuthorizationEnvelope` by id
  (wired through `intake-pipeline.ts`'s `IntakeDeps.envelopes` and
  `amendment.ts`'s `AmendEnvelopeOptions.envelopes`); the handler now derives the
  EXPECTED digest server-side via `changeSets.get(changeSetId).authorizationEnvelopeId
  -> envelopes.get(...).canonicalHash`, cross-checks the caller's `digest` against it
  (`ExpectedDigestMismatchError` on any mismatch, before the token is ever touched),
  and verifies the token against the server-derived digest, never the caller-supplied
  one. Proof: `contract-approve-handler.test.ts`'s "a valid token minted for a
  DIFFERENT ChangeSet's envelope cannot approve this ChangeSet (confused deputy)" test
  — the bypass attempt is rejected, and the SAME legitimate token still approves its
  own, correct ChangeSet afterward.

- **HIGH H2 (single-use not durable under concurrency) — FIXED.**
  `durable-approval-ledger.ts` relied solely on `IdempotencyRegistry.checkOrRecord`,
  which `@eo/journal` itself documents as unsafe against two truly concurrent
  first-time calls for the same key. Fix: the check-and-record critical section is now
  wrapped in a real, durable, per-`tokenId` file lock — `@eo/journal`'s own `Lease`
  primitive (roadmap/04 work item 6), keyed by `tokenId` rather than a project hash
  (its `projectHash` constructor argument is just an opaque lock-identity string), with
  retry (`maxAcquireAttempts`/`retryDelayMs`) so a losing concurrent caller WAITS for
  the lease rather than failing on mere contention, then observes the winner's already-
  recorded consumption via the SAME `ApprovalTokenAlreadyVerifiedError` branch. Proof:
  `durable-approval-ledger.test.ts`'s two new concurrency tests —
  `Promise.allSettled` over 2 and then 10 truly-overlapping (no `await` between them)
  verification attempts of the identical token — assert EXACTLY one ever succeeds, run
  5x consecutively with no flakes observed during this repair.

- **MEDIUM M3 (06's `capabilities()` never actually called) — FIXED.**
  `capability-manifest-builder.ts`'s `BuildCapabilityManifestOptions` gains an
  `engineAdapter?: Pick<EngineAdapter, "capabilities">` parameter (`@eo/engine-core`,
  already this package's dependency); when supplied it takes priority over the
  literal `engineEntry` fallback and the pinned-engine entry is derived by an actual
  `.capabilities()` call. `goldens/fixture-request.ts` now passes a small, real (if
  trivial) `FIXTURE_ENGINE_ADAPTER` object instead of a bare literal, so the golden
  fixture itself exercises the real call path. Proof:
  `capability-manifest-builder.test.ts`'s two new tests assert the manifest reflects
  the ADAPTER's own returned fields (via a call-counting stub), and that
  `engineAdapter` wins over a simultaneously-supplied `engineEntry`.

- **MEDIUM M4 (amendment doesn't demote a ready ChangeSet) — FIXED.** `amendment.ts`'s
  `amendEnvelope` used to repoint `authorizationEnvelopeId` without ever touching
  `ChangeSet.state`, so amending an already-`ready` ChangeSet left it reporting
  `ready` while pointing at a brand-new, never-approved envelope. Fix: `amendEnvelope`
  now demotes the ChangeSet's own state as part of the same call, via the existing,
  unmodified `change-set-transition.ts` (02's transition table is unchanged): `ready`
  demotes to `cancelled` (the ONLY legal edge out of `ready` — it has no
  `-> awaiting_approval`/`-> blocked` edge), every in-flight stage
  (`running`/`verifying`/`integrating`/`final_verifying`) demotes to `blocked`
  (mirrors `stop-conditions.ts`'s own halt semantics), and an already-terminal
  ChangeSet refuses the amendment outright (new `ChangeSetAlreadyTerminalError`).
  Proof: `amendment.test.ts`'s 3 new tests (ready → demoted off `ready`,
  running → `blocked`, terminal → refused).

- **LOW L5 (token burned before ready-transition legality is known) — FIXED.**
  `runContractApprove` now runs the digest cross-check, the requirement-coverage
  check (`findUnmappedRequirements`), and a pure `runLifecycleTransition` legality
  pre-check BEFORE ever calling `verifyApprovalTokenDurable` — the single-use token
  is only consumed once every other precondition is already known to hold, so a
  caller can safely retry with the SAME token after fixing an incomplete DAG or a
  not-yet-reachable state. The one residual window (the transition itself still
  failing after the token is spent, in a genuine race) reports a reason explicitly
  saying so rather than implying a retry would help. Proof:
  `contract-approve-handler.test.ts`'s "unmapped requirement" and "illegal source
  state" tests now additionally prove the SAME token still works once the
  precondition is fixed.

- **LOW L6 (degenerate golden requirement↔work-unit mapping) — FIXED.**
  `contract-builder.ts`'s requirement-id derivation is now exported as
  `computeRequirementId`; `intake-pipeline.ts` exports the matching
  `computeIntentContractId`. `goldens/fixture-request.ts` uses both to wire a REAL
  bidirectional mapping (`Requirement.workUnitIds` <-> `WorkUnit.requirementIds`)
  with no duplicated/drifting id formula. Goldens regenerated
  (`packages/supervisor/goldens/{requirements,work-unit-graph}.json`).

- **LOW L7 (journal-before-transition ordering) — FIXED.** `stop-conditions.ts`'s
  `haltOnStopCondition` now calls `transitionRun` FIRST and only journals the
  `adjudication_decision` record after a successful transition — an
  illegal-transition attempt (e.g. halting an already-terminal run) no longer leaves
  a stray decision record behind for a halt that never happened. Proof: the existing
  "already terminal" test now additionally asserts exactly 1 `adjudication_decision`
  entry exists (the one real halt), not 2.

**Files touched by this repair pass** (all within the original phase-11 boundary):
new `packages/supervisor/src/registries/authorization-envelopes-registry.ts`;
modified `packages/supervisor/src/intake/{intake-pipeline,amendment,contract-builder,
capability-manifest-builder,stop-conditions}.ts` and their `.test.ts` files,
`packages/supervisor/src/index.ts` (barrel addition), `packages/supervisor/goldens/
{requirements,work-unit-graph,capability-manifest}.json` (regenerated);
`packages/cli/src/intake/{contract-approve-handler,run-intake-command}.ts` and their
`.test.ts` files, `packages/cli/src/approval/durable-approval-ledger.ts` (+ test),
`packages/cli/src/commands/{types,real-handlers,intake-dispatch.test}.ts`.

**Gate results after the repair pass:** `npx tsc -b packages/supervisor packages/cli`
clean. `npx vitest run packages/supervisor packages/plugin packages/cli
--coverage.enabled=false` — 112 test files, **655 tests, all green**, run 3x
consecutively with no flakes (the 2 new concurrency tests in particular re-run 5x
standalone with no flakes). `npx eslint packages/supervisor/src packages/cli/src
packages/plugin/src` clean. `npx prettier --check` clean on every touched source file
(goldens JSON excluded, per the coordinator's own `.prettierignore` addition).
New-code coverage: `packages/supervisor/src/intake` 100%/96.4% (line/branch),
`packages/cli/src/intake` 97.5%/86.4%, `packages/cli/src/approval` 98%/96.1% — all
comfortably clear 80%.

## Exit criterion → evidence mapping

1. **E2E (fake engine): request → contract → approval → run; halts correctly on each of
   the 7 seeded stop conditions independently.**
   `packages/cli/src/intake/intake.e2e.test.ts` — 9 tests: full request → contract →
   mint → verify → `ready` path; a replayed-after-re-approval token fixture; and
   `it.each` over `STOP_CONDITION_KINDS` (7 entries) each independently driving a fresh
   run to `running` then halting it, asserting `blocked` and no other transition.
   Underlying primitives: `packages/supervisor/src/intake/stop-conditions.ts` +
   `stop-conditions.test.ts` (unit-level, same 7-condition `it.each`).

2. **Model self-approval fixture fails closed; worker-context
   `contract.approve` call without a token fails closed.**
   `packages/cli/src/intake/contract-approve-handler.test.ts` ("fails closed for a
   scripted call with no pre-minted token", "worker-context fixture: a
   legitimately-registered caller still cannot approve without the real token
   payload") and `packages/cli/src/approval/durable-approval-ledger.test.ts` (forged
   token, wrong secret key, wrong subject kind — all fail closed via
   `ApprovalTokenSignatureError`/`ApprovalTokenMismatchError`).

3. **Envelope hash stable across repeat builds of an unchanged fixture; amendment
   produces a distinct hash and invalidates the prior token.**
   `packages/supervisor/src/intake/envelope-builder.test.ts` (byte-identical
   two-build test + fast-check property test + one-field-mutation test) and
   `packages/supervisor/src/intake/amendment.test.ts` (new distinctly-hashed envelope,
   `ChangeSet.authorizationEnvelopeId` repointed). The "prior token replay fails"
   half is `durable-approval-ledger.test.ts`'s "envelope-tamper / amendment fixture"
   test and `intake.e2e.test.ts`'s replay fixture.

4. **Unmapped requirement blocks the `ready` transition (unit test against 02's state
   machine).**
   `packages/supervisor/src/intake/readiness-gate.test.ts` — asserts
   `UnmappedRequirementError` is thrown BEFORE the real `runLifecycleTransition`
   validator (`@eo/contracts`) is ever reached (no journal write, no registry
   mutation), and that full coverage transitions cleanly to `ready`. Also exercised
   end-to-end via `contract-approve-handler.test.ts`'s "verifies but refuses ready
   when a requirement is unmapped" test.

5. **`project.inspect` returns a valid partial report with no 07/12 data journaled
   yet, and correct ChangeSet-state answers across a fixture set spanning every 02
   run-lifecycle stage.**
   `packages/supervisor/src/intake/project-inspect.test.ts` — empty-journal fixture
   test; a fixture set built from `RUN_LIFECYCLE_STATES` (all 11 members) each queried
   individually and via the unscoped listing; an unknown-id query degrades gracefully.
   `packages/cli/src/intake/project-inspect-handler.test.ts` wraps the same for the
   MCP-tool-facing surface.

6. **Golden `IntentContract`/DAG/`AuthorizationEnvelope`/`CapabilityManifest`
   fixtures byte-stable across two builds.**
   `packages/supervisor/src/intake/goldens/` — `fixture-request.ts` (fixed literal
   ids/timestamps, mirrors `packages/engine-core/src/goldens/canonical-envelopes.ts`'s
   convention), `generate-golden-artifacts.ts`, `generate-golden-artifacts.test.ts`
   (byte-diff against 6 committed files under `packages/supervisor/goldens/` +
   two-consecutive-build deep-equal test), `packages/supervisor/scripts/write-goldens.ts`
   (mirrors `packages/engine-core/scripts/write-goldens.ts`).

7. **`ChangeSet` creation idempotent: re-inspecting an unchanged repo never produces a
   second `ChangeSet` (journal-verified).**
   `packages/supervisor/src/intake/intake-pipeline.test.ts` — "re-inspecting an
   unchanged repo never creates a second ChangeSet" asserts exactly 1
   `remote_operation_record` and exactly 1 `run_transition` journal entry across two
   `runIntake` calls with identical content; a further test proves rehydration against
   a *fresh, empty* registry set (simulating a new process against the same journal)
   still yields exactly 1 `ChangeSet`; a conflict (same `requestKey`, changed content)
   never creates a second `ChangeSet` either.

## Files

**`packages/supervisor/src/intake/`** (new): `canonical-hash.ts`, `stable-id.ts`,
`envelope-builder.ts`, `capability-manifest-builder.ts`, `dag-builder.ts`,
`contract-builder.ts`, `performance-contract-builder.ts`, `change-set-transition.ts`,
`readiness-gate.ts`, `stop-conditions.ts`, `project-inspect.ts`, `amendment.ts`,
`intake-pipeline.ts`, `goldens/` (fixture + generator), plus one `.test.ts` per module.
`packages/supervisor/goldens/*.json` (6 committed golden files),
`packages/supervisor/scripts/write-goldens.ts`. `packages/supervisor/src/index.ts`
(barrel additions only).

**`packages/cli/src/`** (new): `intake/tool-definitions.ts`,
`intake/project-inspect-handler.ts`, `intake/contract-approve-handler.ts`,
`intake/run-intake-command.ts`, `intake/intake.e2e.test.ts`, one `.test.ts` per new
module, `approval/durable-approval-ledger.ts` (+ test). Modified (additive only):
`approval/token.ts` (exports `verifySignature`/`TokenPayload`, previously
module-private — no behavior change), `commands/types.ts` (`IntakeDependencies`,
`CliDependencies.intake?`), `commands/real-handlers.ts` (`runRunCommand`),
`commands/dispatch.ts` (`run` case now calls `runRunCommand` — still
`NOT_IMPLEMENTED` when `deps.intake` is absent, mirroring the `installer` pattern
exactly), `index.ts` (barrel additions), `commands/intake-dispatch.test.ts` (new,
mirrors `installer-dispatch.test.ts`).

**`packages/plugin/`**: no changes. Phase 10 already shipped everything 11 needed —
`skills/approve/SKILL.md` already describes exactly this phase's approval flow
correctly (`disable-model-invocation: true`, delegates to 09's `runApprovalFlow`,
never mints itself); `capability-entry.ts`'s `buildPluginCapabilityEntry`/
`buildEngineCapabilityEntry` are consumed by
`packages/supervisor/src/intake/capability-manifest-builder.ts`'s caller-supplied
`pluginEntry`/`engineEntry` parameters with no code change needed on the plugin side.

## New public interfaces for downstream consumption (13)

From `@eo/supervisor`: `runIntake`/`IntakeRequest`/`IntakeArtifacts`/`IntakeOutcome`,
`buildIntakeArtifacts`, `computeIntentContractId`, `transitionChangeSetToReady`,
`transitionChangeSet`, `haltOnStopCondition`/`STOP_CONDITION_KINDS`,
`runProjectInspect`, `amendEnvelope`/`ChangeSetAlreadyTerminalError`,
`buildAuthorizationEnvelope`/`hashEnvelopeContent`, `buildCapabilityManifest`
(now also accepting `engineAdapter`), `buildWorkUnitGraph`/`findUnmappedRequirements`,
`buildIntentContract`, `computeRequirementId`, `buildProvisionalPerformanceContract`,
`canonicalHash`/`canonicalStringify`, `deriveStableId`,
`createAuthorizationEnvelopesRegistry` (new registry added during the
adversarial-validation repair pass, C1).

From `engineering-orchestrator` (`packages/cli`): `PROJECT_INSPECT_TOOL`,
`CONTRACT_APPROVE_TOOL`, `registerIntakeTools`, `runProjectInspectTool`,
`runContractApprove`/`ExpectedDigestMismatchError` (new, C1 repair),
`runIntakeCommand`, `verifyApprovalTokenDurable` (now lease-serialized, H2 repair),
`verifySignature`/`TokenPayload` (now exported from `approval/token.ts`). Both
`ContractApproveDeps` and `IntakeDependencies`/`RunIntakeCommandDeps` now require an
`envelopes: Registry<AuthorizationEnvelope>` — a BREAKING shape change from the
initial build for any caller constructed since (none existed downstream yet; 13 is
the only planned consumer and has not landed).

## Deviations (documented scope decisions)

- **Contract/requirement narrative drafting is out of reach for a deterministic TDD
  suite.** The manager-session `eo-explore`/`eo-reviewer` flow that drafts an
  `IntentContract`'s narrative sections and a DAG's requirement/work-unit content is
  live LLM orchestration — this phase implements the deterministic ASSEMBLY pipeline
  that flow's output feeds into (`contract-builder.ts`, `dag-builder.ts`), taking
  already-drafted structured input. Documented at each builder's own file-level doc
  comment.
- **`run` CLI argv surface is unchanged.** `roadmap/11`'s own text says "11 implements
  the pre-dispatch intake → contract → approval sequence that `run` invokes." This is
  implemented as a fully real, fully tested orchestration function
  (`packages/cli/src/intake/run-intake-command.ts`) wired into `dispatch.ts`'s `run`
  case behind an optional `deps.intake` dependency (mirroring the exact
  `installer`-optionality pattern roadmap/10 already established) — but
  `../argv/types.ts`'s `RunCommand`/`../argv/parse-command.ts` were NOT extended with a
  new request-payload flag, to avoid touching 09's own pre-existing, already-tested
  argv surface for a request-payload encoding this phase's source material never pins.
  Real production wiring (how `readIntakeRequest` resolves an on-disk drafted request)
  is `../bootstrap.ts`'s job, outside this phase's own file-touch boundary.
- **DAG model-routing ("balanced routing") is not computed here.** `WorkUnit.role` and
  `CapabilityManifest`'s model-roster entries are recorded as caller-supplied input;
  13 owns the role→model alias-map resolution algorithm per its own roadmap file.
- **`CapabilityManifest` folding avoids a `@eo/supervisor → packages/detect` dependency
  edge** (which would close a cycle: `detect → cli → supervisor`). 12's quarantine
  entries and 10's plugin/engine entries are accepted as already-built,
  caller-supplied parameters (`BuildCapabilityManifestOptions`) rather than read
  directly from `packages/detect`'s on-disk capability store inside this package.
- **Stop-condition target state.** All 7 named conditions drive the identical
  `-> blocked` transition when applied to an in-flight run — `@eo/contracts`'s fixed
  transition table has no `-> awaiting_approval` edge from any in-flight stage (only
  from `draft`), so `blocked` is the only legal non-success target from `ready`
  onward. Documented in `stop-conditions.ts`'s own file-level doc comment; the
  "fresh approval required" half of each condition's semantics is satisfied by the
  amendment flow producing a new envelope/token for a *future* re-dispatch, not by
  resurrecting the blocked run in place (roadmap/11 §Risks already flags this exact
  hand-off as unresolved, for whoever lands 13's consumption path).

## Carry-forwards from prior phases

- **09's in-memory, single-process approval-token ledger — RESOLVED for 11's own
  cross-process call path.** `packages/cli/src/approval/durable-approval-ledger.ts`
  verifies a token's signature/expiry/subject-binding via `token.ts`'s now-exported,
  stateless `verifySignature`, and tracks single-use consumption via 04's
  `IdempotencyRegistry` (`@eo/journal`, journal-backed, durable across both a process
  boundary and a restart) — keyed by `(tokenId, "<subjectKind>:<digest>")`. Proven in
  `durable-approval-ledger.test.ts`'s "verifies a token minted by a DIFFERENT
  `ApprovalTokenMinter` instance" test (the in-memory `ApprovalTokenMinter.verify()`
  called from a second instance is shown, in the same test, to incorrectly throw
  `ApprovalTokenAlreadyVerifiedError` for a legitimate first verification — the exact
  gap this module closes). `ApprovalTokenMinter.verify()` itself is left completely
  unchanged (still correct for same-process callers); this is an additional, durable
  path layered on top, not a replacement — `contract.approve`'s handler
  (`contract-approve-handler.ts`) uses ONLY the durable path.
- **12's `trust review|approve|revoke` CLI wiring — left as-is, NOT this phase's job.**
  `contract.approve` (this phase) and `capability.approve` (12,
  `packages/detect/src/mcp/capability-approve-handler.ts`) are deliberately separate
  verify-only gates over separate subjects (`envelope_hash` vs `capability_digest`,
  enforced by `ApprovalTokenMinter`'s own subject-kind discriminator — 09's own
  guarantee, reused verbatim). Roadmap/11's own In/Out-of-scope sections never name
  `trust review|approve|revoke`'s CLI-dispatch wiring as this phase's work; wiring
  `packages/detect`'s trust backend into `packages/cli`'s `dispatch.ts` belongs to
  whichever phase owns that CLI-surface decision (12 itself, or 23's release
  hardening) — left untouched here, `trust-review`/`trust-approve`/`trust-revoke`
  still return the typed `NOT_IMPLEMENTED` shape in `dispatch.ts`, unchanged by this
  phase.

## Deferred root-config / dependency changes (none made; described here)

- **`.prettierignore`** should gain a `packages/supervisor/goldens/` entry, mirroring
  the two existing entries for `packages/engine-core/goldens/` and
  `packages/engine-claude/goldens/` — these 4 committed golden JSON files use the
  same fixed `JSON.stringify(value, null, 2)` + trailing-newline convention (never
  Prettier-reformatted) as those two precedents. This phase's hard file-touch
  boundary excludes root config, so the line could not be added here; `npx prettier
  --check` was run excluding `packages/supervisor/goldens/**` for this reason (see
  Gate results below). No other root-config or external-dependency change was
  required — every new dependency used (`@eo/journal`'s `IdempotencyRegistry`,
  `@eo/testkit` fixtures, `@eo/plugin`'s existing capability-entry builders) was
  already present in the lockfile via existing internal workspace `package.json`
  dependency edges (`packages/cli`→`@eo/supervisor`/`@eo/plugin`,
  `packages/supervisor`→`@eo/journal`, both devDependency edges on `@eo/testkit`
  already present) — no `package.json`/`package-lock.json` edit was made or needed.
- **Unrelated, pre-existing dirty working-tree state observed but NOT touched:**
  `package-lock.json`, `packages/connectors-jira/**`, `packages/connectors-grafana/**`
  appeared/changed in the working tree during this session but were never written by
  this phase's own work (confirmed via `git status --short -- packages/supervisor
  packages/cli packages/plugin docs/evidence`, which shows only this phase's own
  files) — almost certainly concurrent, unrelated in-flight work (phases 18-20) in the
  same shared working directory.

## Gate results

- `npx tsc -b packages/supervisor packages/cli packages/plugin` — clean, no errors.
- `npx vitest run packages/supervisor packages/plugin packages/cli --coverage.enabled=false`
  — 112 test files, 643 tests, all passing (pre-existing tests from phases 05/09/10
  unchanged and still green; phase 11 adds ~120 new tests across both packages).
- `npx eslint packages/supervisor/src packages/cli/src packages/plugin/src` — clean.
- `npx prettier --check` on every touched `.ts`/`.md`/`.json` source file — clean;
  `packages/supervisor/goldens/*.json` excluded from this check (see "Deferred
  root-config" above) since they are machine-generated, byte-stability-pinned
  artifacts, identical in kind and rationale to the two pre-existing
  `.prettierignore`-exempted golden directories.
- Coverage (new code only, isolated per-directory from the mixed-package coverage
  run): `packages/supervisor/src/intake` — 100% statements/lines, 96% branches, 100%
  functions. `packages/cli/src/intake` — 100% statements/lines, 83.3% branches, 100%
  functions. `packages/cli/src/approval` (incl. `durable-approval-ledger.ts`) —
  97.8% statements, 95.5% branches, 100% functions, 97.75% lines. All comfortably
  clear the 80%-line-and-branch ground rule for new code; the repo-wide
  `npx vitest run --coverage` gate (all packages together) was not re-run in full
  here since packages outside this phase's scope (e.g. in-flight
  connectors-jira/connectors-grafana work noted above) are mid-development and not
  this phase's responsibility to bring to threshold.
