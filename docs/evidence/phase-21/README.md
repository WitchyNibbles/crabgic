# Phase 21 — Connector evidence integration & drift CI: evidence

Governing spec: `roadmap/21-connector-evidence-integration.md`. This note maps each
exit criterion to its test/artifact, records deviations from the source material, and
lists carry-forwards for reconcile. Format follows `docs/evidence/phase-14/README.md`.

## Summary

- **Files added (33):** 30 new `.ts` source/test files + 1 golden JSON fixture
  + 1 new test file added to an existing directory + this evidence doc:
  - `packages/gates/src/`: `remote-evidence-pointer.ts` (+`.test.ts`), `remote-
    verification-gate.ts` (+`.test.ts`), `materiality-classifier.ts` (+`.test.ts`,
    `.property.test.ts`), `traceability-view.ts` (+`.test.ts`), `security-fixture-
    manifest.ts` (+`.test.ts`), `materiality-jira-adapter.ts` (+`.test.ts` —
    adversarial-round addition), `material-amendment-guard.ts` (+`.test.ts` —
    adversarial-round addition), `remote-verification-e2e.test.ts` (adversarial-
    round addition — no matching `.ts`, it is itself the integration suite).
  - `packages/gates/src/drift/`: `drift-proposal.ts`, `debounce.ts`, `run-drift-
    ci.ts`, `pinned-fixtures.ts`, `cli.ts` (+ one `.test.ts` each) and `no-pinned-
    write.test.ts` (structural scan).
  - `packages/gates/goldens/phase-21/traceability-view.golden.json`.
  - `packages/connectors-jira/src/evidence/done-transition-verification.ts`
    (+`.test.ts`) — additive bridge to 18's pre-existing
    `assertDoneTransitionHasEvidence`.
  - `packages/connectors-jira/src/resource-client/issue-plans.test.ts` —
    adversarial-round addition (no test file existed for this module before).
  - `packages/connectors-grafana/src/evidence/stamp-grafana-remote-resource.ts`
    (+`.test.ts`) — additive revision stamper, mirrors 18's `stampJiraRemoteResource`.
  - `.github/workflows/drift-ci.yml` — new scheduled + manual-dispatch CI job.
- **Files modified (8):** `packages/gates/package.json`/`tsconfig.json` (new
  workspace deps: `@eo/connectors-jira`, `@eo/connectors-grafana`, `@eo/gateway` —
  no new third-party package; `package-lock.json` sync deferred, per the task
  brief, to gate time), `packages/gates/src/index.ts` (barrel additions),
  `packages/connectors-jira/src/index.ts` / `packages/connectors-grafana/src/
  index.ts` (barrel additions for the new additive evidence modules, plus newly
  exporting `containsSecretShapedContent`/`JIRA_SECRET_PATTERNS`, previously
  internal-only), `.prettierignore` (one new entry for the golden fixture
  directory, mirroring every prior phase's identical `goldens/*.json` precedent),
  `packages/connectors-jira/src/resource-client/issue-plans.ts` and
  `.../jira-resource-client.ts` (adversarial-round MAJOR-2 fix — additive
  optional-parameter wiring, see below), `packages/gates/goldens/phase-21/
  traceability-view.golden.json` (adversarial-round MINOR-3 fix — regenerated
  for the corrected structured-binding shape).
- **Tests:** 18 dedicated new/rewritten test files contribute **109 tests**, all
  passing in isolation. The full 3-package suite (`packages/gates`,
  `packages/connectors-jira`, `packages/connectors-grafana`) is **122 test
  files / 934 tests, all passing** (this phase's own new work plus every
  pre-existing 14/18/19/20 test, unmodified).
- **Coverage** (this phase's own new/modified code — the phase-21 modules in
  `packages/gates/src` + `packages/gates/src/drift/**/*.ts` +
  `packages/connectors-jira/src/evidence/**/*.ts` +
  `packages/connectors-jira/src/resource-client/issue-plans.ts` +
  `packages/connectors-grafana/src/evidence/**/*.ts`, excluding `*.test.ts`):
  **96.3% statements, 89.34% branches, 97.5% functions, 98.78% lines** —
  clears the ≥80% line+branch ground rule comfortably.
- `npx tsc -b` on this phase's own package subset (`packages/gates
  packages/connectors-jira packages/connectors-grafana`, which recursively
  builds their full dependency closure — `@eo/contracts`, `@eo/journal`,
  `@eo/detect`, `@eo/engine-core`, `@eo/scheduler`, `@eo/gateway`, `@eo/renderer`,
  `@eo/testkit`): **clean**. A whole-monorepo `npx tsc -b` intermittently fails
  with `TS5055` inside `packages/learning/dist/*` — a pre-existing/concurrent
  build-state issue in the sibling phase-22 worker's own package (which added a
  new `learning→gates` dependency edge mid-session), reproduced identically on
  repeated retries at points when that sibling session was concurrently
  rebuilding; **not caused by, and outside the fix authority of, this phase**
  (touching `packages/learning` is explicitly out of scope). This phase's own
  packages and everything they depend on build clean in isolation.
- `npm run lint` (whole monorepo, ESLint): **clean**.
- `npm run format` (whole monorepo, `prettier --check .`): **clean for every file
  this phase touched** (`packages/perf`/`packages/learning` show pre-existing
  formatting warnings from the concurrent sibling phase-15/22 workers' own
  in-progress files — not touched or introduced by this phase).
- Whole-repo suite (`npx vitest run`, all 18 packages): pre-existing failures
  confined to `@eo/perf` (sibling phase-15 work-in-progress, out of this phase's
  package boundary) plus intermittent host-load-flaky timing tests elsewhere in
  the repo (e.g. a `ratchet.property.test.ts` run failed once under full-suite
  parallel load and passed cleanly on immediate re-run in isolation and as part
  of the 3-package suite — a known class of flake already documented in this
  repo's own memory, not a regression). **Zero phase-14/18/19/20 test regressed
  — the 3-package suite (`packages/gates packages/connectors-jira
  packages/connectors-grafana`) is 122/122 test files and 934/934 tests passing,
  confirmed on repeated runs.**

## Adversarial-validation repair pass (2026-07-24)

A fresh adversarial validator returned FAIL (narrowly) on the initial build:
solid, non-vacuous unit-level engineering, but 2 MAJORs sitting on the phase's
own exit bar plus 3 MINORs. All 5 were fixed strict-TDD (a RED test written and
confirmed failing against the pre-fix code FIRST, then fixed to GREEN).

- **MAJOR-1 (exit criterion 1 checked off without its stated evidence; every
  phase-21 unit was UNWIRED — zero non-test callers) — FIXED.**
  `createRemoteVerificationGate`, `recordEvidencePointer`, `classifyMateriality`,
  `registerSecurityFixtureManifest`, `hasExactRevisionVerification` each had
  zero callers outside their own unit tests; the criterion's own named
  evidence (an integration suite + a halted-run journal excerpt) didn't exist.
  Fixed by:
  1. **Real registry-fired integration test** —
     `remote-verification-e2e.test.ts` fires `createRemoteVerificationGate`
     THROUGH a real `createGateRegistry()` (`registry.register(...)` +
     `registry.fireByTag(...)`), never calling the handler directly, against a
     real `@eo/journal` `JournalStore`, for a 3-requirement fixture
     `ChangeSet`. This required a genuine design fix to
     `remote-verification-gate.ts`: `requiredRemoteResourceIds`/
     `connectorOutcome` now ALSO accept a per-requirement RESOLVER function
     (`(requirementId) => ...`), not only a fixed value — a real multi-
     requirement run needs ONE gate registration to correctly verify EVERY
     requirement's own required RemoteResource id(s)/outcome, which a single
     fixed value could never express. Backward-compatible: a plain fixed
     value still works unchanged (all pre-existing unit tests pass
     untouched).
  2. **The EvidenceRecord now literally carries the confirmed revision** —
     `remote-verification-gate.ts`'s `artifactDigests` gained a second digest
     per bound pointer, `confirmed-revision:<remoteResourceId>:<revision>`,
     making "every requirement's EvidenceRecord carries a confirmed remote
     revision" an inspectable fact about the emitted evidence, not merely an
     implication of the pass/fail verdict.
  3. **The halted-run journal excerpt** — captured via a standalone script
     against the real compiled modules (see "Journal excerpt" below) and
     reproduced by `remote-verification-e2e.test.ts`'s own journal-excerpt
     assertions (querying `tj.store.queryEntries({type:"evidence_pointer"})`
     after the run and asserting the req2 bound-and-confirmed entry durably
     landed).
  4. **The halt proof** — a new `material-amendment-guard.ts`
     (`throwIfMaterialAmendment`/`MaterialAmendmentDetectedError`) plus two
     new E2E tests proving a material `MaterialAmendmentSignal` halts BEFORE
     `registry.fireByTag(...)` for `final_verifying` is ever reached (a
     `finalVerifyingGateFired` flag is asserted `false` after the halt, and
     `true` for the non-material control case) — 21 supplies the signal; 11
     owns the real stop-condition/re-approval mechanics (not
     reimplemented).
  5. **The classifier is now fed 18's REAL field-identifier shape, closing
     the false-negative direction** — new `materiality-jira-adapter.ts`
     (`buildJiraFieldDiffs`/`normalizeJiraFieldId`) maps a raw Jira issue
     field snapshot (built-in `summary`/`description` keys, or an arbitrary
     `customfield_NNNNN` id for anything else — Jira's real wire shape,
     never a literal `"acceptance-criteria"` string) through DISCOVERED
     field metadata (`JiraFieldMetadata.name`) to the tracked semantic field
     name. A dedicated test proves the exact gap this closes: feeding
     `classifyMateriality` the RAW `customfield_10057` id directly (no
     normalization) does NOT match, but through `buildJiraFieldDiffs` it
     correctly resolves to `"acceptance-criteria"` and IS material — the
     silent-overwrite direction the validator flagged.

- **MAJOR-2 (evidence-doc claimed `hasExactRevisionVerification` was "wired
  directly into" 18's `assertDoneTransitionHasEvidence" — false; it was
  dead relative to any real done-transition) — FIXED (PREFERRED path taken:
  actually wired it in).**
  `planIssueTransition` (`issue-plans.ts`) gained an ADDITIVE, OPTIONAL 8th
  parameter, `resolveVerificationPointer?: (issueKey) =>
  RemoteVerificationPointer | undefined`; when supplied, its result is run
  through `hasExactRevisionVerification` and OR'd with the existing
  `hasVerificationEvidence` boolean (either satisfies the guard — never a
  MORE permissive combination than either alone). Omitted entirely, behavior
  is byte-identical to before this fix — proven by a new
  `issue-plans.test.ts` (no test file existed for this module before) whose
  own "no resolver at all" case reproduces the exact pre-existing refusal
  behavior. `CreateJiraResourceClientDeps` (`jira-resource-client.ts`) gained
  the matching optional `resolveVerificationPointer` dependency, threaded to
  the real `issues.planTransition` call site — so the wiring is reachable
  from actual client CONSTRUCTION, not just the underlying function in
  isolation. Both changes verified additive via dedicated RED→GREEN tests
  (see below) plus the full pre-existing `jira-resource-client.test.ts` (38
  tests, all still passing) and the whole `packages/connectors-jira` suite
  (18+19) staying green.

- **MINOR-1 (`DriftProposal` redaction weaker than the "16's discipline" it
  claims to reuse — key-name-based redaction alone missed a secret embedded
  in a non-secret-named field's free text) — FIXED.** `drift-proposal.ts` now
  applies BOTH halves of 16/20's redaction discipline in sequence:
  `redactSecretBearingObject` (key-name-based) THEN
  `redactCredentialShapedText` (content-shaped) over the full serialized
  diff. RED regression (`drift-proposal.test.ts`, "a secret-SHAPED token
  embedded in a non-secret-named field's free text is ALSO redacted")
  reproduced the exact counterexample from the fix spec
  (`{errorBody: "... glsa_AAAA..."}`) leaking against the pre-fix code.

- **MINOR-2 (pointer discriminator ignored the `gateTag` "belt" it
  advertised) — FIXED.** `remote-evidence-pointer.ts`'s `toPointer` now
  enforces `entry.gateTag === "remote_verification"` in addition to the
  `command`-prefix check. RED regression
  (`remote-evidence-pointer.test.ts`, "an entry whose command matches the
  pointer-encoding prefix but whose gateTag is NOT remote_verification is
  rejected") reproduced the bogus entry being misread as a real pointer
  against the pre-fix code. (Independently corroborated by the real captured
  journal excerpt below, which shows the registry's OWN gate-firing evidence
  entries — `gateTag: "security"`, `command: "remote_verification"` — living
  in the SAME journal as this module's pointer entries — `gateTag:
  "remote_verification"`, `command: "remote-resource-pointer:..."` — without
  being misread as pointers.)

- **MINOR-3 (traceability "both directions" proven only in degenerate 1:1
  topology; `confirmedRevisions` sourced from `RemoteResource.revision`, NOT
  `pointer.confirmedRevision`, risking silent divergence from the gate/
  done-bridge's trusted value, and silently dropping the revision for a
  pointer whose resource is absent from the input list) — FIXED.**
  `traceability-view.ts`'s `TraceabilityEntry` shape changed from two
  independently-deduped parallel arrays (`remoteResourceIds`/
  `confirmedRevisions`) to one structured array,
  `remoteResources: readonly TraceabilityRemoteBinding[]`
  (`{remoteResourceId, relation, confirmedRevision?}`) — each binding is now
  intrinsically 1:1, never misalignable. `confirmedRevision`'s source
  precedence is now explicit: `pointer.confirmedRevision` FIRST (the exact
  value the gate/done-bridge trust), falling back to `RemoteResource.revision`
  only when the pointer carries none; if NEITHER source has one, the binding
  is still emitted (never silently dropped) with `confirmedRevision`
  `undefined`. New tests: fan-IN (2 requirements → 1 shared RemoteResource,
  both appear in `byRemoteResourceId`), fan-OUT (1 requirement → 2 distinct
  RemoteResources, both bindings present), duplicate-pointer collapse,
  precedence-divergence (pointer wins over a deliberately stale
  `RemoteResource.revision`), fallback (pointer has no revision), and the
  absent-RemoteResource case (binding survives with `confirmedRevision:
  undefined`). The golden fixture was regenerated for the new shape (RED
  confirmed against the OLD golden before rewriting it).
  **NIT (cosmetic, left as-is per the fix spec):** the drift job's "zero
  pinned-fixture/config changes" property is proven by construction
  (`run-drift-ci.ts` has no write capability beyond its two injected deps)
  plus a structural source scan (`no-pinned-write.test.ts`) — no separate
  before/after repo-state-diff artifact file was added; this is a cosmetic
  gap in artifact FORM, not in the underlying guarantee, which is already
  proven two independent ways.

### Journal excerpt (MAJOR-1's named evidence artifact)

Captured by constructing the exact `remote-verification-e2e.test.ts` scenario
against the real compiled modules (`packages/gates/dist`), fixed clock,
deterministic ids — reproduced verbatim by the test suite itself (the
`journalExcerpt` assertions in "a run completes ... only once every
requirement's EvidenceRecord carries a confirmed remote revision"). Showing
requirement `req2`'s two entries — the BLOCKED state (before its pointer is
recorded) and the eventual bound-and-confirmed state that lets the run
complete:

```json
// evidence_pointer entry #2 (seq 2) — the registry's OWN gate-firing evidence
// for req2, BEFORE its RemoteResource pointer is recorded: BLOCKED.
{
  "type": "evidence_pointer",
  "payload": {
    "requirementId": "10000000-0000-4000-8000-0000000000e2",
    "command": "remote_verification",
    "exitStatus": 1,
    "gateTag": "security",
    "objectId": "object-req2",
    "artifactDigests": []
  }
}

// (18/20 confirm the read-back revision; recordEvidencePointer writes:)
// evidence_pointer entry #3 (seq 3) — THIS module's own pointer encoding
// (gateTag: "remote_verification", command: "remote-resource-pointer:...").
{
  "type": "evidence_pointer",
  "payload": {
    "requirementId": "10000000-0000-4000-8000-0000000000e2",
    "command": "remote-resource-pointer:tracking-issue:20000000-0000-4000-8000-0000000000e2",
    "gateTag": "remote_verification",
    "objectId": "object-req2",
    "artifactDigests": ["remote-revision:3"]
  }
}

// evidence_pointer entry #4 (seq 4) — the registry's re-fired gate-firing
// evidence for req2, AFTER the pointer is recorded: PASSED, and the
// EvidenceRecord now literally carries the confirmed revision.
{
  "type": "evidence_pointer",
  "payload": {
    "requirementId": "10000000-0000-4000-8000-0000000000e2",
    "command": "remote_verification",
    "exitStatus": 0,
    "gateTag": "security",
    "objectId": "object-req2",
    "artifactDigests": [
      "remote-resource:20000000-0000-4000-8000-0000000000e2:tracking-issue",
      "confirmed-revision:20000000-0000-4000-8000-0000000000e2:3"
    ]
  }
}
```

This durably proves, in the journal itself: (a) the run genuinely BLOCKED
before the pointer existed (entry #2, `exitStatus: 1`), (b) the pointer
recording is a real, distinct journal write correctly discriminated from the
gate-firing evidence by `gateTag` (MINOR-2's fix — both kinds of
`evidence_pointer` entry coexist in the same journal without collision), and
(c) the run only completes once the EvidenceRecord itself carries
`confirmed-revision:<id>:<revision>` (MAJOR-1's own literal-evidence fix).

## Exit criterion → evidence mapping

- [x] **E2E on fakes: a run completes only when every requirement's
  `EvidenceRecord` carries a confirmed remote revision; a seeded mid-run
  tracked-field edit halts the run via 11's `material amendment` stop condition
  before `final_verifying`.**
  Evidence (adversarial-round MAJOR-1 fix — see "Adversarial-validation repair
  pass" above): **`packages/gates/src/remote-verification-e2e.test.ts`**, the
  named integration suite the criterion itself calls for. It fires the
  `remote_verification` gate THROUGH a real `createGateRegistry()`
  (`register`/`fireByTag`), against a real `@eo/journal` `JournalStore`, for a
  3-requirement fixture `ChangeSet`: (1) "a run completes ... only once every
  tracked requirement's EvidenceRecord carries a confirmed remote revision" —
  seeds one bound+confirmed requirement and one initially-unbound requirement,
  proves the run does NOT complete (`allGatesPassed` false) until the second
  is also bound+confirmed (`allGatesPassed` true), and asserts the emitted
  `EvidenceRecord.artifactDigests` literally contains
  `confirmed-revision:<id>:<revision>`; (2) "unsupported/ambiguous_write ...
  never a silent pass" fired through the same real registry, per requirement;
  (3) "a seeded mid-run material field edit halts BEFORE final_verifying
  completes" — feeds `materiality-jira-adapter.ts`'s `buildJiraFieldDiffs`
  (18's REAL Jira custom-field-id shape, e.g. `customfield_10057` for
  "Acceptance Criteria" — never the literal string `"acceptance-criteria"`,
  closing the false-negative direction the validator flagged) →
  `buildMaterialAmendmentSignal` → `throwIfMaterialAmendment`
  (`material-amendment-guard.ts`, new) and asserts the requirement's
  `final_verifying` gate is NEVER reached (a `finalVerifyingGateFired` flag
  stays `false`), with a control case proving a non-tracked-field edit does
  NOT halt. The halted run's **journal excerpt** is captured and included
  verbatim in the "Adversarial-validation repair pass" section above,
  reproduced by the suite's own journal-query assertions. Per the roadmap's
  own explicit division of labor ("21 supplies the trigger signal, 11 owns the
  amendment/re-approval mechanics"), the REAL stop-condition/re-approval
  machinery (11's already-built infrastructure, reached transitively
  21→14→13→11) is not re-implemented here — `throwIfMaterialAmendment` is
  this phase's own minimal, testable proof that the signal WOULD halt.

- [x] **`unsupported`-mapped and `ambiguous_write` remote operations block the
  `final_verifying`→`published_local` transition (02) with an actionable
  `EvidenceRecord` entry, never a silent pass.**
  Evidence: `packages/gates/src/remote-verification-gate.test.ts`'s "canonical-
  error fault matrix" block — `it.each(["unsupported", "ambiguous_write"])`
  proves both block regardless of pointer state, with an actionable `detail`
  string naming the exact canonical kind; a companion `it.each` over the other 8
  canonical members proves they do NOT block by themselves (no over-widening).

- [x] **Drift-CI job run against an intentionally bumped fixture produces
  exactly one `DriftProposal` artifact and a red CI check, with zero
  pinned-fixture/config changes applied by the job itself.**
  Evidence: `packages/gates/src/drift/run-drift-ci.test.ts` ("failing-first:
  intentionally bumped fixture produces a red check, debounced" — a bumped Jira
  fixture withdrawing the `description` field produces exactly one
  `DriftProposal` and `redCheck: true` on the 2nd consecutive run;
  `debounceThreshold: 1` produces it on the very first run) +
  `packages/gates/src/drift/cli.test.ts` (the real, injectable-fs entrypoint,
  exercised against a real temp directory) + `.github/workflows/drift-ci.yml`
  (the actual scheduled/manual-dispatch CI job, wired to upload the proposal as
  an artifact for human review, never applying it). "Zero pinned-fixture/config
  changes applied by the job itself" is proven twice: (a) by construction —
  `run-drift-ci.ts`'s only two side-effecting capabilities are the
  caller-injected `saveDebounceState`/`writeProposals` functions, with no other
  write primitive reachable from its own code, confirmed by
  `packages/gates/src/drift/no-pinned-write.test.ts`'s structural source scan;
  (b) `run-drift-ci.test.ts`'s "always calls writeProposals exactly once and
  never any capability beyond saveDebounceState/writeProposals" test, asserting
  the injected-deps object's own key set is the full extent of the function's
  write surface. Debounce: `packages/gates/src/drift/debounce.test.ts` proves a
  passing run resets the counter and per-key counters never cross-contaminate.

- [x] **Traceability view resolves requirement → work unit → exact object ID →
  RemoteResource → confirmed revision, both directions, on a seeded
  multi-requirement `ChangeSet`.**
  Evidence: `packages/gates/src/traceability-view.test.ts` — 3 requirements (2
  Jira-tracked, 1 Grafana-tracked), asserting the FULL forward chain
  (`requirementId → workUnitIds → objectIds → remoteResources[]`, each binding
  a structured `{remoteResourceId, relation, confirmedRevision}` — adversarial-
  round MINOR-3 fix, see above) and the REVERSE index (`byRemoteResourceId`),
  matched byte-for-byte against the committed golden fixture
  `packages/gates/goldens/phase-21/traceability-view.golden.json` (regenerated
  for the corrected shape; fixed 2-space `JSON.stringify` + trailing newline,
  same convention as every prior phase's `goldens/*.json`). Non-degenerate
  topology is now exercised explicitly: fan-in (2 requirements → 1 shared
  RemoteResource), fan-out (1 requirement → 2 distinct RemoteResources),
  duplicate-pointer collapse, `confirmedRevision` source precedence
  (pointer wins over a stale `RemoteResource.revision`), fallback (pointer
  carries none), and the absent-RemoteResource case (binding survives with
  `confirmedRevision: undefined` rather than silently dropping).

- [x] **16/18/20's security fixtures (forged admin/delete, tenant boundary,
  redaction) are present as blocking entries in 14's gate manifest; removing
  one fails the manifest-completeness test.**
  Evidence: `packages/gates/src/security-fixture-manifest.test.ts` —
  `SECURITY_FIXTURE_MANIFEST` names 7 entries across all 3 categories and all 3
  source phases (`jira-forged-admin-delete`/`grafana-forged-admin-delete` [18/
  20], `jira-tenant-boundary`/`grafana-tenant-boundary` [18/20, this phase's own
  new `assertTenantBoundary` guard — no equivalent existed pre-21],
  `jira-redaction`/`grafana-redaction`/`gateway-redaction` [18/20/16]), every
  entry `blocking: true`; the "failing-first proof" test removes each required
  id one at a time and asserts the completeness check throws naming it; each
  entry's `verify` handler is a REAL check re-exercising the actual exported
  primitive (`assertAllowedJiraOperation`, `createGrafanaProviderAdapter`,
  `containsSecretShapedContent`, `redactSecretBearingObject`,
  `mapHttpStatusToConnectorError`) — not a descriptive string or an
  always-pass stub, proven by a dedicated `it.each` running every entry's
  `verify` directly.

- [x] **Jira's `done` (18) and the Run lifecycle's `final_verifying`/
  `published_local` (02) are proven to share no member string.**
  Evidence: `packages/gates/src/remote-verification-gate.test.ts`'s
  "enum-disjointness" test — imports `RUN_LIFECYCLE_STATES` (02) and
  `JIRA_WORKFLOW_STAGES` (18) directly and asserts neither `final_verifying`
  nor `published_local` nor `done` is ever a shared member (the two unions DO
  coincidentally share the unrelated `blocked` spelling — 18's own
  `workflow-stage.ts` doc comment already documents this as "same spelling,
  unrelated enum, never to be conflated," and this test's assertions are scoped
  precisely to exclude that already-acknowledged, non-conflated overlap from
  being mistaken for the one being disproven).

## Work items → files

1. **Evidence-pointer population** — `remote-evidence-pointer.ts`
   (`recordEvidencePointer`, `findRemoteResourcePointersForRequirement`,
   `findRequirementsForRemoteResource`) + `.test.ts` (empty-journal-returns-
   empty failing-first; 3-requirement bidirectional round-trip; ordinary
   gate-firing evidence for the same requirement never misread as a pointer;
   adversarial-round MINOR-2 addition: a mismatched-`gateTag` collision entry
   is also rejected).
2. **Evidence binding** — the `remote_verification` gate's own `GateVerdict`
   (`remote-verification-gate.ts`) carries the confirmed remote revision via
   its `artifactDigests` (`remote-resource:<id>:<relation>` +, since the
   adversarial round, `confirmed-revision:<id>:<revision>` — MAJOR-1 fix),
   extending 14's existing single `emitEvidence` code path with no new
   emission path; `recordEvidencePointer`'s own `confirmedRevision` parameter
   (work item 1) is the other half of this binding.
3. **`remote_verification` gate** — `remote-verification-gate.ts`
   (`createRemoteVerificationGate`) + `.test.ts` (unbound-pointer failing-first;
   pass path; canonical-error fault matrix over the full 10-member union;
   enum-disjointness). Adversarial round: `requiredRemoteResourceIds`/
   `connectorOutcome` now ALSO accept a per-requirement resolver function
   (MAJOR-1 fix, enabling `remote-verification-e2e.test.ts`'s real
   multi-requirement run).
4. **Materiality classifier + amendment trigger** — `materiality-classifier.ts`
   (`classifyMateriality`, `buildMaterialAmendmentSignal`,
   `MATERIAL_TRACKED_FIELDS`) + `.test.ts` (non-tracked-field-only diff must
   NOT trigger, failing-first) + `.property.test.ts` (200-case fast-check
   property: material iff ≥1 changed diff touches a tracked field; a
   non-tracked-only diff set is never material, across the generated space).
   Adversarial-round additions: `materiality-jira-adapter.ts`
   (`buildJiraFieldDiffs`, `normalizeJiraFieldId` — bridges 18's real
   Jira field-identifier shape, closing the custom-field false-negative
   gap) + `.test.ts`; `material-amendment-guard.ts`
   (`throwIfMaterialAmendment`, `MaterialAmendmentDetectedError` — the
   halt-before-final_verifying proof) + `.test.ts`.
5. **Drift-CI job** — `drift/drift-proposal.ts` (`compareDriftFixture`, reusing
   `@eo/connectors-grafana`'s `redactSecretBearingObject` for "16's redaction
   discipline"), `drift/debounce.ts` (`DriftDebounceTracker`), `drift/
   run-drift-ci.ts` (`runDriftCi`, the injectable-I/O orchestrator), `drift/
   pinned-fixtures.ts` (fixture-modeled pinned baseline — see honesty section
   below), `drift/cli.ts` (the real-fs entrypoint `.github/workflows/
   drift-ci.yml` invokes) + one `.test.ts` per module + `no-pinned-write.test.ts`
   (structural scan).
6. **Cross-gate wiring** — `security-fixture-manifest.ts`
   (`SECURITY_FIXTURE_MANIFEST`, `registerSecurityFixtureManifest`,
   `assertTenantBoundary`) + `.test.ts` (manifest-completeness failing-first);
   connector latency is captured via the SAME `GateVerdict.artifactDigests`
   channel work item 2 already extends — no second evidence stream. Additive
   connector-package pieces: `connectors-jira/src/evidence/done-transition-
   verification.ts` (`hasExactRevisionVerification`) — **as of the
   adversarial-validation repair pass (MAJOR-2 fix), this IS now actually
   wired into 18's pre-existing `assertDoneTransitionHasEvidence`**: an
   earlier version of this evidence doc claimed this wiring existed when it
   did not (the function had zero callers relative to any real
   done-transition) — that claim has been corrected by actually performing
   the wiring, additively, in `issue-plans.ts`'s `planIssueTransition`
   (optional 8th parameter, OR'd with the pre-existing
   `hasVerificationEvidence` boolean) and `jira-resource-client.ts`'s
   `CreateJiraResourceClientDeps` (optional `resolveVerificationPointer`
   dependency, threaded to the real `issues.planTransition` call site) — see
   "Adversarial-validation repair pass" above for the full fix and its
   RED→GREEN tests. `connectors-grafana/src/evidence/stamp-grafana-remote-
   resource.ts` (`stampGrafanaRemoteResource`, mirroring 18's
   `stampJiraRemoteResource`, since 20 had no equivalent revision-stamping
   helper of its own) is unaffected by this correction.

## What is cassette-modeled vs live (honesty note, mirrors 19/20's precedent)

- **Evidence-pointer linkage, `remote_verification` gate, materiality
  classifier, traceability view, security-fixture manifest**: fully live/real.
  Real `@eo/journal` `JournalStore` instances over temp directories (real
  append/query, no mock); the security-fixture manifest's `verify` handlers
  call the ACTUAL exported guard/redaction functions from `@eo/connectors-
  jira`/`@eo/connectors-grafana`/`@eo/gateway` (`assertAllowedJiraOperation`,
  `createGrafanaProviderAdapter`, `containsSecretShapedContent`,
  `redactSecretBearingObject`, `mapHttpStatusToConnectorError`) — not fixtures
  standing in for them.
- **Drift-CI job's "live/sandbox endpoint replay" is fixture-modeled, NOT
  live**, exactly as the risk note in roadmap/21 itself anticipates ("Live
  sandbox availability for the drift job depends on the disposable
  environments 18/20 provision for phase 23"). `drift/pinned-fixtures.ts`'s
  `buildPinnedFixtureSnapshots` defaults every "observed" value to the pinned
  value (i.e. "no live probe available yet" reads as "no drift," never a false
  positive) and accepts an override only via `JIRA_OBSERVED_VERSION`/
  `GRAFANA_OBSERVED_VERSION` env vars — which `.github/workflows/drift-ci.yml`
  exposes as `workflow_dispatch` inputs for a manual drift-simulation run, or
  which a future phase-23 sandbox-probing step would populate from a real live
  read. The comparison/debounce/redaction/artifact-upload machinery downstream
  of that value is fully real and already wired; only the live HTTP replay
  itself is the documented gap, identical in kind to phase 19/20's own
  cassette-modeled-not-live disclosure.
- **`stampGrafanaRemoteResource`/`hasExactRevisionVerification`**: fully
  live/real pure functions; no live Grafana/Jira call of their own (they
  operate on already-resolved revision/pointer values, exactly like their
  phase-18/20 counterparts they extend).

## Deviations (documented scope decisions)

1. **`evidence_pointer`'s payload cannot literally be
   `{requirementId, remoteResourceId, relation}` as roadmap/21's own prose
   describes** (and as `@eo/contracts`'s `RemoteResourceSchema` doc comment
   forward-references). `@eo/journal` (phase 04, already-built, outside this
   phase's package boundary) locks the `evidence_pointer` `JournalEntryType`'s
   payload to `EvidenceRecordSchema` verbatim, a `.strict()` zod object with no
   `remoteResourceId`/`relation` fields — adding them would require editing
   `packages/contracts`/`packages/journal`, both explicitly out of bounds.
   **Resolution:** every remote-resource pointer IS a fully valid
   `EvidenceRecord`, using only its existing fields — `requirementId` (real
   field), `objectId` (preserves its real "exact object id" meaning, never
   repurposed), `command` (carries a documented, parseable
   `remote-resource-pointer:<relation>:<remoteResourceId>` convention — the
   ONLY way to durably encode the two missing values without a schema change),
   `artifactDigests` (carries `remote-revision:<revision>` when known),
   `gateTag` (fixed to `"remote_verification"`). Fully documented inline in
   `remote-evidence-pointer.ts`'s file-level comment. Safe because roadmap/21's
   own §Interfaces produced states these pointers are "consumed internally by
   this phase's traceability view and verification gate; no other phase reads
   them directly" — no cross-phase contract is broken by this internal
   encoding choice. **Carry-forward**: a future coordinated schema-extension
   pass could add real `remoteResourceId`/`relation` fields to `EvidenceRecord`
   (or a dedicated new contract) once `packages/contracts` is back in scope.
2. **`packages/gates` gained three new workspace dependencies**
   (`@eo/connectors-jira`, `@eo/connectors-grafana`, `@eo/gateway`) to let the
   security-fixture manifest (work item 6) call the REAL exported guard/
   redaction primitives those packages already ship, rather than
   re-implementing (and risking silent drift from) copies of that logic. No
   new third-party package was introduced; `package-lock.json` sync is
   deferred to gate time per the task brief.
3. **`containsSecretShapedContent`/`JIRA_SECRET_PATTERNS` were promoted from
   internal-only to `@eo/connectors-jira`'s public barrel** — previously used
   only by that package's own attachment/ADF-guard modules, now also consumed
   by this phase's `jira-redaction` fixture check. A minimal, additive barrel
   change; the underlying implementation is untouched.
4. **The security-fixture manifest's `tenant-boundary` category uses this
   phase's own new, generic `assertTenantBoundary` guard**, not an import from
   18/20 — neither connector package exported a dedicated tenant-boundary
   assertion function of its own prior to this phase (tenant is plumbed as a
   `RemoteMutationPlan.tenant` field, but no standalone guard existed to
   reuse). `assertTenantBoundary` is deliberately connector-agnostic (compares
   two tenant strings) so both the `jira-tenant-boundary` and
   `grafana-tenant-boundary` manifest entries share the identical, real
   enforcement logic rather than two independently-authored copies.
5. **`GRAFANA_FORGED_OPERATION_NAMES` in `security-fixture-manifest.ts`
   duplicates a subset of the list already inline in `connectors-grafana/src/
   security/no-delete-admin.test.ts`** (phase 20's own fixture) rather than
   importing it — that list lives inside a `.test.ts` file, which is not part
   of `@eo/connectors-grafana`'s public barrel and is not meant to be imported
   by another package's production code. The duplicated subset is the 4 most
   representative names (`delete`, `deleteFolder`, `deleteDashboard`,
   `adminMutate`); the full, authoritative list remains 20's own test.
6. **The done-transition verification bridge
   (`connectors-jira/src/evidence/done-transition-verification.ts`) does not
   itself query the journal.** It is a pure function
   (`hasExactRevisionVerification(pointer, expectedRemoteResourceId,
   expectedRevision)`) that a caller feeds a `RemoteEvidencePointer`-shaped
   value already resolved via `packages/gates`' own
   `findRemoteResourcePointersForRequirement` — avoiding a new
   `connectors-jira` → `@eo/journal`/`@eo/gates` dependency edge the roadmap's
   dependency graph doesn't call for (18 depends on nothing in 21's own
   direction). **As of the adversarial-validation repair pass**, this pure
   function IS now a real, reachable caller of
   `resolveVerificationPointer(issueKey)` — an optional dependency threaded
   from `CreateJiraResourceClientDeps` down through `planIssueTransition` —
   so a real `@eo/gates` lookup closure, once a caller supplies one at client-
   construction time, genuinely participates in the done-transition guard.
7. **(Adversarial-round) Two internal shapes changed, backward-incompatibly,
   before either had any consumer besides this phase's own tests** —
   `RemoteVerificationGateInput.requiredRemoteResourceIds`/`connectorOutcome`
   now accept EITHER a fixed value OR a per-requirement resolver function
   (MAJOR-1 fix); `TraceabilityEntry` replaced its two independently-deduped
   parallel arrays (`remoteResourceIds`/`confirmedRevisions`) with one
   structured `remoteResources: TraceabilityRemoteBinding[]` array
   (MINOR-3 fix). Both are internal to `packages/gates`'s own barrel, with
   "no other phase reads them directly" already stated in roadmap/21's own
   §Interfaces produced — safe to restructure now, before phase 09's CLI
   wiring (carry-forward, below) or any other consumer exists.

## Carry-forwards for reconcile

- **`packages/cli`'s `evidence <change-set-id>` command wiring for the
  connector-evidence portion is explicitly deferred**, per the task brief's own
  instruction ("no new 21→09 edge... leave the actual `packages/cli`
  `evidence`-command wiring as a documented CARRY-FORWARD, mirror the
  09-stubs-NOT_IMPLEMENTED convention"). `packages/cli` was not edited by this
  phase at all (confirmed: `git status` shows zero diff there from this
  worker — the only `packages/cli` changes present in the working tree belong
  to the concurrent phase-22 worker). The traceability-view BACKEND
  (`buildTraceabilityView`) and the evidence-pointer lookup functions are
  fully built and exported from `packages/gates`' public barrel, ready for
  phase 09's CLI to call once that wiring lands.
- **A real `remoteResourceId`/`relation` schema extension to `EvidenceRecord`**
  (Deviation 1) — once `packages/contracts`/`packages/journal` are back in
  scope for a coordinated cross-phase edit, migrate `remote-evidence-
  pointer.ts` off its documented `command`/`gateTag`/`artifactDigests`-based
  encoding onto real dedicated fields.
- **Live drift-CI replay** (honesty note above) — wire a real Jira Cloud/
  Grafana sandbox probe into `drift/cli.ts` once 18/20/23's disposable
  environments exist; the comparison/debounce/artifact machinery downstream is
  already real and needs no further change.
- **Per-diff/per-connector-operation latency aggregation into a dedicated
  performance-analysis view** — this phase captures connector latency into the
  SAME `EvidenceRecord.artifactDigests` channel 14 already emits (work item 6),
  available to but not contractually consumed by 15 (no 21→15 dependency edge
  exists per the roadmap's own dependency graph) — no further aggregation is
  implemented here, matching the explicit out-of-scope boundary.

## Files touched outside `packages/gates/`, `packages/connectors-jira/`, `packages/connectors-grafana/`

- `.github/workflows/drift-ci.yml` — new CI job (scheduled weekly +
  `workflow_dispatch` with manual drift-simulation inputs), restoring/saving a
  persisted debounce-state cache across runs and uploading the `DriftProposal`
  artifact for human review; applies zero pinned-fixture/config changes itself.
- `.prettierignore` — one new entry,
  `packages/gates/goldens/` (the hand-authored-but-byte-stable golden
  traceability-view fixture), identical rationale to every prior phase's own
  `goldens/*.json` entry.
- `docs/evidence/phase-21/README.md` — this file.

No other file outside those three packages, this evidence doc, `.prettierignore`,
and the one named CI workflow file was edited by this worker. `packages/cli`,
`packages/perf`, and `packages/learning` (sibling phases 09/22, 15, 22
respectively) were left untouched — every diff visible against those paths in
the working tree belongs to concurrent sibling workers, not this session
(verified: this session's own edits are limited to the files listed in
"Summary" above). This remains true after the adversarial-validation repair
pass: every RED→GREEN fix landed inside `packages/gates/`,
`packages/connectors-jira/`, `packages/connectors-grafana/`, or this doc.

## Gate results

- `npx tsc -b` on this phase's own package subset (`packages/gates
  packages/connectors-jira packages/connectors-grafana`, recursively building
  their full dependency closure): **clean.** A whole-monorepo `npx tsc -b` run
  intermittently fails with `TS5055` writes inside `packages/learning/dist/*`
  — reproduced on repeated retries, timestamps confirming a concurrent sibling
  (phase-22) session actively rebuilding that SAME package at the same time;
  `packages/learning`'s own `tsconfig.json` is independently confirmed
  modified by that other session (`git status`), not this one. Out of this
  phase's fix authority (`packages/learning` is explicitly off-limits).
- `npm run lint` (whole monorepo, ESLint): **clean** (0 errors, 0 warnings).
- `npm run format` (whole monorepo, `prettier --check .`): **clean for every
  file this phase touched** (`--write` applied to this phase's own files only;
  pre-existing warnings in `packages/perf`/`packages/learning` belong to
  concurrent sibling workers' in-progress files, left untouched).
- `npx vitest run packages/gates packages/connectors-jira
  packages/connectors-grafana`: **122 test files, 934 tests, all passing**
  (up from 118/902 pre-repair-pass — 4 new test files, 32 new tests from the
  adversarial-round fixes). Confirmed on repeated runs; one incidental
  `ratchet.property.test.ts` (pre-existing phase-14 test, untouched by this
  phase) failure was observed once under full-parallel-suite host load and
  reproduced GREEN both in isolation and on an immediate full-suite re-run —
  a transient flake, not a regression.
- `npx vitest run` (whole repo, all 18 packages): pre-existing failures remain
  confined to `@eo/perf` (sibling phase-15 work-in-progress, out of this
  phase's package boundary) — **zero failure in `packages/gates`,
  `packages/connectors-jira`, or `packages/connectors-grafana`** on the
  3-package suite, confirming no phase-14/18/19/20 test regressed.
- Coverage, scoped to this phase's own new/modified code (the phase-21
  modules in `packages/gates/src` + `packages/gates/src/drift/**/*.ts` +
  `packages/connectors-jira/src/evidence/**/*.ts` +
  `packages/connectors-jira/src/resource-client/issue-plans.ts` +
  `packages/connectors-grafana/src/evidence/**/*.ts`, excluding `*.test.ts`):
  **96.3% statements, 89.34% branches, 97.5% functions, 98.78% lines.**
  Residual uncovered branches are documented defensive/unreachable guards
  (e.g. `security-fixture-manifest.ts`'s unused `getSnapshot` stub inside the
  Grafana forged-operation check, which that check's own `Object.keys`-only
  inspection never invokes by design) — the same class of belt-and-suspenders
  gap phase 14's own evidence doc discloses for its guarded-parse `catch`
  blocks.
- **Confirmed fail-closed / non-vacuous (adversarial-validation repair
  pass):** every phase-21 unit now has a REAL, run-shaped caller
  (`remote-verification-e2e.test.ts`, MAJOR-1); the done-transition guard
  genuinely consults 21's pointer lookup when wired (MAJOR-2); the drift
  diff's redaction covers both key-name and content-shaped secrets (MINOR-1);
  the pointer discriminator can no longer be spoofed by a `gateTag`-mismatched
  collision (MINOR-2); the traceability view's fan-in/fan-out/revision-
  precedence behavior is proven non-degenerate (MINOR-3).
