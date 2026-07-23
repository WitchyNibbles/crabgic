# Phase 06 work item 6 — `@live` conformance suite (worker W5)

Scope owned: `packages/engine-claude/src/live/**`, `src/fake-live-parity.test.ts`, this
evidence file, the `[W5-EXPORTS]` anchor in `src/index.ts`, one `.gitignore` line, and
CONDITIONAL authority over `src/options-assembler.ts` + `goldens/` (path-anchor — see §7).

Wave A+B were DONE (670 tests). W5 authors the live suite, runs it against the REAL pinned
engine on this host, and closes the phase's live exit criteria.

## 1. Headline status (honest)

**The suite is fully authored, typechecks clean, the offline gate is green, and the live
harness end-to-end (auth + real engine stream + rate-limit guard) is LIVE-VERIFIED — but the
full green conformance pass could NOT complete: the mandatory canary aborted the batch for
rate-limit safety at `utilization 0.87 ≥ 0.85` (a genuine `allowed_warning` band on the
owner's subscription). Per the LIVE-RUN SAFETY absolute ("if the canary aborts, STOP entirely
and report — do not press a hot subscription window"), the run was stopped, not retried.**

This is the correct, mandated behavior — the safety guard is not vacuous: the canary reached a
real `rate_limit_event` (which requires the pinned engine to have started, authenticated via
the handoff token, and streamed), parsed it through W2's `rate-limit`/`limit-signal` module,
and refused to press the window.

## 2. Live invocation accounting

| Phase                                                | Invocations | Notes                                                                                     |
| ---------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| Canary (`ensureCanary` → `runCanary`)                | **1**       | Reached a real `rate_limit_event`; **aborted** at util 0.87 before the version assertion. |
| Dev / conformance / sessions / sandbox / path-anchor | **0**       | Never ran — the canary aborted first (the mandated fail-fast).                            |
| **Total**                                            | **1**       | One minimal `haiku`/`maxTurns:1` call, aborted safely.                                    |

No conformance/session/sandbox/secret-mask/path-anchor model spawns were made. No
`live-run-record.json` was written (finalizer never ran). No canary marker persisted (the
canary threw before caching). All scratch dirs were removed in `finally`.

## 3. Files created

- `src/live/live-harness.ts` — EO_LIVE gate; auth resolution (baseline §1 order: env token →
  `~/.claude/.eo-oauth-token` 0600 → `.credentials.json` copy via this package's own
  `provisionWorkerAuth`); `os.tmpdir()` scratch provisioning (deleted in `finally`); real
  `ClaudeEngineAdapter` context over the DEFAULT `query` (`model: "haiku"`, gateway pointed at
  the in-repo stub); direct-query helper (spike-style probes); canary + rate-limit guard
  (abort on non-`allowed`/`allowed_warning`, util ≥ 0.85, any `rejected`); version-drift check
  (init `claude_code_version` **and** `capabilities().engineVersion` == `2.1.210`, in range);
  executed-call guards; sanitization scan (`sk-ant-`, OAuth blobs, `$HOME`, registered live
  secrets); `suiteDigest` (SHA-256 over sorted `*.live.test.ts` bytes); `live-run-record`
  writer + journal `evidence_pointer` append; deterministic key-sorted verdict writer.
- `src/live/fixtures/stub-mcp-server.mjs` — minimal MCP stdio server the `gatewayServerOverride`
  seam points at, so every real-adapter spawn wires a gateway server that completes the MCP
  `initialize` handshake (advertising zero tools) instead of the nonexistent
  `engineering-orchestrator` binary. The suite never exercises a gateway tool (16's surface).
- `src/live/envelope-conformance.live.test.ts` — the 7 `CONFORMANCE_FIXTURES` replayed through
  the REAL adapter + engine-level enforcement spot-checks (see §5).
- `src/live/sandbox-hermeticity.live.test.ts` — egress-403 / UDS-reachable / denyRead-ENOENT /
  hermeticity (direct-query, spike 04/02 verbatim). Sibling of the envelope-conformance
  criterion (roadmap groups sandbox+hermeticity under §Conformance).
- `src/live/secret-mask.live.test.ts` — `credentials.envVars mode: mask` + auth-material
  scratch-tree confinement scan.
- `src/live/sandbox-unavailable.live.test.ts` — `failIfUnavailable` fails closed (PATH starved
  of bwrap/socat; 0 model invocations).
- `src/live/crash-recovery.live.test.ts` — kill-9 (process-tree PID) / resume / fork / concurrent.
- `src/live/path-anchor.live.test.ts` — THE OWED PROBE (§7).
- `src/live/zz-live-run-record.live.test.ts` — finalizer (writes the record + journals it).
- `src/live/fixtures/live-verdicts.json` — committed verdicts (provenance: §6).
- `src/fake-live-parity.test.ts` — DEFAULT-gate offline parity (fake vs committed live verdicts).

## 4. Offline gate + build (verified green)

- `npx tsc -b` (whole repo): exit 0.
- `npx vitest run --project @eo/engine-claude --coverage.enabled=false`: **271 passed / 17
  files** (was 263/16; +8 from `fake-live-parity.test.ts` — 7 fixtures + the coverage check).
  `*.live.test.ts` and `src/live/**` are excluded from the default gate + its coverage
  denominator (per the root `vitest.config.ts`), so the harness needs no coverage.
- EO_LIVE gate proven RED: running any live file with `EO_LIVE` unset fails the suite with
  `LiveEnvNotEnabledError` (the CI job goes red, never vacuously green).

## 5. Evidence-soundness FINDINGS (the load-bearing part)

**5.1 The 7 raw `CONFORMANCE_FIXTURES` split into two enforcement classes through the REAL
adapter — 5 of them cannot literally spawn.** The fixtures were built for testkit's fake
layered evaluator (which never calls `assertNoFootguns`). Run through the real
`ClaudeEngineAdapter.spawn`, 5 fail `assertNoFootguns` synchronously (before ANY engine call):
compound/process-wrapper smuggling + deny-wins same/cross use `permissionOverride` that
REPLACES the mandatory Edit/Write deny backstop → `MissingEditWriteDenyBackstopError`; the
blanket-mcp-deny footgun trips `BlanketMcpDenyViolationError`. This is genuine defense-in-depth
conformance: the real compiler never emits these shapes and the adapter never forwards them.
The other 2 (path-escape relative/absolute) are footgun-clean (owned-path envelope, no
override) and DO spawn — their deny is proven at the ENGINE's permission layer. Both classes
resolve to overall `deny`, matching every fixture's baseline `expected` and the fake engine's
`evaluateAllLayers` overall, so parity holds at the overall-verdict level.

**5.2 The compiler's Bash allowlist is a closed 4-literal set (no `echo`/`sleep`).** So (a)
engine-level compound-command smuggling is probed with an ALLOWED prefix (`git status && curl`,
whole call denied), and (b) the kill-9 arm derives a footgun-clean profile by adding
`Bash(sleep:*)` to all three allow mirrors (permissions/settingsJson/sdkOptions) — the
mandatory denies/backstops are untouched, so `assertNoFootguns` still passes.

**5.3 Sandbox/hermeticity need tools the compiled profile forbids (curl/echo/cat).** They run
as DIRECT-query spike-style probes (baseline §6/§2), not adapter probes — the adapter's
sandbox/`settingSources: []` WIRING is unit-tested in `options-assembler.test.ts`; these live
probes re-confirm the ENGINE's recorded §6/§2 behaviors, each carrying the spike's own
executed-call / attempted-and-blocked guard so no absence assertion is vacuous.

**5.4 Path-escape uses a benign out-of-scope target, not the fixtures' literal `/etc/passwd`,**
to avoid the model-safety refusal confound baseline §6 confound-1 documents. The permission
semantic (Edit outside owned path denied) is identical.

These findings are the whole point of the "do NOT repeat the vacuous-pass mistakes §2/§6
record" directive — the raw fixtures could not have been spawned as-is, and a suite that
claimed to "replay them" without noticing this would have been vacuous.

## 6. `live-verdicts.json` provenance (transparent)

The committed file encodes the DETERMINISTIC expected verdicts (all 7 overall-`deny`, with the
`adapter-footgun-gate` vs `engine-permission-deny` mechanism per §5.1) — byte-identical to what
the harness's `writeLiveVerdicts` produces on a green run. It was generated with the harness's
exact serialization (key-sorted, trailing newline). Because the live run aborted at the canary,
these verdicts are **fake-derived / not yet live-confirmed**; the offline `fake-live-parity`
gate is green (fake == committed by construction). On a clean (non-hot) window, running
`envelope-conformance.live.test` regenerates this file byte-identically from real observations —
`git` will show no diff on a green run, confirming the two engines agree.

## 7. Path-anchor — CONDITIONAL AUTHORITY NOT EXERCISED

`path-anchor.live.test.ts` is authored to empirically decide, per form, whether the real engine
honors the CURRENT triple-slash `Write(///abs/worktree/owned/**)` (what `substituteWorktree
Placeholders` + the goldens emit) vs. the double-slash `Write(//abs/worktree/owned/**)`, with an
executed-call-guarded allow-side (in-owned-path Write succeeds) and deny-side (out-of-path Write
denied) for EACH form, via direct query + explicit permission rules and NO sandbox (so only
anchor matching decides). **The probe could not run (canary abort), so the determination is
unmade.** Therefore: `substituteWorktreePlaceholders` is UNCHANGED, `goldens/*.sdk-call.json`
are UNCHANGED (still triple-slash), W1's unit tests stay green. The conditional authority was
NOT exercised. This carry-forward remains open until the probe runs on a clean window.

**Owed baseline addendum (phase-00 follow-up, NOT edited here):** `docs/engine-baseline.md` §3
records no path-anchor probe; once `path-anchor.live.test` runs, §3 owes an addendum recording
which `//`-anchored owned-path form the engine honors. Flagged for the reconciler / phase-00
follow-up — the baseline is not edited by this worker.

## 8. Kill-9 PID approach

Process-tree inspection from the test process (Linux `/proc/<pid>/stat` ppid walk →
`descendantsOf(process.pid)`), diffing descendants before spawn vs. at the `sleep` tool_use, then
`process.kill(pid, "SIGKILL")` on the new engine subtree. The SDK's `Query` exposes no child
handle (confirmed in `sdk.d.ts` 0.3.210: `interrupt()`/`supportedModels()`/`mcpServerStatus()`,
no process), so process-tree inspection is the mechanism. The spike-06 CLI fallback was NOT
needed and is NOT used — every crash-recovery arm runs on the SDK transport through the real
adapter (both transports spawn the same pinned engine, baseline §7). NOTE: this arm did not
execute live (canary abort), so the PID walk is code-verified/typed but not yet live-confirmed.

## 9. Journal `evidence_pointer` shoehorn (mirrors W3)

`writeLiveRunRecord` appends an `evidence_pointer` whose payload validates as `EvidenceRecord`
(unowned by W5), shaped around 14's gate-firing evidence, not a live-run record. Mirroring W3's
documented shoehorn (`hooks.ts` `createSessionEndEvidenceHook`): `command`/`exitStatus`/
`objectId`/`toolchainFingerprint`/`changeSetId` are schema-fit choices; `artifactDigests`
carries the actual `live-run-record.json#suiteDigest=…` pointer; `runId` → `objectId`. Same
future-reconciliation flag as W3.

## 10. Sanitization

Every persisted artifact passes `assertSanitized` (zero `sk-ant-`, zero OAuth token blobs, zero
`$HOME`, zero registered live-secret substrings) before being trusted. The resolved OAuth token
(from the 0600 handoff file) and any masked/injected secret are `registerSecret`-tracked in
memory only, never logged or written. `live-verdicts.json` (fixture names + `deny` + fixed
detail strings) is inherently clean; scanned clean. `secret-mask.live.test` additionally scans
the worker's worktree + HOME scratch trees (excluding its sanctioned `CLAUDE_CONFIG_DIR`) for
any auth-material leak.

## 11. Deviations / open questions

- **Live green pass blocked by a hot subscription window (util 0.87).** Re-run
  `npm run test:live` on an off-hours / metered-account window to complete conformance,
  sessions, sandbox, secret-mask, and the path-anchor determination. The harness is ready;
  budget for a full green pass is ~19 live invocations (canary 1 + envelope 2 + sandbox/herm 5
  - secret-mask 1 + sandbox-unavailable 0 + crash-recovery 6 + path-anchor 2 + finalizer 0).
- **`live-verdicts.json` is fake-derived pending live confirmation** (§6) — documented, offline
  gate green, regenerates byte-identically on a clean run.
- **Path-anchor determination unmade** (§7) — goldens/options-assembler unchanged; conditional
  authority not exercised; baseline §3 addendum still owed.
- **Gateway stub vs. real gateway:** live spawns use the `gatewayServerOverride` seam (a stub
  MCP server), not the real `engineering-orchestrator gateway mcp` process (09/16's, not built
  here) — the adapter's gateway wiring is unit-tested; the live suite proves the worker STARTS
  with the real assembled `Options`.
