# Phase 20 evidence — Grafana Cloud/OSS/Enterprise adapters

This directory is the evidence trail for `roadmap/20-grafana-adapters.md`'s exit criteria. One
continuous TDD pass built `packages/connectors-grafana`'s full deliverable, work item by work item
(1 → 6), studying `packages/gateway` (16) and `packages/renderer` (17)'s exports first and reusing
them throughout (never re-implementing transport/security, the mutation-pipeline shell, or the
rendering/lint pipeline).

**Session date:** 2026-07-24, plus an **adversarial-review remediation pass (same day)** — see
"Adversarial-review remediation" below for the 5 findings fixed after independent validation.
**Gate results** (captured verbatim in this directory, current as of the remediation pass):
`tsc-clean.txt` (exit 0), `eslint-clean.txt` (exit 0), `prettier-clean.txt` (exit 0),
`vitest-run.txt` (**264 tests, 30 files, all green**), `coverage-run.txt` (package-scoped
aggregate, computed with `--coverage.include='packages/connectors-grafana/src/**/*.ts'` since the
repo's global coverage gate is scoped to the whole monorepo and reports near-zero when only this
package's tests run — the per-package figure is the number that matters for this phase):
**98.95% statements / 92.49% branches / 99.37% functions / 99.26% lines**, comfortably above the
80%-line-and-branch ground rule.

## Adversarial-review remediation (2026-07-24)

Independent adversarial validation confirmed several strong clean axes (API token never leaks —
traced end-to-end; no-delete/admin guard is a type-level impossibility on every path; exactly-once
+ fetch-compare-rebase + rollback all sound; genuine 16/17 reuse; unknown-build→read-only correct)
but found 5 real gaps. Each was fixed TDD-style (failing test first), entirely within
`packages/connectors-grafana/` and this evidence directory. All 264 tests pass; `tsc -b`/`eslint`
clean; coverage unchanged above 80% both metrics (line 91.82%→92.49% branch, actually improved).

| # | Finding | Fix | New/updated evidence |
| --- | --- | --- | --- |
| HIGH (annotation read-back verify structurally broken — every annotation write reported `failed`) | `verify()`/`reconcileAmbiguous()` (`mutation-apply-client.ts`) compared the remote read-back's canonical fields against the RAW, un-marked `payload.input` — but `annotation`'s `buildCreateRequest` (`resources/definitions/annotation.ts`) always injects an `eo-marker:<uid>` tag into `tags` (a canonical field) before sending the actual POST. Against a real Grafana, the read-back therefore ALWAYS differed from the comparison baseline, so a genuinely successful annotation create was always recorded `failed`. The integration cassette masked this (its static verify fixture returned `tags: []`, inconsistent with the marker the connector's own POST actually sends). | Added `canonicalizeDesiredInput(input, {action, deterministicUid})` to the `GrafanaResourceDefinition` interface (all 7 kinds implement it) — the connector's ACTUAL desired state, never the raw input. `annotation.ts` extracts a single `injectAnnotationMarker` helper both `buildCreateRequest` (the real wire body) and `canonicalizeDesiredInput` (create only; update is identity) call, so the two can never drift apart again. `mutation-apply-client.ts`'s `verify()`/`reconcileAmbiguous()` now compare against `canonicalizeDesiredInput`'s output, never `payload.input` directly. `cassettes.ts`'s annotation verify response is now built dynamically (`buildAnnotationVerifyResponse(idempotencyKey)`), deriving the SAME marker the actual create will use, so the cassette can never again misrepresent the connector's own POST body. | `mutation-apply-client.test.ts`'s new "adversarial-review HIGH regression" test (a genuine annotation create write now verifies `true` and records — this exact scenario returned `false` before the fix); `resource-client.test.ts`'s `canonicalizeDesiredInput` describe block (all 7 kinds, incl. proving annotation's marker matches `buildCreateRequest`'s own wire body byte-for-byte); `integration-cassette-replay.test.ts` updated to compute each kind's idempotency key BEFORE building the cassette, so the annotation entry's embedded marker always matches what the replay's own `planCreate` derives — all 5 per-version + OSS/Enterprise replays (which include an annotation create) now genuinely pass rather than passing vacuously |
| MEDIUM (notifier resource-body secrets un-redacted into snapshots/evidence) | `contact-point.ts`'s `settings` and `notification-template.ts`'s `template` were captured verbatim into `GrafanaParsedResource.fields` — becoming rollback snapshots, plan payloads, and canonical read-back-compare results attachable to an `EvidenceRecord`, with no redaction anywhere on that path. | New shared `security/redaction.ts`: `redactSecretBearingObject` (recursive, key-name-driven — walks nested objects/arrays, redacting any secret-shaped KEY at any depth) and `redactCredentialShapedText` (content-pattern-based, for `template`'s free-text body). Applied on BOTH sides of the `verify()` comparison — `contact-point`/`notification-template`'s `parseCanonical` (the remote read-back) AND `canonicalizeDesiredInput` (the comparison baseline) — so redaction never causes a spurious verification mismatch. NEVER applied to the actual outbound `buildCreateRequest`/`buildUpdateRequest` wire body (a redacted webhook URL sent to Grafana would corrupt the real contact point). `query-layer.ts`'s row redaction now reuses the SAME shared `redactSecretBearingObject` (deepening it from top-level-only to fully recursive — see the LOW finding below). | `security/redaction.test.ts` (the shared primitives' own unit tests); `security/leak-hunt.test.ts`'s new describe block (a real webhook secret planted in a contact-point's `settings.authorization`/`settings.password` never survives into `parseCanonical`'s output, a captured rollback snapshot, or `canonicalizeDesiredInput`'s comparison baseline — while `buildCreateRequest`'s actual wire body still correctly carries the real secret, proving the mutation itself isn't broken by the fix; a credential-shaped string pasted into a notification-template body is also redacted); `resource-client.test.ts`'s `canonicalizeDesiredInput` tests for both kinds |
| MEDIUM (alert-rule high-impact tagging missed non-pause disabling) | `requiredHighImpactFlagsFor` tagged "alert disabling" ONLY when an update's input touched `isPaused` — an update rewriting `condition` to never fire, moving `ruleGroup` into an unwatched group, or stretching `for` so far the alert never has time to trigger reached the network with NO high-impact flag, un-gateable by 16's envelope-flag guard or 23's notification-side-effect matrix. | Broadened detection, asymmetrically between create and update: **create** still only flags on `isPaused` (nothing pre-existing is being neutralized by a brand-new rule); **update** now flags when ANY of `condition`/`for`/`ruleGroup`/`isPaused` is touched — each is a way to alter whether/how an EXISTING rule fires. | `high-impact-tagging.test.ts`'s new tests: a condition-rewrite, a `ruleGroup` move, and a `for`-stretch on UPDATE are all now flagged "alert disabling"; a create touching the same 3 non-`isPaused` fields is confirmed still UNflagged (preserves the create-time distinction); a pure-rename update stays unflagged |
| LOW (build-info not zod-validated + `edition:"cloud"` bypassed the version allowlist unconditionally) | `fetchBuildInfo()`'s result was used directly with no shape validation — the one external response shape in this package that wasn't zod-validated at the boundary (contrast `provider-registration.ts`'s already-strict validation of every tool-call param). `isKnownGrafanaBuild` also returned `true` unconditionally for `edition: "cloud"` regardless of `version`. | Added `GrafanaBuildInfoResponseSchema` (`build-info-fixtures.ts`) and applied `.parse()` at the exact boundary in `discoverGrafanaCapabilities` — a malformed response (missing `version`, an out-of-enum `edition`, a wrong `product`, or extra fields under the now-`.strict()` shape) now fails discovery outright. The unconditional cloud→known bypass is KEPT, but is now backed by validated shape (edition is guaranteed one of exactly 3 enum members, never an arbitrary string) and its rationale is documented explicitly (Cloud exposes no stable version to pin against — it is itself one of the 4 pinned targets, tracked continuously); the reported version is still always recorded, never discarded, even when it doesn't gate write-eligibility. | `capability-discovery.test.ts`'s new "build-info is zod-validated at the boundary" describe block: 4 malformed-shape rejection tests + 1 test confirming a well-formed but arbitrary-version `cloud` response still passes shape validation and is treated as known (by design, not by gap) |
| LOW (2 items, fixed since cheap) | (a) `query-layer.ts`'s row redaction inspected only TOP-LEVEL key names — a secret nested under a non-secret-named parent (e.g. `metadata.headers.authorization`) passed through unredacted. (b) `downsampleToResultBudget`'s non-converging-filter collapse branch (hit at `candidate.length === 2`) returned early WITHOUT calling `enforceResultBudget` on the result — benign in practice (a single already-item-budget-checked row is always within the larger result budget) but unasserted. | (a) `scopeAndRedactRow` now delegates to the SAME shared `redactSecretBearingObject` the resource definitions use — fully recursive, not top-level-only. (b) the collapse branch now explicitly calls `enforceResultBudget` before returning. | `query-layer.test.ts`: a nested-secret redaction test + an array-of-objects redaction test; a dedicated `candidate.length === 2` collapse-path test proving the budget is explicitly satisfied, not silently assumed |
| LOW (1 item, documented — not cheaply fixable) | The read-only guard (`assertWritableCapability`) runs only at PLAN time (`planCreate`/`planUpdate`); a snapshot flipping writable→read-only in the window before the later `observability.apply` call isn't re-guarded. | Documented as a known, accepted narrow window in `write-eligibility-guard.ts`'s own doc comment: `@eo/gateway`'s `MutationApplyClient.buildRequest(plan)` contract is deliberately synchronous and I/O-free (that package's own design), so there is no structurally available point inside THIS phase's own code to re-await an async capability-snapshot re-check immediately before issuing the request. A real fix would require a cross-cutting change to `@eo/gateway`'s own `MutationApplyClient`/`executeMutationPlan` contract (e.g. an explicit pre-apply freshness hook) — 16's interface to evolve, not this phase's to silently work around. | Doc comment in `write-eligibility-guard.ts`; carried forward here for 16/21's awareness |

**New files from this remediation pass:** `src/security/redaction.ts` (+ `redaction.test.ts`).
**Changed public interface:** `GrafanaResourceDefinition` gained a new required method,
`canonicalizeDesiredInput(input, context): Readonly<Record<string, unknown>>` — every one of the 7
resource definitions implements it (6 are identity; `annotation`/`contact-point`/
`notification-template` are not). `cassettes.ts`'s `buildKindCreateCassette` signature gained an
optional second parameter (`{ annotationIdempotencyKey? }`); its old single-argument call shape
still compiles and still returns a valid (if annotation-marker-generic) cassette via the new
`DEFAULT_ANNOTATION_IDEMPOTENCY_KEY` — no caller of the old shape was left broken.

## Exit-criteria → evidence map

| Exit criterion (roadmap/20-grafana-adapters.md) | Evidence |
| --- | --- |
| `folder→dashboard→annotation→alert-rule` integration suite green on all three version cassettes (11.6/12.4/13.1) + current-Cloud, plus the OSS/Enterprise Docker-recipe run | `src/fixtures/integration-cassette-replay.test.ts` — replays the full 7-kind create chain (`folder→dashboard→annotation→alert-rule→contact-point→mute-timing→notification-template`, roadmap's own order) against each pinned `GrafanaBuildInfoFixture`'s discovered route table, through `@eo/gateway`'s real `executeMutationPlan` + a real `JournalStore` (tmp-dir-backed) + a scripted fake transport; `src/fixtures/docker-recipes.ts` declares the OSS/Enterprise recipes, cross-referenced by fixture label so the "Docker-recipe-backed run" tests assert the SAME cassette replays green for both. See Deviations for why this is cassette-replayed rather than a live container run. |
| Mutation-safety property suite finds zero blind-overwrite counterexamples; every 409/412 resolves to fetch-compare-rebase or an explicit typed block | `src/mutation/precondition.property.test.ts` (fast-check: 300-run two-writer race + N-writer fuzzed interleaving over a simulated precondition-guarded remote resource, proving no divergent-content overwrite ever occurs); `src/mutation/apply-with-rebase.test.ts` (integration: 412-with-unchanged-content → safe rebase → recorded; 409-with-diverged-content → explicit typed `blocked`/`conflict`, zero extra write attempts; fetch-compare GET itself failing → blocked, never assumed safe) |
| Rollback-restore integration test proves the restored resource is canonical-identical to the pre-mutation snapshot; a failed creation leaves the resource in place with a cleanup-report artifact, never an auto-delete | `src/mutation/rollback.test.ts` (fetches the fresh revision first — never restores against a stale precondition — writes the snapshot back, reads back, and canonical-compares; blocks on any of the 3 HTTP steps failing or on a read-back mismatch, never a false-positive restore); `src/mutation/cleanup-report.test.ts` (a failed/blocked create produces a `GrafanaCleanupReport`; a successful/replayed create produces none; no delete-shaped method exists anywhere to auto-clean with — see `src/security/no-delete-admin.test.ts`) |
| An unknown/untested build-info fixture forces a read-only `CapabilitySnapshot`; a mutation attempt against that snapshot fails before any HTTP call | `src/discovery/capability-discovery.test.ts` ("unknown build forces read-only" describe: `BUILD_INFO_UNKNOWN`'s routes all probe as reachable, yet `isReadOnly` is still `true` — the verdict is independent of route reachability); `src/adapter.test.ts` + `src/fixtures/fault-injection-matrix.ts`'s redaction scenario (`planCreate`/`planUpdate` against a read-only snapshot reject via `assertWritableCapability` with zero `send` calls, asserted by call-count) |
| Query-layer test proves aggregation/redaction completes and results stay within 16's 32 KiB item / 256 KiB result budgets before data leaves this package | `src/query/query-layer.test.ts` — a fixture row exceeding 32 KiB is truncated in place (never passed through raw); a fixture result set exceeding 256 KiB is downsampled; secret-shaped field NAMES are redacted even when explicitly allowlisted; an absent time range is rejected before any row is touched; the full pipeline test asserts both budgets simultaneously on a combined oversized+secret-laden fixture |
| Reconciliation suite: an ambiguous-POST-timeout fixture resolves via marker search to zero duplicate resources, or blocks with typed `ambiguous_write` — never silently both | `src/mutation/mutation-apply-client.test.ts`'s "reconciliation" describe block, run through `@eo/gateway`'s real `executeMutationPlan` with a `mid-post-timeout` fault (from that package's own fault-injection testkit): marker found (uid-addressable kinds AND annotation's tag-based marker) → `recorded`, exactly one POST ever attempted; marker not found → `blocked`/`ambiguous_write`, exactly one POST ever attempted (never a second, guessed retry) |
| Every mutation touching alert disabling, contact points, mute timings, or notification templates carries at least one of the 4 `HighImpactCapabilityFlag` labels; a static/schema-level test fails on any untagged high-impact call | `src/mutation/high-impact-tagging.test.ts` — exhaustive sweep over all 7 kinds × {create, update}, asserting the 3 unconditionally-flagged kinds are always tagged, folder/dashboard/annotation are never tagged, and `alert-rule` is tagged "alert disabling" iff its input touches `isPaused`; `src/mutation/mutation-plan-builder.test.ts` proves `buildGrafanaMutationPlan` actually attaches `requiredCapabilityFlags` end-to-end for a real plan |
| Security fixture suite: forged delete/admin calls produce zero outbound HTTP requests (mock-transport call-count assertion) | `src/security/no-delete-admin.test.ts` (no forged operation name — `delete`/`remove`/`createUser`/`replaceNotificationPolicyTree`/etc. — exists as a callable function anywhere on `GrafanaProviderAdapter` or any of the 7 resource definitions; `Object.keys(adapter)` is exactly the 4-method allowlist); `src/fixtures/fault-injection-matrix.ts`'s `forged-delete-admin` scenario (zero `send` calls, asserted directly) |

## Additional test-plan bullets (beyond the checkbox list above)

- **Unit — per-resource-client request/response mapping (all 7 kinds), canonical-serializer round-trip:** `src/resources/resource-client.test.ts` (`describe.each` over all 7 kinds: list/get are GET-only; create is always POST; update always carries a precondition; `parseList` rejects a non-array body and parses a valid one; `parseCanonical` round-trips identical content, detects genuine changes, and prefers an `ETag` header over any body field; every request is exercised end-to-end through `@eo/gateway`'s real `GatewayHttpClient` against a fake transport).
- **Property — route-table selection is deterministic from capability, never version:** `src/discovery/route-table.test.ts` (fixture tests for all 4 pinned builds; fast-check: shuffled/duplicated capability-flag insertion order never changes the selected family; `apis` always preferred over `legacy` when both present; `selectRouteFamily`'s own signature takes no version parameter at all).
- **Conformance — every rendered annotation goes through 17's `renderWithRegeneration`:** `src/annotations/annotation-renderer.test.ts` (first-attempt success; regenerate-once on a too-long `change`; second failure → `blocked`/`policy_blocked`, never a written artifact; template shape `<state> | <service> | <change> | evidence=<ref>` is always followed).
- **Security — leak-hunt (no raw provider body in any error):** `src/security/leak-hunt.test.ts` (a planted secret marker in a raw HTTP response body never survives into `restoreFromSnapshot`'s blocked reason, `assertWritableCapability`'s thrown `ConnectorError`, or `checkGrafanaConnectionDoctor`'s result — each serializes to exactly its documented field set).
- **Security — `GATEWAY_MCP_SERVER_NAME` sole-reference proof:** `src/security/gateway-name-reference.test.ts` (repo-local recursive scan over every `.ts` file under `src/`, mirroring `packages/gateway`'s own instantiation of this proof — zero hand-typed occurrences of the literal anywhere, including this scanner and every comment/doc string in the package).
- **Security — secret-reference-only storage:** `src/security/secret-redaction.test.ts` (no credential-shaped literal pattern — Grafana service-account/API-key prefixes, JWT shape, AWS access-key shape — appears anywhere in `src/`; no production file reads `process.env` directly, since secret resolution is exclusively `@eo/gateway`'s `resolveSecretReference`; no production file declares a plain-string token/secret/password parameter).
- **Tenant-boundary breach:** `src/fixtures/fault-injection-matrix.ts`'s `tenant-boundary` scenario + `src/auth/connection-doctor.test.ts` (a token bound to an org outside the connection's `orgAllowlist` is refused before any resource access; an empty allowlist refuses rather than trusting any org).

## Work-item → module map

| Work item | Modules |
| --- | --- |
| 1. Auth + connection-doctor | `src/auth/connection-doctor.ts` |
| 2. Discovery/probing → `CapabilitySnapshot` + data-driven route table | `src/discovery/{build-info-fixtures,route-table,capability-discovery}.ts` |
| 3. Resource clients (7 kinds) + canonical serializers | `src/resources/{resource-definitions,transport-bridge}.ts`, `src/resources/definitions/*.ts`, `src/adapter.ts`, `src/provider-registration.ts` |
| 4. Mutation glue: snapshot/rollback, preconditions, restore, reconciliation, high-impact tagging | `src/mutation/*.ts`, `src/reconciliation/marker-reconciler.ts` |
| 5. Query layer (time-range/field scoping, aggregation/redaction, budgets) | `src/query/query-layer.ts` |
| 6. Fixtures: cassettes, Docker recipes, fault-injection matrix, latency counters | `src/fixtures/*.ts` |
| (Interfaces produced, not its own numbered work item) Annotation rendering + optional MCP wrap declaration | `src/annotations/annotation-renderer.ts`, `src/mcp-wrap/upstream-mcp-policy.ts` |

## Deviations / deliberate interpretations (carry-forwards for 21/23 to be aware of)

1. **No live Docker/Grafana instance is ever started.** The ground rules forbid live network calls
   in tests. `src/fixtures/docker-recipes.ts` declares the OSS/Enterprise recipes as reviewable,
   versioned data (pinned image tag, non-secret bootstrap env, port, and a cross-reference to the
   `GrafanaBuildInfoFixture` label each container is expected to report). The "Docker-recipe-backed
   OSS/Enterprise runs" test-plan bullet is satisfied by replaying the SAME cassette mechanism
   against those cross-referenced fixtures, never by a fabricated claim that a container actually
   ran. Phase 23 (which owns the live E2E matrix and has runtime/sandbox access this task run does
   not) is the natural place to wire an actual `docker run` against these recipes.
2. **Grafana wire-format fixtures are plausible, not live-captured.** Every JSON body shape in
   `src/resources/definitions/*.ts`'s comments and `src/fixtures/cassettes.ts` is this worker's own
   best-effort modeling of Grafana's REST/provisioning API shapes (folder/dashboard/annotation via
   the classic `/api/*` endpoints; alert-rule/contact-point/mute-timing/notification-template via
   the provisioning API; a spec-internally-consistent `/apis/<group>/<version>/...` App-Platform
   shape for the newer route family). Roadmap/20 §Risks itself says the route table is "data, not
   code" precisely because of this — a live-verified drift is a fixture update, never a routing-
   logic change. **Carry-forward:** 21's drift-CI replay job should diff these fixtures against a
   real Grafana instance's actual responses at least once before relying on them as ground truth.
3. **`RemoteMutationPlan` carries no generic payload field** (roadmap/02's schema is deliberately
   payload-agnostic — only a redacted diff + a desired-state hash). This phase resolves that by
   introducing its own `GrafanaPlanPayloadStore` (in-memory, keyed by `plan.id`), populated by
   `adapter.ts`'s `planCreate`/`planUpdate` and read back by `mutation-apply-client.ts`'s
   `buildRequest`/`verify`/`reconcileAmbiguous`. This is an interpretation, not a ledger ruling —
   flagged here rather than silently assumed. A durable (crash-surviving) version of this store,
   and of `GrafanaRollbackSnapshotStore`, is a natural 21/23 integration concern; both are
   in-memory-only at this phase, matching `@eo/gateway`'s own `ProviderRegistry`/
   `CapabilitySnapshotCache` in-process scope.
4. **The fetch-compare-rebase orchestration (`apply-with-rebase.ts`) is this phase's own addition**
   layered ON TOP OF `@eo/gateway`'s `executeMutationPlan` — that package's own pipeline treats a
   409/412 as a terminal `failed`/`conflict` outcome and never itself retries (confirmed by reading
   `mutation-pipeline.ts` and `retry-ladder.ts`: the `"fetch-rebase-or-block"` retry-ladder action
   is a labeled hook, not an implemented retry). A safe rebase is executed as a brand-new,
   distinctly-idempotency-keyed `executeMutationPlan` call (`${idempotencyKey}:rebase:${revision}`)
   — never a mutation of the original plan/journal record — since a `failed` journal entry is
   authoritative and is never silently re-run by that package's own design.
5. **No external npm dependency was added.** `@eo/contracts`, `@eo/gateway`, `@eo/renderer`,
   `@eo/journal`, `@eo/testkit`, `zod`, and `fast-check` are all already present in the root
   lockfile (used by sibling packages); `packages/connectors-grafana/package.json` only adds
   dependency edges onto them, never a new external package.
6. **No root-config, ledger, or roadmap-file edit was made or is believed necessary.** Every
   interface consumed from 02/16/17 matched this phase's own text exactly as read; no gap requiring
   a ledger change was found.

## Public interfaces phase 21/23 will consume (exact export names, from `src/index.ts`)

`GrafanaResourceKind`/`GRAFANA_RESOURCE_KINDS`, `checkGrafanaConnectionDoctor`,
`discoverGrafanaCapabilities`/`buildGrafanaCapabilitySnapshotDiscoverer`, `buildRouteTable`/
`encodeRouteTableToApiFamilies`/`decodeApiFamiliesToRouteTable`, `GRAFANA_RESOURCE_DEFINITIONS`/
`getResourceDefinition`, `createGrafanaProviderAdapter` (returns the `GrafanaProviderAdapter`
interface: `list`/`get`/`planCreate`/`planUpdate` only — no delete method exists on the type),
`registerGrafanaProvider`/`buildGrafanaGenericProviderClient`, `buildGrafanaMutationPlan`,
`createGrafanaMutationApplyClient` (the `MutationApplyClient` implementation), `applyGrafanaMutationWithRebase`,
`GrafanaRollbackSnapshotStore`/`restoreFromSnapshot`, `GrafanaPlanPayloadStore`,
`buildCleanupReportForFailedCreate`, `createGrafanaMarkerReconciler`/`deriveDeterministicUid`/
`deriveAnnotationMarkerTag`, `processGrafanaQueryResult` (+ its sub-stages), `renderGrafanaAnnotationArtifact`,
`buildGrafanaMcpWrapCapabilityEntry`, and the `src/fixtures/*` fixture/cassette/matrix/counter exports.

## Notable things reused from 16/17 that were not obvious in advance

- `@eo/gateway`'s retry ladder ALREADY names the `"fetch-rebase-or-block"` action for 409/412, but
  deliberately does not implement the rebase itself — that decision is explicitly left to the
  connector (confirmed by reading `retry-ladder.ts` and `http-client.ts` together, not assumed from
  the roadmap prose alone). This phase's `apply-with-rebase.ts` is the intended implementation of
  that hook.
- `createFakeObservabilityProvider`/`createFakeTrackerProvider` (16's testkit) both hardcode a
  fixed `/search`/`/item`/`/plan/create`/... path scheme unsuited to this phase's own kind-specific,
  route-table-driven paths — this phase's tests instead build directly on the lower-level
  `createFakeProviderTransport` + `GatewayHttpClient`, which 16 also exports and which is exactly
  what 16's own fake-provider doubles are built from.
- `MutationApplyClient` (16) is registered ONE PER PROVIDER STRING, not one per resource kind —
  `mutation-apply-client.ts` therefore dispatches internally on `RemoteMutationPlan.canonicalTarget`'s
  own `"<kind>:<id>"` prefix (this phase's own convention, `canonical-target.ts`), never registering
  7 separate provider keys.
