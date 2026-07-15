# Phase 18 — Jira Cloud adapter + intake/milestone synchronization

| | |
|---|---|
| **Depends on** | 16, 17 |
| **Unlocks** | 19, 21, 23 |
| **Sources** | original plan Jira sections (scope, intake/sync, rate limits); REST v3 + Agile APIs; adaptation §7 (Jira/Grafana connectors — unchanged, three Claude Code notes), §8 (intake/sync policy, milestone-only updates carry over unchanged) |
| **Primary package** | `packages/connectors-jira` |

## Goal

The full Jira Cloud surface behind the gateway is live and provider-neutral at the boundary: service-account OAuth, REST v3 + Agile resources operating strictly inside the plan's allow/deny matrix, ADF rendering through 17, and milestone-only synchronization with exactly-once writes — with no delete/admin/impersonation surface reachable by construction, not by convention.

## In scope

- **Auth:** service-account OAuth 2.0 client credentials (60-min tokens, refreshed by this phase's token manager, held only as a secret reference — never a literal in worker-reachable state); connection doctor validates scopes. Wrapped Atlassian MCP for discovery/reads is optional behind a capability flag, mediated by the gateway (adaptation §7: workers never see the Atlassian MCP server); REST is primary and always available.
- **Resources (plan matrix):** projects list/read; boards list/read/create/update + issue ranking; sprints incl. start/complete + move issues; epics/issues search/read/create/update/link/rank/transition; comments list/create/update; links; worklogs; attachments (streamed, size/MIME/filename/malware/secret-checked; bytes never enter prompts). **No deletes, no user/permission/workflow/security/automation admin, no impersonation or caller-supplied author/history, no raw endpoints; custom-field writes only against discovered field metadata.**
- **High-impact capabilities** — 7 of P02's 11-member `HighImpactCapabilityFlag` enum, byte-identical labels (the enum is a provider-neutral core type; only surrounding prose may gloss it): `assignment, reporter change, closing transitions` (Jira Done/Closed workflow statuses), `sprint completion, attachments, bulk mutations` (multi-issue bulk edit/transition), `issue creation`. Each requires the matching envelope flag before the operation reaches 16's mutation pipeline.
- **Capability discovery:** edition/permissions/field metadata → `CapabilitySnapshot` (P02 schema, 16-owned cache/invalidation); unknown editions/versions default read-only.
- **Intake/sync:** a referenced issue key/URL becomes the tracking item; otherwise a concise draft rendered through 17, created only post-approval. Local `IntentContract` stays authoritative. Milestone-only updates (start / material blocker / verified completion) via 17's Jira milestone-comment template; status-comment dedup by entity-property marker (edit in place, never a second comment). Workflow mapping to `JiraWorkflowStage` (`planned | in_progress | blocked | done`) is never-guess: an unrecognized remote status always resolves to `blocked`, never silently to `done`. Revision polling at every milestone feeds the revision comparator; a material remote edit triggers 11's contract-amendment stop condition (wired in 21). Jira `done` only after 21's exact-revision verification passes.
- **Rate limits:** quota/burst/per-issue write compliance, `Retry-After` honored, cross-worker throttling via 16's gateway-side serialization.
- **Reconciliation:** implements 16's marker-reconciliation interface using Jira entity properties as the exactly-once marker for every POST (issue/comment creation).

## Out of scope

- Deployment-type differences (PAT/basic auth, REST v2, wiki-markup fallback, DC version fixtures) and the deployment-parameterized conformance suite → 19.
- Generic transport security, secret-reference resolution, `CapabilitySnapshot` caching/invalidation mechanics, the mutation pipeline's persistence/replay semantics, the retry ladder, and item/result size budgets → 16 (this phase consumes those; it does not reimplement them).
- ADF safe-subset conversion mechanics, Unicode/secret/attribution scanning, and the regenerate-once enforcement loop → 17 (this phase's renders pass through that pipeline).
- `Requirement`↔`RemoteResource` contract linkage, evidence-record binding of exact final revisions, the done-transition verification gate's run-state wiring, and drift CI → 21.
- Opening or posting to a pull request or any VCS-host review surface — no such connector exists in v1; this phase is a tracker connector only.
- Live Jira Cloud sandbox provisioning/teardown and the release-gate E2E matrix → 23 (this phase produces the fixtures/cassettes 23 replays, not the harness itself).

## Interfaces produced

**Types (`packages/connectors-jira`, built on `packages/contracts`):**

- `JiraResourceClient` — deployment-type-parameterized resource-client interface (Cloud implementation lives here; 19 supplies the Data Center implementation behind the same interface) covering projects/boards/sprints/epics/issues/comments/links/worklogs/attachments; every method is typed IO, every failure mapped to exactly one of P02's 10 canonical connector errors. *(Name introduced in this phase — no upstream text names it; it is what 19's "shared resource interface" prose refers to.)*
- `JiraWorkflowStage` — closed union `planned | in_progress | blocked | done`; the Jira ticket-status projection, populated by the never-guess transition mapper. Distinct token space from P02's run-lifecycle `blocked` terminal — same spelling, unrelated enum, never to be conflated. *(Name introduced in this phase.)*
- Revision comparator — stamps each intake-tracked issue's `RemoteResource` (P02 schema) instance with its exact remote revision at every milestone poll; diffing two consecutive stamps is the material-change signal.
- The 7-member Jira subset of P02's `HighImpactCapabilityFlag` enum (see In scope), each bound to the operation(s) it gates.

**Journal entries:**

- `JournalEntryType: milestone_sync` (P02, 13-member union) — one entry per start/material-blocker/verified-completion sync, keyed by the same entity-property marker used for comment dedup.

**Fixtures (`packages/testkit`):**

- Fake-Jira: scriptable REST v3 + Agile double, fault-injectable, extending 16's fake-provider harness.
- Recorded Cloud v3/Agile cassettes.
- Fault matrix: 401/403/409/429, malformed pagination, ambiguous mid-POST timeout.
- Fake/cassette parity suite: proves the fake and a cassette replay of the same scripted scenario yield identical typed results.

**Pipelines:**

- Attachment streaming pipeline (size/MIME/filename/malware/secret-checked; bytes never enter a prompt).
- OAuth client-credentials token manager + connection-doctor scope/expiry checks. (Cloud-specific — 19 implements its own PAT/bearer manager against the same connection-doctor pattern, per adaptation's DC auth model; not a shared instance.)

**Consumed by:**

- **19** (Jira Data Center adapter): `JiraResourceClient` (DC implementation behind the same interface), the 7-member capability-flag mapping (same matrix, parameterized by deployment type), the fake-Jira + fault-matrix harness (extended with DC-specific faults), the cassette-capture tooling (reused for 10.3/11.3).
- **21** (connector evidence integration): `JiraWorkflowStage` (`done` member is the done-transition gate's hook point; the never-guess rule backs the ambiguous-op block), the revision comparator (feeds exact-revision evidence binding and remote-edit-triggered amendment review), `milestone_sync` journal entries (the milestone evidence trail), the attachment pipeline and fault matrix (security-fixture wiring into 14's framework).
- **23** (release hardening): Cloud v3/Agile cassettes + fake-Jira (non-live E2E and drift-CI baselines), the live-sandbox test suite (Jira Cloud live matrix), the attachment pipeline (data-minimization proof), the supported-edition/version statement (compatibility-matrix doc input).

## Interfaces consumed

**From 16 (`packages/gateway`):**

- `ExternalConnection` store + secret-reference resolution — the Jira service-account OAuth client credential is stored and resolved as a reference, never a literal in worker-reachable state.
- Transport security stack (TLS verification, redirect revalidation, SSRF-guarded scheme/origin/IP allowlists, ≤4 in-flight per connection, `Retry-After` + jittered backoff, per-tenant+resource write serialization, O(page) pagination) — this phase's resource clients are built on this transport, not beside it.
- `CapabilitySnapshot` (P02 schema; 16 owns the cache/15-min TTL/invalidation) — this phase populates instances from Jira discovery.
- Mutation pipeline (`RemoteMutationPlan` → `RemoteOperationRecord` persisted before network I/O → apply → read-back → verify → record; same-ID+same-content replay resolves, different content fails) — every create/update/transition/comment call is submitted through this; this phase never persists `RemoteOperationRecord` itself.
- Canonical connector errors (10-member closed union: `authentication, permission, not_found, conflict, rate_limited, validation, unsupported, transient, ambiguous_write, policy_blocked`) — every Jira REST failure maps to exactly one member; no raw Jira error body crosses the boundary.
- Retry ladder (GET free; PUT/PATCH deterministic + precondition-only; POST never blind; 409/412 → fetch, rebase-or-block) and the marker-reconciliation interface (16 declares it; this phase implements it via Jira entity properties).
- Result/item size budgets (32 KiB item / 256 KiB result, typed truncation errors).
- Fake-provider scripting harness (`packages/testkit`) — this phase's fake-Jira extends it rather than reimplementing fault injection.
- Tool-surface names `tracker.search/get/plan_create/plan_update/plan_transition/plan_comment/apply` — the contract this phase's `JiraResourceClient` backs; these tool handlers (registered by 16) dispatch to it for any Jira-typed `ExternalConnection`, and this phase registers no MCP tool of its own.

**From 17 (`packages/renderer`):**

- Markdown→ADF converter + safe-node/mark subset — every Jira Cloud comment/description render goes through this; this phase never emits raw ADF.
- Jira milestone-comment template (Outcome/Evidence/Risk/Next/Ref) — the milestone-sync engine's only comment shape.
- `CommunicationPolicy` length limits as enforced by 17's pipeline (Jira summary ≤120; Jira comment ≤800 chars/6 lines) — constants owned by 02, enforcement staged in 17.
- Regenerate-once protocol (lint failure → one regeneration with feedback → second failure blocks with typed `policy_blocked`) — every outgoing Jira write passes through this before reaching 16's mutation pipeline.

**From 02 (`packages/contracts`), transitively via 16/17's own dependency on 02 — not a direct edge in this phase's header:**

- `IntentContract` — intake's authoritative source; both a referenced-issue and a drafted-then-approved issue resolve back to it.
- `ExternalConnection`, `CapabilitySnapshot`, `RemoteMutationPlan`, `RemoteResource` — instantiated here with Jira-specific data.
- `CommunicationPolicy` constants (Jira summary/comment limits, milestone template shape).
- `HighImpactCapabilityFlag` enum (11 members; this phase uses exactly 7, byte-identical labels).
- Canonical connector errors (10-member union).
- `JournalEntryType` (13-member union) — this phase's entries carry the `milestone_sync` member.

## Work items

1. OAuth client-credentials token manager + connection doctor checks. Entry point: failing unit test — an expired/not-yet-refreshed token must be rejected before any resource call fires.
2. Resource clients on the 16 transport — typed IO + canonical-error mapping — behind the `JiraResourceClient` interface, covering projects/boards/sprints/epics/issues/comments/links/worklogs. Entry point: failing per-resource contract test against a minimal inline stub transport (no live Jira, no shared fake yet).
3. Discovery → `CapabilitySnapshot`; field-metadata-driven custom-field validation; unknown-edition read-only fallback. Entry point: failing snapshot test against a scripted "unrecognized edition" discovery response.
4. Intake + milestone-sync engine + `JiraWorkflowStage` transition mapper + revision comparator. Entry point: failing integration test — issue-key resolution, draft-then-approve, milestone-comment dedup, unmapped-status → `blocked`.
5. Attachment streaming pipeline (size/MIME/filename/malware/secret checks). Entry point: failing test with a poisoned fixture (oversized, spoofed MIME, embedded secret) that must be rejected before any byte reaches a prompt.
6. Testkit fake-Jira (scriptable, fault-injectable, extends 16's harness) + recorded Cloud v3/Agile cassettes + fault matrix + fake/cassette parity suite. Entry point: failing parity test — the same scripted scenario must produce identical typed results from the fake and from cassette replay.

## Test plan

- **Unit:** canonical-error mapping table (every Jira REST status code → exactly one of the 10 members); OAuth token-manager refresh/expiry/clock-skew edge cases; `JiraWorkflowStage` never-guess mapping (every documented Jira status name → a stage; unmapped → `blocked`).
- **Property:** fast-check over discovered field-metadata shapes (an unrecognized field type must never be silently accepted for a custom-field write); revision-comparator diffing over arbitrary field mutations between two snapshots (must be flagged material or explicitly excluded, never silently dropped).
- **Integration:** resource clients against fake-Jira: board → sprint → epic → issue → link → worklog → attachment; ADF/text conversion round-trip; transition mapper against scripted workflow schemes; milestone-sync engine across a 3-cycle scripted issue (start/blocker/completion); concurrent-edit conflict (412 → fetch-rebase-or-block).
- **Conformance:** fault-matrix replay (401/403/409/429, malformed pagination, ambiguous mid-POST timeout) — must fail with no handling before the fix, pass after; fake-Jira/cassette parity suite.
- **Security:** forged delete/admin/impersonation/raw-endpoint calls fail before any network I/O (pre-flight capability check, never a server-side 403 as the sole guard); attachment pipeline rejects oversized/spoofed-MIME/embedded-secret fixtures before bytes reach a prompt; exactly-once proof under injected POST timeout (no duplicate comment/issue on retry); custom-field writes refuse undiscovered field IDs; 17's lint runs on every outgoing payload.

## Exit criteria

- [ ] Plan's Jira flow passes on fakes + cassettes: board → sprint → epic → issue → link → worklog → attachment; ADF/text conversion; transitions; concurrent-edit conflicts.
- [ ] `JiraResourceClient` conformance suite green against fake-Jira for every in-scope resource.
- [ ] Exactly-once via entity-property markers proven under injected POST timeout (no duplicate comments/issues).
- [ ] Forged delete/admin/impersonation calls fail before network I/O.
- [ ] `JiraWorkflowStage` never-guess proven: fuzzed/unrecognized workflow-status names always resolve to `blocked`, never `done`.
- [ ] Revision comparator detects a seeded material remote edit between two milestone polls and produces the amendment-review signal (evidence: property + integration fixture).
- [ ] Milestone sync yields ≤1 status comment per milestone, edited in place; Jira `done` only with 21's verification evidence attached.
- [ ] Attachment pipeline rejects oversized/spoofed-MIME/secret-embedded fixtures before any byte reaches a prompt.
- [ ] Fake-Jira/cassette parity proven: the scripted scenario set replayed against both fake and recorded cassette yields identical typed results.
- [ ] Rate-limit fixture: `Retry-After` honored; per-issue write order preserved.

## Risks & open questions

- No unconfirmed Claude Code engine facts are load-bearing here — this phase's only engine-adjacent dependency is transitive (16's transport/sandbox posture); nothing in this file asserts a flag/setting/event the adaptation doc doesn't already settle.
- `JiraResourceClient` and `JiraWorkflowStage` are named here for the first time; if 19 has independently committed to different names for the same concepts, reconcile before both land — flagged for the reconciler.
- Jira REST v3 API drift is a provider-API risk, not an engine-version risk; 21's drift CI owns detecting it — not re-litigated here.
- ADF safe-subset gaps in 17 could block a Jira rendering need this phase surfaces late; raise against 17 rather than working around it locally — no phase may special-case the lint.
- Adaptation §10 risk 8 (OAuth'd remote MCP is interactive-only) is why Jira auth here is service-account client-credentials held by the gateway, never an interactive Claude Code MCP OAuth flow.
- Live Jira Cloud sandbox needed by 23 — provision early; cassettes refreshed by 21's drift job.
