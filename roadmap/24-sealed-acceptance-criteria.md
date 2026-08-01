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

- [ ] Approved requirements are durable: after process restart, every requirement of an
  approved ChangeSet resolves by id with its criteria and `criteriaHash` intact
  (integration test).
- [ ] A `Requirement` without `criteriaHash` is unrepresentable — schema parse fails (unit
  test).
- [ ] Canonicalization is deterministic and content-sensitive per the property suite
  (fast-check, CI).
- [ ] Both activation paths journal the approval seal; absence of a seal for a
  post-phase approval is impossible to produce through either path (integration tests, one
  per path).
- [ ] The headline tamper fixture: post-approval criteria edit → completion is never
  recorded `succeeded`; `failed` is recorded and the typed reason (`self_consistency_mismatch`
  or `approval_seal_mismatch`) is journaled (integration test).
- [ ] Rollback to a previously-approved criteria set after re-approval is blocked by
  latest-seal-wins (integration test).
- [ ] The seal gate fires under the existing `acceptance` tag at `final_verifying` and a
  mismatch produces a blocking, schema-valid `EvidenceRecord` through `fireOne` (gate-harness
  integration test).
- [ ] Verification is required by construction: omitting the verifier at any public
  dispatch/resume entry point fails compilation (type-level fixture in CI).
- [ ] `JournalEntryType` remains 13 members; all new journal writes use existing kinds
  (conformance guards compile unchanged; Gap 5 cited in the implementing PR).

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
