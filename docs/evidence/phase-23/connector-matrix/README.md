# Phase 23, work item 6 — neutral-communication + connector-security + exactly-once matrix

**Pre-rename names — annotated 2026-08-02, not rewritten.** This file was written before
`3e74cc7` (2026-07-26) renamed the project from `engineering-orchestrator` to `crabgic`, so
the names in it were the real ones when it was captured. This is an evidence file: the
original text stays verbatim and the mapping lives here. Read `@eo/x` as `@crabgic/x`; read
the product / binary / cache-path segment `engineering-orchestrator` as `crabgic`; and read
the gateway MCP server literal `eo_gateway` as `crabgic_gateway`, which is what
`GATEWAY_MCP_SERVER_NAME` holds today (`packages/contracts/src/gateway/server-name.ts:26`).
Nothing else about the citations changed — the modules, paths and tests they name are the
same ones. Two reading rules follow. Quotations keep their old names verbatim, because a
quotation records what its source said, not what is true now. And where this file asserts the
_absence_ of a hand-typed server literal (interface-ledger Gap 11), it asserts it about the
constant's value at the time; that rule is unchanged and the scan targets `"crabgic_gateway"`
today (`docs/evidence/phase-02/closeout-c8-gateway-literal-scan.txt`).

Harness: `e2e/matrix/connector/` (self-contained project: own `tsconfig.json` +
`vitest.config.ts`, mirroring `e2e/provisioning/`'s own convention — not wired
into the root `vitest.config.ts`/`tsconfig.json`).

Run it directly with:

```
npm run build   # packages/* must be built first — this harness imports
                 # @eo/gateway, @eo/renderer, @eo/connectors-jira,
                 # @eo/connectors-grafana, @eo/journal, @eo/contracts,
                 # @eo/testkit from their built dist/ output, exactly like
                 # any other cross-package import in this repo
npx vitest run --config e2e/matrix/connector/vitest.config.ts
```

## Result

- **15 test files, 91 tests, all passing.**
- **100% line/branch/function/statement coverage** on the harness's own
  logic (`src/support/evidence.ts`, `src/support/fixtures.ts` — the only
  files this project's own `vitest.config.ts` counts toward its coverage
  gate; scenario `*.test.ts` files and the crash-recovery `.mjs` kill-harness
  fixtures are exempted from the denominator, mirroring
  `e2e/provisioning/vitest.config.ts`'s own precedent for its `src/live/**`).
- `tsc -p e2e/matrix/connector/tsconfig.json --noEmit`: clean
  (`tsc-clean.txt`).
- `eslint e2e/matrix/connector`: clean (`eslint-clean.txt`).
- `prettier --check e2e/matrix/connector`: clean (`prettier-clean.txt`).
- No literal `eo_gateway` string anywhere in this project (Gap-11).

Full run transcript: `vitest-run.txt`.

## Fail-first (RED → GREEN), both required vectors

Per work item 6's own instruction, both seeded fixtures were proven to make
the harness genuinely FAIL before the real guard's assertion was restored:

- **Confusable-domain fixture** — `fail-first-confusable-domain-RED-then-GREEN.txt`:
  a naive denylist check (the kind of shortcut this harness exists to prove
  inadequate) is fed the seeded Cyrillic-`а` `pаypal.com` homograph fixture
  and is shown to wrongly pass it clean; the real `@eo/renderer` `lint()`
  pipeline is then asserted against the same fixture and genuinely rejects
  it via the `unicode-defense` stage. The RED probe is preserved permanently
  in `src/neutral-communication/confusable-domain.test.ts`'s own
  `describe("RED (fail-first, kept permanently)...")` block — it is not a
  one-off dev step then discarded; it is a standing regression pin.
- **Replay-with-changed-payload fixture** — `fail-first-replay-changed-payload-RED-then-GREEN.txt`:
  the naive "silently accept as a fresh `recorded` apply" expectation is
  shown to genuinely fail against the real `executeMutationPlan` pipeline
  (it actually returns `"conflict"`); the real, correct assertion
  (`status === "conflict"`, `errorKind === "conflict"`, zero additional
  network calls) is then restored and passes. The RED probe is likewise
  preserved permanently in
  `src/exactly-once/replay-changed-payload.test.ts`'s own
  `describe("RED (fail-first, kept permanently)...")` block.

## What runs against real cassettes/pipeline vs. modeled

| Scenario file | Real subsystem driven | Fixture kind |
|---|---|---|
| `neutral-communication/artifact-corpus.test.ts` | `@eo/renderer` `lint()` + all 5 templates | golden fixtures + property (randomized-but-structurally-valid content via the real templates) |
| `neutral-communication/confusable-domain.test.ts` | `@eo/renderer` `lint()` (`unicode-defense` stage) | seeded synthetic confusable-domain fixture |
| `neutral-communication/secret-leakage.test.ts` | `@eo/renderer` `lint()` (`secret-scan`) **+** `@eo/connectors-jira` apply-boundary guard (`assertSafeAdfDocument`/`containsSecretShapedContent`, via `createJiraMutationApplyClient(...).buildRequest`) | synthetic secret sentinels, defense-in-depth at two independent real layers |
| `connector-security/exact-origin-and-redirects.test.ts` | `@eo/gateway` `GatewayHttpClient`, `buildAllowlistForConnection`, `buildHttpClientForConnection` | synthetic `ExternalConnection` fixtures (`@eo/testkit`) |
| `connector-security/custom-ca.test.ts` | `@eo/gateway` `resolveCustomCaPem`/`buildHttpClientForConnection` | synthetic, non-secret PEM-shaped fixture on disk |
| `connector-security/ssrf-and-dns-rebind.test.ts` | `@eo/gateway` `GatewayHttpClient`, `checkResolvedAddress`, `isPrivateOrReservedIp` | private/reserved IPv4, IPv4-mapped IPv6, simulated DNS-rebind resolver |
| `connector-security/tenant-boundary.test.ts` | `@eo/connectors-grafana` `checkGrafanaConnectionDoctor` | org-allowlist fixtures |
| `connector-security/error-redaction.test.ts` | `@eo/gateway` `mapHttpStatusToConnectorError`/`mapUnknownErrorToConnectorError` + `@eo/contracts` `ConnectorError` | synthetic secret marker in a raw provider response (mirrors `packages/gateway/src/security/leak-hunt.test.ts`'s own technique) |
| `connector-security/forged-delete-admin-and-raw-tool-denial.test.ts` | `@eo/connectors-jira` `assertAllowedJiraOperation`/`isJiraAction`; `@eo/connectors-grafana` `createGrafanaProviderAdapter`; the REAL gateway MCP tool registry booted over stdio via the exact same fixture `packages/gateway/src/mcp/server.test.ts` itself spawns | forged action/tool-name lists |
| `exactly-once/replay-changed-payload.test.ts` | `@eo/gateway` `executeMutationPlan` | synthetic plan fixtures |
| `exactly-once/ambiguous-reconciliation.test.ts` | `@eo/gateway` `executeMutationPlan` + `reconcileAmbiguousPost` | synthetic marker-index fixture |
| `exactly-once/crash-recovery.test.ts` | `@eo/journal` `runKillHarness` driving two new `.mjs` fixtures that themselves drive real `executeMutationPlan`(+`reconcileAmbiguousPost`) | real child-process kill/recovery, not simulated |
| `exactly-once/jira-cassette-readback.test.ts` | `@eo/connectors-jira` `runScriptedReadScenario`/`runDatacenterScriptedReadScenario` (real `JiraResourceClient`, Cloud + DC) | **real, already-recorded cassettes** — Cloud (`src/testkit/fixtures/read-scenario.cassette.json`) and DC 10.3/11.3 (`fixtures/datacenter/{10.3,11.3}/read-scenario.cassette.json`) |
| `exactly-once/grafana-cassette.test.ts` | `@eo/connectors-grafana` `createGrafanaMutationApplyClient` + `buildGrafanaMutationPlan`, through the real `executeMutationPlan` | **real, already-recorded annotation cassette** (`fixtures/cassettes.ts`'s own `buildKindCreateCassette`) |

Nothing in this harness re-implements the mutation pipeline, the SSRF
guard, the lint pipeline, or any connector's resource/apply client — every
scenario calls the real, already-built `@eo/*` package function directly.

## Jira Data Center — CASSETTE-ONLY confirmation

Per the owner's explicit phase-23 decision (see the work-item brief): Jira
DC 10.3/11.3 live-container conformance is **cassette-only** for this pass.
`exactly-once/jira-cassette-readback.test.ts`'s `describe("Jira Data
Center — CASSETTE-ONLY evidence...")` block drives the real DC
`JiraResourceClient` (REST v2 + Agile) against phase-19's own recorded DC
cassettes and emits an `EvidenceRecord` whose `command` text states
`evidenceSource: "cassette-only"` explicitly. No DC container is started,
booted, or required anywhere in this harness.

## Gate tag

Every scenario's assertions, once green, emit one `EvidenceRecord`
(`@eo/contracts`) via `src/support/evidence.ts`'s `emitScenarioEvidence`,
journaled as a real `evidence_pointer` entry (`@eo/journal`) with
`gateTag: "release-gate:connector-matrix"` — see
`CONNECTOR_MATRIX_GATE_TAG` in `e2e/matrix/connector/src/support/evidence.ts`.
`objectId` defaults to this checkout's own `git rev-parse HEAD` (or
`$EO_RELEASE_CANDIDATE_OBJECT_ID` when set), matching `e2e/report`'s own CLI
convention. This tag is a NEW, phase-23-owned vocabulary item, distinct from
(additional to) `e2e/report/src/checklist.ts`'s existing 15
`release-gate:<slug>` tags — reconciling the checklist to also accept this
tag for the relevant exit-criteria items (most directly
`jira-grafana-exactly-once`) is carried forward to whichever worker owns
`e2e/report/src/checklist.ts` next, since this work item's own constraints
confine its edits to `e2e/matrix/connector/` + this evidence subsection.

## Discovered gap (documented, not patched)

`@eo/connectors-jira`'s exported `loadReadScenarioCassette`/
`loadDatacenterReadScenarioCassette` (`packages/connectors-jira/src/testkit/
scripted-read-scenario{,-dc}.ts`) resolve their cassette JSON path relative
to `import.meta.url`. That is correct when connectors-jira's own test suite
runs (vitest transforms its `.ts` source directly, so `import.meta.url`
stays under `src/`), but breaks for a genuine cross-package consumer: this
harness imports `@eo/connectors-jira` from its **built** `dist/` output
(this repo's own npm-workspace convention), and `tsc -b` never copies
non-`.ts` assets (the cassette `.json` files) into `dist/` — the loader
throws `ENOENT` there (confirmed: `packages/connectors-jira/dist/testkit/
fixtures/read-scenario.cassette.json` does not exist after a normal
`npm run build`).

Worked around, entirely within this harness's own confined scope (no edit
to `packages/connectors-jira`): `exactly-once/jira-cassette-readback.test.ts`
reads the exact same fixture bytes directly from their known **source**
path instead of calling the broken loader. The cassette DATA and the real
`runScriptedReadScenario`/`runDatacenterScriptedReadScenario` DRIVER (the
actual `JiraResourceClient` read path) are still 100% real and reused —
only the two broken loader *functions* are bypassed. A future worker
touching `packages/connectors-jira`'s own build should either copy
`fixtures/**/*.json` into `dist/` as a build step, or have these loaders
resolve against a path that survives compilation.

## Test count + coverage (verbatim from `vitest-run.txt`)

```
Test Files  15 passed (15)
     Tests  91 passed (91)

Statements   : 100% ( 26/26 )
Branches     : 100% ( 10/10 )
Functions    : 100% ( 5/5 )
Lines        : 100% ( 25/25 )
```
