# Phase 02 — Core contracts, state machines, canonical errors

| | |
|---|---|
| **Depends on** | 01 |
| **Unlocks** | 03, 04, 08, 12, 16, 17 |
| **Sources** | original plan "Core contracts", run lifecycle, canonical errors, CommunicationPolicy limits, config precedence; adaptation §2 & Appendix B (`eo_gateway` MCP naming), §4.5 (WorkUnit `session_id`), §5.6 (rate-limit parking), §8 ("stays exactly as planned" list) |
| **Primary package** | `packages/contracts` (+ `packages/testkit` fixtures) |

## Goal

Every cross-cutting type in the system exists exactly once — a zod schema with inferred TS types and exported JSON Schema — with the run lifecycle, work-unit attempt status, and journal entry type each a single closed union backed by exhaustive tests, plus the canonical connector-error union and the security-monotonic config resolver, all landing before any subsystem is built against them. Done means: no downstream phase hand-defines a type this phase already owns, and no cross-cutting enum survives only as prose.

## In scope

- **Contracts (zod + JSON Schema export, 21):** ProjectProfile, StackEvidence, IntentContract, Requirement, AuthorizationEnvelope, CapabilityManifest, PerformanceContract, ChangeSet, WorkUnit (carries the engine `session_id` field, adaptation §4.5), TaskPacket, WorkerResult, EvidenceRecord, ExternalConnection, CapabilitySnapshot, RemoteMutationPlan, RemoteOperationRecord, RemoteResource, CommunicationPolicy, RenderedArtifact, LearningProposal, RunSnapshot.
- **Run-lifecycle state machine:** `draft → awaiting_approval → ready → running → verifying → integrating → final_verifying → published_local`, terminals `failed | blocked | cancelled`; transition table + invariant tests (terminals absorbing; every transition typed against `JournalEntryType`'s `run_transition` member).
- **`WorkUnitAttemptStatus`** (new — orthogonal to the run lifecycle; a WorkUnit's attempt can park while its parent Run stays `running`): `pending | dispatched | succeeded | failed | cancelled | parked:rate_limit`. `pending` moves to `dispatched` or directly to `cancelled`; `parked:rate_limit` transitions only to/from `dispatched`; `succeeded`/`failed`/`cancelled` are terminal. Own exhaustive transition-table tests, independent of the run-lifecycle suite.
- **Canonical connector errors:** `authentication, permission, not_found, conflict, rate_limited, validation, unsupported, transient, ambiguous_write, policy_blocked` as a closed union (10 members); constructors force provider-body redaction — no raw body field exists on the public type.
- **`JournalEntryType`** (new — 13-member closed union; every journal entry, 04, carries exactly one member): `run_transition, work_unit_transition, adjudication_decision, remote_operation_record, evidence_pointer, session_assignment, git_freeze, worktree_quarantine, cas_ref_update, approval_token_mint, fanout_rationale, milestone_sync, learning_transition`. Rate-limit-park events are `work_unit_transition` entries (their status field is `WorkUnitAttemptStatus`) — there is no separate `rate_limit_park` member.
- **`LearningProposalState`** (new — 11-member closed union; the type of `LearningProposal.state`): `observation | reproducer | candidate | dev_eval | held_out_eval | shadow_run | independent_review | promoted | rejected | rolled_back | expired`. Transition-table tests, guards, and promotion enforcement are owned by 22, which hosts the pipeline this union names.
- **CommunicationPolicy constants:** branch ≤64; commit subject ≤72 (`type(scope): outcome`); commit body ≤5 lines; PR title ≤72; PR body ≤12 lines / 4 sections (Outcome, Validation, Risk, Tracking); Jira summary ≤120; Jira comment ≤800 chars / 6 lines + milestone template; Grafana annotation ≤240; review comment ≤6 lines (one finding, evidence, action); prohibited-content categories (attribution, first-person, signatures, mentions, secrets, unsafe links).
- **`renderer-core` module**, inside `packages/contracts` (not a standalone package): length/line counters + attribution-token scanner primitives.
- **`GATEWAY_MCP_SERVER_NAME`** constant: `"eo_gateway"` — the single literal every engine-side MCP registration derives from (03's compiled allow-string, 06's `mcpServers`/`strictMcpConfig` allowlist, 10's `.mcp.json` entry key, 16's SDK server registration + `mcp__${GATEWAY_MCP_SERVER_NAME}__<tool>` wire-prefix); no phase hand-types the literal a second time.
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

**`GATEWAY_MCP_SERVER_NAME`** — consumed by 03 (derives the `mcp__eo_gateway__*` allow-string), 06 (`mcpServers` key + `strictMcpConfig` allowlist), 10 (`.mcp.json` entry key), 16 (server registration + tool-name prefix).

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
7. `GATEWAY_MCP_SERVER_NAME` constant + `HighImpactCapabilityFlag` enum (11 members). Failing-first: a golden-value test asserting the literal `"eo_gateway"`.
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

- [ ] All 21 contracts round-trip (parse → serialize → parse) with full schema-branch coverage — coverage report artifact.
- [ ] Run-lifecycle invariant suite green; fast-check fuzz (≥10k cases) finds no illegal path.
- [ ] `WorkUnitAttemptStatus` exhaustive transition-table suite green; `parked:rate_limit` proven reachable only from, and returning only to, `dispatched`.
- [ ] Canonical connector-error union (10 members): a type-level test proves no raw provider-body field is constructible on the public type; every member has ≥1 round-trip fixture.
- [ ] `JournalEntryType` exhaustiveness check: an uncovered category added anywhere in the codebase fails `tsc -b`, demonstrated by a temporarily-stubbed 14th category.
- [ ] Property tests prove no random config-layer stack can loosen a declared security key (≥10k fast-check cases, zero counterexamples).
- [ ] JSON Schema artifacts byte-stable across two consecutive builds (empty diff).
- [ ] `GATEWAY_MCP_SERVER_NAME` is the sole definition site of the literal `"eo_gateway"` — a repo-wide grep/golden-value CI check fails if the literal appears a second time under `packages/*`.
- [ ] `HighImpactCapabilityFlag` (11 members) fixture-tested; label strings byte-match what 18/20 cite (`closing transitions`, `bulk mutations`, etc.).
- [ ] CommunicationPolicy golden snapshot includes the review-comment limit and contains no dashboard-version-message entry.
- [ ] Threat model review recorded: `docs/threat-model.md` STRIDE list covers UDS, worker runtime, envelope compiler, installer, gateway, connectors, capability quarantine, renderer, learning store; sign-off note committed.
- [ ] Testkit fixture builders exist for all 21 contracts plus both new unions, each producing an instance that validates against its own schema — meta-test running every builder through its contract's zod parser.

## Risks & open questions

- `schemaVersion` is carried on every contract from day one — the journal (04) must survive contract evolution across versions; migration tests land with work item 1, not deferred.
- `WorkUnitAttemptStatus` membership beyond the four resolution-mandated members (`dispatched`, `succeeded`, `failed`, `parked:rate_limit`) is this phase's own discretionary choice (`pending`, `cancelled`) per the binding resolution's explicit delegation — a later phase adding a further member must also update the exhaustive transition-table tests here, not silently assume one.
- `JournalEntryType`'s 13-member list is binding as adjudicated; phase 12 has flagged that capability-quarantine audit pass/fail verdicts (as opposed to `trust approve`'s token mint, which does map to `approval_token_mint`) have no clean dedicated member. That tension is real but out of this phase's authority to resolve unilaterally — a 14th member would need to go back through the same resolution process, not be added here.
- STRIDE surface list now explicitly names capability quarantine and renderer, closing gaps flagged by 12 and 17 respectively (adaptation §10 risk 11 covers the plugin/executable-capability angle of the former).
- `HighImpactCapabilityFlag` is a name introduced in this phase for the previously-unnamed 11-member enum (matching the cross-phase ledger's own proposed name) — 18/20 should cite it by this name rather than re-describing it as anonymous prose.
- No Claude Code engine fact is asserted by this phase (pure schemas/state machines/constants); the one Claude-Code-adjacent literal, `GATEWAY_MCP_SERVER_NAME = "eo_gateway"`, is a product-chosen identifier, not an engine behavior, and needs no `docs/engine-baseline.md` citation or verify-at-build-time spike.
