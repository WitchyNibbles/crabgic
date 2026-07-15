# Phase 03 — EngineAdapter contract, envelope compiler, fake engine

| | |
|---|---|
| **Depends on** | 00, 02 |
| **Unlocks** | 05 (fake-engine reuse in 05's pre-06 worker-lifecycle tests — formalized, `P03 --> P05`), 06 |
| **Sources** | adaptation §1 (EngineAdapter), §4.1–§4.2, §5.1, §9 (envelope-conformance test-matrix), Appendix B (`mcp__*` deny footgun); `docs/engine-baseline.md` (phase 00 output) |
| **Primary package** | `packages/engine-core`, `packages/testkit` (fake engine) |

## Goal

Before this phase, nothing in the codebase can be exercised against engine-shaped behavior: there is no typed contract for spawning a worker, no function that turns an `AuthorizationEnvelope` into the confinement artifacts a worker process actually needs, and no way to test any of it without a licensed `claude` binary. When this phase is done: a frozen `EngineAdapter` interface exists in `packages/engine-core`; a pure, property-tested `compileEnvelope` function turns any `AuthorizationEnvelope` into a permission profile, a sandbox profile, and the two serializations a worker needs (`--settings`-file JSON and mirrored SDK options); and a scriptable fake engine in `packages/testkit` implements `EngineAdapter` well enough that phase 06 — and every phase after it — runs its test suite with zero engine installed. Phase 06 inherits a frozen capability tuple and byte-stable golden artifacts to implement against and diff for drift.

## In scope

- **`EngineAdapter` interface** (`packages/engine-core`, scaffolded empty by 01 — Gap 3; this phase is its first implementation): `spawn(packet, profile, adjudicate) → WorkerHandle`, `resume(sessionRef, adjudicate) → WorkerHandle` (`SessionRef` scoped to a project directory and its worktrees, adaptation §4.5), `cancel(handle, deadline)`, `capabilities()` returning exactly `supportsJsonSchema`, `supportsSessionResume`, `permissionModel`, `sandboxModel`, `engineVersion` (Gap 7 — retires this phase's earlier `structuredOutput`/`sessionResume` draft names), and a typed `EngineEvent` stream: `init | assistant | toolUse | result | retry | limitSignal`. `AdjudicationCallback` is the hook-slot type `spawn`/`resume` invoke per tool call — this phase defines the call shape only; the policy that answers it is supervisor-owned (05 stubs it, 06 wires it for real).
- **Envelope compiler** — pure function `compileEnvelope(envelope: AuthorizationEnvelope) → CompiledWorkerProfile`:
  - → permission profile: `defaultMode: "dontAsk"`, `disableBypassPermissionsMode: "disable"`; allows from owned paths (`Edit(//…/**)`, `Write(//…/**)`) and the doc-confirmed command-prefix literals — `Bash(npm run test:*)`, `Bash(npm run build:*)`, `Bash(git status:*)`, `Bash(git diff:*)` — no space before the colon, per adaptation Appendix B; the word-boundary rule (§4.1, illustrated only via the unrelated bare-`*` form `Bash(ls *)`) is a separate mechanism, not stretched to justify a third, unverified colon-spacing notation (Gap 12); the mandatory `mcp__${GATEWAY_MCP_SERVER_NAME}__*` allow entry is derived programmatically from `GATEWAY_MCP_SERVER_NAME` (constant, 02; value `"eo_gateway"`), never hand-typed a fourth literal (Gap 11); mandatory denies `Agent`, `WebFetch`, `WebSearch`, `Bash(git push:*)`, `Bash(curl:*)`, `Bash(wget:*)`, plus control-repo/journal/credential paths.
  - → sandbox profile (§4.2): write = worktree+tmp; `denyRead` control repo, journal, `~/.ssh`, `~/.aws`; `network.allowedDomains` only from the envelope; `allowUnixSockets: true`; `failIfUnavailable: true`; `credentials.envVars` mask entries.
  - → `WorkerSettingsJson` (the `--settings <file>` shape) and mirrored `WorkerSdkOptions` (the Agent SDK `query()` options subset: `allowedTools`/`disallowedTools`, `permissionMode`, `settingSources: []`, `strictMcpConfig: true`, `mcpServers` keyed `GATEWAY_MCP_SERVER_NAME`) — one compiled decision, two serializations.
  - **Footguns as tests:** never emit a blanket `mcp__*` deny (deny beats the gateway allow, per Appendix B's own warning); single-server exposure via `strictMcpConfig` instead; `//` vs `~/` vs bare `/` path-anchor forms; compound-command (`&&`/`||`/`;`/`|`) and process-wrapper (`nohup`/`timeout`/`nice`) smuggling coverage.
- **Fake engine** (`packages/testkit`, scaffolded empty by 01): implements `EngineAdapter`; replays scripted tool-call traces (seeded from 00's `spikes/fixtures/`) through a `CompiledWorkerProfile` and the caller-supplied `AdjudicationCallback`; emits the identical `EngineEvent` stream a real adapter would; injectable failures — crash, `limitSignal`, schema-violating result (matching 00's recorded structured-output-violation probe shape), hang/timeout.
- **Envelope-conformance fixture format**: per-envelope scripted traces plus the expected allow/deny verdict at each of layers 2–4 (permissions, adjudication+journal, sandbox — adaptation §5.1/§9), each layer assertable independently by disabling the others; reused byte-identical by 06's `@live` suite.
- **Golden settings artifacts** for three canonical envelopes (read-only, standard implementation, network-granted) — the committed, byte-stable compiler output 06 diffs the real engine's behavior against.

## Out of scope

- The real SDK-backed `EngineAdapter` implementation, subscription-auth token injection, and the live version gate — all 06 (`packages/engine-claude`).
- The adjudication *decision logic* — what actually allows or denies a given tool call at runtime. This phase defines only the `AdjudicationCallback` shape the adapter invokes; the policy that answers it is 05 (stub) / 06 (real, journal-first).
- Gateway MCP tool implementations and the `eo_gateway` tool registry itself — 16.
- The `GATEWAY_MCP_SERVER_NAME` constant and the `AuthorizationEnvelope`/`TaskPacket`/`WorkerResult`/`JournalEntryType` schemas themselves — owned by 02; this phase only consumes and derives from them.
- Actual journal writes for `session_assignment`/`adjudication_decision` entries — 04 owns the journal mechanics; 05/06 own calling it. This phase's adapter-responsibility doc only names which `JournalEntryType` member belongs at which lifecycle point.
- Scheduling, limit-parking policy, and mapping a `limitSignal` event onto `WorkUnitAttemptStatus: parked:rate_limit` — 13.
- Manager-side subagent isolation (`isolation: worktree` exploration agents) — 10/11; those run under the manager's own interactive permissions, never a compiled worker profile.

## Interfaces produced

From `packages/engine-core` (scaffolded empty by 01; first populated here — Gap 3, header no longer says "new"):

- **`EngineAdapter` interface** (`spawn`, `resume`, `cancel`, `capabilities()`, typed `EngineEvent` stream) — formal consumer is **06**, the only phase with 03 in `Depends on`; 06 implements it as `packages/engine-claude` and is itself the surface 10/11/13/23 rely on downstream (none of them import `packages/engine-core` directly).
- **`EngineCapabilities`** (`capabilities()`'s return type) — exactly `supportsJsonSchema`, `supportsSessionResume`, `permissionModel`, `sandboxModel`, `engineVersion` (Gap 7). Consumed by 06 (implements it) and cited verbatim by 23's release-gate re-run (`EngineAdapter.capabilities()` row, 23 §Interfaces consumed).
- **`WorkerHandle`, `SessionRef`, `AdjudicationCallback`** — the call-shape types `spawn`/`resume` use. Consumed by 06's real implementation and by this phase's own fake engine.
- **`compileEnvelope(envelope) → CompiledWorkerProfile`** (pure function) and its two output shapes, **`WorkerSettingsJson`** and **`WorkerSdkOptions`** — consumed by 06 to assemble the real `query()` call, and by this phase's fake engine to decide which scripted tool calls are allowed.

From `packages/testkit` (scaffolded empty by 01; this phase adds the fake engine — 02 already contributes fixture builders, 16 later adds fake providers):

- **Fake engine** implementing `EngineAdapter` — formal consumer 06 ("fake vs live parity: identical fixture verdicts," 06's own exit criteria). Also exercised directly by 05's own pre-06 worker-lifecycle tests per 05's own text ("spawn via EngineAdapter (fake engine until 06)," 05 §In scope) — now a formal dependency: 05's header lists 03, and the README graph carries a `P03 --> P05` edge (see Risks).
- **Envelope-conformance fixture format** (per-envelope scripted trace + expected per-layer verdict) — reused byte-identical by 06's `@live` suite (adaptation §9) and re-executed by 23 against the release-candidate object ID ("envelope-conformance fixture format," 23 §Interfaces consumed).
- **Golden settings artifacts** for the three canonical envelopes — diffed by 06 for real-engine drift and re-diffed by 23 at release ("golden settings artifacts," 23 §Interfaces consumed).

Nothing in this phase is consumed by 09: the doctor's version/hermeticity/sandbox self-tests (09 §In scope) are direct engine probes owned by 06's live conformance suite, not imports of `packages/engine-core`.

## Interfaces consumed

From **00** (`docs/engine-baseline.md`, `spikes/fixtures/`):

- Recorded permission-probe verdicts — deny-wins-over-allow (same-level and cross-level), compound-command smuggling denied, process-wrapper smuggling denied — the compiler's footgun tests assert exactly these recorded outcomes.
- The four doc-confirmed `Bash(...)` command-prefix literals, plus the Gap-12 Bash-colon-spacing probe verdict once 00 records it — gates whether the compiler may ever generalize past those four literals.
- `spikes/fixtures/` stream-json transcripts (init/assistant/result/api_retry) — seed data for the fake engine's scripted traces.
- The structured-output probe's recorded schema-violation behavior — shapes the fake engine's "schema-violating result" failure injection.

From **02** (`packages/contracts`):

- `AuthorizationEnvelope` schema — sole input to `compileEnvelope`.
- `TaskPacket` schema — type of `EngineAdapter.spawn()`'s first parameter (02 owns the schema; 13 builds instances; this phase only consumes the type).
- `WorkerResult` schema — the shape the fake engine's normal-path result conforms to, and deliberately violates for schema-violation failure injection.
- `GATEWAY_MCP_SERVER_NAME` constant (value `"eo_gateway"`) — the compiler derives the mandatory `mcp__${GATEWAY_MCP_SERVER_NAME}__*` allow entry from this instead of hand-typing a fourth literal (Gap 11).
- `JournalEntryType`'s `session_assignment` and `adjudication_decision` members — named in this phase's adapter-responsibility doc as the entry types that belong at spawn-time and per-tool-call respectively; this phase does not write them (04 owns the journal; 05/06 own calling it).

## Work items

1. `EngineAdapter` interface + `EngineEvent`/`EngineCapabilities`/`WorkerHandle`/`SessionRef`/`AdjudicationCallback` types in `packages/engine-core`; adapter-responsibility doc naming the `JournalEntryType` member due at each lifecycle point. Failing-first: a stub-conformance test asserting a minimal stub adapter satisfies the interface, plus a unit test asserting `capabilities()`'s keys are exactly `supportsJsonSchema, supportsSessionResume, permissionModel, sandboxModel, engineVersion` — both fail (type/stub absent) before this item lands.
2. `compileEnvelope` — permission-profile emission. Failing-first: a unit test compiling a minimal `AuthorizationEnvelope` fixture and asserting `permissions.allow` contains only the four doc-confirmed `Bash(...)` literals, the owned-path `Edit`/`Write` entries, and `mcp__${GATEWAY_MCP_SERVER_NAME}__*`, with `defaultMode: "dontAsk"` and `disableBypassPermissionsMode: "disable"` — fails against a stub compiler first. Per-rule-family unit tests + fast-check property: *no allow outside the envelope; mandatory denies survive any envelope.*
3. `compileEnvelope` — sandbox profile + `WorkerSettingsJson`/`WorkerSdkOptions` emission. Failing-first: a unit test asserting the sandbox block's `denyRead` includes control-repo, journal, `~/.ssh`, `~/.aws`, and `failIfUnavailable: true` — fails until the sandbox emitter exists. Golden settings artifacts for the three canonical envelopes (read-only, standard implementation, network-granted) — failing-first: a byte-diff test against a golden file that doesn't exist yet.
4. Footgun regression suite. Failing-first: a test asserting the compiler never emits a blanket `mcp__*` deny, run first against a deliberately broken compiler variant that does — fails, then the real compiler passes. `//` vs `~/` vs bare `/` anchor coverage; compound-command and process-wrapper smuggling coverage.
5. Fake engine + failure injection (`packages/testkit`). Failing-first: a test spawning the not-yet-built fake engine against a phase-00 scripted trace and asserting ordered `EngineEvent` replay — fails until it exists. Injectable crash/`limitSignal`/schema-violating-result/hang failures; parity check comparing fake-engine verdicts against 00's recorded fixtures.
6. Envelope-conformance fixture set (adaptation §9 "envelope conformance" rows). Failing-first: a fixture-schema validator run against a hand-written fixture missing a required per-layer verdict field — fails until the format + validator exist. First fixture set: compound-command and process-wrapper smuggling, path escape (`../`, absolute), deny-wins (same-level and cross-level), the blanket-`mcp__*`-deny footgun.

## Test plan

All vectors below are written red before their corresponding compiler/adapter code exists (roadmap TDD ground rule).

- **Unit:** per-rule-family compiler tests (allow emission, mandatory-deny emission, sandbox block, `WorkerSettingsJson`/`WorkerSdkOptions` emitters); `EngineCapabilities` shape test; `EngineEvent` exhaustiveness test.
- **Property:** fast-check ≥10k cases — no allow outside the envelope; mandatory denies survive any envelope; compiled profile never contains a blanket `mcp__*` deny; `//`/`~/`/bare-`/` anchor forms never collide or shadow each other.
- **Integration:** fake-engine end-to-end (spawn → scripted trace → `AdjudicationCallback` → `EngineEvent` stream → result); each injectable failure mode (crash, `limitSignal`, schema-violating result, hang) exercised through the adapter's public `spawn`/`resume`/`cancel` surface, not internal calls.
- **Conformance:** the envelope-conformance fixture set itself — per-envelope traces × expected allow/deny verdict at each of layers 2–4 independently (permissions, adjudication+journal, sandbox); must include compound-command smuggling, process-wrapper smuggling, path escape (`../`, absolute), and cross-level deny-wins. This exact fixture set is reused byte-identical by 06's `@live` suite — the roadmap's "envelope conformance" test-matrix item (adaptation §9) is owned here.
- **Security:** mutation tests over deliberately broken compiler variants — blanket `mcp__*` deny, dropped control-repo/`.ssh`/`.aws` `denyRead`, space-before-colon `Bash` literal — each must be caught by a failing test, not silently pass; an adjudication-hook-bypass test (fake engine attempts a tool call with no `AdjudicationCallback` supplied, or one that throws) must fail closed, never open. This phase runs the mandatory security-review pass (ground-rule TDD requirement) even though it only generates configuration — a defect here silently disables enforcement for every worker in the system.

## Exit criteria

- [ ] `EngineCapabilities` field-exhaustiveness test passes: exactly `supportsJsonSchema, supportsSessionResume, permissionModel, sandboxModel, engineVersion`, no more, no fewer (Gap 7).
- [ ] Compiler property suite (no allow outside the envelope; mandatory denies survive any envelope; no blanket `mcp__*` deny ever emitted) green at ≥10k fast-check cases in CI.
- [ ] Golden settings artifacts for the three canonical envelopes (read-only, standard implementation, network-granted) committed and byte-stable across two consecutive builds.
- [ ] Fake-engine replay parity: every fixture in the initial envelope-conformance set produces its hand-derived expected per-layer verdict.
- [ ] Demo test: spawn fake worker → attempt a smuggled command (`allowed-cmd && curl …`) → observe denial → receive a structured `WorkerResult`-shaped failure — runs green in CI with no `claude` binary installed.
- [ ] Mutation suite: each seeded broken-compiler variant (blanket `mcp__*` deny; missing control-repo `denyRead`; space-before-colon `Bash` literal) is caught by a failing test, recorded in the mutation-test report.

## Risks & open questions

- **Security keystone:** this phase "only" generates configuration, but a defect here silently disables enforcement for every worker in the system; the mandatory security-review pass runs against this phase even though no runtime worker exists yet.
- **Verify-at-build-time (owned by 00, Gap 12):** whether `Bash(<prefix>:*)` requires or forbids a space before the colon for command-prefix rules beyond the four doc-confirmed literals is unresolved until 00 records it in `docs/engine-baseline.md`; the compiler must not generalize the colon-spacing pattern to any prefix beyond those four until that probe lands.
- **§10 risk #5 (sandbox default read-open):** the sandbox emitter must always populate `denyRead` for `~/.ssh`/`~/.aws`; only a golden-artifact drift test would catch a silent regression here.
- **§10 risk #3 (SDK `settingSources` default ambiguity):** doesn't gate this phase's pure compiler directly (no SDK call happens here), but `WorkerSdkOptions` must show `settingSources: []` explicitly in the golden artifacts so drift is visible before 06 ever spawns a real worker.
- **§10 risk #2 (`--permission-prompt-tool` undocumented):** the `AdjudicationCallback` hook slot deliberately mirrors the documented SDK `canUseTool` callback shape, not the undocumented CLI flag; 06 must not build the real wiring against the latter.
- **Resolved (previously flagged as a cross-phase gap):** 05's own text ("spawn via EngineAdapter (fake engine until 06)") implied a hard dependency on this phase's `packages/engine-core` type and `packages/testkit` fake engine. This is now formalized: 05's header lists `03, 04` under Depends on, and the README graph carries a `P03 --> P05` edge.
- **Fake-vs-live parity is not permanent truth:** this phase guarantees fixture-*format* compatibility; only 06's `@live` suite proves the fake engine's behavior still matches the real one on any given pinned engine version.
