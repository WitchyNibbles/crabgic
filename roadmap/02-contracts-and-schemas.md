# Phase 02 — Core contracts, state machines, canonical errors

| | |
|---|---|
| **Depends on** | 01 |
| **Unlocks** | 03, 04, 08, 12, 16, 17 |
| **Sources** | original plan "Core contracts", run lifecycle, canonical errors, CommunicationPolicy limits, config precedence; adaptation §2 & Appendix B (`crabgic_gateway` MCP naming), §4.5 (WorkUnit `session_id`), §5.6 (rate-limit parking), §8 ("stays exactly as planned" list) |
| **Primary package** | `packages/contracts` (+ `packages/testkit` fixtures) |

## Goal

Every cross-cutting type in the system exists exactly once — a zod schema with inferred TS types and exported JSON Schema — with the run lifecycle, work-unit attempt status, and journal entry type each a single closed union backed by exhaustive tests, plus the canonical connector-error union and the security-monotonic config resolver, all landing before any subsystem is built against them. Done means: no downstream phase hand-defines a type this phase already owns, and no cross-cutting enum survives only as prose.

## In scope

- **Contracts (zod + JSON Schema export, 21):** ProjectProfile, StackEvidence, IntentContract, Requirement, AuthorizationEnvelope, CapabilityManifest, PerformanceContract, ChangeSet, WorkUnit (carries the engine `session_id` field, adaptation §4.5), TaskPacket, WorkerResult, EvidenceRecord, ExternalConnection, CapabilitySnapshot, RemoteMutationPlan, RemoteOperationRecord, RemoteResource, CommunicationPolicy, RenderedArtifact, LearningProposal, RunSnapshot, **EnvelopePolicy**.
- **`EnvelopePolicy` (added 2026-07-28 — ledger Gap 18):** the standing approval every dispatch is checked
  against — **path prefixes** (segment-aware, never globs: `validateOwnedPath` already rejects glob
  metacharacters, and a second matching language on that surface is where 03's CRITICAL confinement escape
  lived), allowed commands, network destinations and credential references (**both defaulting to empty, i.e.
  deny**), and the high-impact connector flags that may be auto-granted (**also defaulting to empty**), named
  with this phase's own canonical labels. Written by 10's `install`, read by 03's containment check, applied by 13 at
  dispatch. This phase owns the schema and the **containment predicate's specification** only — an
  `AuthorizationEnvelope` is contained iff every one of its authority dimensions is a subset of the policy's;
  the implementation is 03's, as the security keystone.
- **Run-lifecycle state machine:** `draft → awaiting_approval → ready → running → verifying → integrating → final_verifying → published_local`, terminals `failed | blocked | cancelled`; transition table + invariant tests (terminals absorbing; every transition typed against `JournalEntryType`'s `run_transition` member).
- **`WorkUnitAttemptStatus`** (new — orthogonal to the run lifecycle; a WorkUnit's attempt can park while its parent Run stays `running`): `pending | dispatched | succeeded | failed | cancelled | parked:rate_limit`. `pending` moves to `dispatched` or directly to `cancelled`; `parked:rate_limit` transitions only to/from `dispatched`; `succeeded`/`failed`/`cancelled` are terminal. Own exhaustive transition-table tests, independent of the run-lifecycle suite.
- **Canonical connector errors:** `authentication, permission, not_found, conflict, rate_limited, validation, unsupported, transient, ambiguous_write, policy_blocked` as a closed union (10 members); constructors force provider-body redaction — no raw body field exists on the public type.
- **`JournalEntryType`** (new — 13-member closed union; every journal entry, 04, carries exactly one member): `run_transition, work_unit_transition, adjudication_decision, remote_operation_record, evidence_pointer, session_assignment, git_freeze, worktree_quarantine, cas_ref_update, approval_token_mint, fanout_rationale, milestone_sync, learning_transition`. Rate-limit-park events are `work_unit_transition` entries (their status field is `WorkUnitAttemptStatus`) — there is no separate `rate_limit_park` member.
- **`LearningProposalState`** (new — 11-member closed union; the type of `LearningProposal.state`): `observation | reproducer | candidate | dev_eval | held_out_eval | shadow_run | independent_review | promoted | rejected | rolled_back | expired`. Transition-table tests, guards, and promotion enforcement are owned by 22, which hosts the pipeline this union names.
- **CommunicationPolicy constants:** branch ≤64; commit subject ≤72 (`type(scope): outcome`); commit body ≤5 lines; PR title ≤72; PR body ≤12 lines / 4 sections (Outcome, Validation, Risk, Tracking); Jira summary ≤120; Jira comment ≤800 chars / 6 lines + milestone template; Grafana annotation ≤240; review comment ≤6 lines (one finding, evidence, action); prohibited-content categories (attribution, first-person, signatures, mentions, secrets, unsafe links).
- **`renderer-core` module**, inside `packages/contracts` (not a standalone package): length/line counters + attribution-token scanner primitives.
- **`GATEWAY_MCP_SERVER_NAME`** constant: `"crabgic_gateway"` — the single literal every engine-side MCP registration derives from (03's compiled allow-string, 06's `mcpServers`/`strictMcpConfig` allowlist, 10's `.mcp.json` entry key, 16's SDK server registration + `mcp__${GATEWAY_MCP_SERVER_NAME}__<tool>` wire-prefix); no phase hand-types the literal a second time.
- **Config precedence resolver:** CLI → env → project → user → defaults with a declared security-key set where lower precedence only tightens (deny lists append-only, booleans one-way, numeric limits min-wins); property-tested.
- **`HighImpactCapabilityFlag`** (11-member closed union): assignment, reporter change, closing transitions, sprint completion, attachments, bulk mutations, issue creation, alert disabling, contact points, mute timings, notification templates. Labels are provider-neutral; a connector may gloss a label in its own prose (e.g. "closing transitions (Jira Done/Closed statuses)") but must not rename the member.
- **Threat model v1:** `docs/threat-model.md` — STRIDE over UDS, worker runtime, envelope compiler, installer, gateway, connectors, capability quarantine, renderer, learning store.
- **Testkit:** fixture builders per contract (incl. `WorkUnitAttemptStatus`/`JournalEntryType` instances); deterministic ID/clock providers.

## Out of scope

- Behavior: the envelope→permissions/sandbox compiler (03), journal mechanics (04), transports (05/06/16), rendering/lint logic (17) — this phase ships shapes and invariants, not implementations.
- Provider payload schemas and Jira/Grafana-specific validation (18, 19, 20).
- `EngineAdapter` interface and its `capabilities()` tuple — owned by 03, which takes this phase's `TaskPacket`/`AuthorizationEnvelope` as compiler input.
- `ArtifactKind` closed union and the `lint()`/`renderWithRegeneration()` pipeline — owned by 17, which consumes `CommunicationPolicy`, `RenderedArtifact`, and the `renderer-core` module produced here.
- MCP tool implementations (`tracker.*`, `capability.*`, `evidence.*`, `result.submit`, etc.) — owned by 16/11/12; this phase only names the server constant (`GATEWAY_MCP_SERVER_NAME`) every registration derives from.
- `$XDG_STATE_HOME`/`$XDG_CACHE_HOME` path layout — owned by 04, which pins both roots as sibling constants.

## Interfaces produced

**Package** `packages/contracts` — zod schemas + inferred TS types + `zod-to-json-schema`-built `schemas/*.json`; **`packages/testkit`** fixture builders.

**Contracts:**

| Contract | Consumed by |
|---|---|
| `ProjectProfile` | 06, 14 |
| `StackEvidence` | 12 (populates), 11, 14, 15 |
| `IntentContract` | 11 (assembles instance), 18, 21 |
| `Requirement` | 11 (assigns IDs), 14, 21 |
| `AuthorizationEnvelope` | 03 (compiler input), 06, 09, 11, 13 |
| `CapabilityManifest` | 11, 12 (populates entries), 10 (plugin entry), 23 |
| `PerformanceContract` | 15 (builds), 11 (approval payload), 23 |
| `ChangeSet` | 05, 09, 11 (creates), 15, 21 |
| `WorkUnit` (carries `session_id`, §4.5) | 04, 05, 06, 11 (DAG), 13 |
| `TaskPacket` | 03 (spawn input), 06, 13 (builds) |
| `WorkerResult` | 06 (schema-enforced via `--json-schema`), 14 |
| `EvidenceRecord` | 04/14 (emit), 08 (attaches rendered PR/review-comment artifacts), 09 (surfaces via `evidence <change-set-id>`), 21, 23 |

> `DesignRecord` / `PlanRecord` join this package (2026-07-29): the design and plan stages' artifacts as DATA,
> with `deriveDesignCriteria` / `derivePlanCriteria` and their `*Contradictions` counterparts beside the schemas
> (same placement as `isStageClosable` and `reclassifyDebtForWriteSet` — closure logic lives with the contract it
> closes over). Six previously-judged exit criteria derive from them, including `plan-dependencies-acyclic`, which
> is a graph algorithm that was filed as a judgement only because the plan was prose. A record can prove a
> criterion, contradict it, or be silent on it, and the three are kept distinct: `[].every(...)` is `true`, so
> collapsing silence into proof would let an empty artifact close a stage. See interface-ledger Gap 20, "Amended
> 2026-07-29 (second time)".

> `CriterionAttestation` / `StoredAttestation` join this package (2026-07-29): the attributed claim a JUDGED exit
> criterion is met — `criterion`, `asserter`, `rationale`, `artifactAnchor`, all required non-empty, each removing
> one way a claim can be unfalsifiable. Not a new *contract* in the 21-contract sense; it is the enforceable half
> of a criterion no tool can decide, the same shape `ReviewFinding.violates` already takes. See interface-ledger
> Gap 20, "Amended 2026-07-29 — judged criteria carry an attributed claim".

> `EvidenceRecord` carries `gateVerdict: "passed" | "failed"` (optional) — the gate handler's own judgement,
> which `exitStatus` cannot stand in for: 14's TDD gate returns `passed: false` while reporting the candidate's
> `exitStatus: 0` when no red baseline exists. **Absent is meaningful**, not unset: a `captureRedBaseline`
> pre-dispatch capture is not a firing, and neither is Gap 6's rendered-artifact evidence. `isNegativeEvidence`
> in this package is the one implementation of "was this a genuine negative run" — it prefers the verdict and
> falls back to `exitStatus`, so records journaled before the field score unchanged. See interface-ledger
> Gap 20, "Amended 2026-07-29".
| `ExternalConnection` | 16 (store), 09, 18, 19, 20 |
| `CapabilitySnapshot` | 16 (cache), 18, 20 |
| `RemoteMutationPlan` | 16 (pipeline), 18, 20, 21 |
| `RemoteOperationRecord` | 16 (persists pre-I/O), 04 (idempotency registry) |
| `RemoteResource` | 18, 20 (tracked), 21 (Requirement↔RemoteResource) |
| `CommunicationPolicy` | 08, 17, 18, 19, 20 |
| `RenderedArtifact` | 17 (produces instances), 08, 18, 19, 20 |
| `LearningProposal` | 22 (state machine), 09, 23 |
| `RunSnapshot` | 04 (implements atomic write), 05, 13 |

**Run-lifecycle enum** (`draft|awaiting_approval|ready|running|verifying|integrating|final_verifying|published_local`, terminals `failed|blocked|cancelled`) — consumed by 05/13 (`running`/terminal handling), 08 (`integrating`), 09/11 (`awaiting_approval`, `cancel` command), 14 (`verifying`/`final_verifying` stage names), 16/21 (`ambiguous_write` → `blocked`), 23 (`published_local`). This `blocked` and Jira's own 4-state ticket-status `blocked` (18) are unrelated enums sharing a token, not the same type.

**`WorkUnitAttemptStatus`** — consumed by 04 (work-unit-attempt records), 13 (limit-parking clause), 23 (limit-parked-resume-across-restart matrix vector).

**`JournalEntryType`** — consumed by every phase that journals: 04 (entry codec), 05 (adjudication/session records), 06 (session assignment), 07 (`git_freeze`/`worktree_quarantine`), 08 (`cas_ref_update`), 09/12 (`approval_token_mint`), 13 (`fanout_rationale`), 18/21 (`milestone_sync`), 22 (`learning_transition`), 23 (evidence audit trail).

**`LearningProposalState`** — consumed by 22 (`LearningProposal.state` field type; owns the transition-table tests/enforcement).

**Canonical connector-error union** (10 members) — consumed by 16 (mapping/redaction), 17 (`policy_blocked` on second lint failure), 18/19/20 (typed provider errors), 21 (`ambiguous_write` blocks `final_verifying`).

**CommunicationPolicy constants** — consumed by 08 (branch/commit constants), 17 (all constants, template enforcement), 18/19/20 (Jira/Grafana limits).

**`renderer-core` module** — consumed by 17's `lint()` stages, and by 08's belt-and-suspenders attribution assertion.

**`GATEWAY_MCP_SERVER_NAME`** — consumed by 03 (derives the `mcp__crabgic_gateway__*` allow-string), 06 (`mcpServers` key + `strictMcpConfig` allowlist), 10 (`.mcp.json` entry key), 16 (server registration + tool-name prefix).

**`HighImpactCapabilityFlag`** — consumed by 18 (7 Jira members), 20 (4 Grafana members).

**`docs/threat-model.md`** — consumed by 16 ("threat-model update required"), 23 (security review pass vs. 03/16/17 implementation).

**Testkit fixture builders** — consumed by 03 (fake engine), 04, 05, 06, 13, 16 (fake providers), 18, 19, 20, 22.

**`schemas/*.json`** build artifact — no phase imports it at runtime; its only consumer is the byte-stability exit criterion below (CI evidence, not a cross-phase dependency).

## Interfaces consumed

- **From 01** (`packages/contracts` + `packages/testkit` scaffolding only — 02's sole dependency): empty workspace packages (`package.json` + `tsconfig` only); root `tsconfig.base.json` (strict, `NodeNext`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) via project references; Vitest + v8 coverage wired to the repo-wide 80% line+branch CI gate; ESLint/Prettier/commitlint config; `engines: { node: ">=24" }`.

## Work items

1. Schema module per contract (21 contracts, zod + inferred types); `zod-to-json-schema` build emitting `schemas/*.json`. Failing-first: one invalid-shape fixture per contract rejected before the schema exists.
2. Run-lifecycle state machine + exhaustive table-driven tests; illegal transitions throw a typed error. Failing-first: an illegal `draft → running` fixture.
3. `WorkUnitAttemptStatus` closed union + its own exhaustive transition-table tests. Failing-first: a `parked:rate_limit → succeeded` fixture (illegal — must resume through `dispatched` first).
4. Canonical connector-error union (10 members) + redacting constructors. Failing-first: a constructor call carrying a raw provider body must not type-check against the public type.
5. `JournalEntryType` closed union (13 members) + discriminated-union exhaustiveness test. Failing-first: a stubbed 14th category added only to the test harness must fail `tsc -b` until the union is updated.
6. CommunicationPolicy constants (incl. review-comment limit; no dashboard-version constant) + minimal `renderer-core` module inside `packages/contracts` (length/line counters, attribution-token scanner), consumed by phases 08 and 17. Failing-first: an over-length review-comment fixture.
7. `GATEWAY_MCP_SERVER_NAME` constant + `HighImpactCapabilityFlag` enum (11 members). Failing-first: a golden-value test asserting the literal `"crabgic_gateway"`.
8. Config precedence resolver + fast-check monotonicity properties. Failing-first: a config stack that lowers a security-key boolean must be rejected before the resolver exists.
9. Threat model doc (`docs/threat-model.md`) + review note.
10. Testkit builders: fixture builders per contract + both new unions; deterministic ID/clock providers.

## Test plan

- **Unit:** valid/invalid vectors per contract schema (21 contracts, discriminated-union branches incl. `WorkUnit.session_id` optionality); run-lifecycle transition-table tests (every declared edge plus a sample of illegal ones); `WorkUnitAttemptStatus` transition-table tests (`pending→{dispatched,cancelled}`, `dispatched→{succeeded,failed,cancelled,parked:rate_limit}`, `parked:rate_limit→dispatched` only, three terminals absorbing); canonical-error constructors reject a raw-body field at the type level; CommunicationPolicy boundary fixtures (72/73-char commit subject, 6/7-line review comment); `renderer-core` counter unit tests incl. a seeded "Generated with…" attribution-token fixture.
- **Property:** fast-check config-resolver monotonicity (≥10k cases: no CLI/env/project/user combination loosens a declared security key — deny-lists append-only, booleans one-way, numeric limits min-wins); run-lifecycle fuzz (random transition sequences never reach an undeclared state; terminals absorb); `WorkUnitAttemptStatus` fuzz (same shape, 6-state space).
- **Integration:** every testkit fixture builder round-trips through its contract's own zod schema and JSON Schema export in one harness pass — the same harness 03/16/18/19/20/22 import rather than re-deriving fixtures.
- **Conformance:** `JournalEntryType`/`WorkUnitAttemptStatus` discriminated-union exhaustiveness (`tsc -b` fails on an uncovered member — compile-time, not runtime); JSON Schema artifacts (`schemas/*.json`) byte-stable across two consecutive builds (golden diff, mirroring 17's own byte-stability convention).
- **Security:** canonical-error constructors — a type-level test proving no raw provider-body field exists on the public type (not just redacted at runtime); adversarial fast-check corpus attempting to inject a wider `allow` list or flip a boolean security key from a lower-precedence config layer, asserting the resolver always rejects.

## Exit criteria

**Closeout pass 2026-08-01:** 11/12 ticked against recorded evidence; the 1 unticked box below is
an open defect — see `docs/evidence/criteria-closeout/defects/02-gateway-literal-scan-scope.md`
and that box's own note. Machine-readable index:
`docs/evidence/criteria-closeout/phase-02.json`.

Shared citations reused by several boxes below. **`CI` run
[30718972881](https://github.com/WitchyNibbles/crabgic/actions/runs/30718972881)**, green at
`65ff0da` (this closeout's branch point; the branch was later rebased onto `af46e00`, whose
delta touches no file under `packages/contracts` or `packages/testkit`, and the PR's own CI run
covers the rebased tree) — its `unit-test+coverage (ubuntu-latest)` job
([91419417946](https://github.com/WitchyNibbles/crabgic/actions/jobs/91419417946)), step "test
with 80% line+branch coverage gate", executed 623 test files / 6060 tests, and the step log names
every `@crabgic/contracts` and `@crabgic/testkit` suite cited below individually (job-log lines
409–463 and 894–915); its v8 coverage table (lines 1306–1339) is this phase's coverage report. Two
boxes below are compile-level rather than runtime, and cite the same run's `typecheck
(ubuntu-latest)` job ([91419417975](https://github.com/WitchyNibbles/crabgic/actions/jobs/91419417975))
instead — `tsc -b`, cold and incremental. Scoped local re-runs of each criterion's own suites,
captured verbatim at the closeout commit, are committed as
`docs/evidence/phase-02/closeout-c<k>-*.txt`.

- [x] All 21 contracts round-trip (parse → serialize → parse) with full schema-branch coverage — coverage report artifact. — **Evidence (2026-08-01):** all 21 contract suites carry a `parse → serialize → parse` test, e.g. `packages/contracts/src/contracts/work-unit.test.ts:69-82` `const revived = WorkUnitSchema.parse(JSON.parse(JSON.stringify(original)) as unknown); expect(revived).toEqual(original)` (twice, with and without `session_id`); the full 21-file `file:line` list is in `docs/evidence/phase-02/closeout-c1-contracts-roundtrip-coverage.txt`. Each suite also carries `.strict()` unknown-key and missing-field rejection cases (`work-unit.test.ts:51`), so a schema that accepted everything would round-trip and still fail. `packages/testkit/src/ajv-harness.test.ts:52-54` validates the same 21 instances a second time against the *emitted* JSON Schema (`expect(results).toHaveLength(21)`, `expect(failures).toEqual([])`). Coverage: `CI` run 30718972881's v8 table reports **100 % statements/branches/functions/lines for every one of the 21 contract modules** — enumerated by name from the json-summary reporter in the closeout transcript ("21 contract modules checked; 0 below 100% on any metric"), not inferred from v8's below-100 %-only text table. `docs/evidence/phase-02/exit-criteria-full-gate.txt` §1 is the phase's own committed coverage report. Scope: the 21 are §In scope's list minus `EnvelopePolicy` (added 2026-07-28 by ledger Gap 18, which makes that bullet's count of 21 arithmetically 22) — it has no `schemas/*.json` and no testkit builder, and is at 100 % anyway.
- [x] Run-lifecycle invariant suite green; fast-check fuzz (≥10k cases) finds no illegal path. — **Evidence (2026-08-01):** `packages/contracts/src/state-machines/run-lifecycle.test.ts` — `:126` `{ numRuns: 10_000 }` closes the fuzz property opened at `:89`, so the ≥10k clause is literal; inside it `:109-116` asserts both directions (`current = runLifecycleTransition(current, candidate); expect(RUN_LIFECYCLE_STATES).toContain(current)` for declared edges, `expect(() => runLifecycleTransition(current, candidate)).toThrow(IllegalTransitionError)` for everything else), and `:100-107` makes absorption permanent rather than one-step. The invariant half is generated from the table itself — `:31-39` one `it` per declared edge, `:63-82` terminals absorbing plus "every non-absorbing state has at least one outgoing transition", which is what stops an empty table satisfying the fuzz vacuously; `:42-60` lists nine illegal pairs including work item 2's `draft → running` fixture. `CI` run 30718972881 green at `65ff0da` (job log line 442, 42 tests, 2408 ms); `docs/evidence/phase-02/closeout-c2-run-lifecycle.txt`.
- [x] `WorkUnitAttemptStatus` exhaustive transition-table suite green; `parked:rate_limit` proven reachable only from, and returning only to, `dispatched`. — **Evidence (2026-08-01):** `packages/contracts/src/state-machines/work-unit-attempt-status.test.ts:55-61` asserts both halves of the clause separately — `expect(WORK_UNIT_ATTEMPT_STATUS_TRANSITIONS["parked:rate_limit"]).toEqual(["dispatched"])` (returning only to) and a loop over every other source state asserting `expect(tos).not.toContain("parked:rate_limit")` (reachable only from) — and `:122-127` re-proves the same property under fuzz rather than by reading the table (`if (previous === "parked:rate_limit") expect(current).toBe("dispatched")`, `if (current === "parked:rate_limit") expect(previous).toBe("dispatched")`, `:138 { numRuns: 10_000 }`). Exhaustiveness: `:30-38` one generated `it` per declared edge, `:41-52` the declared shape, `:21` six members, `:76-78` three terminals, `:82-94` nine illegal pairs including work item 3's `parked:rate_limit → succeeded`. Matches interface-ledger Gap 4 verbatim. `CI` run 30718972881 green at `65ff0da` (job log line 430, 28 tests); `docs/evidence/phase-02/closeout-c3-work-unit-attempt-status.txt`.
- [x] Canonical connector-error union (10 members): a type-level test proves no raw provider-body field is constructible on the public type; every member has ≥1 round-trip fixture. — **Evidence (2026-08-01):** the type-level half is enforced by the `typecheck` job, not the test job: `packages/contracts/src/errors/connector-error.test.ts` carries three `@ts-expect-error` directives — `:183-186` a `rawProviderBody` key on the `ConnectorErrorData` literal, `:199-202` reading `err.rawProviderResponse` off a constructed instance, `:210-212` a `rawProviderBody` key on the constructor input — and an `@ts-expect-error` that suppresses nothing is itself TS2578, so a green `tsc -b` is the proof. `docs/evidence/phase-02/closeout-c4-connector-errors.txt` deletes each directive in turn and captures the diagnostic it was suppressing verbatim (`TS2353 … 'rawProviderBody' does not exist in type …`, `TS2339: Property 'rawProviderResponse' does not exist on type 'ConnectorError'`, `TS2353 … does not exist in type 'ConnectorErrorInput'`), reverting after each. Round-trips: `:65-83` is an `it.each` over the 10-entry `CONSTRUCTORS` table (`:41-52`) doing construct → `toData` → stringify → `ConnectorErrorDataSchema.parse` → `expect(roundTripped).toStrictEqual(data)`, each fixture built *with* a secret-bearing raw response and asserting `expect(JSON.stringify(roundTripped)).not.toContain("should-never-survive")`; `:12`/`:16-27` pin the union at 10 members in roadmap order. `CI` run 30718972881 green at `65ff0da` (`unit-test+coverage` job log line 412, 37 tests; `typecheck` job 91419417975).
- [x] `JournalEntryType` exhaustiveness check: an uncovered category added anywhere in the codebase fails `tsc -b`, demonstrated by a temporarily-stubbed 14th category. — **Evidence (2026-08-01):** the phase's own demonstration is committed as `docs/evidence/phase-02/wi5-journal-14th-member-tsc-failing.txt` (`error TS2741: Property 'capability_quarantine_verdict' is missing … but required in type 'Record<StubbedFourteenMemberJournalEntryType, string>'`, exit 1) and `wi5-journal-tsc-clean.txt` (exit 0 once reverted). Re-run at this commit in `docs/evidence/phase-02/closeout-c5-journal-14th-member.txt`, in two demos: **A** reproduces that stub and gets the identical diagnostic; **B** carries the "anywhere in the codebase" clause by adding the 14th member to `JOURNAL_ENTRY_TYPES` itself and compiling the whole repo, which breaks **five** sites in three other packages — `packages/journal/src/codec/journal-payloads.ts(217,3) TS1360` (production code), `journal/src/codec/journal-entry.test.ts(21,7)`, `journal/src/store/query-entries.test.ts(31,7)`, `scheduler/src/conformance.test.ts(26,7)`, `gates/src/conformance.test.ts(21,7)`, matching interface-ledger Gap 5's own "5 compile-breaking `Record<JournalEntryType, …>` sites" cost estimate exactly. Both stubs reverted, `git diff --stat` empty, clean rebuild. The mechanism itself is `packages/contracts/src/journal/journal-entry-type.ts:62`; `journal-entry-type.test.ts:20/:41-55/:59/:65` are its runtime mirror. Standing channel: `CI` run 30718972881's `typecheck` job, green at `65ff0da`. Gap-5 check: the ledger's 2026-08-01 Resolution keeps the union closed at 13 and journals capability-quarantine verdicts as `adjudication_decision`, changing no member, schema or golden — so both wi5 transcripts remain accurate.
- [x] Property tests prove no random config-layer stack can loosen a declared security key (≥10k fast-check cases, zero counterexamples). — **Evidence (2026-08-01):** `packages/contracts/src/config/precedence.test.ts:227-273` — `{ numRuns: 10000 }` at `:271`, and the property asserts an outcome per security-key *kind* rather than "did not throw": deny-list `expect(resolved["deniedToolPatterns"] ?? []).toEqual(expectedDenyList)` against the recomputed sorted union of every layer, boolean `if (anyLayerSecure) expect(resolved["sandboxEnabled"]).toBe(true)`, numeric `expect(resolved["maxConcurrentWorkers"]).toBeLessThanOrEqual(layerValue)` for every layer's own value. `:236-239` requires the reject path to be the typed `SecurityKeyLoosenedError`, and `:120-143` keeps non-security keys on plain CLI > env > project > user > defaults precedence, so "reject everything" is not a passing strategy. `:277-347` adds the Test-plan Security bullet's adversarial corpus as three further properties (boolean flip from each of the 10 ordered layer pairs, 5000 runs; min-wins numeric raise, 5000 runs; deny-list shrink, 2000 runs). fast-check reports a counterexample as a failure, so green is the "zero counterexamples" clause. `CI` run 30718972881 green at `65ff0da` (job log line 421, 15 tests, 2625 ms); `docs/evidence/phase-02/closeout-c6-config-resolver.txt`; TDD pair `wi8-config-resolver-{failing,passing}.txt`.
- [x] JSON Schema artifacts byte-stable across two consecutive builds (empty diff). — **Evidence (2026-08-01):** `docs/evidence/phase-02/closeout-c7-schema-bytestable.txt` — two consecutive `npm --prefix packages/contracts run build:schemas` runs at this commit, then `diff -r` of the two output copies (`diff -r exit: 0`, byte-identical), plus `git diff --stat -- packages/contracts/schemas` and `git status --short -- packages/contracts/schemas` both empty, i.e. the regenerated bytes also equal the *committed* bytes; 21 files with a sha256 manifest. `schemas/*.json` are generated by `packages/contracts/scripts/build-schemas.ts` and never hand-edited, so regenerating through the writer for an empty diff is what makes the committed bytes provenance-checked. The phase's own capture of the identical procedure is `wi1-json-schema-bytestable.txt` (which also records the determinism settings the property rests on), re-confirmed in `exit-criteria-full-gate.txt` §6 and again in its dated ADDENDUM after the `CONNECTOR_ERROR_KINDS` order fix actually changed `schemas/remote-operation-record.json`. Channel note: no CI job regenerates and diffs the schemas, and this criterion does not name CI; the nearest standing guard is `packages/testkit/src/ajv-harness.test.ts`, which catches a *stale* schema rather than an unstable one.
- [x] `GATEWAY_MCP_SERVER_NAME` is the sole definition site of the literal `"crabgic_gateway"` — a repo-wide grep/golden-value CI check fails if the literal appears a second time under `packages/*`. — **Evidence (2026-08-06), closed by remediation:** the golden-value half was always met; the scan half was met only within a scope narrower than this box's own wording. `packages/contracts/src/gateway/server-name.test.ts:144-155` now walks every **tracked** file under `packages/` via `git ls-files` — 1055 files under the old `packages/*/src/**/*.ts` walk, **1505** now — with `:168` and `:189` as anti-vacuity floors in both directions (a walk that scanned nothing, and one that read no file content). Twelve files besides the two definition sites contain the literal; each is allowlisted with a stated reason, and `:215` asserts every non-definition entry names a derivation test that exists, so the allowlist cannot become the new vacuity. `packages/plugin/.mcp.json` — the hand-typed manifest the old scope could not see — is bound by `packages/cli/src/installer/mcp-entry.golden.test.ts:131` `expect(readShippedManifest()).toEqual(mergeMcpJson({}).mcpJson)`, converting it from "not a second hand-typed literal" into "provably derived". **Negative control:** appending the literal to `packages/plugin/.claude-plugin/plugin.json` fails the widened scan naming that path, while `git ls-files -- 'packages/*/src/**/*.ts' | grep -c plugin.json` returns 0. CI run [31083396959](https://github.com/WitchyNibbles/crabgic/actions/runs/31083396959) job 92557176556 line 436 shows the suite at 4 tests, against 2 for the same file in the same job at `main` 8c9cc56.
- [x] `HighImpactCapabilityFlag` (11 members) fixture-tested; label strings byte-match what 18/20 cite (`closing transitions`, `bulk mutations`, etc.). — **Evidence (2026-08-01):** `packages/contracts/src/capability-flags/high-impact-capability-flag.test.ts:9` `expect(HIGH_IMPACT_CAPABILITY_FLAGS.length).toBe(11)`; `:23-35` the byte-match clause as a full ordered equality against the literal list, including both labels the criterion calls out; `:38-63` asserts the 18/20 split separately — Jira's 7 and Grafana's 4 each by name — which is what makes "what 18/20 cite" a checked claim rather than a total; `:18-20` `expect(HighImpactCapabilityFlagSchema.safeParse("random capability").success).toBe(false)` is the closed-union control. Matches interface-ledger Gap 10 and §In scope verbatim. `CI` run 30718972881 green at `65ff0da` (job log line 459, 6 tests); `docs/evidence/phase-02/closeout-c9-high-impact-flags.txt`.
- [x] CommunicationPolicy golden snapshot includes the review-comment limit and contains no dashboard-version-message entry. — **Evidence (2026-08-01):** `packages/contracts/src/contracts/communication-policy.test.ts:143` `expect(DEFAULT_COMMUNICATION_POLICY).toEqual(GOLDEN_COMMUNICATION_POLICY)` against the literal snapshot at `:22-47`, which carries `reviewComment: { maxLines: 6, shape: ["finding", "evidence", "action"] }`; `:147` asserts the review-comment limit directly rather than only through the snapshot; `:150-153` is the second clause as a *recursive* key sweep (`for (const key of collectKeys(DEFAULT_COMMUNICATION_POLICY)) expect(key).not.toMatch(/dashboard/i)`, `collectKeys` at `:12-20` walking nested objects and arrays), repeated over `COMMUNICATION_POLICY_LIMITS` at `:130-134`. `:193-205` is the boundary control that makes the recorded 6 enforced rather than stored (6 lines pass `checkLimit`, 7 do not — work item 6's mandated failing-first fixture), and `:166-172` rejects a `"dashboard_version"` prohibited-content category. Interface-ledger Gap 6 is the ruling behind the second clause. `CI` run 30718972881 green at `65ff0da` (job log line 413, 23 tests); `docs/evidence/phase-02/closeout-c10-communication-policy.txt`; TDD pair `wi6-comms-renderer-{failing,passing}.txt`.
- [x] Threat model review recorded: `docs/threat-model.md` STRIDE list covers UDS, worker runtime, envelope compiler, installer, gateway, connectors, capability quarantine, renderer, learning store; sign-off note committed. — **Evidence (2026-08-01):** `docs/threat-model.md` — the nine surfaces are its nine numbered sections in the criterion's own order (`:70` UDS, `:91` worker runtime, `:113` envelope compiler, `:133` installer, `:153` gateway, `:172` connectors, `:191` capability quarantine, `:211` renderer, `:230` learning store); the sign-off note is `:280 ## Review note`, carrying Reviewer, Date (2026-07-15), Scope reviewed, a Verdict, and seven honest Open items. `docs/evidence/phase-02/closeout-c11-threat-model.txt` is the anti-vacuity check: rather than trusting the headings, it parses each section's table and counts distinct STRIDE row labels, reporting `6/6` for all nine (54 cells, the number the Review note itself claims). Two record corrections that do not affect the tick: this phase's evidence README points at the doc's "Open items" section as the sign-off, which is really one bullet of "## Review note"; and interface-ledger Gap 5's 2026-08-01 Resolution updated §7's Repudiation row ("**Closed 2026-08-01.**") but two other passages in the same file still describe that gap as open (`:265` and `:316-317`) — reported to the closeout integrator, out of this pass's write set.
- [x] Testkit fixture builders exist for all 21 contracts plus both new unions, each producing an instance that validates against its own schema — meta-test running every builder through its contract's zod parser. — **Evidence (2026-08-01):** `packages/testkit/src/fixtures/registry.test.ts:13-22` pins the three counts separately — `expect(CONTRACT_FIXTURES).toHaveLength(21)`, `expect(ENUM_FIXTURES).toHaveLength(2)` (`WorkUnitAttemptStatus` and `JournalEntryType`, `registry.ts:209-220`), `expect(ALL_FIXTURES).toHaveLength(23)` — and `:29-45` is the meta-test itself, generated from the registry rather than hand-listed: `it.each(CONTRACT_FIXTURES…)` running `entry.schema.safeParse(entry.build())` and asserting success, with the same shape over `ENUM_FIXTURES`. `packages/testkit/src/ajv-harness.test.ts:52-54` adds the second surface (each builder's output against its emitted `schemas/*.json` via ajv), and `:31-37` is its negative control (`{ not: "a work unit" }` must be invalid), without which a harness returning `valid: true` unconditionally would pass the 21-fixture sweep; `registry.test.ts:47-54` adds the immutability control. `CI` run 30718972881 green at `65ff0da` (job log lines 915 and 912); `docs/evidence/phase-02/closeout-c12-testkit-builders.txt`; TDD pair `wi10-testkit-{failing,passing}.txt`, whose RED state is all four files failing with `Cannot find module` before any implementation existed.

## Risks & open questions

- `schemaVersion` is carried on every contract from day one — the journal (04) must survive contract evolution across versions; migration tests land with work item 1, not deferred.
- `WorkUnitAttemptStatus` membership beyond the four resolution-mandated members (`dispatched`, `succeeded`, `failed`, `parked:rate_limit`) is this phase's own discretionary choice (`pending`, `cancelled`) per the binding resolution's explicit delegation — a later phase adding a further member must also update the exhaustive transition-table tests here, not silently assume one.
- `JournalEntryType`'s 13-member list is binding as adjudicated; phase 12 has flagged that capability-quarantine audit pass/fail verdicts (as opposed to `trust approve`'s token mint, which does map to `approval_token_mint`) have no clean dedicated member. That tension is real but out of this phase's authority to resolve unilaterally — a 14th member would need to go back through the same resolution process, not be added here.
- STRIDE surface list now explicitly names capability quarantine and renderer, closing gaps flagged by 12 and 17 respectively (adaptation §10 risk 11 covers the plugin/executable-capability angle of the former).
- `HighImpactCapabilityFlag` is a name introduced in this phase for the previously-unnamed 11-member enum (matching the cross-phase ledger's own proposed name) — 18/20 should cite it by this name rather than re-describing it as anonymous prose.
- No Claude Code engine fact is asserted by this phase (pure schemas/state machines/constants); the one Claude-Code-adjacent literal, `GATEWAY_MCP_SERVER_NAME = "crabgic_gateway"`, is a product-chosen identifier, not an engine behavior, and needs no `docs/engine-baseline.md` citation or verify-at-build-time spike.
