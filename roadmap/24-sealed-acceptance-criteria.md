# Phase 24 — Sealed acceptance criteria & requirement persistence

| | |
|---|---|
| **Depends on** | 04, 11, 13, 14 |
| **Unlocks** | — (first post-v1 phase; the requirement-source consumers named in Out of scope become possible after it) |
| **Sources** | `docs/archon-harvest.md` §1 (donor audit); the frozen archon donor's Phase-2 completion-seal history (its `STATUS.md` + `.archon/work/product-state.md`); `docs/interface-ledger.md` Gap 5 (closed journal union) and Gap 20 (schema-over-prose doctrine); `packages/perf/src/contract/hash-link.ts` lines 26–41 (the recorded threat model: a self-checksum alone was a MAJOR finding) |
| **Primary package** | `packages/contracts` (seal semantics); enforcement lands in `packages/supervisor`, `packages/scheduler`, `packages/gates`, the seal anchor in `packages/journal` — no new workspace (the roster is pinned at 18 by `scripts/check-workspace-count.mjs`) |

## Goal

Before this phase, acceptance criteria functionally evaporate after intake. `Requirement`
records are built once (`packages/supervisor/src/intake/contract-builder.ts`) and persisted
to **no registry** — the only durable copy is an incidental blob inside the intake
idempotency journal entry. The worker never receives criteria (`TaskPacket` carries
`requirementIds` only), completion is accepted without anyone re-reading them
(`packages/scheduler/src/executor.ts` `consumeEvents`), no gate consumes them, and
`packages/contracts/src/contracts/design-record.ts:129-133` already documents the
consequence: `design-addresses-every-acceptance-criterion` "stays judged until a
requirements source is wired in." `Requirement.id` does not cover criteria (its stable-id
seed is `section` + `title`), the envelope hash covers authority fields only, and the
approval token signs the envelope hash — so nothing anywhere binds "what was approved" to
"what completion is judged against."

After this phase, requirements are durable and resolvable by id; each carries a canonical
hash of its criteria taken at build time; approval anchors the full criteria-hash set in
the journal; and neither a work unit's `succeeded` transition nor `final_verifying` can be
reached without a fresh, fail-closed verification that the criteria in force are the
criteria that were approved. The sanctioned way to change criteria after approval remains
the material-amendment path — demote, re-approve, re-seal — and anything else is tamper.

## In scope

- **Requirement persistence** — a `Registry<Requirement>` persisted by the intake pipeline
  alongside the existing four (`changeSets`, `envelopes`, `intentContracts`, `workUnits` —
  `packages/supervisor/src/intake/intake-pipeline.ts:236-239`), file-backed through the
  same bootstrap wiring as `intentContracts` (`packages/cli/src/bootstrap.ts`).
- **`Requirement.criteriaHash`** — new required field on `RequirementSchema`:
  `canonicalHash(acceptanceCriteria)` using the `sha256:`-prefixed supervisor/perf
  canonicalizer (`packages/supervisor/src/intake/canonical-hash.ts` — key-sorted, array
  order preserved; explicitly **not** the journal codec's bare-hex `canonicalize`, which
  serves the hash chain). Computed in `buildIntentContract` at construction; absence is
  unrepresentable in new documents (Gap 20 doctrine), not policed by convention.
- **Approval seal** — at the `awaiting_approval → ready` transition, journal an
  `adjudication_decision` entry carrying `{requirementId → criteriaHash}` for the
  ChangeSet's full requirement set. Sealed **inside `transitionChangeSetToReady`** — the
  one funnel both activation paths (`standing-approval.ts`, `contract-approve-handler.ts`)
  already share — rather than in each caller, so `ready` is unreachable without a seal by
  construction. Sealing per-caller is the exact shape the donor's first seal shipped with:
  one path threaded it, the daemon path did not, and every test injected the option.
  **No 14th `JournalEntryType` member**; Gap 5's union is closed at 13 and phases 12 and 14
  made the identical choice. The seal is a typed payload member rather than free text,
  per Gap 20.
- **Seal verification, perf-shaped** — mirror `verifyProvisionalBudgetIntegrity`'s
  first-failure-wins ladder, with reasons as data:
  `CriteriaSealFailureReason = "self_consistency_mismatch" | "no_approval_seal" |
  "approval_seal_mismatch"`. Self-consistency recomputes the stored requirement's hash;
  the approval check compares against the **latest** approval seal for the ChangeSet —
  latest-wins is what makes a rollback to a *previously approved* criteria set after a
  material amendment fail closed. Pure comparison logic and the reason/outcome vocabulary
  live in `packages/contracts` (the `PERFORMANCE_OUTCOMES` precedent: canonical vocabulary
  in contracts, consumed by the gate — never a parallel enum invented at the check site).
- **Completion enforcement, required by construction** — the verifier threads through
  `DispatchAttemptOptions` / `ResumeAttemptOptions` / `ConsumeEventsParams`
  (`packages/scheduler/src/executor.ts`) as a **required** field, the same closure pattern
  as `ResumeTrigger` (added to make a bypass unexpressible) and
  `BuildEnforcedPerformanceContractOptions.journal` (required because a self-checksum
  without the journal is not a check). A `result` event whose outcome is `succeeded` is
  verified **before** `recordAttempt(..., "succeeded", ...)`; on failure the attempt
  records `failed` and the typed reason is journaled. `recordAttempt` itself is explicitly
  **not** the choke point — 7 call sites and an optional-parameter shape is the exact
  anti-pattern the donor's first seal shipped with (its check ran only inside
  `if (options.getProjectRuntimeState)`; the fix was making the parameter required).
- **Final gate** — a seal-verification handler registered into 14's registry under the
  existing `acceptance` risk tag, firing at `final_verifying` beside the perf gate. On
  mismatch it converts the typed error into a blocking `GateVerdict` so `emitEvidence`
  still journals the failure (the `performance-gate.ts:170-182` catch-and-convert
  precedent), emitting a standard `EvidenceRecord` via the single `fireOne` path.
- ~~**Anchored-object query helper** — lift `packages/perf/src/contract/journal-anchor.ts`'s
  structural `findObjectById` DFS into `packages/journal` as a generic
  find-anchored-object utility.~~ **Not built — superseded during implementation.** The
  seal rides on a typed, optional `criteriaSeal` member of the
  `adjudication_decision` payload, so its lookup is a direct read of a field this code
  owns both ends of, not a search of someone else's blob. perf needs a structural DFS
  only because it reads back a record phase 11 committed for unrelated reasons in a shape
  15 may not assume. Building the generic finder anyway would have produced a primitive
  with no production caller — the "built and tested, zero call sites" pattern the donor's
  own audit flagged as overstated mechanization. perf's copy is untouched.

## Out of scope

- **Delivering criteria text to the worker** (`TaskPacket` stays `requirementIds`-only) and
  **threading the requirement source into the staged review pipeline**
  (`review-submit-handler` server-supplied inputs; flipping
  `design-addresses-every-acceptance-criterion` from judged to derivable, and giving
  `acceptance-criteria-testable` pinned text to attest against). Both become *possible*
  once requirements are durable; each is its own slice with its own byte-budget and
  review-pipeline consequences. This phase seals the bar; it does not yet hand the bar to
  every reader.
- **Journal writer authorization** — `appendEntry` accepts any of the 13 kinds from any
  `JournalStore` holder; adding a writer-identity layer is a separate (and larger) ruling.
  See Risks for the residual this leaves and why it is disclosed rather than half-fixed.
- **Criteria quality** — whether criteria are testable/observable stays a clarify-stage
  concern (`acceptance-criteria-testable`); the seal binds content, it does not grade it.
- **The material-amendment machinery itself** (`materiality-classifier`,
  `material-amendment-guard`, envelope amendment) — consumed as the sanctioned change
  path, not modified.
- **Upstream intake validation** (`IntakeRequestSchema` does not exist; criteria arrive as
  untyped stdin JSON validated at `RequirementSchema.parse`) — pre-existing posture,
  unchanged here.

## Interfaces produced

- **`packages/contracts`:** `Requirement.criteriaHash` (required); the criteria-seal check
  (pure: stored requirement + approval-seal payload → verdict);
  `CriteriaSealFailureReason` (3-member, canonical, owned here);
  `CriteriaSealMismatchError` carrying the reason, with a missing-seal subclass (the
  `BudgetJournalAnchorMissingError extends BudgetHashLinkMismatchError` shape).
- **`packages/journal`:** an optional, typed `criteriaSeal` member on the
  `adjudication_decision` payload (no 14th entry type — Gap 5 closes the entry-type
  union, not payload shapes), plus `journalCriteriaSeal` / `findLatestCriteriaSeal`.
  Latest-wins, deliberately opposite to perf's first-writer-wins: re-approval after a
  material amendment must supersede, and a rollback to superseded criteria must not
  verify clean.
- **`packages/supervisor`:** requirement registry persistence; `criteriaHash` computed at
  the only `Requirement` construction site.
- **`packages/cli` (intake handlers):** approval-seal journal write on both activation
  paths.
- **`packages/scheduler`:** required verifier threading through dispatch/resume/consume;
  fail-closed `succeeded` acceptance.
- **`packages/gates`:** the `acceptance`-tag seal gate at `final_verifying`, emitting
  standard EvidenceRecords.

## Interfaces consumed

- **02 (ambient schema import — same convention every phase uses):** `Requirement`,
  `EvidenceRecord`, `JournalEntryType` (closed 13; Gap 5), `WorkUnitAttemptStatus`,
  pipeline-stage criteria ids.
- **04 (`packages/journal`):** `JournalStore.appendEntry`/`queryEntries` (type-filtered on
  `adjudication_decision` / `remote_operation_record`); the hash-chained envelope this
  phase's anchors inherit their integrity from; `IdempotencyRegistry`'s intake record as
  provenance (the built `Requirement[]` already lands in
  `remote_operation_record.appliedRevision` today — this phase adds no second copy).
- **11 (intake/approval):** `buildIntentContract` (sole `Requirement` writer);
  `transitionChangeSetToReady` and its two callers; the amendment path as the sanctioned
  criteria-change route (demote → re-approve → new seal).
- **13 (`packages/scheduler`):** `dispatchAttempt`/`resumeAttempt`/`consumeEvents` and the
  `WORK_UNIT_ATTEMPT_STATUS_TRANSITIONS` table (no new statuses; a seal failure records
  `failed`).
- **14 (`packages/gates`):** the risk-tag-keyed registry (`acceptance` is already one of
  the 13 `GATE_RISK_TAGS` — no new tag), `fireOne`/`emitEvidence`, and the
  `final_verifying` orchestration.

## Work items

1. Contracts: `criteriaHash` on `RequirementSchema` + pure seal check + reason vocabulary +
   typed errors.
   - Failing-first: a `Requirement` without `criteriaHash` must fail parse; seal-check unit
     fixtures for all three failure reasons.
2. Journal: the seal's typed payload member + `journalCriteriaSeal` /
   `findLatestCriteriaSeal` (revised from "generic anchored-object finder" — see In
   scope).
   - Failing-first: round-trip; no-seal; another change set's seal; LATEST-wins across
     re-approval; an `adjudication_decision` carrying no seal is ignored; the hash chain
     still verifies.
3. Supervisor + bootstrap: requirement registry, persisted at intake beside the existing
   four; hash computed in `buildIntentContract`.
   - Failing-first: restart-shaped test — build, persist, reload, resolve every approved
     requirement by id.
4. Approval seal on both activation paths.
   - Failing-first: each path's fixture asserts the `adjudication_decision` payload carries
     the full `{requirementId → criteriaHash}` set.
5. Scheduler enforcement: required verifier threading; verify-before-`succeeded`.
   - Failing-first (headline): approve → tamper the stored requirement's criteria → worker
     reports success → attempt records `failed`, never `succeeded`, reason journaled.
6. Gate under `acceptance` at `final_verifying`; error→blocking-verdict conversion;
   EvidenceRecord emission.
   - Failing-first: gate-harness fixture with a post-approval edit blocks and journals
     evidence; the perf gate's conversion test is the template.

## Test plan

All of the below start red: no registry, no hash field, no seal record, no verifier, no
gate handler exists yet.

- **Unit:** seal-check ladder (first-failure-wins ordering); hash computation at the
  construction site; anchored-object finder selection rules.
- **Property (fast-check):** `canonicalHash` over criteria — invariant under object-key
  order everywhere an object appears, **sensitive** to array order and to any single
  criterion edit; seal verdict is deterministic across repeated evaluation.
- **Integration:** the headline tamper test (work item 5); rollback test — material
  amendment → re-approval → attempt to complete against the *old* approved criteria fails
  with `approval_seal_mismatch` (latest-wins proven); both activation paths seal; restart
  → reload → verify still passes (durability); gate fires through 14's registry and its
  EvidenceRecord round-trips the journal.
- **Conformance:** no 14th `JournalEntryType` member introduced (the existing
  exhaustiveness guards — `JOURNAL_ENTRY_TYPE_DESCRIPTIONS`, `JOURNAL_ENTRY_PAYLOAD_SCHEMAS
  satisfies Record<JournalEntryType, …>` — must compile unchanged); the verifier parameter
  is required at every public entry point (a type-level fixture that omits it must fail
  compilation).
- **Security:** seal payloads and EvidenceRecords contain criteria hashes and ids, never
  env/argv content; a forged approval-seal entry with a mismatched hash set still fails
  the stored-record self-consistency arm (defense in depth within the disclosed ceiling —
  see Risks).

## Exit criteria

**CLOSED 2026-08-02, evidenced.** All nine criteria walked individually against recorded evidence
(criteria-closeout pass; machine-readable index: `docs/evidence/criteria-closeout/phase-24.json`).
Nine of nine ticked. Two bounds are carried rather than smoothed over, both on criterion 5, and both
are stated in the box itself: the journal-level assertions cover `approval_seal_mismatch` and
`no_approval_seal`, so the disjunction's *other* named reason (`self_consistency_mismatch`) has
unit-level evidence only; and the typed reason travels in the payload's free-text `rationale`, not in
a typed payload member.

§Risks re-checked at closure and **left unchanged, because both entries are still true.** The
disclosed same-process ceiling stands: `appendEntry` still takes no writer identity, and `58f7c17`'s
journal writer separation is OS-level ownership plus a doctor check — its own commit message records
that it protects the journal from *workers*, not from every path the system itself uses, and not at
all from an in-process holder of a `JournalStore`. The upgrade-migration ruling also stands and has
since been operationalized outside this file: `docs/upgrade-guide.md` §"Before upgrading" carries it
verbatim and states that the drain is *manual* (`crabgic status` / `crabgic cancel` per run) —
`RunDispatcher.drain()` (`9057abe`) is the daemon's shutdown primitive, not an operator upgrade path.

Shared citations reused by several boxes below. **`CI` run
[30745540255](https://github.com/WitchyNibbles/crabgic/actions/runs/30745540255)**, green at
`d60398f` — its `unit-test+coverage (ubuntu-latest)` job
([91490386248](https://github.com/WitchyNibbles/crabgic/actions/jobs/91490386248)), step "test with
80% line+branch coverage gate", executed 625 test files / 6155 tests (job-log lines 1035–1036) and
names each of this phase's suites individually; and its `typecheck (ubuntu-latest)` job
([91490386270](https://github.com/WitchyNibbles/crabgic/actions/jobs/91490386270)), which runs
`tsc -b` cold and again incrementally (job-log lines 164, 172) — the channel that scores criteria 8
and 9's compile-time claims. Scoped local re-runs, captured verbatim with UTC timestamp, HEAD sha,
command line and exit status, are committed as `docs/evidence/phase-24/closeout-c*.txt`.

That run is green at `d60398f`, this branch's own base. As of `main` @ `f05970c`, every commit
between `d60398f` and the merge base touches only `roadmap/` and `docs/evidence/`:
`git diff d60398f f05970c -- packages/ e2e/ scripts/` is empty, so the run scores the code the
citations point at. Separately, every quoted span was re-resolved at `d60398f` and matches
byte-for-byte. (An earlier draft of this paragraph claimed `git log 06693e5..d60398f` "touches none
of the files cited here at all" — that was false, and is corrected here rather than rewritten away:
`8a7dc7a`, `9057abe` and `6dd211b` each touch `packages/cli/src/bootstrap.ts` and
`packages/cli/src/daemon/run-dispatcher.ts`, both cited by this record. The substance holds — the
citations were verified at `d60398f` rather than inherited from `06693e5` — but the file-level claim
did not, and a checkable sentence that is wrong is worse than no sentence.) Main moves; the
integrator should re-run the emptiness diff at merge time, and the closeout PR's own CI run covers
the merged tree.

`gates-conformance` is deliberately **not** cited for criterion 7. Its job log
([91490386361](https://github.com/WitchyNibbles/crabgic/actions/jobs/91490386361)) shows it runs
exactly two files — `gates-conformance.test.ts` and `engine-conformance-binding.test.ts` — and never
executes the seal gate's suite. A green workflow that did not run the check is not evidence for it.

Citation re-resolution. Every quoted code fragment in the index was located mechanically against the
tree this branch merges into: **71 citations, 60 resolvable `test`/`artifact` refs, 193 code-shaped
quoted fragments, 193 exact content matches (whitespace-collapsed), all within four lines of their
cited span, zero mismatches, and zero citations yielding no extractable fragment.** A further 20
fragments are prose or bare identifiers rather than code and are therefore not line-anchorable; they
are counted and named rather than silently skipped, and the only substantive one — the
`ConsumeEventsParams` doc comment quoted on criterion 8 — was checked by hand against
`packages/scheduler/src/executor.ts:127`. The resolver's first run surfaced 18 genuine defects in
this record's own first draft: nine quotes with a `:NN ` line prefix accidentally inside the quoted
span, one `...` elision inside quote marks, one fragment quoted from a line 39 lines outside its
cited span, one span that had to widen to reach its second quote, three transcript quotes that
paraphrased the tool's own punctuation, and — the one that mattered — a probe count quoted as
`198 of 200` when the *committed* transcript says `200 of 200` (the count is fast-check-seed
dependent, and the committed artifact is the authority). All eighteen are fixed above rather than
tolerated.

- [x] Approved requirements are durable: after process restart, every requirement of an approved ChangeSet resolves by id with its criteria and `criteriaHash` intact (integration test). — **Evidence (2026-08-02):** `packages/supervisor/src/intake/requirement-durability.integration.test.ts` composes the whole claim rather than implying it from three partial neighbours: intake, then approval through `transitionChangeSetToReady` with the records resolved out of the *durable* registry (`:159-167`), then every live object discarded and rebuilt over the same on-disk paths (`:174-175`). For each declared id it asserts resolution by id (`:180`), criteria and hash intact (`:186-187`), self-consistency after the round trip (`:190`), and that the reloaded record still verifies against the reloaded seal (`:193`). Negative control `:198-239` — a post-approval on-disk rewrite *with* a recomputed hash still fails `approval_seal_mismatch`, so durability is not read as trust. The fixture opens its registry through the same `createFileRegistry` factory production wires at `packages/cli/src/bootstrap.ts:470-473`. Scope: the restart is same-process (objects dropped, bytes retained); no second OS process is spawned. CI job-log line 839. Transcript `docs/evidence/phase-24/closeout-c1-requirement-durability.txt`.
- [x] A `Requirement` without `criteriaHash` is unrepresentable — schema parse fails (unit test). — **Evidence (2026-08-02):** `packages/contracts/src/contracts/requirement.test.ts:55-63` — the field deleted (`:56-57`) and the field emptied (`:61-62`), both `safeParse(...).success` false — against the positive control `:23` that the otherwise-identical fixture parses, so the rejection is attributable to this field and not to a broken fixture. Structural, not policed: `requirement.ts:59` declares `criteriaHash: NonEmptyStringSchema` inside a `.strict()` object with no `.optional()`, and the exported JSON Schema agrees (`packages/contracts/schemas/requirement.json:98`, inside its `required` list). CI job-log line 440. Transcript `docs/evidence/phase-24/closeout-c2-requirement-schema.txt`.
- [x] Canonicalization is deterministic and content-sensitive per the property suite (fast-check, CI). — **Evidence (2026-08-02):** two fast-check properties over the one implementation. `packages/supervisor/src/intake/canonical-hash.test.ts:45-66` — same value hashes identically (`:57`), a single added leaf changes the hash (`:60`), 200 runs — plus its example arms for key-order stability (`:9`), single-field perturbation (`:16`) and deliberate array-order *sensitivity* (`:22`). `packages/contracts/src/contracts/criteria-seal.test.ts:51-82` runs the same two properties over criteria-shaped input, including order (`:62`) and the distinct-lists property (`:71-82`). The suites test the same function: `criteria-seal.ts:73-75` computes the criteria hash *via* `canonicalHash`, and `packages/supervisor/src/intake/canonical-hash.ts:19` is now a re-export of the contracts implementation. Anti-vacuity: both guarded assertions were instrumented rather than assumed — 200/200 cases enter `!(extraKey in obj)`, 100/100 pass the `fc.pre` (a second run with a different fast-check seed gave 198/200; the guard is entered in essentially every case either way) — probe source and output committed at `docs/evidence/phase-24/closeout-c3-property-guard-probe.txt`. CI job-log lines 867 and 413. Transcript `docs/evidence/phase-24/closeout-c3-canonicalization-property.txt`.
- [x] Both activation paths journal the approval seal; absence of a seal for a post-phase approval is impossible to produce through either path (integration tests, one per path). — **Evidence (2026-08-02):** one integration test per path, each asserting the seal's full `{requirementId → criteriaHash}` set through the same `findLatestCriteriaSeal` the dispatcher uses — standing approval at `packages/cli/src/intake/standing-approval.test.ts:165-171` (`toStrictEqual`, so a silently-dropped requirement fails), token path at `packages/cli/src/intake/contract-approve-handler.test.ts:318-363` with a before-control (`:338`, no seal exists yet) and two requirements. The "impossible to produce" half is tested per path too: a refused standing approval (`standing-approval.test.ts:186`) and a refused token approval (`contract-approve-handler.test.ts:402`) each leave no seal. And it is structural, not merely twice-tested: the seal is written inside the one funnel both paths share, before the transition (`packages/supervisor/src/intake/readiness-gate.ts:90-101`), a declared requirement with no record is refused outright (`readiness-gate.test.ts:103-122`), and no other production code performs a ChangeSet `to: "ready"` transition. Bound: this is about the activation paths — it says nothing about an in-process `JournalStore` holder appending a seal directly, which is this phase's disclosed same-process residual. CI job-log lines 929, 923, 850. Transcript `docs/evidence/phase-24/closeout-c4-both-activation-paths.txt`.
- [x] The headline tamper fixture: post-approval criteria edit → completion is never recorded `succeeded`; `failed` is recorded and the typed reason (`self_consistency_mismatch` or `approval_seal_mismatch`) is journaled (integration test). — **Evidence (2026-08-02):** `packages/scheduler/src/executor.test.ts:623-666`, against a *succeeding* fake adapter and a real file-backed journal: `failed` (`:644`), the journal's latest attempt `failed` and never `succeeded` (`:650`), and the typed reason read back **out of the journal** (`:657-659`, `approval_seal_mismatch` plus the requirement id), via a helper that queries real `adjudication_decision` entries (`:583-590`). Clean-pass control `:599-621` — matching criteria succeed and journal zero refusals — and the fail-closed arm `:668-691` journals `no_approval_seal`. Security bullet asserted: ids and hashes only, never the attacker-authored criteria text (`:664-665`). Implementation `executor.ts:247-264` journals the reason *before* the `failed` transition. **Two bounds, carried deliberately.** (a) The journal-level assertions cover `approval_seal_mismatch` and `no_approval_seal`; `self_consistency_mismatch` reaches the journal through the same reason-agnostic formatter (`executor.ts:177-192` interpolates `result.reason` with no branch) but its only direct evidence is unit-level (`criteria-seal.test.ts:94-100`). The criterion is disjunctive and its second disjunct is journal-evidenced, so it ticks as written. (b) The reason rides in the payload's free-text `rationale`, not a typed member — sanctioned by ledger Gap 5's "Boundary with Gap 20" paragraph, but a machine consumer would today have to substring-match. Historical: before `06693e5` this clause was **false** — the reason was computed, returned, and written down nowhere; RED capture at `docs/evidence/phase-24/wi5-seal-reason-journaled-failing.txt`. CI job-log line 810. Transcript `docs/evidence/phase-24/closeout-c5-tamper-reason-journaled.txt`.
- [x] Rollback to a previously-approved criteria set after re-approval is blocked by latest-seal-wins (integration test). — **Evidence (2026-08-02):** `packages/scheduler/src/criteria-seal-rollback.integration.test.ts:105-142` — two seals appended for one ChangeSet, the bar resolved through `findLatestCriteriaSeal` exactly as `packages/cli/src/daemon/run-dispatcher.ts:561-567` resolves it, then a dispatch that presents the genuinely-once-approved revision A against a succeeding adapter is refused `failed` with `approval_seal_mismatch`, journaled (`:129-139`). Both revisions are self-consistent by construction (`:67-70`, `:108`), so only the journal can distinguish them and a self-consistency failure cannot be mistaken for the seal check. Two controls make the refusal *superseding* rather than a fixture artefact: the current revision succeeds with zero refusals (`:162-164`), and revision A succeeds when only the first approval is on record (`:187`). Unit-level anchor proof at `packages/journal/src/criteria-seal-anchor.test.ts:56-68`. Scope: re-approval is simulated by its journal effect (two seals, in order), not by driving the amendment machinery, which §Out of scope excludes. CI job-log lines 814 and 716. Transcript `docs/evidence/phase-24/closeout-c6-rollback-latest-seal-wins.txt`. **Scope bound (2026-08-02, adversarial review):** this tick is carried by the integration test the criterion names, which is real and non-vacuous. It is NOT a claim that the surrounding enforcement is live in the shipped daemon. `composeSupervisor` builds no requirements registry (it declares `REQUIREMENTS_FILE_NAME` at `compose-supervisor.ts:79` — "the DAEMON is a reader" — and never opens it; only the intake process at `bootstrap.ts:471` does), and `SupervisorDependencies.requirements` is optional, so `run-dispatcher.ts:562-565` always takes the `[]` arm under the daemon composition. Measured: `dispatchAttempt` with `requirements: []` plus a live seal naming a requirement returns `succeeded`, zero refusals. With criterion 7's unregistered gate this is one seam — phase 24's enforcement is inert in the shipped daemon. Filed as `docs/evidence/criteria-closeout/defects/24-daemon-requirements-registry-unwired.md` — named here in prose rather than cited as evidence, since a defect record written by this same pass sits inside the closeout claim-space. Filed, not fixed: a closeout pass records defects, it does not repair them.
- [x] The seal gate fires under the existing `acceptance` tag at `final_verifying` and a mismatch produces a blocking, schema-valid `EvidenceRecord` through `fireOne` (gate-harness integration test). — **Evidence (2026-08-02):** `packages/gates/src/criteria-seal-gate.test.ts` fires the real registry with `stage: "final_verifying"` and a real file-backed journal: registered under the existing `acceptance` tag with no new tag invented (`:39-41`); a post-approval edit BLOCKS with `exitStatus: 1` and `approval_seal_mismatch` in the verdict detail while still emitting `gateVerdict: "failed"` evidence (`:75-80`); a never-sealed change set blocks with `no_approval_seal` (`:90-91`); and the negative control — a matching seal passes (`:55-58`) — rules out a gate that blocks unconditionally. "Through `fireOne`" is structural: `fireOne` is private to `createGateRegistry`, `fireByTag` is the only route to it (`registry.ts:53-57`, `:79`), and it is the sole caller of `emitEvidence`, which `EvidenceRecordSchema.parse`s the record before journaling it as an `evidence_pointer` (`evidence.ts:29`, `:51-55`) — schema-valid by construction, not by assertion. Scope: `final_verifying` is evidenced at harness level; the handler does not itself inspect `context.stage`, and no production composition root registers this gate yet — the same posture as 15's performance gate, and the criterion's own named channel is a gate-harness integration test. CI job-log line 570. Transcript `docs/evidence/phase-24/closeout-c7-seal-gate-harness.txt`.
- [x] Verification is required by construction: omitting the verifier at any public dispatch/resume entry point fails compilation (type-level fixture in CI). — **Evidence (2026-08-02):** `packages/scheduler/src/criteria-seal-required.type.test.ts:78-151` carries four `@ts-expect-error` fixtures — both option *types* and both *calls*, for `dispatchAttempt` (`:81`, `:100`) and `resumeAttempt` (`:118`, `:138`) — over the required fields at `executor.ts:325` and `:422`. The positive control `:153-177` compiles the identical literals plus the one field, so the four fixtures fail for the omission and not for an unrelated type error. `packages/scheduler/tsconfig.json`'s `"include": ["src"]` puts the fixture inside `tsc -b`, which the `typecheck` job runs cold and incrementally. **Reproduced by this pass at `d60398f`, not adopted from the implementing PR:** relaxing `criteriaSeal` to optional on both option types makes `npm run typecheck` exit 2 with `TS2578: Unused '@ts-expect-error' directive.` at all four sites plus two `TS2322`s inside `executor.ts`; reverted, and the restored `exit status: 0` is captured in the same file — `docs/evidence/phase-24/closeout-c8-type-fixture-bites.txt` (the implementing PR's own capture is retained at `wi8-type-fixture-breaks-typecheck.txt`). CI typecheck job-log lines 164 and 172; unit job-log line 819.
- [x] `JournalEntryType` remains 13 members; all new journal writes use existing kinds (conformance guards compile unchanged; Gap 5 cited in the implementing PR). — **Evidence (2026-08-02):** `packages/contracts/src/journal/journal-entry-type.test.ts:19-70` asserts the count (`:20`), the 13 names verbatim and in order (`:41-55`, so a swapped member fails too), and one description per member (`:65`). The compile-time guard `JOURNAL_ENTRY_PAYLOAD_SCHEMAS ... satisfies Record<JournalEntryType, z.ZodTypeAny>` (`packages/journal/src/codec/journal-payloads.ts:203-217`) is scored green by the `typecheck` job. All three journal writes this phase introduced use existing kinds: the seal (`criteria-seal-anchor.ts:44-53`, `adjudication_decision` with `decision: "criteria_sealed"`), the seal refusal (`executor.ts:183-192`, same member with `decision: "criteria_seal_refused"`), and the gate's evidence (`gates/evidence.ts:51-56`, `evidence_pointer`) — enabled by an *optional* typed `criteriaSeal` member on an existing payload (`journal-payloads.ts:101-125`), which leaves every pre-phase entry valid; a sealed entry still verifies in the hash chain (`criteria-seal-anchor.test.ts:84-93`). The Gap-5 citation clause: PR #37, merged as `663dd08`, says in its body *"no 14th `JournalEntryType` (Gap 5 closes the entry-type union, not payload shapes)"*, and the same text is durable in `git log -1 --format=%B 663dd08`. Ledger cross-check: Gap 5's Resolution (2026-08-01) re-affirms the union closed at 13 and names this phase's `criteriaSeal` member as its Gap-20 boundary example. CI unit job-log line 446; typecheck job-log lines 164 and 172. Transcript `docs/evidence/phase-24/closeout-c9-journal-entry-type-13.txt`.

## Risks & open questions

- **Disclosed residual — same-process ceiling.** `appendEntry` has no writer identity: any
  in-process holder of a `JournalStore` can append a plausible seal record. The seal
  defends the run's *state* against silent mutation and binds completion to the recorded
  approval; it is not a wall against an adversary already holding the supervisor's own
  write authority. This is named here per Gap 20's convention (and the donor's doctrine —
  its gate spent six rounds converging on the same honest ceiling before labeling it).
  True closure is a journal writer-authorization ruling, deliberately out of scope.
- **Upgrade migration.** Pre-phase ChangeSets have no `criteriaHash` and no approval seal;
  verification would fail them closed. Ruling: drain in-flight runs before upgrading (runs
  are short-lived and restart-resume is already unsupported — v1.5.0 release notes). No
  grandfathering epoch arithmetic: the donor needed an enforcement epoch because it had
  years of live state; crabgic does not, and an epoch constant is a standing foot-gun.
- **Two canonicalizers coexist** (`sha256:`-prefixed supervisor/perf vs the journal codec's
  bare-hex chain hasher). This phase pins the former for seal content and leaves the chain
  hasher alone; if a third consumer appears, consolidation becomes a ledger item — flagged
  now rather than discovered later.
- **`adjudication_decision` free-text reuse is stringly.** Accepted: Gap 5's union is
  closed at 13, phases 12 and 14 made the same trade for their own decisions, and the
  payload here is schema-parsed at read time by the verifier rather than string-matched.
- **Anchor scan cost.** Seal lookup is a type-filtered journal scan (the established
  pattern — perf's anchor finder, `findEvidenceForRequirement`). Runs journal at most a few
  thousand entries today; if that changes, indexing is a journal-package concern, not a
  seal-semantics change.
- **No new engine facts.** This phase touches contracts, journal, intake, scheduling, and
  gates only; nothing here reads Claude Code behavior, so no `docs/engine-baseline.md`
  citation is required (same posture as phase 15's closing note).
