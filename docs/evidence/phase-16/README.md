# Phase 16 evidence — Connector gateway core

This directory is the evidence trail for `roadmap/16-gateway-core.md`'s exit criteria, following
the same convention established in `docs/evidence/phase-02/`, `phase-05/`, etc. One continuous
TDD pass built `packages/gateway`'s full deliverable, work item by work item (1 → 6), with a
test written before (or alongside) each unit of implementation.

**Session date:** 2026-07-23/24, plus an **adversarial-review remediation pass (2026-07-24)** —
see "Adversarial-review remediation" below for the five findings fixed after independent
validation. **Gate results** (also captured verbatim in this directory, current as of the
remediation pass): `tsc-clean.txt` (exit 0), `eslint-clean.txt` (exit 0), `vitest-run.txt` (**278
tests, 29 files, all green**), `coverage-run.txt` (package-scoped aggregate: **98.01% lines /
88.83% branches** over the 38 non-test source files under `packages/gateway/src`, computed from
`coverage/lcov.info` since the repo's global coverage gate is intentionally scoped to the whole
monorepo and reports a low percentage for a partial run that didn't execute every package's tests
— the per-package figure at the bottom of that file is the number that matters for this phase).

## Adversarial-review remediation (2026-07-24)

Independent adversarial validation of the original implementation found five interrelated
defects — several headline guarantees were not actually enforced where the spec required. Each
was fixed TDD-style (failing test first), entirely within `packages/gateway/` and this evidence
directory. All 278 tests pass; `tsc -b`/`eslint` clean; coverage unchanged above 80% both metrics.

| # | Finding | Fix | New/updated evidence |
| --- | --- | --- | --- |
| HIGH #2 (the crux) | `tracker.apply`/`observability.apply` dispatched straight to `client.apply(params)` (`provider-dispatch-tool.ts`), bypassing `executeMutationPlan` entirely — no journal-before-I/O, no idempotency, no read-back/verify, and no `GatewayHttpClient` (so no SSRF guard, no write-serializer) on the mutate path. | Split `*.apply` out of the generic read/plan dispatch into a dedicated `mcp/native-tools/mutation-apply-tool.ts` (`buildMutationApplyTool`), whose input schema is a full, schema-validated `RemoteMutationPlan` (run ID/idempotency key/expected revision/envelope reference are already-required fields on that 02 schema — no loose `Record<string, unknown>` bag). `mutation-pipeline.ts`'s `executeMutationPlan` was rewritten so it is now the SOLE issuer of the mutation's network I/O, via `deps.httpClient.request(...)` (`GatewayHttpClient` — full SSRF guard + write-serializer + retry ladder + budgets). A new `MutationApplyClient` contract (`mcp/native-tools/mutation-apply-client.ts`) gives 18/20 a `buildRequest`/`parseResponse`/`verify`/`reconcileAmbiguous` seam with NO way to issue a raw network call themselves. | `src/mcp/native-registry.test.ts`'s "HIGH #2 adversarial-review fix" describe block (journal-before-I/O proof: pending-then-recorded entries under the same operationId; SSRF-guard proof: a foreign-origin `buildRequest` target is refused with zero network calls; `observability.apply` parity); `src/mcp/native-tools/mutation-apply-tool.test.ts` (not-found/unsupported/verify/reconcileAmbiguous wiring) |
| HIGH #1 | DNS pinning was unimplemented: `http-client.ts` resolved+validated the hostname's IP for the SSRF check, but `http-transport.ts` dialed by HOSTNAME via `node:https`, which re-resolves at `connect()` — a rebinding resolver returning a public IP at check time and a private/metadata IP at connect time would bypass the guard entirely (TOCTOU). | `http-transport.ts`'s `sendHttpRequest` now accepts a `pinnedAddress` and dials that literal IP (hostname preserved only as TLS SNI `servername` + `Host` header). `http-client.ts`'s `#preflight` now returns the ONE validated address and threads it through as `pinnedAddress` on every hop — the exact address checked is the exact address dialed, never re-resolved. | `src/transport/http-transport.test.ts` "DNS pinning" describe (real integration: dials an intentionally-unresolvable hostname successfully only because the pinned IP is used, not a fresh DNS lookup; Host-header preservation; HTTPS+custom-CA+SNI-pinned variant); `src/transport/http-client.test.ts` "DNS pinning" describe (rebinding-resolver simulation: a later, different resolver answer never affects an already-pinned in-flight request; per-redirect-hop pinning uses each hop's own fresh address) |
| MEDIUM/HIGH #3 | The exactly-once crash matrix was proven only against a self-idempotent PUT fixture. The pending bookkeeping record used a DIFFERENT operationId (`key#pending`) than the real dedup key, so a genuine restart never saw it — kill-after-commit-before-record re-entered `compute()` and called `apply()` again; a duplicate was avoided only by the fixture's own idempotence, not by the pipeline. | `mutation-pipeline.ts` was rewritten to stop delegating to `@eo/journal`'s generic `IdempotencyRegistry.checkOrRecord` entirely. It now manages the full `pending → recorded/conflict/failed` state machine itself, directly over `journal.appendEntry`/`queryEntries`, using the SAME `operationId` (`plan.idempotencyKey`) for the pending write and every terminal write — "latest entry for this operationId" is the authoritative state. A restart that finds a `pending` (non-terminal) record NEVER blindly retries: only `handlers.reconcileAmbiguous` can turn it into `recorded`; absent it, the outcome is `blocked`/`ambiguous_write`. | New kill-harness fixtures replacing the old one: `deterministic-put-and-crash.mjs` (idempotent PUT, reconciles-by-retry) and `nonidempotent-post-and-crash.mjs` (a genuinely non-idempotent POST/create — MEDIUM/HIGH #3's own required case, with a marker-reconciliation `reconcileAmbiguous` hook modeling 18/20's own responsibility per `reconciliation.js`). `src/mutation-pipeline/mutation-pipeline.test.ts`'s crash-recovery describe block: kill-before/after for the deterministic fixture, kill-after for the non-idempotent fixture WITH reconciliation (never double-creates) and WITH reconciliation explicitly disabled (`EO_FIXTURE_NO_RECONCILE=1`, fails closed with `blocked`, never double-creates either). Plus new in-process unit tests: "restart finds a pending record" describe block (no-hook blocks; hook-resolves records; hook-cannot-resolve still blocks; hook-throws maps to failed) and "a prior TERMINAL record is never silently re-run" describe block. |
| MEDIUM #5 | No serialization of concurrent same-idempotencyKey mutations: `checkOrRecord` is documented by `@eo/journal` as unsafe for concurrent first-writers of the same operationId — two concurrent calls could both observe "no prior record" and both apply. | Added `IdempotencyKeyLock`, a thin wrapper reusing `WriteSerializer` (the same keyed-mutex primitive already proven for per-tenant+resource write ordering) keyed by `idempotencyKey` instead. `executeMutationPlan`'s entire query-then-decide-then-write critical section now runs inside `lock.runExclusive(idempotencyKey, ...)`. `mcp/native-registry.ts` constructs exactly ONE `IdempotencyKeyLock` instance, shared across every mutating tool call the registry serves (a fresh lock per call would defeat the purpose). | `src/mutation-pipeline/mutation-pipeline.test.ts`'s "MEDIUM #5: concurrent same-idempotencyKey serialization" test (two concurrent calls for the same key — exactly one real network call, the other replays); "mutating network I/O goes through GatewayHttpClient" describe's concurrent-different-keys test (proves the write-serializer keying is unaffected) |
| MEDIUM #4 | The SSRF IPv6 classifier waved through IPv4-mapped/embedded addresses: anything containing `:` that wasn't `::1`/`::`/`fc*`/`fd*`/`fe80:` was classified public — `::ffff:169.254.169.254` (mapped metadata), `::ffff:10.x`/`127.x`/`192.168.x`, hex-group forms (`::ffff:a9fe:a9fe`), and NAT64-embedded forms (`64:ff9b::a9fe:a9fe`) all passed. | `ssrf-guard.ts`'s `isPrivateOrReservedIp` now detects IPv4-mapped (dotted-quad and hex-group forms), IPv4-compatible, and NAT64-embedded IPv6 addresses, extracts the embedded IPv4, and re-runs the IPv4 private/reserved check against it. | `src/transport/ssrf-guard.test.ts`'s new `it.each` cases: `::ffff:169.254.169.254`, `::ffff:10.0.0.1`, `::ffff:127.0.0.1`, `::ffff:192.168.1.1`, `::ffff:a9fe:a9fe`, `64:ff9b::a9fe:a9fe`, `64:ff9b::10.0.0.1`, `::10.0.0.1` (all private), plus `::ffff:8.8.8.8`/`64:ff9b::8.8.8.8` (embedded-public stays public) |

**New files from this remediation pass:** `mcp/native-tools/mutation-apply-client.ts`,
`mcp/native-tools/mutation-apply-tool.ts` (+ its own test), `connection-store/connection-http-client.ts`
(+ its own test), `mutation-pipeline/kill-harness-fixtures/deterministic-put-and-crash.mjs`,
`mutation-pipeline/kill-harness-fixtures/nonidempotent-post-and-crash.mjs` (replacing the old,
single `apply-plan-and-crash.mjs` fixture, which modeled neither a real HTTP call nor a
non-idempotent action). `mutation-pipeline.ts`'s public API changed: `MutationPipelineHandlers`
now has `provider`/`buildRequest`/`parseResponse`/`verify`/`reconcileAmbiguous` (previously
`apply`/`verify`); `MutationPipelineDeps` now takes `httpClient`/`lock` instead of `idempotency`;
`pendingOperationId` was removed (no longer needed — pending and terminal records share one
operationId); `IdempotencyKeyLock` was added. Every caller (native-tools, tests) was updated
accordingly — no caller of the old shape remains.

## Exit-criteria → evidence map

| Exit criterion (roadmap/16-gateway-core.md) | Evidence |
| --- | --- |
| Exactly-once matrix on fakes: crash before/after remote commit, identical replay, changed-payload rejection, ambiguous POST reconciled or blocked — none produce a duplicate or silent overwrite | `src/mutation-pipeline/mutation-pipeline.test.ts` — "happy path" (recorded), "exactly-once semantics" (replayed byte-identical, changed-content conflict), "ambiguous write / verification failure / connector errors" (blocked/failed), "restart finds a pending record" and "a prior TERMINAL record is never silently re-run" (adversarial-review MEDIUM/HIGH #3 fix), "MEDIUM #5: concurrent same-idempotencyKey serialization", and the crash-recovery describe block reusing `@eo/journal`'s real `runKillHarness` against TWO fixtures: `kill-harness-fixtures/deterministic-put-and-crash.mjs` (idempotent PUT) and `kill-harness-fixtures/nonidempotent-post-and-crash.mjs` (a genuinely non-idempotent POST/create, with and without marker-reconciliation available — see the adversarial-review remediation table above) |
| SSRF suite: foreign-origin/private-IP redirects refused pre-credentials; custom CA honored against a disposable self-signed server | `src/transport/ssrf-guard.test.ts` (unit + fast-check property tests, incl. adversarial-review MEDIUM #4's IPv4-mapped/NAT64-embedded-IPv6 cases), `src/transport/http-client.test.ts` ("redirect revalidation" describe block: foreign-origin refused, private-IP-via-redirect refused, max-hop bound; "DNS pinning" describe block, adversarial-review HIGH #1 fix), `src/transport/http-transport.test.ts` ("HTTPS custom CA" describe: succeeds with the matching CA against a real `openssl`-generated disposable self-signed server, fails without it; "DNS pinning" describe: real dial-by-pinned-IP proof) |
| Retry ladder proven per verb (GET free, PUT/PATCH deterministic+precondition, POST never blind, 409/412 fetch-rebase-or-block); per-resource write order preserved under concurrency | `src/transport/retry-ladder.test.ts` (full decision-table + fast-check properties), `src/transport/http-client.test.ts` ("retry ladder + backoff" describe), `src/transport/write-serializer.test.ts` + `http-client.test.ts` ("concurrency + write serialization" describe: same tenant+resource preserves submission order, different keys run concurrently, tenant boundary respected) |
| Budgets enforced (32 KiB item / 256 KiB result, typed truncation errors); pagination memory stays O(page) on a 10k-item fake | `src/transport/budgets.test.ts` (incl. UTF-8 byte-length-not-string-length case), `src/transport/pagination.test.ts` + `src/testkit/fake-paginated-source.ts` (committed 10k-item fixture builder) + `src/testkit/fault-matrix.test.ts`'s "O(page) on a 10k-item fake" test (max observed page length never exceeds the page size across 10,000 items) |
| Leak hunt: no raw provider body in any error, log, or artifact (live substring search) | `src/security/leak-hunt.test.ts` — plants a distinctive secret marker inside `rawProviderResponse` at every surface (canonical-error mapping, native tool-registry dispatch, mutation-pipeline failure + its journaled entries) and recursively greps every observable output string for it; `src/mutation-pipeline/error-mapping.test.ts` and `src/mcp/native-registry.test.ts` carry additional targeted leak assertions |
| `gateway mcp` lists exactly this phase's native tool set over stdio to a stub MCP client, and accepts one externally-registered tool with no name collision | `src/mcp/server.test.ts` — real child-process stdio boot (`src/mcp/test-support/stdio-boot-fixture.mjs`, using this package's own exported `buildGatewayMcpServer`/`connectGatewayMcpServer`) to a real `@modelcontextprotocol/sdk` `Client`: exact 18-name tool-set listing, the extra-tool-registration test, and a real `callTool` round-trip (success and `isError` cases); `src/mcp/native-registry.test.ts`'s "registers exactly the 18 native tool names" test is the in-process companion |
| No `change_set.*` or `learning.*` name is ever registered | `src/mcp/native-registry.test.ts`'s "never registers a change_set.\* or learning.\* tool name" test (scans the live registry's own `toolNames`) |
| Every SDK server registration and wire-level tool name references `GATEWAY_MCP_SERVER_NAME` — zero hand-typed literals | `src/mcp/gateway-name-reference.test.ts` — package-local recursive scan over every `.ts`/`.mjs` file under `src/`, mirroring `packages/engine-claude`'s own instantiation of this proof; the repo-wide `packages/contracts/src/gateway/server-name.test.ts` scanner also passes with zero `packages/gateway` violations (verified directly — see Deviations) |
| Provider-dispatch point resolves to the correct provider-specific client per registered provider; unrecognized provider rejected before any network call | `src/provider-dispatch/provider-registry.test.ts` (resolve/duplicate/unknown), `src/mcp/native-registry.test.ts` ("dispatches tracker.search end-to-end", "unknown connectionId", "unregistered provider", "operation not implemented" tests) |
| Connection-doctor reachability probe (incl. custom-CA validation) succeeds against a disposable fixture connection and fails informatively against an unreachable one | `src/connection-doctor/reachability-probe.test.ts` — succeeds with custom CA against a real disposable HTTPS fixture server, fails without the CA, fails against an unreachable target, fails informatively on secret-resolution/CA-read errors, reports `reachable:false` for a 5xx, and exercises the default (non-overridden) client builder too |
| When the optional upstream-MCP-client wrap is enabled for a fixture connection, no additional MCP server ever appears in a simulated worker's `mcpServers` config | `src/mcp/upstream-mcp-client-policy.test.ts` — the simulated worker `mcpServers` builder takes no policy argument at all (the structural proof); enabling the flag for a fixture connection is asserted to change nothing about the resulting key set, which is always exactly `[GATEWAY_MCP_SERVER_NAME]` |
| Security review sign-off recorded against `docs/threat-model.md` | See "Security review" section below — this package could not edit `docs/threat-model.md` itself (outside this phase's permitted file scope for this task run); the review was performed and is recorded here, with the actual doc edit flagged as a carry-forward item |

## Work-item → module map

| Work item | Modules |
| --- | --- |
| 1. Connection store + secret-reference resolution | `src/secrets/secret-reference-resolver.ts`, `src/connection-store/external-connection-store.ts` |
| 2. HTTP client wrapper + full security/throttle/serialization stack | `src/transport/{ssrf-guard,retry-ladder,backoff,write-serializer,pagination,n-plus-one-detector,budgets,dns-resolve,http-transport,http-client}.ts` |
| 3. `CapabilitySnapshot` cache + invalidation | `src/capability-snapshot/capability-snapshot-cache.ts` |
| 4. Mutation pipeline + reconciliation + canonical-error mapping + budgets | `src/mutation-pipeline/{mutation-pipeline,reconciliation,error-mapping}.ts` |
| 5. `eo_gateway`-named MCP server + extensible tool-registration API + provider-dispatch | `src/mcp/{tool-registry,server,native-registry,uds-forward-client,upstream-mcp-client-policy}.ts`, `src/mcp/native-tools/*.ts`, `src/provider-dispatch/provider-registry.ts`, `src/connection-doctor/reachability-probe.ts` |
| 6. Fake providers (testkit) + fault matrix | `src/testkit/*.ts` |

## Security review (against `docs/threat-model.md` §5 "Gateway")

`docs/threat-model.md` §5 (produced by phase 02, read-only for this task run — see Deviations)
already names the STRIDE threats this implementation must mitigate. Cross-checked against the
actual `packages/gateway` implementation:

- **Spoofing** — TLS + redirect revalidation before credentials attach: `transport/http-client.ts`'s
  `#preflight`/`#revalidateRedirect`, proven by `http-client.test.ts` and the fast-check properties
  in `ssrf-guard.test.ts`. Residual risk the threat model itself already names (optional
  upstream-MCP-client wrap, 12's quarantine question) is unchanged by this implementation — the
  flag is modeled but this phase's own exit criteria don't exercise it against a real upstream
  server, matching the roadmap file's own stated scope.
- **Tampering** — exactly-once pipeline (`mutation-pipeline.ts`) proven by the crash matrix above;
  retry ladder verb rules (`retry-ladder.ts`) proven per-verb; marker-reconciliation
  (`reconciliation.ts`) fails closed (`blocked`/`ambiguous_write`), never guesses.
  **Superseded design note:** an earlier revision of this file used a namespaced `operationId`
  (`${idempotencyKey}#pending`) for the pre-I/O bookkeeping write, distinct from the real dedup
  key, specifically to avoid colliding with `@eo/journal`'s generic `IdempotencyRegistry`'s own
  first-writer-wins index. Independent adversarial review (2026-07-24) correctly identified that
  this made the pending write invisible to a genuine restart's own dedup check — a
  kill-after-remote-commit-before-record crash would re-enter `compute()` and re-apply, with a
  duplicate avoided only by the test fixture's own happenstance idempotence, not by the pipeline
  itself (finding MEDIUM/HIGH #3). The fix, current as of this revision: `mutation-pipeline.ts` no
  longer uses `IdempotencyRegistry` at all — it owns the full `pending → recorded/conflict/failed`
  state machine directly over the journal, using the SAME `operationId` throughout, so a restart
  correctly detects an in-flight prior attempt and routes it through `reconcileAmbiguous` (never a
  blind retry) rather than silently reinterpreting it as brand-new. Also fixed alongside: MEDIUM
  #5 (concurrent same-key calls now serialize via `IdempotencyKeyLock`) and HIGH #2 (this
  pipeline is now the sole issuer of the mutation's network I/O, via `GatewayHttpClient`, so every
  mutating MCP tool inherits the SSRF guard and write-serializer, not just the read tools). See
  the "Adversarial-review remediation" section above for the full account.
- **Repudiation** — every `RemoteOperationRecord` journals against `remote_operation_record`
  before I/O (`mutation-pipeline.ts`); `evidence.attach`/`result.submit` durably journal via
  `evidence_pointer` (`native-tools/evidence-tools.ts`, `result-tools.ts`).
- **Information disclosure** — canonical-error redaction (`error-mapping.ts`, inherited from
  `@eo/contracts`'s `ConnectorError`) proven never to leak `rawProviderResponse`; 32 KiB/256 KiB
  budgets (`budgets.ts`) enforced with typed truncation errors; the leak-hunt test above is the
  live substring search the threat model's own mitigation text names verbatim.
- **Denial of service** — ≤4 in-flight per connection (`ConcurrencyGate` in `http-client.ts`),
  Retry-After + jittered bounded backoff (`backoff.ts`), per-tenant+resource write serialization
  (`write-serializer.ts`), O(page) pagination + N+1 detection (`pagination.ts`,
  `n-plus-one-detector.ts`).
- **Elevation of privilege** — every mutating tool requires a validated `RemoteMutationPlan`
  (run ID/idempotency key/expected revision/envelope reference are all schema-required fields on
  `@eo/contracts`'s `RemoteMutationPlanSchema`, unchanged here); an unrecognized provider or a
  missing connection is rejected before any network call (`provider-dispatch-tool.ts`).

**Sign-off:** the implementation in `packages/gateway` is reviewed against `docs/threat-model.md`
§5's mitigation text above and found consistent with it, with no new residual risk beyond what
that document already names. **Not done in this session:** editing `docs/threat-model.md` itself
to record this sign-off inline (e.g. a "reviewed against implementation, 2026-07-24" note) — this
task's permitted file scope for this run is `packages/gateway/` and `docs/evidence/phase-16/`
only; the orchestrator should apply that doc edit directly, or authorize a follow-up.

## Deviations, carry-forward gaps, and cross-phase notes

1. **`@modelcontextprotocol/sdk` added as a direct dependency of `packages/gateway`, but
   `package-lock.json` was not regenerated.** The package (v1.29.0) is already physically present
   in the repo's `node_modules` tree (a transitive dependency of `@anthropic-ai/claude-agent-sdk`,
   which `packages/engine-claude` already depends on), so `tsc -b`/`vitest` resolve it correctly
   without an `npm install`. `packages/gateway/package.json` now declares it (and `@eo/contracts`,
   `@eo/journal`, `zod` as dependencies; `@eo/testkit`, `fast-check` as devDependencies) for
   correctness, but running `npm install` to regenerate `package-lock.json` would touch a root
   file outside this task's permitted scope — flagged for the orchestrator to run once, after
   which this note can be deleted.
2. **`packages/gateway/tsconfig.json`** gained `"types": ["node"]` and project references to
   `../contracts`, `../journal`, `../testkit` (the last for test-only fixture imports) — both
   necessary for `tsc -b` to resolve `node:*` core-module types and the cross-package imports;
   no root-level tsconfig file was touched (`tsconfig.json` at the repo root already referenced
   `./packages/gateway`, unchanged).
3. **UDS forward client (`mcp/uds-forward-client.ts`) reimplements a small, compatible ndjson
   handshake/request/response client rather than importing one from `@eo/supervisor`.**
   `packages/supervisor/src/index.ts` is `export {}` — its protocol/codec modules are not part of
   its public barrel and are unreachable via `@eo/supervisor`'s own `package.json` `exports` map
   (no subpath entries). This is a genuine, unavoidable duplication until 05 (or 23's final wiring
   pass) exports a shared client — exactly the kind of gap `16-gateway-core.md`'s own Risks section
   already anticipates ("this phase settles it by exporting its server/registry as a plain
   importable module... an ordinary npm-workspace import"). Proven compatible against a real,
   from-scratch fake UDS peer speaking the identical wire shape (`mcp/uds-forward-client.test.ts`,
   `mcp/native-tools/run-forward-tools.test.ts`) — never against `@eo/supervisor`'s own internals,
   since those aren't importable. **Carry-forward for 09/23:** wire the real resolved supervisor
   socket path into this phase's `NativeRegistryDeps.supervisorSocketPath` at actual CLI-boot time
   (this phase's own exit criteria don't require resolving `@eo/journal`'s XDG state-root
   convention itself — that's accepted as the caller's job, matching how `supervisorSocketPath` is
   threaded as a plain constructor parameter here, never re-derived).
4. **Optional upstream-MCP-client-wrap flag modeled as this phase's own out-of-band policy store**
   (`mcp/upstream-mcp-client-policy.ts`), not as a new field on `@eo/contracts`'s
   `ExternalConnectionSchema` (out of this phase's authority to extend without a coordinated ledger
   change). `16-gateway-core.md`'s own Out-of-scope text already flags that this flag "lives in the
   `ExternalConnection` config 18/20 populate (or a human operator sets)" without settling exactly
   how — this session's `UpstreamMcpClientPolicyStore` is a documented placeholder pending that
   future coordinated schema addition, not a unilateral resolution of it.
5. **`result.submit`'s durable shape** is modeled as an `EvidenceRecord`-shaped `evidence_pointer`
   journal entry tagged `gateTag: "result.submit"` (`mcp/native-tools/result-tools.ts`) — the
   closed 13-member `JournalEntryType` union has no dedicated "worker result" member, and the
   roadmap file's own Risks section leaves the deeper supervisor-side artifact-store relationship
   (13's own flagged question) explicitly open, not required by this phase's exit criteria.
6. **Provider-dispatch client shape** (`mcp/native-tools/provider-dispatch-tool.ts`'s
   `GenericProviderClient`, a `Record<string, (params) => Promise<unknown>>` keyed by camelCase
   operation name) is this phase's own minimal-sufficient design for the extension point 18's
   `JiraResourceClient` and 20's `GrafanaProviderAdapter` register into — the roadmap file
   describes the existence of the extension point, not a mandated client interface shape; 18/20
   should treat this as a starting contract, adjustable by coordinated agreement if their own
   resource-client shapes need more structure (e.g. typed per-operation params/results) than the
   opaque `Record<string, unknown>` params/return this phase uses.
7. **Pre-existing, unrelated failures observed in the full-repo test run, not caused by this
   phase:** `npx tsc -b` (full repo, no path filter) fails on a pre-existing `packages/cli`
   error (`src/doctor/run-doctor.ts(15,1): TS6192 all imports unused`) — `packages/cli` was
   already dirty/in-progress in git status before this session started and is outside this
   phase's permitted file scope. `npx vitest run` (full repo) shows 3 pre-existing failures, all
   in `packages/cli` and `packages/contracts`: `packages/contracts/src/gateway/server-name.test.ts`
   fails because `packages/cli/src/commands/help.ts` and `packages/cli/src/gateway-mcp/stdio-server.ts`
   already hand-type the `eo_gateway` literal (a pre-existing Gap-11 violation in `packages/cli`,
   not `packages/gateway` — confirmed by running that scanner directly, see its own failure
   output), and two `packages/cli` `run-doctor.test.ts` tests fail with a real-environment
   `EINVAL` binding a UDS socket path that's too long for this sandbox. **`packages/gateway`
   itself builds clean in isolation (`npx tsc -b packages/gateway` — exit 0) and every one of its
   234 tests passes** (`vitest-run.txt`); these three failures and the CLI build error are flagged
   for whoever is concurrently landing phase 09, not fixed here (out of this task's file scope).
8. **`docs/threat-model.md` review sign-off recorded as evidence here, not as a doc edit** — see
   the "Security review" section above.
