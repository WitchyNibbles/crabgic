# @eo/engine-claude

Claude Code worker runtime over the Agent SDK — the first real implementation of 03's
`EngineAdapter` (`roadmap/06-claude-engine-adapter.md`). Every engine fact below cites
`docs/engine-baseline.md` (accepted range: engine 2.1.207–2.1.210, SDK 0.3.207–0.3.210;
tested 2.1.210 / 0.3.210) — never memory.

## Design decisions (phase-06 build record)

1. **Single SDK boundary.** Only `adapter.ts` invokes the SDK, through the injectable
   `SdkQueryFunction` seam (`adapter-config.ts`). Unit/integration tests inject scripted
   streams replaying `spikes/fixtures/*` shapes; the `@live` suite is the only place the
   real `query` runs.
2. **Pre-spawn `session_assignment`.** The SDK supports pre-assigned session UUIDs
   (`Options.sessionId`, sdk.d.ts 0.3.210). The adapter generates the UUID, journals
   `session_assignment` **before** the engine subprocess exists, and only then starts the
   stream. This closes the phase-05 finding that journaling after `spawn()` could leak an
   untracked worker on a crash between spawn and fsync (05's own code is unchanged: its
   post-`spawn()` journaling call sees the same id, and `spawn` starts the engine lazily).
3. **Auth (baseline §1).** `WorkerAuthMaterial` supports both recorded mechanisms:
   `.credentials.json` copy (0600) into the worker's isolated `CLAUDE_CONFIG_DIR`
   (confirmed-PASS path) and `CLAUDE_CODE_OAUTH_TOKEN` env injection. The adapter never
   chooses independently (roadmap/06 risk 9). Credential bytes must never appear outside
   the worker's own `CLAUDE_CONFIG_DIR`/env (live-verified, `secret-mask.live.test`).
4. **Env from scratch.** Worker env is a strict allowlist (`PATH`, `HOME`, `TMPDIR`/`TMP`,
   `CLAUDE_CONFIG_DIR`, plus auth), per baseline §4.3 — SDK `Options.env` replaces the
   subprocess environment entirely; nothing is inherited.
5. **Gateway wiring (Gaps 2 + 11).** `mcpServers` is keyed by `GATEWAY_MCP_SERVER_NAME`
   (imported from `@eo/contracts`, zero hand-typed `"eo_gateway"` literals —
   `gateway-name-reference.test`), configured as the **external**
   `engineering-orchestrator gateway mcp` stdio process. Never an in-process import of
   `packages/gateway` (the adaptation §5.3 code sample is illustrative there, per
   roadmap/06 §Risks).
6. **Placeholder substitution.** Engine-core's `<worktree>`/`<worker-tmp>` placeholders in
   the compiled profile are substituted with `ClaudeEngineAdapterConfig.worktreePath` /
   `provisioning.TMP` at spawn time, before any engine invocation. The real-engine
   `//`-anchor matching semantics are UNPROBED in the baseline (§3 has no path-anchor
   probe) — the `@live` suite carries the probe this package owes (03 carry-forward).
7. **Structured output (baseline §5).** `Options.outputFormat: { type: "json_schema" }`
   with the packet's `resultSchema`; results validate against `WorkerResultSchema`
   (@eo/contracts). The observed violation shape — `subtype: "success"` with
   `structured_output` **absent** — is a first-class typed schema-violation failure, not
   a silent pass; `error_max_structured_output_retries` is handled as the SDK-typed
   (unobserved) variant.
8. **limitSignal (baseline §8).** Built from the committed `rate_limit_event` schema
   (`status` transition to `rejected`, early-warning `allowed_warning` + `utilization`),
   keying on epoch `resetsAt`, **plus** the error-string channel fallback (the only shape
   an actual exhaustion has been observed to surface as). Parking policy is 13's.
9. **Version gate.** `spawn`/`resume` refuse outside the accepted range. The range
   constants live in `version-gate.ts`; a test parses `docs/engine-baseline.md` and fails
   if the constants drift from the document (the document stays the single citable
   source).
10. **zod.** This package declares `zod@4.4.3` **solely** to satisfy the SDK's `zod@^4`
    peer contract (nested install; the repo-wide schema layer stays zod 3.25.76 via
    `@eo/contracts`). Do not author zod schemas here and never pass zod objects across
    the SDK boundary — boundary validation uses `@eo/contracts` schemas.
11. **`@live` convention (Gap 15).** Live tests live in `src/live/*.live.test.ts`, are
    excluded from the default gate and its coverage denominator, and run only via
    `npm run test:live` (`vitest.live.config.ts`) — sequential, `EO_LIVE=1` required,
    rate-limit-guarded (abort the batch on `utilization` ≥ 0.85 or any non-`allowed`
    status at canary time), haiku-priced short prompts. Each green run journals
    `{engineVersion, runId, suiteDigest}` for 14's `engine-conformance` gate.
12. **Fail-closed adjudication.** The `AdjudicationCallback` bridge into 05's journal-teed
    bus resolves to **deny** on crash/timeout/absence; a decision is journaled before it
    takes effect. `canUseTool` mirrors the documented SDK shape (roadmap/06 risk 2).
    **GUARANTEE DOWNGRADE (Finding 2, engine-fact-drift carry-forward):** the independent
    per-call adjudication-**journaling** backstop (the `canUseTool` bridge → journal-teed
    bus → `adjudication_decision` entry, and the PostToolUse executed-vs-adjudicated audit
    that keys off it) is **LIVE-UNVERIFIED**, because whether the SDK invokes `canUseTool`
    at all under `permissionMode: "dontAsk"` is an **unprobed engine fact** — baseline §3
    probed enforcement via the static allow/deny lists + `result.permission_denials`, with
    **no `canUseTool` installed**. The **load-bearing, verified** enforcement layer is the
    static `dontAsk` allow/deny + OS sandbox (baseline §3), which holds regardless. The
    PostToolUse audit is therefore scoped to only assert a **genuine adjudicated-vs-executed
    mismatch** (a tool with ≥1 recorded allow whose executed input matches none), never
    treating a pre-approved tool with zero adjudicated records as a violation. Owed: a
    baseline §3 addendum probing `canUseTool`-under-`dontAsk`; the new
    `src/live/adjudication-bridge.live.test.ts` probe converts this into a live-gated
    assertion (drives one allowed `Bash(git status:*)` through the real bridge and records
    empirically whether an `adjudication_decision` entry appears).
13. **Deny enforcement is catalog-removal (baseline §4).** Conformance asserts denied
    tools as absence-from-catalog (init `tools` list), never as recorded denial events;
    blocked reads assert the ENOENT-masking shape (§6); egress denial asserts the
    proxy-issued 403 shape (§6).

## Module map

| Module | Contents |
|---|---|
| `adapter-config.ts` | Shared construction-time seam (types only) |
| `options-assembler.ts`, `auth.ts`, `model-routing.ts`, `version-gate.ts`, `gateway-server-config.ts` | Compiled profile → concrete SDK `Options`; auth provisioning; balanced model default; baseline version gate |
| `event-normalizer.ts`, `limit-signal.ts` | SDK `SDKMessage` stream → 03's typed `EngineEvent`s |
| `adjudication-policy.ts`, `hooks.ts`, `result-validation.ts` | Real envelope policy behind 05's bus; PostToolUse audit + SessionEnd `evidence_pointer`; `WorkerResult` validation |
| `adapter.ts`, `session.ts` | `ClaudeEngineAdapter` (spawn/resume/cancel/capabilities + `fork`), `SessionRef` helpers |
| `live/` | `@live` conformance harness + suites (excluded from default gate) |
