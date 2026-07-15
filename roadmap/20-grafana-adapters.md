# Phase 20 — Grafana adapters (Cloud / OSS / Enterprise)

| | |
|---|---|
| **Depends on** | 16, 17 |
| **Unlocks** | 21, 23 |
| **Sources** | original plan Grafana sections (scope, mutation safety, version-aware routing); adaptation §7 (gateway is the sole MCP/HTTP client to upstream providers; gateway-side result-size budgets), §5.5 (`observability.*` tool naming), §10 (risks 4, 10, 11) |
| **Primary package** | `packages/connectors-grafana` |

## Goal

When this phase is done, the gateway can read and mutate Grafana Cloud/OSS/Enterprise resources through 16's `observability.*` tool surface for three fixture-verified self-managed versions (11.6, 12.4, 13.1) plus current Cloud: every write is precondition-checked against a captured concurrency token, rollback-capable, and read-back verified before it counts as applied; every rendered annotation clears 17's blocking pipeline; and no delete/admin/impersonation operation is reachable through the public resource-client surface at any step.

## In scope

- **Auth:** org-scoped service-account tokens (secret references, never literals); separate Cloud Access Policy credentials only where direct telemetry APIs require them; credentials bound to exact origin/org/folder allowlists; a connection-doctor check validates token scope + org binding before first use.
- **Version-aware routing:** live discovery (health/build-info call + route probing) selects legacy `/api` vs newer `/apis` routes **by capability, not major version**; unknown/untested builds forced read-only. Compatibility fixtures: 11.6, 12.4, 13.1 + current Cloud.
- **Resources (list/get/create/update only):** folders, dashboards, annotations, Grafana-managed alert rules, contact points, mute timings, notification templates. **Excluded, permanently:** deletes; user/org/service-account/access-policy/billing admin; data-source creation or secret admin; notification-policy-tree replacement; data-source-managed alert mutation; raw HTTP/MCP passthrough.
- **High-impact flags:** alert disabling, contact points, mute timings, notification templates — each envelope-required, using 02's `HighImpactCapabilityFlag` labels verbatim (Grafana's 4 members never drifted from 02's wording, unlike Jira's, which Gap 10 corrects). Every mutation touching one of these four resource classes is statically tagged with the flag(s) it requires — this tagging is the fixed operation set 23's notification-side-effect-classification matrix exercises.
- **Mutation safety:** capture resourceVersion/ETag/dashboard-version + a rollback snapshot before every update; optimistic-concurrency writes (409/412 → fetch-compare-rebase or an explicit block, never a blind overwrite); read-back canonical compare; rollback classes (reversible → version-checked restore); created resources are never auto-deleted on failure — reported for reviewed cleanup instead. `dashboard version` is a REST precondition token only (ETag-equivalent), never rendered as communication text — the deleted `dashboard version message ≤160` CommunicationPolicy constant (Gap 6) never applied to this phase; this line confirms that deletion's rationale rather than reintroducing the constant.
- **Reads/queries:** approved dashboards/metrics/logs/traces/alerts only; required time-range + field scoping; aggregation/redaction happens before results enter worker context; size budgets enforced by 16 (32 KiB item / 256 KiB result).
- **Reconciliation:** deterministic UIDs + annotation tags as exactly-once markers, implementing 16's marker-reconciliation interface (16 declares it and states "adapters implement" it — this phase is that adapter for `observability.*`/Grafana).
- **Official Grafana MCP wrap:** optional read-only capability behind a flag; HTTP APIs remain primary and are the only path exercised by default fixtures.

## Out of scope

- Generic transport (TLS/redirect/SSRF guard, retry/backoff, write serialization, pagination) and the plan→validate→journal→apply→read-back→verify→record pipeline shell, plus canonical-error redaction constructors — owned by 16; this phase supplies only the Grafana-specific plan contents and serializers that flow through it.
- Rendering, the blocking lint pipeline, the annotation template's exact wording, and the regenerate-once protocol — owned by 17; this phase calls the renderer, it does not reimplement it.
- Requirement↔RemoteResource linkage, approval-preview rendering of planned mutations (11), done-transition/`ambiguous_write` verification gating, and drift-CI replay scheduling — owned by 21; this phase supplies the fixtures/cassettes and read-back results 21 consumes, not the gating logic itself.
- The full live E2E release matrix, cross-connector security/perf/quality gate orchestration, and live-sandbox teardown — owned by 23; this phase supplies the per-version cassettes and OSS/Enterprise Docker recipes those matrices run against (work item 6), not the matrix runner.
- Jira-specific resources, auth, and milestone sync — owned by 18, 19.
- Quarantine mechanics (digest pinning, SBOM, sandboxed pre-execution test) for the optional Grafana MCP wrap, if a deployment ever enables it — owned by 12; this phase only declares the capability as optional and flag-gated, it does not implement quarantine.

## Interfaces produced

- **`packages/connectors-grafana`** (scaffolded empty at 01; this phase fills it) — consumed by 21 and 23 per the interface ledger.
- **`GrafanaProviderAdapter`** *(name introduced by this phase)* — the resource-client/discovery/serializer bundle this phase registers into 16's provider-dispatch point for the `observability.*` tool family whenever an `ExternalConnection.provider` is Grafana. Exposes list/get/create/update per resource kind (folder, dashboard, annotation, alert-rule, contact-point, mute-timing, notification-template); no delete method exists on the type.
- **`CapabilitySnapshot` instances scoped to Grafana connections** (02 schema, populated here): route table (`/api` vs `/apis` per capability), product/edition/version, unknown-build → read-only flag.
- **`RemoteResource` records** (02 schema) for the 7 Grafana resource kinds above — consumed by 21 work item 1 (Requirement↔RemoteResource mapping).
- **`RemoteMutationPlan` instances** (02 schema) for Grafana mutations, each carrying its canonical target, action, required `HighImpactCapabilityFlag` member(s) where applicable, desired-state hash, and expected remote revision — consumed by 16's pipeline, previewed by 11, linked by 21.
- **Canonical read-back-compare results** — the post-mutation canonical resource state this phase's serializers produce, attachable to an `EvidenceRecord` (02 schema) per 21's In-scope → Verification-gates bullet ("Grafana read-back results attached to evidence").
- **Rollback-snapshot store + restore path** keyed on resourceVersion/ETag/dashboard-version — the mechanism 23's Grafana "managed-alert conflicts" E2E scenario exercises.
- **Grafana annotation `RenderedArtifact`s** — produced by calling 17's `renderWithRegeneration({ kind: "grafana_annotation", generate, policy })`, which resolves to `{ status: "rendered", artifact: RenderedArtifact }` on success or `{ status: "blocked", error: "policy_blocked", findings }` on regenerate-once failure; the rendered text follows the `<state> | <service> | <change> | evidence=<ref>` template and carries the `evidence=<ref>` pointer 21 journals at milestone-sync-equivalent events.
- **Mutation-safety property test suite** (concurrent-edit fuzzing over the precondition/optimistic-concurrency logic, built in work item 4) — 23's own Interfaces-consumed row for this phase names it directly for re-run against live release-candidate infrastructure, not a synthetic fixture.
- **Reconciliation markers** (deterministic UIDs + annotation tags) implementing 16's marker-reconciliation interface — exercised by 16's own ambiguous-POST retry search and by 21/23's exactly-once E2E scenarios.
- **Fixture matrix**: recorded cassettes per version (11.6, 12.4, 13.1, current Cloud) + Docker recipes (OSS, Enterprise) — consumed by 21's drift-CI replay job and by 23's live E2E matrix (work item 6).
- **Fault-injection fixtures** (forged delete/admin, tenant-boundary breach, redaction-check) — consumed by 21 work item 6 ("connector security fixtures... run inside 14's framework") and by 23's Connector-security E2E bullet.
- **Latency/throughput counters** — consumed by 21 work item 6, captured into 14's `EvidenceRecord` stream; available to, but not contractually consumed by, 15 (no 21→15 edge exists in the dependency graph).
- **`HighImpactCapabilityFlag` tagging** for the 4 Grafana-relevant members (alert disabling, contact points, mute timings, notification templates) attached to every qualifying `RemoteMutationPlan` — the fixed, statically-verifiable operation set 23's "notification side-effect classification" E2E check exercises.

## Interfaces consumed

- From **16** (`packages/gateway`): the HTTP transport/security/throttle stack; the mutation-pipeline shell (persist `RemoteOperationRecord` before network I/O → apply → read-back → verify → record); the marker-reconciliation interface this phase implements; canonical-error redaction constructors; the `observability.search/get/query/plan_create/plan_update/apply` tool family (every mutating call still requires run ID, idempotency key, expected state version, envelope reference, validated plan — 16's own requirement, unchanged here); the 32 KiB item / 256 KiB result budget enforcement; `packages/testkit`'s scriptable observability fake-provider + fault-injection harness (built by 16 work item 6), which this phase's own tests run against.
- From **17** (`packages/renderer`): the `ArtifactKind` closed union's `grafana_annotation` member (17 lists this phase as `grafana_annotation`'s consumer by name); the `renderWithRegeneration({ kind, generate, policy }): Promise<RenderOutcome>` function, where `RenderOutcome` is `{ status: "rendered", artifact: RenderedArtifact } | { status: "blocked", error: "policy_blocked", findings: LintFinding[] }`; the `<state> | <service> | <change> | evidence=<ref>` template (≤240 chars) enforced inside `lint()`'s per-`ArtifactKind` length stage. 17's own Out-of-scope assigns "performing the actual Jira/Grafana API calls that deliver rendered text" to phases 18/19/20 "transported by 16" — the delivery boundary this file assumes.
- From **02** (`packages/contracts`, reached transitively — both 16 and 17 already depend on 02, so no new dependency edge is needed; same non-new-edge reasoning the ledger's Gap 1 resolution uses for registry extension): `ExternalConnection`, `CapabilitySnapshot`, `RemoteMutationPlan`, `RemoteResource`, `RenderedArtifact` schemas; the 10-member canonical connector error union (`authentication, permission, not_found, conflict, rate_limited, validation, unsupported, transient, ambiguous_write, policy_blocked`); the `HighImpactCapabilityFlag` enum (this phase uses exactly 4 of its 11 members, labels verbatim: alert disabling, contact points, mute timings, notification templates); the `CommunicationPolicy` Grafana-annotation-≤240 constant.

## Work items

1. Auth + connection-doctor check: token-scope probe, org binding. Starts from a failing token-scope/org-binding validation test against a fake token response, exercised directly against `packages/connectors-grafana`'s doctor function, before any client exists (CLI invocation of this check is 09/23's wiring concern, not asserted here).
2. Discovery/probing → `CapabilitySnapshot` with a data-driven route table. Starts from failing fixture tests for each of the 4 pinned build-info responses (11.6/12.4/13.1/current-Cloud) asserting the expected route selection, before the prober exists.
3. Resource clients for all 7 kinds behind one interface (`GrafanaProviderAdapter`); canonical serializers for read-back. Starts from failing per-resource contract tests against 16's fake observability provider.
4. Mutation glue: snapshot/rollback store, preconditions, restore path. Starts from a failing concurrent-edit property test (two writers, same resource, stale precondition) that currently allows a blind overwrite.
5. Query layer with time-range/field scoping + aggregation/redaction helpers. Starts from a failing budget test (a fixture response exceeding 32 KiB item / 256 KiB result pre-aggregation) that currently passes the raw payload through untruncated.
6. Fixtures: per-version cassettes + OSS/Enterprise Docker recipes for 23; fault-injection matrix (forged delete/admin, tenant-boundary, redaction) for 21/14; latency/throughput counters for 21 (available to, but not contractually consumed by, 15 — no 21→15 edge exists in the dependency graph). Starts from a failing drift-CI stub test expecting a replayable cassette set that does not yet exist.

## Test plan

- **Unit:** per-resource-client request/response mapping (all 7 kinds) against 16's fake observability provider; canonical-serializer round-trip (mutate → read-back → compare) per resource kind.
- **Property:** concurrent-edit fuzzing proves no random interleaving of two writers ever produces a blind overwrite (every 409/412 resolves to fetch-compare-rebase or an explicit block); route-table selection is fuzzed over shuffled capability-flag combinations and always resolves deterministically from capability, never from the version string alone.
- **Integration:** cassette replay per version (11.6, 12.4, 13.1, current Cloud) exercising folder→dashboard→annotation→alert-rule→contact-point→mute-timing→notification-template; Docker-recipe-backed OSS/Enterprise runs of the same flow.
- **Conformance:** every rendered annotation is produced via 17's `renderWithRegeneration` (regenerate-once; second failure returns `{ status: "blocked", error: "policy_blocked" }`, never a written annotation); every thrown error is one of 02's 10 canonical members with no raw Grafana response body attached (leak-hunt assertion).
- **Security:** forged delete/admin/notification-policy-tree-replacement/data-source-secret-admin calls asserted to produce zero outbound HTTP requests (no matching method exists on the public resource-client surface, so the call fails pre-network); tenant/org/folder allowlist breach attempt denied; fixtures assert no literal credential ever appears in a log, error, or golden artifact (secret-reference-only storage).

## Exit criteria

- [ ] `folder→dashboard→annotation→alert-rule` integration suite green on all three version cassettes (11.6/12.4/13.1) + the current-Cloud cassette, plus the OSS/Enterprise Docker-recipe run.
- [ ] Mutation-safety property suite finds zero blind-overwrite counterexamples over its fuzzed-concurrency run; every 409/412 resolves to fetch-compare-rebase or an explicit typed block.
- [ ] Rollback-restore integration test proves the restored resource is canonical-identical (post-serializer-normalization) to the pre-mutation snapshot; a failed resource-creation path leaves the created resource in place with a cleanup-report artifact, never an auto-delete call.
- [ ] An unknown/untested build-info fixture forces a read-only `CapabilitySnapshot`; a mutation attempt against that snapshot is asserted to fail before any HTTP call.
- [ ] Query-layer test proves aggregation/redaction completes, and results stay within 16's 32 KiB item / 256 KiB result budgets, before data leaves `packages/connectors-grafana`.
- [ ] Reconciliation suite: an ambiguous-POST-timeout fixture resolves via marker search to zero duplicate resources created, or blocks with typed `ambiguous_write` — never silently both.
- [ ] Every mutation touching alert disabling, contact points, mute timings, or notification templates carries at least one of 02's 4 corresponding `HighImpactCapabilityFlag` labels, verified by a static/schema-level test that fails on any untagged high-impact call — the fixed set 23's notification-side-effect-classification matrix exercises.
- [ ] Security fixture suite: forged delete/admin calls produce zero outbound HTTP requests (mock-transport call-count assertion).

## Risks & open questions

- Upstream `/api`→`/apis` migration is ongoing — the route table is data, not code, so drift lands as a fixture update via 21's drift CI, never a routing-logic change.
- Sandbox network allowlisting is hostname-based without TLS termination by default (adaptation §10 risk 4) — irrelevant to correctness here only because Grafana HTTP calls execute inside the gateway process, never inside a worker's sandboxed egress path (adaptation §7 point 1: workers never see Grafana MCP/HTTP directly).
- The optional Grafana MCP wrap, if ever enabled, is exactly the kind of third-party executable capability adaptation §10 risk 11 flags ("plugins execute code... go through the plan's capability-quarantine pipeline like any executable capability"); this phase declares it only as an optional, flag-gated `CapabilityManifest` entry and never enables it by default.
- No Claude Code engine surface is touched directly by this phase — Grafana HTTP calls run inside the gateway process, not a worker; no permission rule, sandbox field, or hook is asserted anywhere above.
- **Verify-at-build-time:** `MAX_MCP_OUTPUT_TOKENS` is unconfirmed (adaptation §10 item 10); this phase does not depend on it (budgets are enforced gateway-side per adaptation §7 point 2), but if it is later confirmed, re-check it doesn't truncate `observability.*` responses at a point that surprises this phase's own aggregation/budget logic.
