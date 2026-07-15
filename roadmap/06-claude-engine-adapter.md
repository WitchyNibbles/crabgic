# Phase 06 — Claude Code worker runtime (SDK transport)

| | |
|---|---|
| **Depends on** | 03, 05 |
| **Unlocks** | 10, 11, 13 |
| **Sources** | adaptation §0 (transport/auth/model-routing/plan-limit decisions), §3.1–§3.3, §4.3–§4.6, §5.1–§5.3, §5.6–§5.7, §9 (`EngineAdapter` capability delta, new test-matrix items), §10 risks 1–6 & 9–10, Appendix A, Appendix B; `docs/engine-baseline.md` (phase 00 output) |
| **Primary package** | `packages/engine-claude` |

## Goal

Before this phase, `packages/supervisor` (05) spawns only 03's fake engine, and 03's `AdjudicationCallback` slot, `resume`, and version gate have no real policy behind them. When this phase is done, `packages/engine-claude` is the first real implementation of 03's `EngineAdapter`: workers run via `@anthropic-ai/claude-agent-sdk` under `compileEnvelope`'s output, with subscription OAuth, a journal-first `AdjudicationCallback`, schema-validated `WorkerResult`, `SessionRef`-based crash/repair recovery, and `limitSignal` detection — proven against the real, pinned Claude Code engine, not only the fake.

## In scope

- **Spawn path (§5.3, confirmed v1 transport):** implements `EngineAdapter.spawn(packet, profile, adjudicate) → WorkerHandle` over Agent SDK `query()`: `cwd` = supervisor-provisioned worktree (never `.claude/worktrees/` or `isolation: "worktree"` — those stay manager-side only, §3.2), `env` sanitized + per-worker `CLAUDE_CONFIG_DIR` (05-provisioned) + injected `CLAUDE_CODE_OAUTH_TOKEN` (mechanism per phase-00's auth-spike verdict), `settingSources: []` always passed explicitly (never the default, §10 risk 3), `WorkerSdkOptions` (03's compiled output) passed through verbatim, `systemPrompt` preset + role preamble, `maxTurns` from `packet`, model routed per role (balanced defaults, overrides only via approved envelope), a pre-generated `SessionRef`/session UUID journaled (`session_assignment`) before the process starts.
- **Gateway wiring (Gap 11, Gap 2):** `WorkerSdkOptions.mcpServers` is keyed `GATEWAY_MCP_SERVER_NAME` with `strictMcpConfig: true` (already set by 03's compiler off the same constant). This phase's spawn path configures that entry as a connection to the `engineering-orchestrator gateway mcp` process (Gap 2's fixed CLI-invocation convention — the identical external-process shape 10's `.mcp.json` entry already uses), never a hand-typed `"eo_gateway"` literal. See Risks for why this is external-process, not an in-process import of `packages/gateway`.
- **`AdjudicationCallback` — real implementation** (03 defines the call shape; 05 stubs it; this phase answers it): every tool call is routed to 05's journal-teed bus for a decision **before** it takes effect (`adjudication_decision` journal entry written first, then allow/deny/`updatedInput` returned); a bridge failure (crash, timeout) resolves to **deny**, never a silent allow. PostToolUse audit hook; SessionEnd hook captures the transcript as an evidence pointer.
- **Results:** `WorkerResult` schema enforced via `--json-schema`/`structured_output`; gateway `result.submit` retained as belt-and-suspenders (dotted form, Gap 8 — unchanged); schema violation → typed failure entering the repair-attempt path; usage/turn accounting captured (dollar budgets stay informational under subscription auth, §5.7).
- **Recovery:** implements `EngineAdapter.resume(sessionRef, adjudicate) → WorkerHandle` — reconnects the same `SessionRef` for crash recovery and rate-limit re-dispatch; `forkSession` starts an isolated session for repair attempts that must not touch the original transcript (§4.5).
- **Limit signals:** detect the rate/usage-limit shape phase 00 recorded; emit a typed `limitSignal` `EngineEvent`. Parking policy itself is 13's, not built here.
- **Version gate:** `EngineCapabilities.engineVersion` checked against `docs/engine-baseline.md`'s accepted range; `spawn`/`resume` refuse outside it.
- **`@live` conformance:** wire the `engine-live` CI job (inert placeholder from 01, Gap 15) to run the `@live`-tagged suite — 03's envelope-conformance fixture set replayed against the real, pinned engine; fake-vs-live parity re-asserted.

## Out of scope

- `compileEnvelope`, the `EngineAdapter`/`EngineEvent`/`EngineCapabilities`/`WorkerHandle`/`SessionRef`/`AdjudicationCallback` type definitions, the fake engine, and golden settings artifacts — all owned by 03 (`packages/engine-core`, `packages/testkit`); this phase consumes them, it does not define or regenerate them.
- Supervisor lifecycle, UDS protocol, registries, ring buffer, per-worker `HOME`/`TMP`/`CLAUDE_CONFIG_DIR` provisioning, and the `AdjudicationCallback` *stub* — owned by 05; this phase supplies the real answering policy behind that stub, it is not a replacement for 05's own code.
- Rate-limit parking policy (backoff timers, the `WorkUnitAttemptStatus: parked:rate_limit` transition itself, restart-safe re-dispatch scheduling) — owned by 13; this phase only emits the raw `limitSignal` event.
- Gateway MCP tool *implementations* and the `eo_gateway` tool registry itself (`tracker.*`, `observability.*`, `evidence.get`, `evidence.attach`, `result.submit`'s server-side handler, forwarded `run.status`/`run.cancel`) — owned by 16 (`packages/gateway`); workers reach these only as an MCP client of the external `gateway mcp` process, never by importing `packages/gateway`.
- Manager-side session, subagents (`eo-explore`, `eo-reviewer`), advisory hooks, slash commands — owned by 10; the manager session runs under ordinary interactive permissions, never a compiled worker profile.
- The CLI command surface (`resume`, `cancel`, `gateway mcp`, doctor's own version/hermeticity/sandbox self-tests) — owned by 09; per 03's own note, 09's doctor checks are direct engine probes, not imports of this phase's package. This phase supplies no CLI surface itself.
- Journal encoding/schema (ndjson codec, chain fields, segment rotation) — owned by 04; this phase only writes entries through 05's already journal-teed bus.
- Contract assembly, approval-token minting, `CapabilityManifest` assembly — owned by 11.

## Interfaces produced

- **`packages/engine-claude`** — the first real implementation of `EngineAdapter` (`spawn`, `resume`, `cancel`, `capabilities() → EngineCapabilities`) over the Agent SDK. Per 03's own accounting, this package — not `packages/engine-core` directly — is "the surface 10/11/13/23 rely on downstream." The specific piece each named consumer relies on:
  - **10** — `EngineCapabilities.engineVersion` plus the version-range gate, reused for the plugin's doctor/install compatibility checks and its own `CapabilityManifest` version pin (10's own stated reuse); the `engine-live` CI job wiring below is also reused directly by 10's `@live` plugin-load smoke test.
  - **13** — the `limitSignal` `EngineEvent` ("on `limitSignal` (06): park → backoff → re-dispatch via `resume`," 13's own text); `resume`/`forkSession` for re-dispatch and repair-attempt isolation; the `WorkerResult` pass/fail outcome feeding its attempt policy.
  - **23** — `@live`-tagged conformance suite, version-range gate, `resume`/`forkSession`, `session_id` (all four already named on 23's own Interfaces-consumed row for this phase).
  - **11** — `EngineAdapter.capabilities()`'s `engineVersion`, `supportsJsonSchema`, `supportsSessionResume` (field names per Gap 7), read at approval-preview time to populate `CapabilityManifest`'s pinned-engine entry and caption `PerformanceContract` budget previews (per 11's own Interfaces-consumed section).
- **`limitSignal` `EngineEvent`** — emitted when the rate/usage-limit shape phase 00 recorded is detected; carries the reset-window hint and scope (work-unit vs. account-wide) 13's scheduler needs.
- **`session_id`/`SessionRef` assignment + `resume`/`forkSession` wiring** — a supervisor-chosen UUID journaled (`session_assignment`) before spawn; `resume` reconnects the same `SessionRef` for crash recovery and rate-limit re-dispatch; `forkSession` isolates repair attempts from the original transcript.
- **`WorkerResult` validation outcome** — schema-validated `structured_output`, or a typed schema-violation failure — feeds 13's "one initial + two evidence-driven repairs" attempt policy.
- **Real `AdjudicationCallback` + evidence bridge** — journal-first `adjudication_decision` entries; SessionEnd transcript capture as an `evidence_pointer` — transcripts land in 13's artifact store once that phase lands; re-run live by 23 ("Hook enforcement | 03/06").
- **`engine-live` CI job wiring + `@live`-tagged suite** (Gap 15) — 10's own `@live` plugin-load smoke test runs in this same CI job; reused wholesale by 23 at release.

## Interfaces consumed

From **03** (`packages/engine-core`, `packages/testkit`):
- `EngineAdapter` interface this phase implements: `spawn(packet, profile, adjudicate)`, `resume(sessionRef, adjudicate)`, `cancel(handle, deadline)`, `capabilities()`.
- `EngineCapabilities`, `WorkerHandle`, `SessionRef`, `AdjudicationCallback` — the call-shape types.
- `compileEnvelope`'s output — `CompiledWorkerProfile`, materialized as `WorkerSettingsJson` and `WorkerSdkOptions` — mirrored into this phase's concrete `query()` call, not regenerated.
- Golden settings artifacts (three canonical envelopes: read-only, standard implementation, network-granted) — this phase's worker-profile assembler is tested against these byte-for-byte for real-engine drift.
- The fake engine + envelope-conformance fixture format (per-envelope trace + expected per-layer verdict) — reused byte-identical as this phase's `@live` suite input, and for fake-vs-live parity.

From **05** (`packages/supervisor`):
- The journal-teed UDS event bus — this phase's `AdjudicationCallback` implementation and audit/evidence hooks call into it; every decision is journaled before it takes effect.
- Worker registries (the `session_id` slot on the worker/run record) and per-worker `HOME`/`TMP`/`CLAUDE_CONFIG_DIR` provisioning — this phase points the SDK's `env`/`cwd` at what 05 already provisioned.
- The stubbed `AdjudicationCallback`, the crash-detection → journaled-attempt-record → recovery-hook slot 05 already built ("resume/fork policy lands in 06/13," per 05's own text), and the exact integration point 05 spawns workers "via EngineAdapter (fake engine until 06)" — this phase supplies the real answering policy and replaces the fake at that point; 05's own code does not change.

From **02** (`packages/contracts` — ambiently available to every phase, the same convention 10 and 03 apply to `GATEWAY_MCP_SERVER_NAME` citing Gap 11; no new dependency edge):
- `GATEWAY_MCP_SERVER_NAME = "eo_gateway"` — this phase's `mcpServers` key references it directly (Gap 11); `WorkerSdkOptions.mcpServers`'s key is already set off the same constant by 03's compiler.
- `TaskPacket` schema — the type of `spawn()`'s first parameter (02 owns the schema; 13 builds instances; matching 03's own framing, this phase's implementation of `spawn` only consumes the type — 13 depends on 06, so no cycle).
- `WorkerResult` schema — the shape `structured_output` is validated against.
- `JournalEntryType` members `session_assignment`, `adjudication_decision`, `work_unit_transition`, `evidence_pointer` — the categories this phase's journaled events fall under (Gap 5); the enum and journal codec stay owned by 02/04.

`docs/engine-baseline.md` (phase 00's output — cited per README's own ground rule, not a phase dependency; 00 is not in this phase's Depends-on, matching 03's identical citation pattern) supplies the tested version + accepted range, the hermeticity/permission/sandbox/session/structured-output probe verdicts, the auth decision record, the rate-limit signal shape, and `spikes/fixtures/` transcripts this phase's parser and `@live` suite are built and tested against — every such fact is a citation, per Hard Rule 1, never an independently asserted claim.

## Work items

1. `EngineAdapter` real implementation skeleton: `spawn`/`resume`/`cancel` over Agent SDK `query()`, translating `WorkerSdkOptions` (03) into concrete call options; wire `mcpServers`/`strictMcpConfig` off `GATEWAY_MCP_SERVER_NAME` (Gap 11) as a connection to the external `gateway mcp` process (Gap 2); inject auth per phase-00's recorded mechanism. First failing test: assemble options for each of 03's three golden canonical envelopes and diff against a golden SDK-call fixture that does not exist yet.
2. `EngineEvent` normalizer: parse real (and fake-engine, for this test) messages into 03's typed stream (`init | assistant | toolUse | result | retry | limitSignal`); build `limitSignal` detection from phase-00's captured rate-limit shape. First failing test: feed phase-00's rate-limit fixture transcript through the parser and assert a typed `limitSignal` event — fails, no parser exists.
3. Real `AdjudicationCallback` over 05's bus: every call adjudicated and journaled (`adjudication_decision`) before it takes effect; bridge failure denies, never allows; PostToolUse audit hook; SessionEnd evidence-capture hook. First failing test: a forged tool call outside the envelope must be denied and the denial journaled before the engine sees a response — fails, no callback implementation exists.
4. Result validation + usage accounting: enforce `WorkerResult` via `structured_output`; malformed output → typed schema-violation failure. First failing test: a deliberately malformed `structured_output` payload must produce a typed failure, not a silent pass — fails, no validator exists.
5. `resume`/`forkSession` + crash-recovery integration test: pre-assign and journal `SessionRef`/`session_id` before spawn; `resume` reconnects the same worktree/session; `forkSession` isolates repair attempts. First failing test: kill -9 a running worker mid-turn, then `resume` — context and worktree state must be intact — fails, no resume wiring exists.
6. Version gate + `@live` wiring: `spawn`/`resume` refuse outside `EngineCapabilities.engineVersion`'s accepted range; wire the `engine-live` CI job (01) to run the `@live`-tagged suite against 03's fixtures on the pinned engine; assert fake-vs-live parity. First failing test: a spawn attempt against a baseline-mismatched version string must be refused before any engine invocation — fails, no gate exists.

## Test plan

**Unit:** worker-profile assembler (golden `WorkerSdkOptions`-to-`query()`-call diff, 3 canonical envelopes); `GATEWAY_MCP_SERVER_NAME` reference check (no hand-typed `"eo_gateway"` literal anywhere in `packages/engine-claude`); `EngineEvent` parser against each of phase-00's captured fixtures (clean success, retry/backoff, rate-limit signal, schema-violating result, crash) — each must normalize to its correct typed event.

**Property:** `SessionRef`/worktree round-trip — for any generated UUID + worktree pair (fast-check), `resume(sessionRef, adjudicate)` reconnects to that exact pair, never a substituted one.

**Integration (vs. 03's fake engine):** `AdjudicationCallback` denies a forged call and journals the denial before returning; PostToolUse/SessionEnd hooks fire and an evidence pointer is written; schema-violating result triggers the typed failure path; kill -9 → `resume` continuity; `forkSession` leaves the original transcript untouched; two concurrent same-project-dir sessions with distinct `SessionRef`s never interleave.

**Conformance (`@live`, tagged, run in the `engine-live` CI job):** 03's full envelope-conformance fixture set replayed against the real pinned engine — compound-command/process-wrapper smuggling denied, path escape denied, deny-wins-over-allow holds, sandbox probes (egress denied, UDS reachable, `denyRead ~/.ssh` enforced, masked secret shows only the placeholder); hermeticity (planted rogue settings/hook/`CLAUDE.md`/`.mcp.json` under `settingSources: []` all ignored); structured-output round-trip; sessions (kill-9/resume, fork-session, no-interleave); version-drift gate (refuses an untested `claude --version`). Fake-vs-live parity: identical verdicts across both engines. This phase owns the live half of adaptation §9's Envelope conformance, Hook enforcement, Sandbox, Hermeticity, Structured output, Sessions, and Version drift test-matrix categories (03 owns the unit/property half of the first two; 09 owns the doctor-side half of Version drift/Hermeticity independently, per 03's own note that its checks are direct probes, not imports of this package).

**Security:** masked secret never appears in worker env or transcript (live substring search); `failIfUnavailable` aborts closed when `bwrap` is unavailable; an `AdjudicationCallback` failure (crash/timeout) denies the pending call rather than allowing it by default — the live counterpart of 03's own fake-engine test ("a fake engine attempts a tool call with no `AdjudicationCallback` supplied, or one that throws, must fail closed"); a blanket `mcp__*` deny is never present alongside the gateway allow (Appendix B's footgun, reconfirmed live); the injected `CLAUDE_CODE_OAUTH_TOKEN`/`.credentials.json` fallback never appears outside its own worker's `CLAUDE_CONFIG_DIR`.

## Exit criteria

- [ ] 03's full envelope-conformance fixture set passes on the pinned live engine — suite `envelope-conformance.live.test`, run in the `engine-live` CI job.
- [ ] Masked secret never appears in worker env or transcript — `secret-mask.live.test`.
- [ ] `failIfUnavailable` aborts (fails closed) when `bwrap` is unavailable — `sandbox-unavailable.live.test`.
- [ ] kill -9 → `resume` continues in the same worktree with context intact; `forkSession` leaves the original transcript untouched — `crash-recovery.live.test`.
- [ ] Schema-violating `structured_output` triggers a typed failure entering the repair-attempt path, never a silent pass — `structured-output-violation.test`.
- [ ] `limitSignal` fires against phase-00's captured (or an equivalently live-triggered) rate-limit shape — `limit-signal.test`.
- [ ] Fake-vs-live parity: identical fixture verdicts across `packages/testkit`'s fake engine and the real engine — `fake-live-parity.test`.
- [ ] `WorkerSdkOptions.mcpServers` key and `strictMcpConfig` reference `GATEWAY_MCP_SERVER_NAME` byte-for-byte; zero hand-typed `"eo_gateway"` literals anywhere in `packages/engine-claude` — `gateway-name-reference.test`.
- [ ] `spawn`/`resume` refuse to start outside `docs/engine-baseline.md`'s accepted version range — `version-gate.test`.
- [ ] `engine-live` CI job (01) runs the `@live`-tagged suite end to end against the pinned version — evidenced by a green CI run.

## Risks & open questions

- **Release velocity (§10 risk 1):** Claude Code ships weekly; a version bump restarts the `@live` conformance clock — this phase's version gate blocks adopting an unverified version until `docs/engine-baseline.md` is revised (deliberate "00/06 policy," matching 00's and 23's framing), rather than degrading silently.
- **`--permission-prompt-tool` (§10 risk 2):** not used; the real `AdjudicationCallback` mirrors the documented SDK `canUseTool` callback shape 03 already designed against, not the undocumented CLI flag.
- **SDK `settingSources` default ambiguity (§10 risk 3):** mitigated because `WorkerSdkOptions` (03) already shows `settingSources: []` explicitly; this phase's hermeticity conformance test is what earns the assumption, not the assumption itself.
- **Sandbox domain-fronting / no default TLS termination (§10 risk 4):** workers get zero egress by envelope default; only the gateway (outside the worker sandbox) talks to providers.
- **Sandbox default read-open for credential paths (§10 risk 5):** the compiled sandbox block this phase mirrors always carries `denyRead`/`credentials` (03's responsibility to emit); covered here by the live sandbox-probe conformance tests, not re-derived independently.
- **Native worktree/subagent isolation is young (§10 risk 6; §3.2):** this phase never spawns workers into `.claude/worktrees/` or with `isolation: "worktree"`; write-capable workers always run at a `cwd` 05 provisions inside the supervisor-owned worktree (07); native isolation stays manager-side only (10).
- **Subscription-auth workers share plan rate limits; `--bare` skips OAuth sources (§10 risk 9):** this phase uses the SDK transport exclusively for v1 (§5.2's CLI form is an escape hatch only); auth injection follows whichever mechanism phase 00's blocking auth spike recorded as adopted — this phase does not independently choose between direct `CLAUDE_CODE_OAUTH_TOKEN` resolution and the `.credentials.json` fallback.
- **Verify-at-build-time (§10 risk 10):** the exact stream-json event taxonomy, `MAX_MCP_OUTPUT_TOKENS`, and hook-input field details are unconfirmed. This phase's `EngineEvent` normalizer parses whatever phase-00 empirically captured into 03's stable typed shape; a taxonomy shift on a version bump requires updating this parser before that version can pass `@live` (23 does not re-derive the taxonomy itself). Budget enforcement never depends on `MAX_MCP_OUTPUT_TOKENS`; the gateway (16) enforces its own budgets independently.
- **Worker-side gateway MCP wiring is external-process, not in-process:** adaptation §5.3's code sample shows workers reaching the gateway via an in-process `createSdkMcpServer` object built from `supervisorHandlers.*`. Building that literally would require this phase to import `packages/gateway` (16) at the point of spawn — a dependency edge the README graph does not have (16 depends on 02/04/05; nothing depends on 06↔16 either direction). This phase instead treats that part of the code sample as illustrative, the same way Gap 8 already treats that sample's `result_submit` spelling as illustrative rather than literal: workers connect to the gateway as an MCP client of the external `engineering-orchestrator gateway mcp` process (Gap 2), the identical shape 10's `.mcp.json` entry uses, never an in-process import. Flagged for the reconciler to confirm 16's and 09's own files agree the registry is reachable this way for worker connections, not solely the manager's `.mcp.json` connection.
- **11's dependency on this phase, now resolved:** 03's own Interfaces-produced section states "06 ... is itself the surface 10/11/13/23 rely on downstream," and the README graph lists 06 in 11's `Depends on`; 11's own Interfaces-consumed section now names the exact fields — `EngineAdapter.capabilities()`'s `engineVersion`, `supportsJsonSchema`, `supportsSessionResume` (field names per Gap 7) — read at approval-preview time to populate `CapabilityManifest`'s pinned-engine entry and caption `PerformanceContract` budget previews. No longer an open question.
- **Cross-phase gap inherited from 03, not this phase's to fix:** 03 itself flags that 05's "spawn via EngineAdapter (fake engine until 06)" implies a hard 05→03 dependency neither 05's header nor the README graph reflects. This phase's own header (`Depends on: 03, 05`) is correctly graphed; only the fake-engine wiring this phase eventually replaces inherits that unresolved gap.
