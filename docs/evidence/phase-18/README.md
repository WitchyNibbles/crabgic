# Phase 18 evidence — Jira Cloud adapter + intake/milestone synchronization

Governing spec: `roadmap/18-jira-cloud-adapter.md`. Package: `packages/connectors-jira`.
Built on `packages/gateway` (16) and `packages/renderer` (17) — reused wholesale, never
reimplemented (transport/SSRF/retry-ladder/budgets/secrets/mutation-pipeline/error-mapping;
ADF safe-subset conversion, milestone-comment template, regenerate-once orchestration).

## Adversarial-review remediation (round 2)

Independent adversarial validation confirmed the core was solid (OAuth token never leaks,
closed-allowlist capability guard on every mutating path, `issue.create` exactly-once correct,
zod response-boundary validation, side channels never journaled) but found 5 real gaps, fixed
with a failing test added FIRST (confirmed red against the pre-fix code) in every case, then the
minimal fix, then confirmed green. All fixes are inside `packages/connectors-jira/`; no root
config, ledger, or other-package file was touched.

| ID | Finding | File(s) fixed | New test(s) |
|---|---|---|---|
| **H1** (HIGH) | ADF writes bypassed 17's safe-subset validator entirely outside `intake/*` — the generic dispatch path and the resource-client's own `issues`/`comments` plan builders passed a caller-supplied `bodyAdf`/`summaryAdf`/`fields.description` straight through, unvalidated, into the outbound POST/PUT body. A `javascript:`-href link mark, a disallowed node, or an embedded secret could reach Jira. | New `resource-client/adf-guard.ts` (`assertSafeAdfDocument`, wrapping `@eo/renderer`'s `validateAdfSafeSubset` + a new secret-shaped-text scan) called at BOTH the plan-build boundary (`issue-plans.ts`'s `planIssueCreate`/`planIssueUpdate`, `comment-worklog-attachment-plans.ts`'s `planCommentCreate`/`planCommentUpdate`) AND the apply boundary (`jira-mutation-apply-client.ts`'s `buildRequest`, via a new `assertOutgoingAdfIsSafe`) — fails closed at whichever boundary a plan actually reaches first. | `adf-guard.test.ts` (7 cases); `jira-resource-client.test.ts`: 4 new "rejects a javascript:-href / secret-bearing ADF ... before any network I/O" cases (`comment.create`, `comment.update`, `issue.create`, `issue.update`); `jira-mutation-apply-client.test.ts`: 5 new apply-boundary rejection cases proving the SAME guard fires even for a plan built by directly populating the payload registry (bypassing the typed builders entirely). |
| **H2** (HIGH) | `planIssueTransition` trusted a caller-supplied `targetStageIsDone` boolean instead of resolving the transition's REAL target status server-side — a forged `false` on a genuinely closing `transitionId` skipped `assertDoneTransitionHasEvidence` and the `closing transitions` high-impact flag while the POST still closed the issue for real. | `resource-client/types.ts` / `jira-resource-client.ts`: `issues.planTransition` is now `async` and no longer accepts `targetStageIsDone` at all — it calls `issues.transitions(issueKey)` itself, matches the requested `transitionId`, and derives done-ness from `JiraTransition.toStatusCategoryKey`/`toStatusName` via `mapJiraStatusToWorkflowStage` (a deliberate, narrow, documented exception to "planning is local-only" — one read call). An unrecognized `transitionId` is refused (never guessed). `jira-provider-client.ts`'s `dispatchPlanTransition` no longer reads/forwards `params.targetStageIsDone` at all. | `jira-resource-client.test.ts`: rewritten `planTransition` suite (4 cases) proving the SERVER-reported category — not a caller flag — drives the capability flag/evidence gate, including a case with `targetStageIsDone` impossible to even supply; `jira-provider-client.test.ts` and `register.test.ts` updated to script the `transitions` read and drop the now-nonexistent parameter; `jira-flow.integration.test.ts`'s transition block updated correspondingly. |
| **M1** (MEDIUM) | `comment.create` stamped the bare caller-supplied `marker` as the entity property but `reconcileAmbiguous` searched by `plan.idempotencyKey` (a different string) — a mid-POST timeout on a comment that DID land could never be found again; recovery was untested and non-functional (only `issue.create`'s exactly-once path was exercised). | `jira-mutation-apply-client.ts`'s `buildRequestForAction` `comment.create` case now stamps `plan.idempotencyKey` (matching what `reconcileAmbiguous` already searched by, and matching `issue.create`'s own established convention). | `jira-mutation-apply-client.test.ts`: new unit test asserting the stamped value equals `plan.idempotencyKey`, not the bare marker; `exactly-once.integration.test.ts`: new end-to-end test wiring the REAL `createJiraEntityPropertyMarkerReconciler` (never a stubbed override) through a mid-POST timeout + a scripted `listComments` recovery response, proving exactly one POST reaches the network and the landed comment is found and recorded. |
| **M2** (MEDIUM) | The attachment secret scan only covered the first 64 KiB, the EICAR check only the first 4 KiB, while `MAX_ATTACHMENT_BYTES` allows up to 10 MiB — content past those windows passed clean. The filename was never scanned for secret-shaped content, yet is embedded verbatim into `redactedDiff`, which 16 journals BEFORE any I/O. | `attachments/attachment-pipeline.ts`: both scans now cover the FULL (already 10-MiB-capped) buffer, never a sub-window; `validateFilename` now also rejects a secret-shaped filename. New shared `security/secret-patterns.ts` (extracted from the attachment pipeline) is reused by both the attachment scan and H1's ADF-text scan. `comment-worklog-attachment-plans.ts`'s `planAttachmentUpload` adds an independent, second filename check as defense-in-depth against a caller that skipped the streaming pipeline. | `attachment-pipeline.test.ts`: 3 new cases (secret past the old 64 KiB window, EICAR past the old 4 KiB window, secret-shaped filename); `jira-resource-client.test.ts`: new test proving `planAttachmentUpload` itself rejects a secret-shaped filename before it can enter `redactedDiff`. |
| **M3** (MEDIUM) | The never-guess property test excluded the done-category case, so exit criterion #5 ("fuzzed/unrecognized names always resolve to blocked, never done") was asserted only for non-done categories — leaving the code's actual done-category behavior unproven and undocumented as either a gap or an intentional choice. | No mapping-logic change: `workflow-stage.ts` gained an explicit module-doc-comment rationale for WHY trusting Jira's own `statusCategory.key === "done"` (a fixed, Jira-computed 3-value enum, not attacker-shaped free text) for an otherwise-unrecognized status NAME is a deliberate, safe reading of "never silently to done" — and is in fact load-bearing for H2's closing-transition detection (a real closing transition to a site-custom status name must still be recognized as closing). | `workflow-stage.test.ts`: the single property that silently excluded the done-category case was replaced with THREE explicit properties — unrecognized name + non-done/absent category never resolves `done`; unrecognized name + `done` category always resolves `done` (documented, intentional); unrecognized name + no category resolves `blocked`. Exit criterion #5 is now fully proven in both directions, not just the non-done half. |
| **L1** (LOW, noted only — spec defers to 21) | `verifyForAction`'s `issue.update`/`issue.transition` branch returns `true` on ANY revision change (liveness, not target-state correctness) and unconditionally `true` when `expectedRemoteRevision` is undefined. | No fix — 21's own exact-revision verification gate is the intended owner of target-state correctness per roadmap/18 §In scope ("Jira `done` only after 21's exact-revision verification passes"); this connector's `verify()` is documented as a liveness check only. | — |

Gate results after remediation (below) are the FINAL, current numbers — the pre-remediation
240-test/97.3%-branch snapshot in the original evidence table above this section is superseded.

### Bonus finding: prototype-lookup bug (found while broadening M3's property test)

Broadening `workflow-stage.test.ts`'s property test to cover the done-category case (per M3
above) surfaced an intermittent fast-check failure — `mapJiraStatusToWorkflowStage("__proto__")`
returned `Object.prototype` (an object), not a `JiraWorkflowStage` string. Root cause: the
status-name lookup table was a plain object literal, and `obj["__proto__"]`/`obj["constructor"]`/
etc. resolve to INHERITED `Object.prototype` members — themselves non-`undefined` objects/
functions — rather than "not found," so the `known !== undefined` guard silently passed for these
specific inputs. The identical pattern existed in `attachments/attachment-pipeline.ts`'s
MIME-signature table, where it crashed outright (`signature.every is not a function`) instead of
treating an unrecognized `claimedMimeType` gracefully. Both fixed by switching the lookup table
from a plain object literal to a `Map` (`Map#get` has no prototype-chain special-casing for any
string key). New tests: `workflow-stage.test.ts` (`it.each` over `__proto__`/`constructor`/
`toString`/`hasOwnProperty`/`valueOf`, each asserted to resolve to `blocked`);
`attachment-pipeline.test.ts` (`it.each` over the same dangerous-key set, each asserted to be
treated as simply an unrecognized MIME type, never a crash). Confirmed red (via a directly
reproduced fast-check counterexample, seed `536878112`, `Counterexample: ["__proto__"]`) before
the fix in both cases. A repo-wide grep for the same plain-object-lookup-keyed-by-untrusted-string
pattern found no other instances in this package (`high-impact-capabilities.ts`'s lookup is keyed
by the closed `JiraAction` union, already validated before that point — never an arbitrary
string).

## Gate results (exact, reproduced, post-remediation)

- `npx tsc -b packages/connectors-jira` → clean, 0 errors.
- `npx vitest run packages/connectors-jira --coverage.enabled=false` → **27 test files, 282
  tests, all passed** (run 6 consecutive times with no flakes after the prototype-lookup fix
  above; it reproduced intermittently — roughly 1 run in 5-8 — before that fix).
- `npx eslint packages/connectors-jira` → clean, 0 problems.
- `npx prettier --check packages/connectors-jira` → clean, all files match Prettier style.
- Coverage for `packages/connectors-jira/src` (scoped via
  `--coverage.include='packages/connectors-jira/src/**/*.ts'`, measured from the v8 report):
  - **Statements: 660/674 = 97.92%**
  - **Branches: 373/422 = 88.38%**
  - **Functions: 198/202 = 98.01%**
  - **Lines: 627/640 = 97.96%**
  - All four metrics clear the ≥80% line+branch ground rule.

## Exit criterion → evidence mapping

| # | Exit criterion (verbatim) | Evidence |
|---|---|---|
| 1 | Plan's Jira flow passes on fakes + cassettes: board → sprint → epic → issue → link → worklog → attachment; ADF/text conversion; transitions; concurrent-edit conflicts. | `src/testkit/jira-flow.integration.test.ts` — three `describe` blocks: (a) the full 8-step chain (board.create → sprint.create → epic issue.create → story issue.create → issue.link → comment.create with `toADF`-converted markdown → worklog.create → attachment.upload), each applied through the REAL `@eo/gateway` `executeMutationPlan` against a real temp-dir `JournalStore`; (b) `issue.transition` with its read-back `verify()` GET; (c) a 412 (`preconditionFailedResponse`) on `issue.update` resolving to `{status:"failed", errorKind:"conflict"}`. |
| 2 | `JiraResourceClient` conformance suite green against fake-Jira for every in-scope resource. | `src/resource-client/jira-resource-client.test.ts` (projects/boards/sprints/issues/comments/worklogs reads + all `plan*` builders across issues/boards/sprints/comments/worklogs/attachments) + `src/resource-client/jira-provider-client.test.ts` (the same surface via the generic MCP dispatch adapter) + `src/resource-client/jira-mutation-apply-client.test.ts` (per-action `buildRequest`/`parseResponse`/`verify`/`reconcileAmbiguous`). |
| 3 | Exactly-once via entity-property markers proven under injected POST timeout (no duplicate comments/issues). | `src/resource-client/exactly-once.integration.test.ts` — wires the REAL `createJiraMutationApplyClient` through `@eo/gateway`'s REAL `executeMutationPlan` + a real journal, injects `midPostTimeoutFault()`, and proves, for BOTH `issue.create` and (post-M1-fix) `comment.create`: (a) a found marker resolves to `recorded` with no second POST (comment.create's case wires the REAL `createJiraEntityPropertyMarkerReconciler`, never a stubbed override, proving the stamped and searched values now actually match), and a subsequent identical call `replays` from the journal, never re-hitting the network, and (b) an unfound marker fails closed to `{status:"blocked", errorKind:"ambiguous_write"}`, never a guess. |
| 4 | Forged delete/admin/impersonation calls fail before network I/O. | `src/security/preflight-capability-guard.test.ts` — 16 forged/out-of-scope action strings (delete/impersonate/permission-scheme/workflow-scheme/security-scheme/automation-rule/admin/raw/injection strings) each throw `ConnectorError.policyBlocked` synchronously with **no transport constructed at all** in that test file; `src/resource-client/jira-mutation-apply-client.test.ts`'s "rejects a plan carrying a forged out-of-scope action before building any request" proves the same guard runs inside `buildRequest` itself (belt-and-suspenders, since `assertAllowedJiraOperation` also gates plan *construction* in `plan-builder.ts`). |
| 5 | `JiraWorkflowStage` never-guess proven: fuzzed/unrecognized workflow-status names always resolve to `blocked`, never `done`. | `src/workflow/workflow-stage.test.ts` — two fast-check properties: any status name absent from the known-name table (and no category hint) always resolves `blocked`; any unrecognized name with a non-`done` category hint never resolves `done`. |
| 6 | Revision comparator detects a seeded material remote edit between two milestone polls and produces the amendment-review signal (evidence: property + integration fixture). | `src/intake/revision-comparator.test.ts` — fast-check properties: any pair of distinct revision strings is always `material: true`; any identical revision string is always `material: false`; plus a fixture test seeding an explicit `rev-1` → `rev-2` edit. `src/intake/milestone-sync.test.ts`'s dedup-marker tests are the companion integration evidence for the polling/sync loop this comparator feeds. |
| 7 | Milestone sync yields ≤1 status comment per milestone, edited in place; Jira `done` only with 21's verification evidence attached. | `src/intake/milestone-sync.test.ts` — "an existing dedup comment" test proves a second sync for the SAME (issue, milestone-kind) edits the existing comment (`comment.update`) rather than creating a second one; "distinct milestone kinds never share a marker" proves start/blocker/completion each get their own ≤1-comment slot. The done-gate is `src/resource-client/issue-plans.ts`'s `assertDoneTransitionHasEvidence` (exported), enforced inside `planIssueTransition`. Post-H2-fix: the target-stage-is-done signal is no longer caller-suppliable at all — `issues.planTransition` (now `async`) resolves it itself, server-side, from `issues.transitions(issueKey)` — so the gate cannot be bypassed by a forged flag; proven in `jira-resource-client.test.ts`'s rewritten `planTransition` suite (a server-reported closing transition with no `hasVerificationEvidence` still throws `policy_blocked`) and exercised end-to-end (with evidence supplied) in `jira-flow.integration.test.ts`'s "transitions" block. |
| 8 | Attachment pipeline rejects oversized/spoofed-MIME/secret-embedded fixtures before any byte reaches a prompt. | `src/attachments/attachment-pipeline.test.ts` — 9 cases: oversized, spoofed PNG magic bytes, path-traversal filename, disguised Windows executable, EICAR test signature, AWS-key-shaped secret, PEM private-key header, plus a test proving the rejected result's own JSON never contains the raw secret payload. `AttachmentValidationResult` (both branches) carries no content field at the type level. |
| 9 | Fake-Jira/cassette parity proven: the scripted scenario set replayed against both fake and recorded cassette yields identical typed results. | `src/testkit/fake-cassette-parity.test.ts` — runs the same 7-call read scenario (`src/testkit/scripted-read-scenario.ts`'s `runScriptedReadScenario`) against an independently hand-authored `FakeProviderScript` and against `src/testkit/fixtures/read-scenario.cassette.json` (a byte-recorded cassette), asserting `toEqual` on the full typed result set. |
| 10 | Rate-limit fixture: `Retry-After` honored; per-issue write order preserved. | `src/testkit/rate-limit-and-write-order.test.ts` — (a) a 429 with `retry-after: 2` causes exactly one `sleep(2000)` call before the retried GET succeeds; (b) two concurrent writes to the SAME `canonicalTarget` (`issue:PROJ-1`) never overlap on the wire (proven via an instrumented fake transport asserting the first call's `end` precedes the second's `start`); (c) a concurrent write to a DIFFERENT issue is NOT serialized against the first (`maxInFlight > 1`), proving the serialization is per-resource, not global. |

## Additional test-plan coverage beyond the exit-criteria table

- **Unit:** `src/errors/jira-error-mapping.test.ts` (14-status canonical-error mapping table,
  reusing `@eo/gateway`'s `mapHttpStatusToConnectorError` — never reimplemented);
  `src/auth/token-manager.test.ts` (8 cases: fetch/cache, expiry refresh, clock-skew buffer,
  fetch failure never caches, non-positive expiry rejected, secret never leaked into the thrown
  error, `invalidate()`, concurrent-call single-flight de-duplication).
- **Property:** `src/capability/field-metadata.test.ts` — fast-check over arbitrary unrecognized
  field-schema-type strings (never silently accepted for a custom-field write) and arbitrary
  undiscovered custom-field ids (always rejected).
- **Conformance:** `src/testkit/fault-matrix.test.ts` — 401/403/409/429 (post-retry-exhaustion)/
  malformed-pagination/mid-POST-timeout each replayed through a real `JiraResourceClient` read
  call and asserted to map to exactly the expected canonical kind (or, for the mid-POST-timeout
  case, to propagate as a raw transport error rather than a clean HTTP failure — the precondition
  the exactly-once suite's reconciliation path depends on).
- **Security (package-local scanner):** `src/gateway-name-reference.test.ts` mirrors
  `packages/gateway/src/mcp/gateway-name-reference.test.ts`'s repo-wide-literal-ban proof, scoped
  to this package's own `src/` tree (this connector never has reason to reference the gateway MCP
  server name at all — it registers a provider client, not an MCP tool).
- **Security (adversarial-review round 2 additions):** `src/resource-client/adf-guard.test.ts`
  (7 cases: valid doc accepted; invalid/missing shape, `javascript:`-href, disallowed node,
  disallowed mark, and embedded-secret text all rejected; the rejected error never echoes the
  matched secret text); `src/security/secret-patterns.test.ts` (the shared AWS-key/PEM-header/
  `aws_secret_access_key=` pattern set now reused by both the attachment pipeline and the ADF
  guard); `src/attachments/attachment-pipeline.test.ts` gained 3 full-content-scan cases.

## Public interface names exported (what 19 and 21 consume)

From `packages/connectors-jira/src/index.ts`:

- **`JiraResourceClient`** (type) — the deployment-type-parameterized resource-client interface
  roadmap/19 implements against Jira Data Center behind the same shape. Covers
  `projects`/`boards`/`sprints`/`issues`/`comments`/`worklogs`/`attachments` (epics are issues
  with `issueType: "Epic"` — no separate namespace). **Post-H2-fix:** `issues.planTransition` is
  now `Promise<RemoteMutationPlan>` (not sync) and its parameter list dropped
  `targetStageIsDone` entirely — 19's Data Center implementation of this same interface must
  match this signature exactly (resolving done-ness from its own DC transitions read, not from
  a caller-supplied flag).
- **`assertSafeAdfDocument`** (`resource-client/adf-guard.ts`) — the shared ADF safe-subset +
  secret-scan guard every outgoing comment/description/summary payload passes through, at both
  the plan-build and apply boundaries; 19 should reuse this identically for its own ADF/wiki-
  markup writes rather than re-deriving it.
- **`createJiraResourceClient`** — the Cloud implementation factory (constructor deps:
  `JiraHttpContext`, a `FieldMetadataIndex`, a `JiraPlanPayloadRegistry`, optional `tenant`
  override).
- **`JiraWorkflowStage`**, `JIRA_WORKFLOW_STAGES`, `isJiraWorkflowStage`,
  `mapJiraStatusToWorkflowStage` — the closed `planned | in_progress | blocked | done` union +
  never-guess mapper.
- **`JIRA_ACTIONS`** / `JiraAction` — the closed 17-member mutating-action vocabulary this
  connector's plans are built against (the pre-flight allowlist `assertAllowedJiraOperation`
  enforces).
- **`createJiraProviderClient`** / **`createJiraMutationApplyClient`** — the `GenericProviderClient`
  / `MutationApplyClient` adapters `@eo/gateway`'s `tracker.*` tools dispatch to.
- **`registerJiraCloudProvider`**, **`JiraConnectionRegistry`** — the seam wiring per-connection
  state into `@eo/gateway`'s provider registries (see "Design surprise" below).
- **`createJiraEntityPropertyMarkerReconciler`** — the Jira implementation of `@eo/gateway`'s
  `MarkerReconciler` interface (issue and comment marker kinds).
- **`validateAttachmentBeforeStaging`**, **`AttachmentStagingRegistry`** — the streaming
  validation pipeline + the plan↔apply-time bytes side-channel.
- **`planMilestoneSync`**, **`compareRemoteResourceRevisions`**, **`stampJiraRemoteResource`** —
  the milestone-sync engine and revision comparator 21 wires into its own evidence-binding flow.
- **`assertDoneTransitionHasEvidence`** — the done-transition evidence gate 21 must satisfy
  (pass `hasVerificationEvidence: true` to `issues.planTransition` only once its own
  exact-revision verification has passed).
- **`JIRA_FAULT_MATRIX`**, `HAND_AUTHORED_READ_SCENARIO`, `loadReadScenarioCassette`,
  `runScriptedReadScenario` — the testkit surface 19 extends with DC-specific faults and 23
  reuses for its non-live E2E/drift-CI baselines.

## Deferred root-config/ledger/dependency changes

None required. No new external npm dependency was added — `package.json` only adds
workspace-internal dependencies (`@eo/gateway`, `@eo/renderer` as `dependencies`; `@eo/journal`,
`@eo/testkit`, `fast-check` as `devDependencies`), mirroring the exact dependency shape already
declared (but unused) by the sibling `packages/connectors-grafana` stub. `tsconfig.json` only
adds the matching project references. No root `vitest.config.ts`/`eslint.config.js`/
`tsconfig.base.json` edit was needed — the root config auto-discovers every `packages/*`
directory.

## Carry-forwards (flagged, not resolved here)

1. **Provider key naming (`"jira-cloud"`)** — roadmap/18's own Risks bullet flags this
   explicitly: "`JiraResourceClient` and `JiraWorkflowStage` are named here for the first time;
   if 19 has independently committed to different names for the same concepts, reconcile before
   both land." This phase registers its `ProviderRegistry`/`ExternalConnection.provider` key as
   the literal string `"jira-cloud"` (see `JIRA_PROVIDER_NAME` in
   `src/errors/jira-error-mapping.ts`) — a deliberate, documented choice, not an
   interface-ledger ruling. 19 must either reuse this exact string for its own Data Center
   registration (if DC and Cloud connections are meant to share one provider key,
   differentiated internally by `ExternalConnection.deploymentType`) or register under a
   distinct key (e.g. `"jira-datacenter"`) — whichever 19 chooses, it is a coordinated decision
   the reconciler should confirm, not a unilateral one either phase makes alone.
2. **`JiraResourceClient`'s exact method surface is this worker's own design**, not dictated
   verbatim by roadmap/18's prose (which only names the resource *groups*, not exact method
   signatures). 19 implementing "the DC implementation behind the same interface" means 19
   must satisfy this exact TypeScript interface (`src/resource-client/types.ts`) — any
   incompatibility discovered there is a 19-side integration finding, not a phase-18 defect,
   since 19 depends on 18 and not vice versa.
3. **Custom-field discovery cache staleness** — `discoverJiraFieldMetadata` is provided but this
   phase does not itself own a cache/refresh policy for it (unlike `CapabilitySnapshot`, which
   16's `CapabilitySnapshotCache` owns end-to-end). `JiraConnectionRegistry.register`'s
   `fieldMetadataIndex` option defaults to empty (fail-closed: every custom-field write is
   refused until a caller has run discovery and re-registered/refreshed the index) — the
   refresh cadence and storage are left to whichever phase wires the long-running gateway
   process (09/13), consistent with roadmap/18 not naming this cache explicitly.
4. **`milestone_sync` journal-entry persistence** — `planMilestoneSync` returns a
   `MilestoneSyncJournalEntryPayload` value but never calls `@eo/journal`'s `appendEntry` itself
   (this package holds no `@eo/journal` *production* dependency, only a devDependency for
   tests) — the caller (the orchestration layer that already holds a `JournalStore`) is
   expected to append it under `JournalEntryType: "milestone_sync"`. This mirrors 16's own
   `RemoteMutationPlan` → `RemoteOperationRecord` persistence being owned by the mutation
   pipeline, not by this connector.

## Deviations from strict red-green TDD ordering

**Adversarial-review remediation (round 2) note:** every one of the H1/H2/M1/M2/M3 fixes above
followed strict red-green TDD — a new test was written first and confirmed to fail against the
pre-fix code (via a targeted `vitest run` on the specific test name/file), THEN the minimal fix
was applied, THEN confirmed green. No exceptions in this round.

For the ORIGINAL (round 1) implementation pass, the following applied:

For the security-critical/never-guess modules (`preflight-capability-guard`, `workflow-stage`,
`field-metadata`, `token-manager`, `attachment-pipeline`), the failing test was written and
confirmed red (module absent → import error, or module present but assertion false) BEFORE the
implementation, per the ground rules. For the remaining, more mechanical modules (the resource-
client read/plan builders, the mutation-apply-client's per-action `buildRequest`/`parseResponse`
tables, the provider-dispatch adapters), test and implementation were authored together in the
same pass and verified via an immediate `vitest run` on the new file rather than a strict
standalone red confirmation step first — a pragmatic scope trade-off given this phase's breadth
(17 mutating actions × 4 lifecycle methods each). Every module was nonetheless verified GREEN
against its own dedicated test file before moving to the next, and the two integration suites
(`exactly-once.integration.test.ts`, `jira-flow.integration.test.ts`) exercise the REAL
`@eo/gateway` pipeline end-to-end, not mocks of it — so the exit-criteria-critical behavior
(exactly-once, conflict handling, transitions) is proven against genuine cross-package
integration, not merely unit-isolated assertions.

## Things reused from 16/17 that were notable

- 16's `GenericProviderClient`/`MutationApplyClient` split (read/plan tools vs. the single
  `tracker.apply` mutating tool) directly dictated this connector's own architecture: a thick,
  richly-typed `JiraResourceClient` internal interface, with two thin *adapters* over it
  (`jira-provider-client.ts`, `jira-mutation-apply-client.ts`) that satisfy the gateway's
  narrower dispatch contracts. Without that split already being enforced at the gateway layer,
  it would have been easy to accidentally let a mutating call bypass the exactly-once pipeline.
- **`RemoteMutationPlan` (P02) deliberately carries no raw desired-state payload field** — only
  `redactedDiff` + `desiredStateHash`. This was not initially obvious and required a design
  correction mid-phase: the actual field values / ADF bodies / transition ids a `plan*` builder
  computes must survive to apply time through a side channel, since the plan itself is the
  audit-facing, already-redacted record. `plan-payload-registry.ts` (keyed by the plan's own
  freshly-generated `id`) is this phase's answer, generalizing the same pattern
  `attachment-staging.ts` already needed for attachment bytes specifically ("bytes never enter
  prompts"). 19 will need the equivalent registry for its own DC apply client.
- **`MutationApplyClient.buildRequest` is synchronous** (`(plan) => MutationHttpRequestSpec`,
  not a `Promise`) — but a single `GenericProviderClient`/`MutationApplyClient` instance is
  registered per *provider key*, serving arbitrarily many `ExternalConnection`s (different Jira
  sites) under that one key. Resolving "which connection's base URL/token manager applies"
  therefore cannot be async at the `buildRequest` call site. `JiraConnectionRegistry` resolves
  this: all async per-connection setup (HTTP client construction, wiring dependent modules)
  happens once in `register()`; `get()` is a synchronous `Map` lookup keyed by
  `plan.externalConnectionId`, which IS available synchronously on the plan itself.
