# Phase 21 — Connector evidence integration & drift CI

| | |
|---|---|
| **Depends on** | 14, 18, 20 |
| **Unlocks** | 23 |
| **Sources** | original plan phase 9 (connector evidence into contracts/verification/perf/security/learning); adaptation §7 (connector notes: gateway-only egress, result-size budgets), §4.4 (evidence-carrying results) |
| **Primary packages** | `packages/gates` (gate registration, traceability view, drift-CI job), `packages/connectors-jira`, `packages/connectors-grafana` (revision comparators, done-transition guards) |

## Goal

Remote state becomes first-class evidence instead of a side effect: every requirement bound to a Jira issue or Grafana resource carries a confirmed remote revision before its run may leave `final_verifying` (02); the requirement→work-unit→object-ID→remote-revision chain resolves in both directions on demand; an unmapped or ambiguous remote operation blocks rather than silently passing; a material remote-side edit mid-run reliably reaches phase 11's approval gate instead of being overwritten; and provider drift is caught on a schedule without ever auto-changing what's pinned.

## In scope

- **Evidence-pointer linkage:** every `RemoteResource` (02) that a Jira/Grafana intake or mutation resolves for a requirement (18/20) is recorded as an `evidence_pointer`-typed `JournalEntryType` (02, 13-member union) entry keyed by `Requirement.id`, tagged `tracking-issue | dashboard | alert`; bidirectional requirement↔resource lookup built on top, in `packages/gates`. Pre-approval mutation *previews* stay 11's concern (11 calls gateway tools directly, before 21 exists in a run's timeline) — this bullet is strictly post-execution, durable, evidence-only.
- **Evidence binding:** the read-back-verified remote revision that 16's pipeline confirms (surfaced through 18/20) is bound onto the same `EvidenceRecord` (02) instances 14 already emits for that requirement, alongside 14's existing exact-object-ID field — an extension of 14's evidence channel, not a new one.
- **Verification gate:** a `remote_verification` gate registered into 14's contract-risk-tag gate framework blocks the Run lifecycle's `final_verifying`→`published_local` transition (02) for any requirement with an unbound evidence pointer, or whose remote operation resolved to canonical `unsupported` or `ambiguous_write` (02's 10-member connector-error union) — never a silent pass, and never an informal 11th error code. (Jira's own `done` workflow state (18, its own 4-state `planned/in_progress/blocked/done` mapping) is a distinct enum from the Run lifecycle's `final_verifying`/`published_local`; the gate blocks the latter on verification of the former — the two are never conflated.)
- **Remote-edit reconciliation:** 18's milestone revision polling feeds a conservative field-level materiality classifier (summary/description/acceptance-criteria fields only, first pass); a material diff raises 11's `material amendment` stop condition (reached transitively via 14→13→11) — 21 supplies the trigger signal, 11 owns the amendment/re-approval mechanics.
- **Drift CI:** a scheduled job replays 18's and 20's pinned cassettes/fixtures against live sandboxes; on divergence it emits a `DriftProposal` artifact (connector, pinned vs. observed version, redacted diff reusing 16's provider-body redaction discipline, recommended fixture update) for human review — never an automatic routing or version-pin change.
- **Cross-gate wiring:** 16/18/20's already-built security fixtures (forged admin/delete, tenant-boundary, redaction) are registered as standing, blocking entries in 14's gate manifest rather than one-off phase-exit tests; connector operation latency is captured in the same `EvidenceRecord` stream 14 emits — available to any performance analysis, but 21 does not implement 15's benchmarking harness and there is no direct 21→15 dependency edge (15 and 21 are sibling dependents of 14, per the README graph).

## Out of scope

- Pre-approval remote-mutation **preview** rendering — 11 (calls 16's gateway tools directly; nothing there waits on 21).
- Jira/Grafana auth, resource CRUD, rate limiting, capability discovery, and the plan→validate→journal→apply→read-back pipeline itself — 16 (transport/pipeline), 18 (Cloud), 19 (Data Center), 20 (Grafana).
- PerformanceContract methodology and the benchmarking harness itself — 15; 21 only ensures connector timing lands in evidence 15 could read.
- Amendment-diff computation, envelope re-versioning, re-approval token minting — 11; 21 only supplies the materiality signal.
- Capability-quarantine review UX (`trust review`) — 12; the drift-proposal review is its own self-contained artifact/flow, not a reuse of 12's command.
- Jira Data Center-specific evidence handling — 19, which extends 18's Cloud evidence contract; 21 does not special-case DC.
- Any VCS-host (GitHub/GitLab/Bitbucket) delivery of evidence — confirmed absent from v1 scope entirely (adaptation §8: local-branch publication without checkout/push; no such connector phase exists anywhere in 00–23); not reintroduced here despite the topical adjacency.
- Security/coverage adapter selection and implementation (SAST, secret scanning, dependency/license analysis, coverage, flake policy) — 14; 21 only adds connector-specific fixtures into that already-built framework.

## Interfaces produced

- **`evidence_pointer` journal entries** (02's `JournalEntryType`) — payload `{requirementId, remoteResourceId, relation: "tracking-issue"|"dashboard"|"alert"}`, queryable bidirectionally. Consumed internally by this phase's traceability view and verification gate; no other phase reads them directly.
- **Bound `EvidenceRecord` instances** carrying a confirmed remote revision alongside 14's existing object-ID/digest fields. Consumed by: 23 (release-gate check "every requirement linked to evidence from the exact final object ID and remote revisions").
- **`remote_verification` gate** — a new entry in 14's contract-risk-tag gate registry. Runtime-consumed by 14's own gate-execution engine; this is a registration into an already-extensible framework, the same pattern 12/18/19/20 already use for their own SSDF-selected security adapters — it does not require 14 to depend on 21.
- **Materiality trigger signal**, feeding 11's `material amendment` stop condition. Runtime-consumed by 11's stop-condition detector (reached transitively: 21→14→13→11; no new build-order edge — 11 is already-built infrastructure by the time 21's trigger fires during a live run).
- **Traceability view** (requirement → work unit → exact object ID → RemoteResource → confirmed revision, bidirectional) — backs phase 09's already-stubbed `evidence <change-set-id>` command (09 ships it `NOT_IMPLEMENTED` per its own convention; 21 wires the connector-evidence portion here, mirroring the `gateway mcp` stub-then-wire pattern already established between phases 09 and 16 — no new 21→09 dependency edge required). Consumed by: 23 (E2E traceability check); the CLI's `evidence` command once wired.
- **`DriftProposal` artifact** (connector, pinned-fixture version, observed-live version, redacted diff, recommended fixture update) + the scheduled CI job producing it. Consumed by: a human reviewer, out-of-band (no CLI dependency introduced); keeps 18/20's cassette corpus current, which 18's own Risks/notes already forward-reference ("cassettes refreshed by 21's drift job").
- **Connector security-fixture gate registrations** (importing 16/18/20's forged-admin/delete, tenant-boundary, and redaction fixtures into 14's manifest as blocking, not advisory) + **connector operation latency** captured in 14's `EvidenceRecord` stream. Consumed by: 14's gate-execution engine (registrations); available to, but not contractually consumed by, 15 (no 21→15 edge exists in the dependency graph).

## Interfaces consumed

From **14** (`packages/gates`):
- The contract-risk-tag-keyed gate registry/framework — 21 registers into it, does not reimplement it.
- `EvidenceRecord` emission (02 schema; 14 populates command, exit status, env/toolchain fingerprint, timestamp, artifact digests, exact object ID) — 21 extends specific instances with remote-revision data.
- The stop-condition/amendment surface, reached transitively through 14's own dependency chain (14→13→11) — 21 relies on it existing and firing on the signal supplied; 21 does not re-implement 11's `material amendment` handling.

From **18** (`packages/connectors-jira`):
- `RemoteResource` (02 schema) records for Jira issues/epics/boards/sprints, and their read-back-verified revisions (16's pipeline, surfaced by 18).
- The `planned/in_progress/blocked/done` workflow-state mapping and `milestone_sync`-typed `JournalEntryType` (02) events from 18's milestone-sync engine.
- 18's recorded Cloud v3/Agile cassettes (its work item 6) — replayed by the drift job.
- Canonical connector errors (02's 10-member union) as typed by 18's resource clients, including `unsupported` for gaps the adapter never guesses at.

From **20** (`packages/connectors-grafana`):
- `RemoteResource` (02 schema) records for folders/dashboards/alert rules/contact points/mute timings/notification templates, their read-back-verified revisions, and rollback-snapshot state (20's mutation-safety mechanism).
- 20's cassette/version fixtures per Grafana release (its work item 6) — replayed by the drift job.
- The dashboard-version/`resourceVersion`/ETag concurrency token (20) used as the "confirmed remote revision" value for Grafana resources.

## Work items

1. Evidence-pointer population: write `evidence_pointer` `JournalEntryType` entries linking `Requirement.id`↔`RemoteResource.id` as 18/20 resolve tracking issues/dashboards; bidirectional lookup in `packages/gates`. Failing-first: a lookup against an empty journal must return empty, not throw — written before the writer exists.
2. Evidence binding: extend 14's `EvidenceRecord` emission with the confirmed remote revision from 18/20's read-back verification, keyed by item 1's pointers. Failing-first: an `EvidenceRecord` for a tracked requirement missing the revision field must fail a completeness assertion before the populating code exists.
3. `remote_verification` gate: register into 14's framework; block `final_verifying`→`published_local` (02) on unresolved pointers or `unsupported`/`ambiguous_write` outcomes (02). Failing-first: a requirement with an unbound pointer must fail the gate before the gate's pass path is implemented.
4. Materiality classifier + amendment trigger: conservative field allow-list (summary/description/acceptance-criteria) over 18's milestone revision diffs; fires 11's `material amendment` stop condition. Failing-first: a diff touching only a non-tracked field (e.g. Jira watchers) must **not** trigger, asserted before the tracked-field-triggers case is implemented.
5. Drift-CI job: scheduled replay of 18/20 cassettes against live/sandbox endpoints; diff → `DriftProposal`. Failing-first: a run against an intentionally bumped fixture must produce a red check before the job's no-drift green path is implemented.
6. Cross-gate wiring: register 16/18/20's security fixtures into 14's manifest as blocking entries; capture connector latency in the `EvidenceRecord` stream. Failing-first: a manifest-completeness test (asserting all named fixtures present) is written before the registrations exist, so it fails first.

## Test plan

**Unit** — `evidence_pointer` round-trip: seed 3 requirements (2 Jira-tracked, 1 Grafana-tracked); bidirectional requirement↔`RemoteResource` lookup resolves both directions; an untracked requirement returns empty, not an error. Canonical-error mapping: a `RemoteMutationPlan` whose action type is absent from the adapter's table must resolve to `unsupported` (02), never a bespoke "unknown" value. Enum-disjointness: Jira's `done` (18) and the Run lifecycle's `final_verifying`/`published_local` (02) share no member string.

**Property** — materiality classifier: fast-check property over randomized field-level diffs — any diff touching summary/description/acceptance-criteria fields classifies `material = true`; diffs touching only non-tracked fields (watchers, labels, etc.) classify `material = false`, holding across the generated space.

**Integration** — E2E on 16/18/20's fakes: a run completes only when every requirement's `EvidenceRecord` carries a confirmed remote revision; a seeded mid-run edit to a tracked Jira issue's description halts the run via 11's `material amendment` stop condition before `final_verifying` completes. Unknown-operation fixture: a seeded `RemoteMutationPlan` with an unmapped action type blocks `final_verifying` with an actionable `EvidenceRecord` entry, not a silent pass.

**Conformance** — drift-CI job run against an intentionally bumped fake Jira/Grafana schema fixture (renamed field or withdrawn capability): must produce exactly one `DriftProposal` artifact and a red check, with zero pinned-fixture/config changes applied by the job itself (diffed before/after).

**Security** — gate-manifest completeness: 14's loaded gate set must include 16/18/20's forged-admin/delete, tenant-boundary, and redaction fixtures as blocking (not advisory) entries; removing any one fails the completeness test — proof that these fixtures graduated from one-off phase-exit checks to standing, continuously-run gates.

## Exit criteria

- [ ] E2E on fakes: a run completes only when every requirement's `EvidenceRecord` carries a confirmed remote revision; a seeded mid-run tracked-field edit halts the run via 11's `material amendment` stop condition before `final_verifying`. Evidence: integration suite in `packages/gates` + the halted run's journal excerpt.
- [ ] `unsupported`-mapped and `ambiguous_write` remote operations block the `final_verifying`→`published_local` transition (02) with an actionable `EvidenceRecord` entry, never a silent pass. Evidence: fault-matrix test.
- [ ] Drift-CI job run against an intentionally bumped fixture produces exactly one `DriftProposal` artifact and a red CI check, with zero pinned-fixture/config changes applied by the job itself. Evidence: CI job log + before/after repo-state diff.
- [ ] Traceability view resolves requirement → work unit → exact object ID → RemoteResource → confirmed revision, both directions, on a seeded multi-requirement `ChangeSet`. Evidence: golden traceability-view fixture, snapshot-tested.
- [ ] 16/18/20's security fixtures (forged admin/delete, tenant boundary, redaction) are present as blocking entries in 14's gate manifest; removing one fails the manifest-completeness test. Evidence: manifest-completeness test.
- [ ] Jira's `done` (18) and the Run lifecycle's `final_verifying`/`published_local` (02) are proven to share no member string. Evidence: enum-disjointness test.

## Risks & open questions

- Materiality-rule false negatives/positives: the field allow-list stays conservative (summary/description/acceptance only) until 22's learning loop proposes tuned versions — never silently widened. 
- Drift job hits live systems on a schedule: transient provider flakiness could masquerade as drift. Mitigation: require repeated failing runs before emitting a `DriftProposal` (debounce), not a single sample.
- Live sandbox availability for the drift job depends on the disposable environments 18/20 provision for phase 23 (P18: "Live Jira Cloud sandbox needed by 23 — provision early"; P23: "Provision live sandboxes during phases 18–20, not here") — the drift job schedules against those same environments rather than provisioning its own.
- Open implementation detail (non-blocking): exact storage location for `DriftProposal` artifacts (CI-artifact store vs. a repo path) is left to the implementing PR.
- No adaptation §10 engine-fact risk directly governs this phase — 21 does not touch the Claude Code engine boundary; its only engine-adjacent exposure (worker-grade sandbox profiles used to execute security fixtures) is already covered by 03/06's own verify-at-build-time items.
