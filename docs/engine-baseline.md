# Engine baseline (Phase 00)

**Status:** baseline established; TWO FULL rounds of live verification complete (initial 2026-07-15, re-baseline 2026-07-24 per phase 23's engine-fact-drift ground rule — see "Re-baseline (2026-07-24)" callouts throughout), plus a THIRD, deliberately NARROW re-baseline on 2026-07-25 that extended the accepted range to the installed 2.1.220 **without re-running the spike suite** (see "Narrow re-baseline (2026-07-25)" below, and §14–§15 for the two facts it did record).
**Tested version (full spike suite):** `claude` CLI **2.1.218** (Claude Code), `@anthropic-ai/claude-agent-sdk` **0.3.218** — both npm-registry-current at time of the 2026-07-24 re-verification. (Originally tested at 2.1.210 / 0.3.210 on 2026-07-15; every fact below was re-run against 2.1.218 and reconfirmed unless a section explicitly says otherwise.) The 2026-07-25 narrow re-baseline did **not** move this point version: the suite was not re-run, so 2.1.218 / 0.3.218 remains the version the recorded probe verdicts were actually produced at (and is what `TESTED_ENGINE_VERSION` in `packages/engine-claude/src/version-gate.ts` mirrors, and what the live harness's own canary asserts the SDK-resolved engine reports before any live probe runs).
**Doc baseline (`docs/claude-code-adaptation.md`) was verified against:** 2.1.207 (2026-07-12).
**Accepted range:** **2.1.207–2.1.220**. The 2026-07-24 re-run reproduced every PASS verdict from the 2.1.207–2.1.210 pass with zero FAILs and zero observed load-bearing behavioral deltas (permission semantics, hermeticity, sandbox shapes, structured-output shape, session semantics, and the tool catalog are all byte-for-byte/behaviorally identical — see §9 for the full re-run tally and §10 for the explicit "what would have narrowed this" list, none of which fired), taking the range to 2.1.218; the 2026-07-25 narrow re-baseline extended the upper end again to 2.1.220 on the narrower basis described immediately below. The range is therefore extended rather than re-pinned to a fresh point; if a future re-run inside this range ever surfaces a genuine behavioral delta, that re-run must narrow the range at the version where the delta first appears, per the ground rule that a spanning range must never silently cross a changed fact. Node v24.18.0, WSL2 Linux (6.6.87.2-microsoft-standard-WSL2), `bwrap` 0.9.0 + `socat` present (installed mid-phase in the original pass; see §6).
**Date verified:** 2026-07-15 (original), **2026-07-24 (re-baseline, phase 23)**, **2026-07-25 (narrow re-baseline to 2.1.220)**.

**Narrow re-baseline (2026-07-25, `claude` CLI 2.1.220 — owner-approved):** the host's `claude` on `PATH` moved to **2.1.220**, outside the then-accepted 2.1.207–2.1.218 range; per CLAUDE.md's engine-fact-drift ground rule that is a re-baseline trigger, and the owner chose to **extend the range to 2.1.220 and accept the findings gathered against it** rather than pin the host back. **This round is deliberately narrower than the 2026-07-24 one and must not be read as equivalent:** none of the eight `spikes/*.mjs` scripts was re-run, no fixture was regenerated, and §9's verdict tally is unchanged. What it did produce is two new engine facts, each with committed evidence artifacts — §14 (path-scoped permission rules: an ISOLATED rule did not match, while the compiler's OWN full permission object DOES scope; the owed phase-03 carry-forward is therefore narrowed rather than closed, and the causal difference is undetermined — this section was **corrected on 2026-07-25** after first publishing an over-broad "no path-anchored form matches / the compiler's anchoring is inert" reading of only the first probe) and §15 (`--allowedTools` is variadic on the CLI). **Transport caveat, load-bearing:** only the **CLI transport** (`claude` resolved from `PATH`) is genuinely at 2.1.220 on this host. The **SDK transport** still resolves the engine binary bundled with `@anthropic-ai/claude-agent-sdk` **0.3.218** — `node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude --version` reports `2.1.218 (Claude Code)`, exactly as this header's engine-resolution note predicts — so §14's evidence, both artifacts of it, gathered through the SDK, was gathered at engine **2.1.218**, not 2.1.220, while §15's was read off the 2.1.220 `PATH` binary. The SDK's own accepted range is therefore deliberately **not** extended (§10 keeps 0.3.207–0.3.218), and `e2e/release/src/enginePinCheck.ts`'s `EXPECTED_SDK_PIN` stays `0.3.218`: the two version lines move together only when the SDK dependency is actually bumped, and it was not bumped here. Nothing observed in this round was a behavioral delta between 2.1.218 and 2.1.220, and no §10 invalidation trigger was seen to fire — but §10 was **not** re-checked item-by-item at 2.1.220 the way it was on 2026-07-24, so the upper end of this range rests on a weaker evidentiary base than its 2.1.218 point. A full-suite re-run at 2.1.220 (bumping `spikes/package.json` to the SDK release matching 2.1.220 and reinstalling, per the engine-resolution note below) remains owed (§11).
**This is the single citable baseline** — per the project's ground rule, anything engine-touching cites this document, never memory or the adaptation doc's own §10 open-questions list directly. The adaptation doc remains the _rationale_ record; this file is the _verified-fact_ record.

**Producing scripts:** `spikes/01-auth.mjs` … `spikes/08-tool-catalog-env.mjs` (re-runnable; see `spikes/README.md`; 01–07 map to roadmap/00's seven In-scope probes, 08 is the orchestrator-directed tool-taxonomy follow-up). **Fixtures:** `spikes/fixtures/*.verdicts.json` (one array per script) + sanitized transcripts (`*.transcripts.sanitized.json(l)`, `*.raw.sanitized.json`) reflect only the FINAL run of each script — as of 2026-07-24 that final run is the 2.1.218 re-baseline pass for every script. **Probe-run count:** the original (2026-07-15) formal runs totaled ~49 live model invocations (haiku throughout; spike 07 makes zero live calls by design — it scans committed fixtures), ~92 including development/debugging iterations. The 2026-07-24 re-baseline pass added approximately 30 further live model invocations (haiku, single/few-turn) across spikes 01–06 and 08 re-run cleanly once each; spike 07 again made zero live calls. **Engine resolution note (load-bearing for anyone re-running these spikes):** spikes 01–05 and 08 invoke the engine via the `@anthropic-ai/claude-agent-sdk` package, which bundles its own pinned native `claude` binary per-platform (`@anthropic-ai/claude-agent-sdk-linux-x64` etc.) — this is INDEPENDENT of whatever `claude` is on `PATH`. Re-baselining against a newer engine therefore requires bumping `spikes/package.json`'s SDK dependency to the matching `0.3.x` release (confirmed 1:1 with the CLI's `2.1.x` release throughout — `0.3.210`↔`2.1.210`, `0.3.218`↔`2.1.218`) and reinstalling, NOT just upgrading the system `claude` binary. Spike 06 (`sessions`) is the one exception: it spawns `claude` via `spawn("claude", ...)` resolved from `PATH` (`spikes/lib/cli.mjs`), so it always tests whatever CLI is installed system-wide.

---

## 1. Auth decision record (blocking spike, work item 2) — RESOLVED 2026-07-24

**Re-baseline update (2026-07-24, engine 2.1.218):** the `~/.claude/.eo-oauth-token` handoff file (mode 0600) now exists on this host, populated out-of-band by the owner between the original pass and this re-baseline. Re-running `spikes/01-auth.mjs` unchanged picked it up automatically and the primary path now PASSes. Both auth mechanisms are confirmed live; the phase's sole blocking UNRESOLVED item is closed.

| Path                                                                                                              | Status                                                                                                                                                                                                                                                                                                                                                                                                 | Verdict  |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| `CLAUDE_CODE_OAUTH_TOKEN` via `claude setup-token` (handoff-file path)                                            | **RESOLVED 2026-07-24.** Handoff file present (mode 0600 confirmed by the script’s own stat check); SDK worker (`settingSources: []`, isolated `CLAUDE_CONFIG_DIR`) resolved auth via the token and completed a turn with `subtype: "success"`, no interactive/browser login triggered. Originally UNRESOLVED on 2026-07-15 (no token minted, owner not present; `claude setup-token` is interactive). | **PASS** |
| `.credentials.json` fallback (copy into isolated `CLAUDE_CONFIG_DIR`, mode 0600, `settingSources: []` SDK worker) | Re-confirmed 2026-07-24 at 2.1.218 (508-byte credentials file, same shape as the original 2026-07-15 pass). SDK worker with `settingSources: []` resolved auth and completed a turn with `subtype: "success"`, no interactive/browser login triggered.                                                                                                                                                 | **PASS** |

**Go/no-go call (updated 2026-07-24):** BOTH mechanisms are now live-confirmed. The `.credentials.json` fallback remains the recommended v1 default (no interactive `setup-token` step required per worker), but the primary `CLAUDE_CODE_OAUTH_TOKEN`/handoff-file path is no longer a blocking gap — either may be cited as settled fact by phase 05/06.

**Consumer (cross-reference added 2026-07-25; no verdict changed):** `packages/engine-claude/src/auth.ts`'s `provisionWorkerAuth` implements BOTH mechanisms recorded above and deliberately never chooses between them itself — `kind: "credentialsFile"` copies the source `.credentials.json` into the worker's isolated `CLAUDE_CONFIG_DIR` at mode `0600` (exclusive `O_CREAT|O_EXCL|O_NOFOLLOW` create, so a pre-planted symlink or pre-existing file at the dest is refused rather than followed/overwritten; on resume/fork a byte-identical dest is accepted as-is and a byte-mismatched one is refused as tampering), while `kind: "oauthToken"` writes no file at all and returns `{ CLAUDE_CODE_OAUTH_TOKEN: token }` for `buildWorkerEnv` to fold into the worker's from-scratch allowlisted env (§4.3's `PATH`/`HOME`/`TMPDIR`/`TMP`/`CLAUDE_CONFIG_DIR` set, nothing inherited). The caller that does choose is `packages/cli/src/daemon/run-dispatcher.ts`'s `resolveWorkerAuthMaterial`, whose precedence — `CLAUDE_CODE_OAUTH_TOKEN` env → `~/.claude/.eo-oauth-token` → `~/.claude/.credentials.json`, returning `undefined` (refuse to dispatch) when none is present — cites this section by name as its source of truth. Both mechanisms are therefore live in shipped code, and BOTH of this section's PASS verdicts are load-bearing for it: the handoff-file path is not vestigial.

- **Sanitization fix applied during re-baseline (2026-07-24):** the first re-run of `spikes/01-auth.mjs` against the now-present handoff file wrote the literal real `$HOME` path (via `tokenSource = \`file:${TOKEN_HANDOFF_FILE}\``) into the committed verdict fixture, tripping the script's own `$HOME`-leak scan (`scanForSecrets`, exit code 1) — this is the known path-leak the phase-23 task flagged. Fixed in `spikes/01-auth.mjs`: the observed-field now reports a sanitized `file:$HOME/.claude/.eo-oauth-token`placeholder (the credentials-fallback "not found" branch was sanitized the same way defensively, though not hit this run). Re-run after the fix produced a clean sanitization scan; the committed`spikes/fixtures/01-auth.verdicts.json` contains no real path.
- Security: no script writes credential bytes anywhere outside an `os.tmpdir()` scratch dir that is deleted in a `finally` block; `spikes/01-auth.mjs` also greps its own output for the first 8 characters of any real OAuth token used, in addition to the shared `sk-ant-*`/token-blob/`$HOME` scan (§7).
- **Env-inheritance caveat (checked):** these spikes run nested inside a live Claude Code session, whose env (`CLAUDECODE`, `CLAUDE_CODE_*`, auth-adjacent vars) could in principle mask auth-resolution results if inherited by the worker. **Both auth probes used a strictly allowlisted, from-scratch env** (`PATH`, `HOME`=isolated, `CLAUDE_CONFIG_DIR`=isolated, plus — token path only — `CLAUDE_CODE_OAUTH_TOKEN`); the SDK's `Options.env` replaces the subprocess environment entirely, so the fallback PASS reflects genuine `.credentials.json` resolution, not inherited ambient auth. See §4.3.

Fixture: `spikes/fixtures/01-auth.verdicts.json` (regenerated 2026-07-24 at engine 2.1.218; sanitization-clean).

---

## 2. Hermeticity verdict (work item 3)

The `settingSources: []` SDK worker — the confirmed v1 transport (adaptation §0/§5.3), not `--bare` — was tested against a rogue "user"-tier `settings.json` (planted at an isolated `CLAUDE_CONFIG_DIR`, never the real `~/.claude`), a rogue project-tier `settings.json` + `PreToolUse` hook, a rogue `CLAUDE.md`, and a rogue project `.mcp.json` (pointing at a nonexistent binary).

**Evidence-soundness fix (validation round):** the first version of this probe asked the worker to hunt for env vars and "secret instruction phrases" — the model **refused it as a suspected prompt-injection test and made zero Bash calls** (reproduced independently), which made the env/hook marker-absence assertions vacuous (absence was guaranteed by the refusal, not by hermeticity). The probe was rewritten: benign CI-diagnostics framing with neutral variable names (`CRABGIC_CHECK_A`/`CRABGIC_CHECK_B`), a **hard guard requiring a Bash `tool_use` to have actually executed** (zero calls → those sub-probes report UNRESOLVED, never a vacuous PASS), marker-absence asserted from the executed call's `tool_result`, and the CLAUDE.md test switched to a benign planted instruction ("end every reply with `PINEAPPLE-CI-77`") whose effect would be visible in a normal reply. The re-run executed the Bash call for real.

| Sub-probe                                                                                       | Verdict  | Evidence (committed fixture)                                                                                                                              |
| ----------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rogue user-tier + project-tier `settings.json` `env` blocks NOT injected into worker's Bash env | **PASS** | 1 executed Bash `tool_use` (`echo A=$CRABGIC_CHECK_A B=$CRABGIC_CHECK_B`); `tool_result` = `"A= B="` — both expansions empty from a genuinely-run command |
| Rogue user-tier + project-tier `PreToolUse` hooks do NOT fire                                   | **PASS** | Bash executed, so the `Bash` hook matcher was eligible; neither hook's `touch`-marker file was created                                                    |
| Rogue `CLAUDE.md` instruction has NO observable effect                                          | **PASS** | final reply exactly `"DONE"`; planted token absent from reply and entire transcript                                                                       |
| Rogue project `.mcp.json` NOT auto-discovered (absent from init `mcp_servers`)                  | **PASS** | init `mcp_servers = []` (structural)                                                                                                                      |

**All four PASS on executed-call evidence — no partial-hermeticity surprise on settings/hooks/CLAUDE.md/.mcp.json.** This resolves adaptation §10 item 3 (`settingSources` default ambiguity) for the _explicit-`[]`_ case: phase 03's compiler and phase 06's spawn path may build on this holding, as designed. Phase 09's doctor hermeticity self-test should reuse the executed-call guard — an assertion of absence is only sound when the probing command demonstrably ran.

**Separately confirmed from the SDK's own type declarations** (not requiring a live probe): `settingSources` **omitted** defaults to loading **all** filesystem sources (user/project/local), matching CLI defaults — it is not itself ambiguous in the current SDK; the ambiguity adaptation §10 item 3 flagged was about cross-doc inconsistency, not the shipped behavior. Downstream phases should still always pass `settingSources: []` explicitly per that item's own mitigation — this is now a "belt" on top of a "suspenders" default, not a load-bearing requirement.

**Re-baseline (2026-07-24, engine 2.1.218):** all four sub-probes re-run and PASS, identical shape to the 2026-07-15/2.1.210 pass (same executed-call-guard evidence, no partial-hermeticity surprise).

Fixtures: `spikes/fixtures/02-hermeticity.verdicts.json`, `02-hermeticity.transcript.sanitized.jsonl` (both regenerated 2026-07-24).

---

## 3. Permission probes (work item 4)

All run via SDK `query()` with `settingSources: []` + an explicit `settings` object carrying the permission envelope under test (the confirmed v1 worker-launch shape), `permissionMode: "dontAsk"`, reading the SDK result's `permission_denials: {tool_name, tool_input}[]` field — with one necessary exemption: the **deny-wins-cross-level** probe by definition needs two filesystem settings tiers, so it alone ran with `settingSources: ["user", "project"]`, pointing at planted `settings.json` files inside isolated scratch dirs (`CLAUDE_CONFIG_DIR`-relative user tier, scratch-cwd `.claude/` project tier — never the real `~/.claude`).

| Sub-probe                                                               | Verdict  | Note                                                                                                                                                                                                                |
| ----------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dontAsk` auto-denies an unlisted tool (`Write`, not in any allow rule) | **PASS** |                                                                                                                                                                                                                     |
| Compound-command smuggling (`echo x && curl …`) denied                  | **PASS** | curl subcommand independently fails to match `Bash(echo:*)`                                                                                                                                                         |
| Process-wrapper smuggling (`nohup curl …`) denied                       | **PASS** | wrapper stripped, curl still fails to match                                                                                                                                                                         |
| Deny-wins-over-allow, same settings level                               | **PASS** | rule present in both `allow` and `deny` at one level → denied                                                                                                                                                       |
| Deny-wins-over-allow, cross settings level                              | **PASS** | user-tier `deny` beat project-tier `allow` for the identical rule                                                                                                                                                   |
| `Edit` outside the allowed path denied                                  | **PASS** | model also tried a `Bash(sed -i …)` workaround after the `Edit` denial — **also denied** (Bash wasn't allow-listed at all in this config); file left byte-identical                                                 |
| `Agent` deny blocks subagent spawning                                   | **PASS** | resolved by spike 08 after an initial UNRESOLVED pass — see §4: the `Agent` **rule name** aliases the live **`Task`** tool literal, and deny enforcement is **catalog-removal** (fail-closed), not call-time denial |
| Bash colon-spacing (`Bash(cargo check:*)` vs `Bash(cargo check :*)`)    | **PASS** | see below                                                                                                                                                                                                           |

**Scope note on the `Edit` outside-the-allowed-path row (added 2026-07-25):** that sub-probe asserts only what it says — the out-of-path `Edit` was denied and the file was left byte-identical. It carried a lone `Edit(//tmp/<allowed-dir>/**)` allow rule with **no in-path control**, so it does not show that the path anchor MATCHED (an anchor that matches nothing yields the same denial under `dontAsk`). Do not cite this row in either direction on the path-anchoring question; §14 is the section that measures it.

### Bash colon-spacing verdict (load-bearing for phase 03)

Tested a prefix **outside** the doc's four confirmed literals (`Bash(npm run test:*)`, `Bash(npm run build:*)`, `Bash(git status:*)`, `Bash(git diff:*)` — none show a space before the colon):

- `Bash(cargo check:*)` (**no space** before the colon) → **matched and allowed** `cargo check --workspace`.
- `Bash(cargo check :*)` (**space** before the colon) → **did NOT match**; the command was denied.

**Verdict: the no-space form is required**, consistent with the doc's four literal examples. Phase 03's envelope compiler may generalize `Bash(<prefix>:*)` (no space before the colon) to arbitrary prefixes beyond the doc's four literals.

**Re-baseline (2026-07-24, engine 2.1.218):** all 8 sub-probes re-run and PASS, including the colon-spacing verdict (no-space form still required) and the `Agent`→`Task` catalog-removal behavior (§4). No change in permission-rule matching semantics observed.

Fixtures: `spikes/fixtures/03-permissions.verdicts.json`, `03-permissions.transcripts.sanitized.json` (both regenerated 2026-07-24).

---

## 4. Tool taxonomy — RESOLVED: `Agent` rule name aliases the live `Task` tool; deny enforcement is catalog-removal

An initial spike-03 pass recorded a surprise here (no tool named `Agent`; `permission_denials: []` under `deny: ["Agent"]`). A dedicated follow-up spike (`spikes/08-tool-catalog-env.mjs`, run at the orchestrator's direction to test an env-contamination hypothesis) plus re-analysis of the spike-03 fixtures resolved it fully. Facts, in decreasing order of load-bearing-ness for phase 03:

### 4.1 The subagent-spawn tool's live literal name is `Task`; the permission-rule name `Agent` aliases it

- Under the **default** permission mode (no deny rules), the engine's tool catalog **includes a tool literally named `Task`** — on the SDK transport and the CLI transport alike, under both a strictly allowlisted env and a fully inherited env (spike 08, all three catalogs byte-identical, engine 2.1.210 in every capture; re-confirmed byte-identical again at engine 2.1.218 in the 2026-07-24 re-baseline, §4.4).
- **No tool literally named `Agent` exists** in any captured catalog (12 init-message captures across spikes 03 and 08).
- Across the **committed** spike-03 fixture (`03-permissions.transcripts.sanitized.json`, which holds only the final run of the script), `Task` is present in **6/6** runs whose settings did _not_ deny `Agent`, and absent in the **1/1** run whose settings contained `deny: ["Agent"]` (`agent-deny-default`). The superseded initial pass of spike 03 additionally showed the same absence in a second `deny: ["Agent"]` run (`agent-deny-with-agents-option`) — that run's transcript was overwritten when the script was re-run with the corrected assertion and survives only in console history, so it is cited here as corroboration, not committed evidence. Spike 08's committed `deny: ["Task"]` run shows the identical removal. The `Agent` **rule name** maps to the `Task` **tool literal**.

### 4.2 Deny enforcement mechanism: catalog-removal, not call-time denial

With `deny: ["Agent"]` (or `deny: ["Task"]` — spike 08 confirmed both) active, the `Task` tool is **removed from the model's tool catalog entirely** (absent from the init message's `tools` list). The model can never attempt the call, so `permission_denials` stays empty **by design** — the original "no denial recorded" observation was this fail-closed removal, not a bypass. Phase 06's conformance checks must assert this as **absence-from-catalog**, not as a recorded denial event. Verdict: **PASS** (`permissions.agent-deny-blocks-subagent` re-run in spike 03 with the corrected assertion; `tool-catalog.subagent-literal-deny` in spike 08).

### 4.3 Env-contamination hypothesis: REFUTED (and the spawn-env discipline is a baseline fact anyway)

- **Every spike 01–06 SDK probe already constructed its worker env from scratch** (allowlist: `PATH`, `HOME`=isolated, `CLAUDE_CONFIG_DIR`=isolated, plus probe-specific vars). The SDK's `Options.env` docstring states the value **replaces** the subprocess environment entirely; the SDK itself stamps `CLAUDE_CODE_ENTRYPOINT="sdk-ts"` into the child. The surprising catalog was therefore never an inherited-env artifact.
- The explicit comparison (spike 08): SDK worker under strict allowlist env (`PATH`, `HOME`, `TMPDIR`, `CLAUDE_CONFIG_DIR` only) vs. under the full inherited env of a live nested Claude Code session (`CLAUDECODE`, `CLAUDE_CODE_*`, `AI_AGENT`, etc. present) → **tool catalogs identical**.
- **Baseline fact for phase 06's spawn path regardless:** workers must be spawned with an explicitly allowlisted env. On this engine version env inheritance did not alter the catalog, but the allowlist is what makes that a non-issue by construction, and it is already the confirmed behavior of every probe in this suite (fixture: `spikes/fixtures/08-tool-catalog-env.catalogs.sanitized.json`, both catalogs recorded).

### 4.4 The broad default catalog itself (residual, non-blocking)

The default catalog on this host — `Task, Bash, CronCreate, CronDelete, CronList, DesignSync, Edit, EnterWorktree, ExitWorktree, Monitor, NotebookEdit, PushNotification, Read, RemoteTrigger, ReportFindings, ScheduleWakeup, SendMessage, Skill, TaskCreate, TaskGet, TaskList, TaskOutput, TaskStop, TaskUpdate, ToolSearch, WebFetch, WebSearch, Workflow, Write` — is larger than adaptation Appendix A/B's assumed inventory (no `Grep`/`Glob` as dedicated tools; many additional built-ins). Since it is **identical across SDK/CLI transports, and across allowlisted/inherited envs, at engine 2.1.210**, it is engine-default behavior as far as this host can determine, not host contamination. Impact on v1 is low: the worker profile is `dontAsk` + explicit **allow-list**, and §3 confirms unlisted tools (e.g. `Write`) are auto-denied regardless of how large the ambient catalog is. The catalog list above is itself part of this baseline; a changed list on a future version is a baseline-invalidating event (§10).

**Re-baseline (2026-07-24, engine 2.1.218): catalog explicitly re-captured, BYTE-IDENTICAL.** Spike 08 was re-run at 2.1.218 (both SDK-transport catalogs — allowlisted-env and inherited-env — plus the CLI-transport catalog); all three are the exact same 29-tool list quoted above, in the exact same order, on both transports. This is the explicit re-capture the original baseline flagged as required before this fact could be trusted as engine-default rather than host/account-specific (§4.4's original "residual MITIGATION"); it did not change across the 2.1.210→2.1.218 bump, so that mitigation is now satisfied for this version range. **Non-blocking observation, NOT a tool-catalog change:** the (separate) `slash_commands` field in the SDK/CLI `init` message gained at least one new entry, `workflow-launch-exec`, between the 2026-07-15 and 2026-07-24 captures (and some accounts' captures show `usage-credits`/`extra-usage` present or absent inconsistently across both passes — this looks like account/feature-flag variation, not a version-keyed change). `slash_commands` is a CLI/UX surface, distinct from the `tools` array this baseline tracks for permission-enforcement purposes, and is out of this baseline's tracked scope; noted here only so a future reader isn't surprised by the diff.

- **Residual MITIGATION (downgraded from blocking):** a one-time catalog capture on a clean, non-dev-workstation install remains worthwhile before release hardening (phase 23) to confirm 4.4's list is engine-default rather than account/host-specific — but phase 03 is no longer blocked: the `Agent`→`Task` aliasing, the removal-based enforcement, and the allow-list posture are all confirmed on both transports under sanitized envs.

---

### 4.5 A bare `allowedTools` entry SHADOWS `canUseTool` for that tool (live-observed 2026-07-30)

Observed on the SDK transport during the first real end-to-end run, at engine
`2.1.218` (inside the accepted range `2.1.207`–`2.1.220`,
`ACCEPTED_ENGINE_VERSION_RANGE`). The SDK emitted it unprompted, on the worker's
stderr:

```
(node:765861) [CLAUDE_SDK_CAN_USE_TOOL_SHADOWED] Warning: canUseTool will not be
invoked for: mcp__crabgic_gateway__*. Bare allowedTools entries auto-approve the
whole tool before the callback is consulted. To gate every tool call, use a
PreToolUse hook; or remove the bare names from allowedTools so they fall through
to canUseTool. Allow rules from settings files can also shadow the callback but
are not visible here.
```

Three facts, in decreasing order of load-bearing-ness:

- **A tool named outright in `allowedTools` is auto-approved BEFORE `canUseTool`
  runs.** The callback is not consulted for it at all. This is not conditional on
  `permissionMode`: the shadowing comes from the allow entry, not the mode.
- **Allow rules in settings files shadow it the same way**, and the SDK says it
  cannot enumerate those in the warning — so the absence of a warning is not
  evidence that the callback is reached.
- **A `PreToolUse` hook is the engine's own named remedy** for gating every call,
  because hooks run before permission evaluation rather than after it.

**Why this matters here:** `compileEnvelope` grants the gateway family by naming
`mcp__${GATEWAY_MCP_SERVER_NAME}__*` tools in `allowedTools`, so phase 06's
journal-first fail-closed `AdjudicationCallback` never fires for any connector,
evidence or review call. The static allow/deny catalog and the OS sandbox are
unaffected — what is lost is the per-call audit record, not the boundary. See
`docs/security-posture.md` §Residual risk, which previously presented that bridge
as covering these calls.

**This resolves a previously-UNPROBED fact and answers it in the opposite
direction to the assumption.** The prior record asked only whether `canUseTool`
fires under `permissionMode: "dontAsk"`; the real variable was the allow entry,
and no permission mode changes it.

**Independently reproduced in this repository's own harness, 2026-07-30.**
`packages/engine-claude/src/live/mcp-adjudication-shadowing.live.test.ts` wires
the stub gateway with one callable tool and grants it by name; every run emits
`CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` naming the stub gateway's own
`probe.echo` tool specifically. The SDK emits that only for a tool it has registered and whose
permission it has evaluated, so this is not an inference from a generic warning.

**The remedy IS a baseline fact now — a `PreToolUse` hook fires for an MCP tool
call.** Observed directly: on a run where the model genuinely invoked the stub
tool, the hook's recorded `tool_name` list contained it. So the adjudication
bridge can be rebuilt on a hook, which is the remedy the SDK's own warning names.

### 4.6 The engine normalizes a dot in an MCP tool name to an underscore

Measured alongside the above, and the most actionable of the three facts here.
The stub server advertises `probe.echo`. The SDK's shadowing warning quotes the
**dotted** form. The model's `tool_use` block, and the `tool_name` a `PreToolUse`
hook observes, both carry the **underscored** form — `mcp__<server>__probe_echo`.

Every real gateway tool is dotted (`contract.approve`, `run.status`,
`tracker.apply`, `capability.audit`), so **a hook matcher written against the
advertised name matches nothing**: a control that looks installed and is not.
That is the same shape of defect as the shadowing itself, and it cost three
inconclusive probe runs to notice, because the probe was asserting on a name the
engine never emits.

**Probe reliability, stated so nobody reads a red run as a regression:** the
`haiku` worker invoked the stub tool roughly one run in eight across eight live
runs, on identical options. The probe retries the precondition and still ends
INCONCLUSIVE most of the time. Both facts rest on positive observations, which
non-reproduction does not weaken.

### 4.7 A matched RULE-SHAPED allow entry shadows `canUseTool` exactly like a bare name (live-measured 2026-07-30)

§4.5 established shadowing for a tool named **outright** in `allowedTools`; its
warning added, unquantified, that settings-file allow **rules** "can also shadow
the callback but are not visible here". The compiled profile grants
`Bash`/`Edit`/`Write` only ever by rule (`Bash(<prefix>:*)`,
`Edit(//<worktree>/…/**)` — `emitPermissionProfile` emits no bare built-in
name), so whether a _matched rule_ short-circuits before `canUseTool` decided
whether the mutation-capable tools execute with any adjudication record at all.
Adversarial review (2026-07-30) found this unverified in either direction.

Measured at engine `2.1.218` (inside `2.1.207`–`2.1.220`) by
`packages/engine-claude/src/live/builtin-allow-rule-shadowing.live.test.ts`,
which grants exactly the production-shaped `Bash(git status:*)` rule down both
production channels (`settings.permissions.allow` + `allowedTools`) and drives
a real `git status` to completion, both probes conclusive on the first run:

- **`canUseTool` is NOT invoked for a `Bash` call a rule-shaped allow entry
  matched.** The executed-call guard held (real `git status` output came back),
  so this is "auto-approved before the callback", not "denied before the
  callback".
- **A `PreToolUse` hook DOES fire for that same matched call** — the same
  remedy as §4.5, so one hook can cover the gateway family and the rule-granted
  built-ins alike.

**Measured scope, stated precisely:** the probe measured the `Bash(<prefix>:*)`
shape. The `Edit`/`Write` path-rule shapes are NOT separately probed; the SDK's
own warning generalizes the mechanism to every settings allow rule, and the
bridge covers them regardless — if a shape turns out not to shadow, `canUseTool`
double-covers it, which double-journals and nothing worse.

**Why this matters here:** with §4.5 + §4.7 together, _no_ production tool
grant — bare gateway names or rule-shaped built-ins — reaches `canUseTool`.
The per-call adjudication record therefore lives entirely on the `PreToolUse`
bridge (`packages/engine-claude/src/tool-adjudication-hook.ts`); `canUseTool`
remains installed as a backstop for any grant shape not yet measured, and no
document should claim it adjudicates the compiled profile's own grants.

### 4.8 The engine ALLOWS metacharacter-bearing commands inside a matched `Bash(<prefix>:*)` rule (live-measured 2026-07-30)

§3 probed compound operators (`&&`/`||`/`;`/`|`) and process wrappers; it never
probed redirects, quoting, or the other shell metacharacters the envelope
adjudication policy fails closed on (`adjudication-policy.ts`,
`UNPROVEN_SHELL_METACHARACTER_PATTERN` — `& $ \` < > \r \n`). Measured at
engine `2.1.218`, under an `allowedTools`/`allow`grant of exactly`Bash(git status:*)`:

- **`git status 2>&1` EXECUTES** — real `git status` output returned, zero
  `permission_denials`. The redirect characters (`>`, `&`) do not defeat the
  prefix match. In-repo probe:
  `builtin-allow-rule-shadowing.live.test.ts` ("the ENGINE allows a
  metacharacter-bearing command…").
- **`git status --porcelain "a|b"` EXECUTES** — a QUOTED `|` does not make the
  engine treat the command as a compound with an unmatched segment (one-off
  measurement, same session; the policy's quote-unaware splitter denies it).

**Consequence:** the envelope adjudication policy is measurably STRICTER than
the engine inside a matched prefix rule. A control that turns the policy's
verdict into a refusal for built-in calls refuses commands the engine grants —
`npm run test 2>&1` is the everyday casualty — which is why the
tool-adjudication bridge records built-in verdicts without acting on them
(record-not-refuse; the enforced boundary remains the engine's own rule
evaluation plus the OS sandbox).

## 5. Structured-output probe (work item 6)

Transport: SDK `query()` — `Options.outputFormat: {type: 'json_schema', schema}` is the confirmed SDK field name (the CLI `--json-schema` flag's SDK equivalent; adaptation §4.4 only said "SDK equivalent" without naming it — there is no field literally called `jsonSchema` on `Options`).

| Sub-probe                                                                                | Verdict                                                         |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Happy path: well-formed request → validated `structured_output`                          | **PASS** — `{"answer":"hello","count":3}`, `subtype: "success"` |
| Deliberate schema violation (model told to ignore the schema and reply with a bare word) | **PASS** (recorded, not judged — see below)                     |

**Exact observed schema-violation behavior** (verbatim, as the roadmap requires): the model **declined to call the internal `StructuredOutput` tool at all**, explaining in plain text that it wouldn't call it without a legitimate request. The result still came back `subtype: "success"`, `is_error: false`, with `structured_output: undefined` — **no retry loop was forced, no non-zero exit, no typed error subtype** in this scenario. This reveals an implementation detail not in the adaptation doc: schema-constrained output is mediated by an internal tool named **`StructuredOutput`** that the model chooses to call (or not) — it is not a hard grammar constraint on the final message.

**Separately confirmed from the SDK's own type declarations:** a distinct result subtype `error_max_structured_output_retries` exists (`SDKResultError.subtype`), implying the engine _does_ auto-retry and can hard-fail after exhausting retries — but only, apparently, when the model _attempts_ the `StructuredOutput` tool call with invalid arguments repeatedly, not when it simply never calls the tool (as observed here). **This retry-exhaustion path itself remains UNRESOLVED/unobserved** — provoking a model into repeatedly attempting-but-failing structured output (rather than declining outright) was not achieved in this pass.

- **MITIGATION (partial UNRESOLVED):** phase 06 should treat "no `structured_output` field, `subtype: success`" as a normal, expected failure-to-produce-structured-output shape requiring its own repair-attempt trigger (not just the `error_max_structured_output_retries` subtype) — that success-shaped absence is what was actually observed. Re-probe the retry-exhaustion path specifically (e.g. a schema the model will keep trying to satisfy but structurally cannot) if that distinct shape needs its own repair-path branch.

**Re-baseline (2026-07-24, engine 2.1.218):** both sub-probes re-run and PASS; the schema-violation behavior is identical in shape — the model still declines the `StructuredOutput` tool call outright (`subtype: "success"`, `structured_output: undefined`), and `error_max_structured_output_retries` remains unobserved/UNRESOLVED (retry-exhaustion path still not reproduced).

Fixtures: `spikes/fixtures/05-structured-output.verdicts.json`, `05-structured-output.transcripts.sanitized.json` (both regenerated 2026-07-24).

---

## 6. Sandbox probes (work item 5) — full suite run, bwrap + socat installed mid-phase

**Host update mid-phase:** bubblewrap 0.9.0 and socat were installed by the orchestrator (`/usr/bin/bwrap`, `/usr/bin/socat`) partway through this phase. All six sandbox sub-probes below were run **for real**, superseding the originally-anticipated "absent, mostly UNRESOLVED" path.

Transport: SDK `query()` — **`Options.sandbox`** (the top-level SDK field), **not** `settings.sandbox`. These have a materially different `failIfUnavailable` default: `Options.sandbox` defaults `failIfUnavailable` to **true** once `enabled: true` is set (query errors out rather than degrading), while the settings.json-level `sandbox.failIfUnavailable` key defaults to **false** (warns, runs unsandboxed). Both were exercised explicitly with `failIfUnavailable: true` here regardless.

| Sub-probe                                               | Verdict  | Detail                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bwrap` presence                                        | **PASS** | found at `/usr/bin/bwrap`                                                                                                                                                                                                                                                                                                                                                            |
| `failIfUnavailable` aborts when forced-broken           | **PASS** | `PATH` starved to exclude `bwrap`; `query()` threw `"Sandbox required but unavailable: ... bubblewrap (bwrap) not installed, socat not installed ..."` rather than running unsandboxed                                                                                                                                                                                               |
| Egress denied, empty `allowedDomains`                   | **PASS** | see behavior note below                                                                                                                                                                                                                                                                                                                                                              |
| UDS reachable with the correct Linux flag               | **PASS** | see schema correction below                                                                                                                                                                                                                                                                                                                                                          |
| `denyRead ~/.ssh` enforced                              | **PASS** | attempted-and-blocked, both arms executed: no-deny arm's `cat` returned the marker content (read-open default); with-deny arm's `cat` was attempted (1 `tool_use`) and its own failure line reads `cat: <path>: No such file or directory` — **denyRead masks the path as nonexistent (ENOENT), not EACCES/"Permission denied"** — with zero content leak (see confound notes below) |
| `credentials.envVars mode: mask` shows placeholder only | **PASS** | real value never appeared in transcript; some (non-real) `VALUE=` output was observed                                                                                                                                                                                                                                                                                                |

### Behavior note: egress denial shape

A Bash-invoked `curl` to `http://example.com` with `network.allowedDomains: []` did **not** fail as connection-refused/DNS-failure — **the sandbox's own network proxy answered the request itself with HTTP 403** (`curl` exited 0 — it successfully reached the proxy, which then refused it). Record this shape verbatim for phase 06's egress-denial detection: check for the proxy's own 403 (or other synthesized HTTP response), not only OS-level connection errors.

### Schema correction: Unix-socket allow flag

Adaptation Appendix A cites `network.allowUnixSockets: true` as a **boolean**. The live `SandboxSettings.network.allowUnixSockets` field is typed **`string[]`** — a **macOS-only** path allowlist, explicitly documented as **"ignored on Linux (seccomp cannot filter by path)"**. The Linux/WSL2-relevant gate is a **differently-named boolean key: `allowAllUnixSockets`**. Confirmed empirically: default config → UDS unreachable; `network.allowAllUnixSockets: true` → UDS reachable. **Phase 03/06 must use `allowAllUnixSockets` on Linux/WSL2, not `allowUnixSockets`.**

### Clarification: sandbox filesystem/network keys are supplementary, not primary

The SDK's own `Options.sandbox` docstring states filesystem and network restrictions are actually configured via **permission rules** (`Read(...)`/`Edit(...)` allow/deny, `WebFetch(domain:...)`), and the `sandbox.filesystem.*`/`sandbox.network.*` keys **merge with** those rules rather than being the primary mechanism (e.g. `sandbox.filesystem.denyRead` docstring: "merged with paths from `Read(...)` deny permission rules"). This refines — does not contradict — adaptation §4.2's schema example, which put filesystem/network config directly under `sandbox: {...}`; that block still works, but the source of truth for what an envelope compiler should touch first is the permission-rule layer, with `sandbox.*` as the supplementary/behavioral layer (`enabled`, `failIfUnavailable`, `allowAllUnixSockets`, `credentials.*`, etc.).

### Methodology notes (two confounds found and fixed)

1. An initial run of the `denyRead ~/.ssh` probe using a file literally named `fake_id_rsa` with "PRIVATE_KEY" wording in its content caused **the model's own safety training to refuse the `cat` command outright**, in both arms — a false signal caused by the model, not the sandbox. Fixed by keeping the directory literally named `.ssh` (required for the `~/.ssh` rule to apply) but renaming the file/content to neutral markers.
2. A validation-round audit found the with-deny arm STILL vacuous after fix 1: the model saw the `denyRead` restriction in the Bash tool description and **refused pre-emptively without attempting the read**, so "marker absent" proved nothing. Fixed by framing the read as an expected-to-fail sandbox diagnostic (attempting it is the compliant behavior) and hardening the assertion to **attempted-and-blocked**: a `cat` `tool_use` must exist AND the cat's own failure line must carry a denial-class errno (incidental noise lines such as `.bashrc: Permission denied` chatter are excluded from the match); an arm with zero attempts reports UNRESOLVED, never PASS. The re-run executed the read in both arms.

Both are durable pitfalls for anyone re-running these probes; the executed-call guard pattern (also applied to spike 02, §2) should carry into phase 09's doctor checks. The ENOENT-masking enforcement shape recorded above is load-bearing for phase 06: detection of a blocked read must key on "file unexpectedly absent", not on an EACCES-style permission error.

**Re-baseline (2026-07-24, engine 2.1.218):** all 6 sub-probes re-run and PASS. Same host (`bwrap`/`socat` still present); identical shapes confirmed — egress-denial via proxy-issued HTTP 403 (not connection failure), `allowAllUnixSockets` still the correct Linux gate, `denyRead` still masks as ENOENT (not EACCES), masked-credential placeholder still never leaks the real value.

Fixtures: `spikes/fixtures/04-sandbox.verdicts.json`, `04-sandbox.transcripts.sanitized.json` (both regenerated 2026-07-24).

---

## 7. Session probes (work item 7)

Transport: CLI subprocess (`claude -p`, spawned directly via `child_process`, no shell) — needed for literal `kill -9` process control and true concurrent-OS-process interleaving testing; both transports spawn the same underlying engine.

| Sub-probe                                                                 | Verdict  | Detail                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-assigned `--session-id` honored                                       | **PASS** | result `session_id` == requested UUID; transcript file created at `<CLAUDE_CONFIG_DIR>/projects/<munged-cwd>/<uuid>.jsonl`                                                                                                                                                              |
| `kill -9` mid-run → `--resume` continuity                                 | **PASS** | worker told to remember "42" then `sleep 8` via Bash, streaming (`stream-json --include-partial-messages`); SIGKILLed after the first stream event arrived (3.5s floor), leaving a 23-event crash-truncated prefix in the fixture; `--resume <same-id>` from the same cwd recalled "42" |
| `--fork-session` transcript isolation                                     | **PASS** | original transcript file byte-identical before/after fork; fork got a distinct `session_id`; fork recalled prior context ("BANANA123"); fork has its own transcript file                                                                                                                |
| Two concurrent same-dir sessions, distinct `--session-id`s, no interleave | **PASS** | two processes launched concurrently in the same cwd, each told a distinct secret word + `sleep 3`; resuming each afterward recalled only its own word, never the other's                                                                                                                |

Confirmed munged-cwd pattern: cwd `/a/b/c` → transcript directory name `-a-b-c` (leading `/` → leading `-`, remaining `/` → `-`), matching adaptation Appendix A's claim.

**Re-baseline (2026-07-24, engine 2.1.218):** all 4 sub-probes re-run and PASS via the CLI transport (`claude` resolved from `PATH`, genuinely 2.1.218 — see the header's engine-resolution note). Session-id assignment, kill-9/resume continuity, fork-session isolation, and no-interleave all reproduced with no behavioral change; the munged-cwd transcript-path pattern is unchanged.

Fixtures: `spikes/fixtures/06-sessions.verdicts.json`, `06-sessions.raw.sanitized.json` (both regenerated 2026-07-24).

---

## 8. Rate-limit signal capture (work item 8)

**Re-baseline (2026-07-24, engine 2.1.218):** re-run of `spikes/07-ratelimit.mjs` (itself still zero live API calls, by design — it only scans the other scripts' committed fixtures). Same policy as the original pass: no dedicated live trigger against the owner's subscription.

**Fixture-retention decision (2026-07-24):** the 2.1.218 re-run of spikes 02–05 incidentally produced 16 `rate_limit_event` messages again, same count as the original pass, but that re-run's shorter probe session happened to land on a single steady utilization band (one distinct payload) rather than the original pass's 4 distinct payloads spanning `allowed`/`allowed_warning` at 0.96/0.98/0.99. Since §9/§10 confirm the `rate_limit_event`/`rate_limit_info` schema and every other observed behavior in these four transcripts (`02-hermeticity.transcript.sanitized.jsonl`, `03-permissions.transcripts.sanitized.json`, `04-sandbox.transcripts.sanitized.json`, `05-structured-output.transcripts.sanitized.json`) are byte-for-byte/behaviorally IDENTICAL between 2.1.210 and 2.1.218, the narrower 2.1.218 capture would have thrown away real representative coverage (the 0.96/0.98/0.99 multi-variant band, and the non-warning `allowed` sample) for no engine-fact reason. **The four transcript fixtures were therefore restored to their original 2026-07-15/2.1.210 captures** (`git show 008ae4b~1:spikes/fixtures/<file>`, byte-identical to the pre-re-baseline state — `008ae4b` is the commit that first landed the narrower 2.1.218 captures) rather than left at the narrower 2.1.218 re-capture — this is a deliberate retention of richer, still-valid evidence, not an oversight. **The COMMITTED fixtures below hold the full original 4-payload/16-sample set, not the narrower single-payload 2.1.218 re-run** (`spikes/fixtures/07-ratelimit.verdicts.json` was re-generated afterward by re-running `spikes/07-ratelimit.mjs` against these restored transcripts, so its own recorded `observed` text also cites the full 0.96/0.98/0.99 set again). Everything else about these four scripts (02/03/04/05's own PASS verdicts, permission/hermeticity/sandbox/structured-output behavior) was independently re-confirmed live at 2.1.218 during this re-baseline (§2–§6, §9) BEFORE this retention decision was made; only the transcript fixture files' bytes were reverted, not the verdicts recorded elsewhere in this document.

**No dedicated live trigger was run** — the owner's subscription (the same account every spike authenticates as) hit a session limit earlier on 2026-07-15 before this phase began, and mid-phase the limit was hit AGAIN, interrupting this phase's own fix round; deliberately exhausting it further was and remains unsafe. However, a validation-round audit found that **the structured signal shape did not need triggering: it was already captured incidentally** — the SDK streams `rate_limit_event` messages during ordinary, non-limited operation, and this phase's own committed transcripts contain **16 of them**.

### Observed structured shape (committed evidence — PASS)

Message shape, verbatim from the committed fixtures (`02-hermeticity.transcript.sanitized.jsonl`, `03-permissions.transcripts.sanitized.json`, `04-sandbox.transcripts.sanitized.json`, `05-structured-output.transcripts.sanitized.json`):

```json
{"type":"rate_limit_event","rate_limit_info":{...},"uuid":"<uuid>","session_id":"<uuid>"}
```

**Original pass (2026-07-15, engine 2.1.210) — distinct `rate_limit_info` payloads observed, verbatim:**

```json
{"status":"allowed","resetsAt":1784135400,"rateLimitType":"five_hour","overageStatus":"rejected","overageDisabledReason":"org_level_disabled","isUsingOverage":false}
{"status":"allowed_warning","resetsAt":1784135400,"rateLimitType":"five_hour","utilization":0.96,"isUsingOverage":false,"surpassedThreshold":0.9}
{"status":"allowed_warning","resetsAt":1784135400,"rateLimitType":"five_hour","utilization":0.98,"isUsingOverage":false,"surpassedThreshold":0.9}
{"status":"allowed_warning","resetsAt":1784135400,"rateLimitType":"five_hour","utilization":0.99,"isUsingOverage":false,"surpassedThreshold":0.9}
```

(The superseded initial 02 transcript additionally carried a `{"status":"allowed_warning","resetsAt":1784638800,"rateLimitType":"seven_day","utilization":0.38,...}` sample — same schema, `seven_day` kind — overwritten when spike 02 was re-run for §2's soundness fix; cited as corroboration only.)

**These original-pass payloads are what the COMMITTED fixtures hold as of this re-baseline** (restored per the "Fixture-retention decision" above) — downstream consumers (`packages/engine-claude/src/event-normalizer.test.ts`, `packages/testkit/src/fake-engine/parity.test.ts`) assert against this exact multi-variant set, and both suites are green against the restored files.

**For the record — the 2.1.218 re-run's own (superseded, not committed) sample**, observed before the retention decision was made, verbatim: a single distinct payload, `{"status":"allowed_warning","resetsAt":1785243600,"rateLimitType":"seven_day","utilization":0.93,"isUsingOverage":false,"surpassedThreshold":0.75}` — same field set as the original pass (`status`, `resetsAt`, `rateLimitType`, `utilization`, `isUsingOverage`, `surpassedThreshold`); `status`/`rateLimitType` values (`allowed_warning`/`seven_day`) are within the same enum observed before. **No schema delta** — it was a narrower sample (one utilization band instead of four) from a shorter probe session, not a changed shape. It is cited here only as corroborating evidence that the schema is stable at 2.1.218; it is NOT what is committed at `spikes/fixtures/0{2,3,4,5}-*` today.

The SDK type declaration (`SDKRateLimitEvent`/`SDKRateLimitInfo` in `sdk.d.ts`, confirmed unchanged at **0.3.218**) confirms and completes the schema: `status: 'allowed' | 'allowed_warning' | 'rejected'`; `rateLimitType?: 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet' | 'seven_day_overage_included' | 'overage'`; numeric epoch-seconds `resetsAt`; `utilization`; `surpassedThreshold`; `overageStatus`/`overageResetsAt`/`overageDisabledReason`; `errorCode?: 'credits_required'`.

**Directive to phase 06: build `limitSignal` detection from THIS real schema** — watch the `rate_limit_event` stream for a `status` transition to `'rejected'` (and treat `'allowed_warning'` + `utilization`/`surpassedThreshold` as the early-warning input phase 13's scheduler can park on _before_ hard rejection), keying reset timing on the machine-parseable epoch `resetsAt`. Do **not** synthesize a guessed shape; the fake engine (phase 03) replays these committed payloads.

### Still UNRESOLVED: the exhausted/blocked variant

Every committed event carries `status` `'allowed'` or `'allowed_warning'`; a live `'rejected'` sample — and whatever terminal result/error message accompanies an actually-refused request in-stream — has not been captured, on either the 2026-07-15/2.1.210 pass or the 2026-07-24/2.1.218 re-baseline. The only exhausted-limit sample from this host (2026-07-15, error-string channel, surfaced to a headless agent process) is, verbatim:

> `Agent terminated early due to an API error: You've hit your session limit · resets 2:10pm (Europe/Madrid)`

- **MITIGATION:** the next time any worker naturally hits a limit while streaming, capture the raw message sequence verbatim into `spikes/fixtures/07-ratelimit.live-capture.sanitized.jsonl` and update the `ratelimit.exhausted-variant-shape` verdict. Never trigger deliberately on the owner's subscription; a dedicated/metered test account or off-hours window is the only acceptable deliberate path. Until captured, phase 13 must treat the `'rejected'`-transition handling as built on the SDK's _typed_ promise, exercised only against fake-engine fixtures, and phase 06 must ALSO detect the error-string channel (sentence naming the limit kind + localized reset time) as a fallback signal, since that is how an actual exhaustion has been observed to surface.

Fixture: `spikes/fixtures/07-ratelimit.verdicts.json` (regenerated 2026-07-24; probe `ratelimit.structured-event-shape` PASS; `ratelimit.trigger-safety-and-simulation-strategy` and `ratelimit.exhausted-variant-shape` still UNRESOLVED with mitigations, unchanged from the original pass).

---

## 9. Full verdict tally

**Current (2026-07-24, engine 2.1.218 — this is the FINAL/citable tally):** 30 PASS, 2 UNRESOLVED, 0 FAIL, across the same 32 recorded sub-probes in 8 scripts. Every script was re-run against 2.1.218 (spikes 01–05 and 08 via the SDK, which required bumping `spikes/package.json` to SDK `0.3.218` — see header note; spike 06 via the CLI transport, already 2.1.218 on `PATH`; spike 07 makes no live call and re-scanned the other scripts' freshly-regenerated fixtures). The only change from the original (2026-07-15, engine 2.1.210) tally: `auth.oauth-token-resolution` flipped from UNRESOLVED to PASS (§1) — an owner-side resolution (the handoff file was populated out-of-band), not an engine-behavior change. Every other sub-probe reproduced its original verdict with no observed behavioral delta.

Script 08 is the orchestrator-directed follow-up that resolved spike 03's tool-taxonomy surprise. After the independent validation round in the original pass, spikes 02 and 04 were re-run with evidence-soundness fixes (executed-call guards, attempted-and-blocked assertions — §2, §6) and spike 07 was restructured to cite the structured `rate_limit_event` evidence already present in committed fixtures (§8); every changed verdict traces to the corresponding re-run's committed fixture.

| #         | Script            | PASS (2.1.210 → 2.1.218) | UNRESOLVED (2.1.210 → 2.1.218) | FAIL  |
| --------- | ----------------- | ------------------------ | ------------------------------ | ----- |
| 01        | auth              | 1 → **2**                | 1 → **0**                      | 0     |
| 02        | hermeticity       | 4 → 4                    | 0 → 0                          | 0     |
| 03        | permissions       | 8 → 8                    | 0 → 0                          | 0     |
| 04        | sandbox           | 6 → 6                    | 0 → 0                          | 0     |
| 05        | structured-output | 2 → 2                    | 0 → 0                          | 0     |
| 06        | sessions          | 4 → 4                    | 0 → 0                          | 0     |
| 07        | ratelimit         | 1 → 1                    | 2 → 2                          | 0     |
| 08        | tool-catalog-env  | 3 → 3                    | 0 → 0                          | 0     |
| **Total** |                   | **29 → 30**              | **3 → 2**                      | 0 → 0 |

**Narrow re-baseline (2026-07-25, CLI 2.1.220): this tally is UNCHANGED.** No spike was re-run, no fixture regenerated, and no verdict changed — the 30 PASS / 2 UNRESOLVED / 0 FAIL above remain the 2.1.218 figures and are not claims about 2.1.220. The two facts that round did record (§14, §15) were gathered outside the eight-script spike suite — like §12's plugin-key fact — and are deliberately NOT counted among the 32 recorded sub-probes.

Remaining UNRESOLVED (unchanged by the re-baseline): `ratelimit.trigger-safety-and-simulation-strategy` and `ratelimit.exhausted-variant-shape` (§8, opportunistic capture only — never deliberately trigger against the owner's subscription). Every `UNRESOLVED` carries an explicit mitigation note in its section (Hard Rule 1). No downstream phase may cite an `UNRESOLVED` item as settled fact.

---

## 10. Changes that would invalidate this baseline

Re-run the full probe suite (`spikes/README.md` procedure) and update this document before relying on a newer version if any of the following change:

**Re-baseline (2026-07-24, engine 2.1.218): NONE of the items below fired.** Every item was explicitly re-checked against 2.1.218 as part of this re-baseline (not merely assumed stable); the accepted range was extended to 2.1.207–2.1.218 (§ header) on that basis, rather than re-pinned to a fresh point.

**Narrow re-baseline (2026-07-25, CLI 2.1.220): the list below was NOT re-checked item-by-item.** Unlike the 2026-07-24 round, no spike was re-run (§9), so "no trigger fired" is an ABSENCE OF OBSERVATION for every item except the two that were probed directly that day — the last two bullets, added by that round. Read the range's 2.1.220 upper end accordingly (header, "Narrow re-baseline").

- Any permission-rule matching semantics (deny/allow precedence, compound-command/wrapper stripping, the Bash colon-spacing form confirmed in §3).
- The `settingSources: []` hermeticity guarantee (§2) — if any planted-artifact class starts leaking, phase 03/06/09's hermeticity assumption breaks immediately.
- `Options.sandbox` vs `settings.sandbox` field names/defaults, `allowAllUnixSockets` vs `allowUnixSockets` naming (§6), or the egress-denial response shape (proxy-issued 403 vs. connection failure).
- The default tool-preset catalog (§4.4's exact list), the `Agent`→`Task` rule-name/tool-literal aliasing, or the deny-as-catalog-removal enforcement mechanism (§4.1–§4.2) — phase 03's `deny: ["Agent"]` emission and phase 06's absence-from-catalog conformance check are both built directly on these three facts.
- `Options.outputFormat` field name/shape, or the `StructuredOutput` internal tool name/behavior (§5), including whether `error_max_structured_output_retries` is actually reachable and under what conditions.
- Session transcript path munging scheme, `--resume`/`--fork-session` semantics (§7).
- The `rate_limit_event`/`rate_limit_info` schema (§8 — field names, `status` enum, epoch `resetsAt`), the error-string phrasing of an actual exhaustion, or the ENOENT-masking shape of `denyRead` enforcement (§6) — phase 06's `limitSignal` and blocked-read detection key on these observed shapes.
- `claude --version` moves outside 2.1.207–2.1.220, or `@anthropic-ai/claude-agent-sdk` moves outside 0.3.207–0.3.218. (Re-baselined 2026-07-24: range extended from the original 2.1.207–2.1.210 / 0.3.207–0.3.210 after the full suite reproduced every PASS at 2.1.218/0.3.218 with zero deltas — see §9. Extended again 2026-07-25 to 2.1.220 on the narrow basis in the header. **The two ranges are deliberately no longer symmetric:** the CLI range's upper end is 2.1.220 because the host's `PATH` binary is, while the SDK range's stays 0.3.218 because the pinned SDK — and therefore the engine binary the SDK transport actually runs — is still 0.3.218/2.1.218. Bumping the SDK dependency is a separate act with its own evidence requirement; do not "sync" these two ranges on the assumption that the documented 1:1 release correspondence obliges it.)
- CLI flag surface: **`--max-turns` is documented in `docs/claude-code-adaptation.md` §3.3 as confirmed in local `--help` 2.1.207, but is ABSENT from `claude --help` in 2.1.210** — only `--max-budget-usd` remains at the CLI layer. The SDK's `Options.maxTurns` field is unaffected and remains the confirmed mechanism (the SDK transport is already the confirmed v1 path per adaptation §0, so this doesn't block anything, but any future CLI-transport work must not assume `--max-turns` exists without re-checking). **Re-confirmed absent at 2.1.218** (`claude --help` re-checked 2026-07-24) — no change.
- The `enabledPlugins` settings-key format (§12) or the `<plugin-name>@<marketplace-name>` composition it depends on.
- **(added 2026-07-25; CORRECTED same day)** The setup-dependent matching of path-scoped permission rules (§14) — **both** of §14's observations are invalidation-relevant, in opposite directions. If the compiled profile's owned-path anchoring stops scoping (§14.2's in-path-allowed / one-directory-up-denied split no longer reproduces), phase 03's compiler and phase 06's containment story lose the mechanism they currently rest on and must both be re-derived. If an ISOLATED `Write(<path-pattern>)`/`Edit(<path-pattern>)` rule in §14.1's setup starts matching, that is a capability appearing rather than disappearing, and it would also collapse the divergence §14.3 leaves undetermined — which is a finding in its own right. This bullet previously read "the non-matching of path-scoped permission rules"; that framing came from the over-broad conclusion §14 has since retracted.
- **(added 2026-07-25)** The `--allowedTools`/`--allowed-tools` argument arity on the CLI (§15) — if the flag stops being declared `<tools...>` (variadic), argv builders that currently use the `=` form to protect a trailing positional prompt can be simplified, and any that rely on the space-separated form swallowing operands would break.
- **(added 2026-07-27)** The status-line payload contract (§17.1 — member names, the nullability of `context_window.used_percentage`, the absence of `effort` on non-effort models, `rate_limits`' subscription/first-response preconditions, epoch-seconds `resets_at`), the plugin manifest's lack of a `statusLine` key (§17.2), or the availability of `${CLAUDE_PLUGIN_ROOT}`/`$CLAUDE_PROJECT_DIR` in a `settings.json` command (§17.3). Phase 10's installer writes a `statusLine` entry that depends on all three. **This item is binary-sourced and documentation-corroborated, not probe-verified** (§17).
- **(added 2026-07-27)** The plugin version-resolution order (§16) — if `plugin.json` stops silently outranking the marketplace entry's `version`, or the precedence chain gains/loses a level, then phase 10's manifest may declare a version again and `packages/plugin/src/plugin-manifest-version.test.ts` must be re-derived. **This item is documentation-sourced, not probe-verified** (§16); it is the weakest-evidence entry on this list.
- **(added 2026-07-27)** The `Stop` hook control contract (§19) — `decision:"block"` ceasing to prevent a turn ending, `reason` ceasing to reach the model, the `Stop` payload losing `cwd`, or (**release-blocking**) `stop_hook_active` ceasing to be set on re-entry, which is the manager autonomy gate's loop guard.
- **(added 2026-08-06)** The subagent turn-bound contract (§21) — the agent-frontmatter `maxTurns` key name or its positive-integer schema, the **200-turn built-in default** an agent inherits by declaring none, the drop-on-invalid behaviour (a version that refuses the agent outright instead of dropping the key is a materially different failure mode), or `max_turns_reached` as the loop's terminator. `packages/plugin/agents/eo-explore.md` is bounded by this key and nothing else: a `Task` spawn's turns never reach the parent's `num_turns`, and `--max-turns` is absent from the CLI surface (bullet above), so if this contract moves, that subagent silently returns to an unbounded loop. **This item is binary-sourced, not probe-verified** (§21), and §21's quoted-value question is UNDETERMINED rather than settled.
- **(added 2026-07-27)** `AskUserQuestion` appearing in the **headless** tool catalog on either transport (§18.1) — "a worker can never block a run waiting on a human" stops being true by construction and becomes dependent on the worker profile's allow-list alone; phase 06's profile must be re-checked. Also: the tool's input-schema shape changing (§18.2 — `questions[]`, `question`/`header`/`options[]`/`multiSelect`, option `label`/`description`/`preview`, or the `annotations` notes map), which is what the manager operating protocol's wording describes. **The absence half is probe-verified; the interactive-presence half is an in-session observation only** (§18.2).

---

## 11. NEEDS_ORCHESTRATOR

- **Interactive-catalog capture of `AskUserQuestion` (§18.2): OWED, non-blocking.** §18.1's absence-from-headless half is probe-verified on both transports; the complementary "present in an interactive TUI session" half is an in-session observation, not a fixture, because interactive mode emits no `system/init` and the `api` debug filter does not dump the outbound `tools` array (two bounded pty attempts recorded in §18.2). Owed: a pty harness that reads the TUI's own tool-list surface. Not blocking — the manager operating protocol that uses the tool degrades gracefully to a single consolidated prose question if it is absent, so nothing shipped depends on this resolving PASS.

- **Status-line payload live verification (§17): OWED, non-blocking.** §17's contract is a static read of the 2.1.220 binary corroborated by the vendor reference, not an observed payload. Owed: configure `statusLine` in a scratch project, capture the real stdin JSON across a cold session and a post-first-response one, and confirm `CLAUDE_PROJECT_DIR` is exported into the command's environment. Not blocking — the consumer degrades safely if the environment half is wrong (§17.3).

- **Auth token path (§1): RESOLVED 2026-07-24 — no longer blocking.** The owner populated `~/.claude/.eo-oauth-token` out-of-band since the original pass; `spikes/01-auth.mjs` picked it up with no code change (beyond the $HOME-leak sanitization fix, §1) and both auth mechanisms now PASS.
- **Tool-taxonomy (§4): RESOLVED — no longer blocking phase 03.** The `Agent` rule name aliases the live `Task` tool literal; deny enforcement is fail-closed catalog-removal; env-contamination hypothesis refuted; SDK and CLI transports identical. **The residual "clean non-dev-workstation install" mitigation is now also satisfied**: the 2026-07-24 re-baseline explicitly re-captured the catalog on this same host at a different engine version (2.1.218 vs the original 2.1.210) and it was still byte-identical across both SDK-env variants and the CLI transport (§4.4) — this is the strongest evidence available short of a literally different machine, and closes the open mitigation for this baseline's purposes.
- **Rate-limit structured shape (§8):** still genuinely unresolved after the 2026-07-24 re-run; only an opportunistic future capture (never a deliberate trigger against the owner's subscription) can close it.
- **Why an isolated path-scoped rule did not match while the compiled profile's does (§14.3): OPEN — the causal difference is UNDETERMINED as of 2026-07-25.** Four candidate differences between the two probe setups (lone rule vs. full permission object; deny-side vs. allow-side; single-segment vs. nested owned path; target geometry) are all confounded in the evidence on disk. Closing this needs a new probe varying ONE dimension at a time. **Note the corrected reasoning:** this item previously read "owned-path containment is unproven BECAUSE path-scoped rules are inert, so the compiler's anchoring cannot be what contains a worker" — that premise is retracted (§14.2 shows the anchoring scoping under the compiler's own permission object). The item stays open on the narrower ground above, not on the old one.
- **Whole-system worker containment (§14.4): OPEN — not settled by §14 in either direction.** §14.2 establishes that in the compiled profile the permission layer scopes owned-path writes and refuses out-of-worktree ones, and that the sandbox does not constrain the engine's `Write` tool at all on this host (`sandbox-write-tool` allowed all four targets). That is a layer attribution, not a containment verdict: it covers the `Write`/`Bash` write paths those arms exercised, at one engine version, on one host. No phase may cite §14 as "containment holds" or as "containment is broken".
- **Full-suite re-run at 2.1.220 (header, "Narrow re-baseline"): OWED.** The accepted range's upper end was extended on a two-fact basis with no spike re-run and no item-by-item §10 re-check. Re-running the eight spikes against 2.1.220 (which requires bumping `spikes/package.json` to the SDK release matching 2.1.220 and reinstalling — the system `claude` alone does not change what the SDK transport runs) is what would put 2.1.220 on the same evidentiary footing as 2.1.218.
- **Plugin settings-key format (§12):** RESOLVED by phase 10's live verification against 2.1.218 (`enabledPlugins: {"<plugin>@<marketplace>": true}`); recorded here as a carry-forward from phase 10's evidence file, which flagged this doc as the place to land it (out of phase 10's own edit scope).

---

## 12. Plugin settings key format (`enabledPlugins`) — cross-phase engine fact (phase 10 carry-forward)

**Added 2026-07-24 (phase 23 re-baseline), recording a fact phase 10 verified live but could not land here itself** (`docs/evidence/phase-10/README.md` §"Engine-fact verified live", flagged as "out of this phase's allowed edit scope" and left as an explicit carry-forward for whoever next touched this document).

**Fact:** the real `claude` binary's `enabledPlugins` settings key is keyed by **`<plugin-name>@<marketplace-name>`**, NOT the bare plugin name. **Verified live against `claude` 2.1.218** (phase 10, same version this re-baseline confirms): in a scratch project + scratch `HOME`, running `claude plugin marketplace add <path>`, then `claude plugin install <plugin>@<marketplace> --scope project`, then `claude plugin enable <plugin>@<marketplace> --scope project` produced this real, on-disk project `.claude/settings.json`:

```json
{ "enabledPlugins": { "crabgic@crabgic-marketplace": true } }
```

**Consumer:** phase 10's installer (`packages/plugin/src/enabled-plugin-key.ts`, `packages/cli/src/installer/install.ts`) composes this key from `MARKETPLACE_NAME` (byte-cited against the committed `marketplace.json`) rather than writing a bare plugin-name literal — the original finding this fixed is documented in `docs/evidence/phase-10/README.md`. This baseline doc did not previously record the fact itself (only the installer code did); it is captured here now so it is citable per the project's ground rule ("anything engine-touching cites `docs/engine-baseline.md`, never memory") without requiring a detour through a phase-10-specific evidence file.

**Invalidation trigger:** if a future engine version changes the `enabledPlugins` key composition (e.g. drops the `@marketplace` suffix, or uses a different separator), that is a baseline-invalidating event per §10 — re-verify against `docs/evidence/phase-10/README.md`'s exact procedure (`plugin marketplace add` → `plugin install <name>@<marketplace>` → `plugin enable <name>@<marketplace>`, scratch `HOME`) and update both this section and phase 10's `enabled-plugin-key.ts` citation test.

No dedicated `spikes/0N-*.mjs` script probes this fact (it was discovered and verified inside phase 10's own package tests, not phase 00's spike suite); no new spike script was added for it during this re-baseline, since the fact is a settings-file schema convention rather than a runtime engine behavior the existing 8 scripts are structured to probe.

---

## 13. Fixture index and coverage of the required fixture span

All paths relative to repo root. **Re-baseline note (2026-07-24):** every fixture listed below (except this section's own list of filenames, which is unchanged) was regenerated at engine 2.1.218 by the phase-23 re-baseline pass, EXCEPT the four transcript fixtures `02-hermeticity.transcript.sanitized.jsonl`, `03-permissions.transcripts.sanitized.json`, `04-sandbox.transcripts.sanitized.json`, `05-structured-output.transcripts.sanitized.json` — those were re-run live at 2.1.218 (confirming byte-for-byte/behaviorally identical results, §2–§6, §9), then deliberately RESTORED to their original 2026-07-15/2.1.210 captures per §8's "Fixture-retention decision" to preserve the richer committed rate-limit sample coverage (`spikes/fixtures/07-ratelimit.verdicts.json`, `packages/engine-claude/src/event-normalizer.test.ts`, and `packages/testkit/src/fake-engine/parity.test.ts` all depend on that exact original evidence). The header's standing rule ("reflect only the FINAL run of each script") applies to those four files' PASS/FAIL verdicts and behavioral content — confirmed identical either way — not to the specific bytes of a schema-stable sample set. All fixtures (both the freshly-regenerated ones and the restored four) were re-scanned for `sk-ant-*`/OAuth-token-blob/`$HOME`-path substrings with zero hits (§1 covers the one fixture — `01-auth.verdicts.json` — that required a script fix to stay clean after the handoff-file resolution).

- `spikes/fixtures/01-auth.verdicts.json`
- `spikes/fixtures/02-hermeticity.verdicts.json`, `02-hermeticity.transcript.sanitized.jsonl`
- `spikes/fixtures/03-permissions.verdicts.json`, `03-permissions.transcripts.sanitized.json`
- `spikes/fixtures/04-sandbox.verdicts.json`, `04-sandbox.transcripts.sanitized.json`
- `spikes/fixtures/05-structured-output.verdicts.json`, `05-structured-output.transcripts.sanitized.json`
- `spikes/fixtures/06-sessions.verdicts.json`, `06-sessions.raw.sanitized.json`
- `spikes/fixtures/07-ratelimit.verdicts.json`
- `spikes/fixtures/08-tool-catalog-env.verdicts.json`, `08-tool-catalog-env.catalogs.sanitized.json`
- `spikes/fixtures/09-human-interaction-tool.verdicts.json`, `09-human-interaction-tool.catalogs.sanitized.json` (added 2026-07-27, §18 — captured at 2.1.218/SDK + 2.1.220/CLI, NOT part of the 2026-07-24 re-baseline pass described above)
- `spikes/fixtures/10-stop-hook.verdicts.json`, `10-stop-hook.payloads.sanitized.json` (added 2026-07-27, §19 — captured at 2.1.220/CLI; payload paths redacted to `$HOME` before the sanitization scan, since the fixture's value is the payload SHAPE, not the host's paths)

Roadmap/00 work item 9 requires the fixture set to span five scenario classes. Coverage:

| Required scenario       | Status                         | Where                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean success           | **Covered**                    | full SDK message streams incl. `system/init` and `result/success` in the 02/03/04/05 transcripts; CLI `--output-format json` and `stream-json` results in `06-sessions.raw.sanitized.json` and `08-tool-catalog-env.catalogs.sanitized.json`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Rate-limit signal       | **Covered (warning variants)** | 16 verbatim `rate_limit_event` messages across the 02/03/04/05 transcripts (§8); the `status:'rejected'` variant remains UNRESOLVED (§8 mitigation)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Schema-violating result | **Covered**                    | `05-structured-output.transcripts.sanitized.json` (`schema-violation` run: `subtype:"success"` with `structured_output` absent — the observed violation shape, §5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Crash                   | **Covered**                    | `06-sessions.raw.sanitized.json` (`kill9-initial`: a genuine crash-truncated `stream-json` prefix from the SIGKILLed worker — **19 event lines as of the 2026-07-24/2.1.218 re-baseline** (was 23 in the original 2026-07-15/2.1.210 capture; the exact count is timing-dependent on when the SIGKILL lands relative to the stream, not a schema change) — `system/init`, `system/status`, `stream_event` partials, `system/thinking_tokens`, one mid-stream `rate_limit_event`, with NO terminating result message, captured by re-running the probe with `--output-format stream-json --include-partial-messages` and killing only after the first stream event (3.5s floor preserved); `kill9-resume`: the successful `--resume` continuation, re-confirmed 2026-07-24) |
| Retry/backoff           | **WAIVED — explicit**          | No committed fixture. A genuine API retry (`SDKAPIRetryMessage`, `subtype: 'api_retry'` in the SDK type union) requires a transient upstream 5xx/overload, which cannot be induced deterministically without either unsafe extra load on the owner's already-limited subscription or man-in-the-middle tampering with the live engine's TLS traffic — both rejected. The event's typed shape exists in `sdk.d.ts` 0.3.210 for phase 03's fake engine to synthesize from; capture a real sample opportunistically the first time any worker's stream shows `api_retry` during ordinary use, and fold it in retroactively. Until then, phase 06's retry/backoff parsing may cite only the typed shape, never a confirmed live sample (Hard Rule 1).                          |

All fixtures pass the sanitization scan (`sk-ant-*` token shapes, OAuth `accessToken`/`refreshToken` JSON blobs, literal `$HOME` path substring) with zero hits at time of writing (2026-07-24 re-baseline); `spikes/01-auth.mjs` additionally checked for the first 8 characters of the real OAuth token used this pass (the token path is now PASS, §1) — no hit found, confirming the $HOME-leak fix (§1) did not leave any token-prefix residue either.

---

## 14. Path-scoped permission rules — honored as ALLOW, NOT honored as DENY. The channel is the causal variable (differential, 2026-08-01; §14.4 supersedes §14.3's "undetermined")

**Added 2026-07-25 (narrow re-baseline). CORRECTED the same day, before any downstream phase consumed it.** This section as first published (commit `30881aa`) drew a single, over-broad conclusion from the first of the two probes below — "the engine honors NO path-anchored form of a `Write(...)` rule, in either channel; the compiler's `//<worktree>/…/**` anchoring is INERT at runtime". A second, independently-built probe run the same day falsifies the generalization: under the compiler's own full permission object the triple-slash owned-path rule demonstrably SCOPES. **Both probes' data stand — neither is retracted; the generalization drawn from the first one is what was wrong.** The two were measured under different setups, and which difference is causal has NOT been established (§14.3).

**The question that was owed** (parked here by `packages/engine-claude/src/options-assembler.ts`'s ENGINE-FACT-DRIFT note and phase 06's README decision 6): _which_ substituted owned-path rule form the real engine honors — triple-slash `Write(///abs/worktree/owned/**)` (what the compiler emits, from literal substitution of the absolute worktree path into its `//<worktree>/**` template) or double-slash `Write(//abs/worktree/owned/**)`. It is **not yet answered in the general case**, and §14.1–§14.3 record exactly how far the evidence reaches.

**Both evidence artifacts must be read together; neither alone supports a conclusion about the compiler's emitted form:**

- `docs/evidence/phase-06/path-anchor-determination.json` — observation A (§14.1), probe `packages/engine-claude/src/live/path-anchor.live.test.ts`.
- `docs/evidence/phase-06/sandbox-containment-determination.json` — observation B (§14.2), probe `packages/engine-claude/src/live/sandbox-containment.live.test.ts`.

### 14.4 Observation C — the DIFFERENTIAL: the causal variable is the CHANNEL (allow vs deny), measured 2026-08-01

**Probe:** `packages/engine-claude/src/live/path-anchor-differential.live.test.ts`. **Artifact:** `docs/evidence/phase-06/path-anchor-differential-determination.json`. Every arm starts from §14.2's own no-sandbox configuration — the one known to scope — and changes exactly ONE thing toward §14.1's setup, so a lost verdict names its own cause. All arms are executed-call-guarded (`insideAttempted` and `oneUpAttempted` both true), and every arm carries a same-run control.

**Ruled OUT as the cause of §14.1's non-match — each still scopes on the allow side:**

- **Path depth.** `single-segment-owned-path`: the owned path reduced to one segment (§14.1's shape). Note this also reproduces §14.1's target geometry — with a single-segment owned path, "one directory up" IS the worktree root. Still scopes.
- **Rule count.** `lone-rule-full-shape`: `permissions.allow` carrying ONLY the owned-path `Write` rule, with tool enablement supplied separately through `allowedTools` so it cannot fail for §14.1's documented tool-disabled reason. Still scopes.
- **Permission-object scaffolding.** `minimal-permission-object`: `permissions` reduced to `{allow:[rule]}` — no `defaultMode`, no `disableBypassPermissionsMode`, no populated `deny`. Still scopes.

**What DID reproduce the non-match — the channel.** `path-scoped-deny`: the compiler's own full permission object plus an explicit path-scoped `Write(///abs/…/inside.txt)` DENY naming a target the allow rule permits. Deny-wins, so an honored deny must refuse it. It recorded `insideDenied: false` — **the deny rule did nothing**, in the same object and the same run where the allow-side control scoped correctly.

**Therefore:** §14.1 and §14.2 do not conflict about anchor FORM at all. A path-scoped rule is honored as an **allow** rule and was not honored as a **deny** rule. That is one finding, consistent with both prior observations, and it localizes the variable §14.3 left undetermined.

**Consequence, and it is a production one.** The compiler emits path-scoped DENY triplets over the sensitive roots — journal/control state, cache, `~/.ssh`, `~/.aws` (`permission-profile.ts`'s `mandatoryPathDeny`). On this engine version those entries appear **inert on the permission layer**. What actually keeps a worker out of those paths is the OTHER half of the profile: writes are allow-scoped to the owned path, and under `dontAsk` a tool call matching no allow rule is auto-denied (§3) — which every arm above measured working. Two things follow:

1. The sensitive-root denies are defense-in-depth that currently does not fire. They must NOT be deleted on the strength of this — an engine version that starts honoring them is strictly better, and the sandbox's own `denyRead`/`denyWrite` lists are a **different** mechanism that does bind for shell-issued writes (§14.2's `sandbox-bash` arm).
2. Any claim that the journal is protected _by a deny rule_ is wrong. It is protected by allow-scoping plus auto-deny.

**Limits.** Write tool only; one engine version; these shapes; the deny arm is a single sample corroborating §14.1's 20. It does not measure `Read`, `Edit`, `Bash`, or the `disallowedTools` channel.

### 14.1 Observation A — a LONE, hand-written path-scoped rule did not match (20 recorded results)

**Setup, exactly:** direct SDK `query()`, `permissionMode: "dontAsk"`, **no sandbox**, so only permission-rule matching can decide. Each arm supplied the candidate rule as the **sole** entry in one channel against an otherwise minimal permission object — no `permissions.defaultMode`, no `disableBypassPermissionsMode`, no populated `deny` array beyond the one rule under test (dontAsk is in force in both setups, but here it comes from `Options.permissionMode` rather than from `permissions.defaultMode` as in §14.2) — and the owned path was a **single segment** — `<worktree>/owned/` — with one in-path target (`owned/inside.txt`) and one out-of-path target (`<worktree>/outside.txt`). Every arm is executed-call-guarded: each recorded form carries `insideAttempted: true` and `outsideAttempted: true`, so no verdict is vacuous. The artifact's `forms` map holds **20 results** — 4 allow-side, 11 in the `settings-deny` channel (1 bare-tool control, 4 candidate forms, 6 syntax diagnostics), 5 in the `disallowed-tools` channel (1 bare-tool control, 4 candidate forms).

- **No path-scoped `Write(<pattern>)` form matched under that setup, in either channel.** Four anchor forms — triple-slash `Write(///abs/…/owned/**)`, double-slash `Write(//abs/…/owned/**)`, plain-absolute `Write(/abs/…/owned/**)`, cwd-relative `Write(owned/**)` — probed both as the sole `permissions.allow` entry AND as the sole `permissions.deny`/`Options.disallowedTools` entry, plus exact-file and `/*` variants on the deny side. **Every path-scoped deny entry records `matched: false`**: the in-owned-path `Write` was not denied (`insideDenied: false`) and the out-of-path control `Write` was still allowed (`outsideAllowed: true`) — the rule did nothing at all, rather than matching the wrong set.
- **The controls were live, which is why these results are data and not noise.** Each channel's bare-tool control — rule `Write`, no parentheses — records `matched: true` and denied BOTH the in-path and the out-of-path write. So `settings.permissions.deny` and `Options.disallowedTools` each demonstrably reached the engine's permission layer and outranked `allowedTools` in that setup; a `matched: false` beside them is a real non-match, not an inert passthrough.
- **§3's `Edit` outside the allowed path probe is NOT a third data point.** It ran a lone `Edit(//tmp/<allowed-dir>/**)` allow rule (plus a broad `Read`) and observed only the OUT-of-path `Edit` being denied, with no in-path control — an outcome an inert rule and a correctly-scoping rule produce identically under `dontAsk`. It is consistent with both observations here and discriminates neither.
- **The allow-side arms settle nothing about anchoring** and the artifact's own `legend` says so: with only `Write(<pattern>)` present and no bare `Write` in `allowedTools`, the tool was disabled outright under `dontAsk` (§3: a tool matching no allow rule is auto-denied), so all four forms recorded an identical `insideAllowed: false`. They measure tool ENABLEMENT. The deny-side shape is the one that measures anchoring **in this setup**.

### 14.2 Observation B — under the COMPILER'S OWN full permission object, the same triple-slash form SCOPES

**Setup, exactly:** the real `compileEnvelope(STANDARD_IMPLEMENTATION_ENVELOPE)` → `substituteWorktreePlaceholders` output, taken **verbatim** — `allowedTools`, `settingsJson.permissions` (including `defaultMode: "dontAsk"`, `disableBypassPermissionsMode: "disable"`, and the whole populated `deny` array) and, where the arm keeps it, `sandbox`. The allow surface is `Edit(///<wt>/packages/example/src/**) | Write(///<wt>/packages/example/src/**) | Bash(npm run test:*) | Bash(npm run build:*) | Bash(git status:*) | Bash(git diff:*) | mcp__crabgic_gateway__*` — **no bare `Write`** — and the owned path is the **nested** `packages/example/src`. Four targets per arm, each write executed-call-guarded and each "refused" verdict requiring a positive refusal signal correlated by `tool_use_id`.

- **In-owned-path write ALLOWED, write one directory up DENIED — reproduced across four samples.** `compiled-profile`, `compiled-profile-repeat` (a deliberate second sample on a fresh scratch) and `compiled-profile-no-sandbox` all drive the engine's `Write` tool and all record `owned-inside → allowed` (the host file exists) with `worktree-root → refused`. A fourth arm, `compiled-bash-allowlist-unsandboxed`, reaches the same split (`owned-inside` created, `worktree-root` denied) through shell-issued writes under the same permission object.
- **The sandbox is ruled out as the explanation, three independent ways.** (i) `compiled-profile-no-sandbox` was built for exactly this — same permission object, `Options.sandbox` **and** `settingsJson.sandbox` both removed (`sandboxEnabled: false`) — and reproduced the split; `compiled-bash-allowlist-unsandboxed` likewise ran unsandboxed. (ii) The compiled `sandbox.filesystem.allowWrite` is `[<worktree>, <worker-tmp>]` — the **whole** worktree — so it cannot distinguish `<worktree>/packages/example/src/` from `<worktree>/`. (iii) The refusal SHAPES differ by layer and the observed ones are the permission layer's: these refusals are recorded in `result.permission_denials` with the tool_result text _"Permission to use Write has been denied because Claude Code is running in don't ask mode"_, whereas the sandbox's refusals in the sibling arms (`sandbox-bash`, `compiled-bash-allowlist-sandboxed`) are an exit-1 `/bin/bash: …: Read-only file system`.
- **The vacuity control holds.** `control-no-sandbox` (bare `Write`, no sandbox) recorded **all four** targets `allowed` — including `worktree-root` — so the refusals above are attributable to configuration and not to the model declining to write. `sandbox-write-tool` (bare `Write` + the real compiled sandbox) also allowed all four, so the sandbox does not constrain the engine's `Write` tool at all on this host.
- **Why the split implicates the anchored allow rule specifically.** The compiled `allowedTools`/`permissions.allow` contain no bare `Write`, so under `dontAsk` a `Write` matching no allow rule is auto-denied (§3) — as the three out-of-path targets in fact were. The in-owned-path `Write` nevertheless succeeded, so **some** allow entry matched it, and the only candidate is `Write(///<wt>/packages/example/src/**)`. The compiled `deny` array contains nothing covering `<worktree>/eo-containment-worktree-root.txt` (`MANDATORY_FIXED_DENY` + the four sensitive roots + `Edit`/`Write` over `<worktree>/.git/**`), consistent with the observed mode-phrased denial. **Caveat on this inference:** the artifact records no `PermissionDecisionReason` discriminator on this channel ("no reason detail on this channel"), so "no allow rule covered it" versus "a deny rule matched it" is reasoned from the compiled arrays' contents plus the denial phrasing, not read off the wire.
- **One `compiled-*` arm does NOT show the split, for a known and unrelated reason.** `compiled-bash-allowlist-sandboxed` (same permission object, sandbox ENABLED, shell-issued writes) recorded `worktree-root → allowed`. That pair exists to test whether enabling the sandbox voids the four-literal `Bash` allowlist, and it is a statement about `Bash` command permissions, not about `Write(...)` path anchoring. Recorded here so the count above is not read as "every compiled arm agreed".

### 14.3 What is established, what is NOT — the causal difference is UNDETERMINED

**Established:** (a) a path-scoped `Write(<pattern>)` rule supplied ALONE, in the §14.1 setup, matched nothing in either channel, against live controls; (b) the SAME triple-slash anchor form, inside the compiler's full permission object in the §14.2 setup, scoped write access to the owned path — in-path allowed, one directory up denied — with and without the sandbox, sampled four times.

**NOT established, and must not be asserted:** _which_ difference between the two setups accounts for the divergence. The candidates, none of which the evidence separates:

1. **Lone rule vs. full permission object** — §14.1 supplied one entry in one channel; §14.2 supplied `defaultMode: "dontAsk"`, `disableBypassPermissionsMode: "disable"`, a populated `deny` array, the `Bash`/MCP allow entries, and the `Edit(...)` sibling of the `Write(...)` rule. Sub-difference worth isolating on its own: dontAsk arrives via `Options.permissionMode` in §14.1 and via `permissions.defaultMode` in §14.2, which are not proven equivalent for rule matching.
2. **Channel and polarity** — §14.1's measuring shape was DENY-side (`permissions.deny` / `disallowedTools`) with `Write` broadly enabled; §14.2's scoping is ALLOW-side, with no bare `Write` anywhere. §14.1's own allow-side arms could not measure anchoring at all, so "does an anchored ALLOW rule match?" was effectively unmeasured there — and that is precisely the shape §14.2 exercises.
3. **Owned-path shape** — a nested, multi-segment `packages/example/src` in §14.2 versus a single `owned` segment in §14.1.
4. **Prompt/target geometry** — §14.1's out-of-path target sits at the worktree root beside a single owned segment; §14.2 drives four targets spanning three containment classes.

Separating these is a NEW probe (one dimension at a time, deny-side and allow-side, against both path shapes), not an inference anyone may draw from what is on disk today. Until it lands, cite §14 as "setup-dependent, cause undetermined" and nothing stronger.

### 14.4 Consequence — bounded, and deliberately narrower than the retracted version

- **Do NOT treat the compiler's `//<worktree>/…/**` anchoring as inert, dead, or removable.** The retracted "INERT at runtime" claim would license exactly that, and §14.2 is direct evidence against it: in the only configuration production actually ships — the compiled profile — the anchored allow rule is what lets a worker write its owned path while a write one directory up is refused. Deleting, "simplifying", or re-spelling that template on the strength of §14.1 alone is unsupported.
- **No production change is warranted from §14.1 either.** Its conditional authority (rewrite `///abs/…` to `//abs/…` or `/abs/…`) fires only if the engine honors a form DIFFERENT from the one `substituteWorktreePlaceholders` emits. §14.1 found no form honored in its setup and §14.2 found the emitted triple-slash form working in the compiler's own — neither outcome points at a different form. The triple-slash form stays.
- **Do NOT generalize §14.2 either.** It shows the anchor scoping under one full permission object with one nested owned path. It does not license "path-scoped rules always match", does not license hand-written lone `Write(<pattern>)` rules elsewhere in the codebase (§14.1 is the standing warning against those), and says nothing about `Read(...)`, or about anchor forms other than triple-slash under that object.
- **Layer attribution, as far as it goes:** in the compiled arms the out-of-worktree and worker-home refusals also carried the permission layer's denial shape, and `sandbox-write-tool` showed the sandbox not constraining the `Write` tool at all — so on this host the sandbox is not what stops the engine's own file writes. Whole-system worker containment is still a separate question with its own owed work (§11); §14 is not a verdict on it in either direction.

### 14.5 Engine version this was gathered at — read carefully

**Engine 2.1.218, not 2.1.220 — for BOTH probes.** They reach the engine through the SDK transport (`runDirectQuery` → `query()`), and the SDK resolves the native binary it bundles — `@anthropic-ai/claude-agent-sdk` 0.3.218, whose `claude --version` reports `2.1.218 (Claude Code)` — independently of the host's `PATH` CLI, which is at 2.1.220 (header engine-resolution note). This attribution is **enforced, not inferred**: the live harness's canary reads `claude_code_version` off the `system/init` message and refuses to proceed unless it equals `TESTED_ENGINE_VERSION` (2.1.218), and both probes call that canary before running. The facts are recorded during the 2026-07-25 narrow re-baseline but are **not** verified at 2.1.220; a full-suite re-run at 2.1.220 (§11) should re-probe them.

**Invalidation trigger (also listed in §10):** any engine version in which the compiled profile's owned-path anchoring stops scoping (§14.2's split no longer reproduces), or in which an isolated path-scoped rule in §14.1's setup starts matching. Either direction changes what phase 03's compiler and phase 06's containment story rest on.

---

## 15. `--allowedTools` is variadic on the CLI (`<tools...>`) (2026-07-25)

**Added 2026-07-25 (narrow re-baseline). Verified against `claude` 2.1.220 on `PATH`** (`claude --help`, a free local invocation — no engine turn).

**Fact:** the flag is declared `--allowedTools, --allowed-tools <tools...>` — variadic. In its **space-separated** form it keeps consuming the operands that follow it, so an argv like `claude … --allowedTools Task "<prompt>"` registers the prompt string as a **second tool name** and leaves the run with no positional prompt at all; the run then fails without ever reaching the model, with (as recorded by the fix's own code comment) `Input must be provided either through stdin or as a prompt argument when using --print`. The **`=` form** — `--allowedTools=Task` — binds exactly one value, leaving a trailing positional prompt a prompt.

**Consumer / where this is already relied on:** `packages/plugin/src/live/plugin-load.live.test.ts` builds its subagent-spawn invocation with `--allowedTools=Task` for exactly this reason (its code comment cites the behavior). Any future CLI-transport argv builder that carries a positional prompt must either use the `=` form or place the variadic flag where nothing follows it. This is a harness/argv-construction concern only — it is not a permission-semantics fact and does not touch §3.

**Not a 2.1.220-only fact:** the same `<tools...>` declaration is present in the 2.1.218 engine bundled with SDK 0.3.218 (`node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude --help`), so this is a standing CLI-surface fact across the accepted range, not a delta introduced at 2.1.220. It belongs to the same family as §10's `--max-turns` CLI-flag-surface bullet: a fact about the CLI's argument grammar, tracked because CLI-transport code depends on it.

**Invalidation trigger (also listed in §10):** the flag ceasing to be declared variadic.

No dedicated `spikes/0N-*.mjs` script probes §14 or §15 — both were established in package-level live tests during a round that deliberately re-ran no spike (§9), and are recorded here so they are citable per the project's ground rule without a detour through a phase-specific evidence file.

---

## 16. Plugin version resolution: `plugin.json` silently outranks the marketplace entry (2026-07-27)

**Added 2026-07-27. DOCUMENTATION-SOURCED, not probe-verified** — read the evidence caveat below before relying on this the way §1–§9's live verdicts can be relied on.

**Fact:** a plugin's effective version resolves in this order, highest first:

1. `version` in the plugin's `.claude-plugin/plugin.json`
2. `version` in the plugin's marketplace entry
3. the git commit SHA of the plugin's source

Setting `version` **pins** the plugin: users receive an update only when that string changes, so pushing new commits under an unchanged `version` delivers nothing to anyone already installed. Declaring it in **both** places is called out explicitly by the vendor reference as a mistake — "Claude Code always uses the `plugin.json` value without warning" — because the manifest wins silently and a stale manifest version therefore masks a correct marketplace entry.

**Why this is recorded:** this repository shipped exactly that defect in `1.0.0` and `1.0.1`. `packages/plugin/.claude-plugin/plugin.json` declared `"version": "0.0.0"` (the workspace placeholder every private package here carries) while the marketplace entry declared the real release version. Per the resolution order above, every install of `crabgic@crabgic-marketplace` resolved to `0.0.0`, and no subsequent release would have reached an installed user. Nothing in the repository tested it, and this baseline did not record the fact, so no citation existed to check the manifest against.

**Consumer:** `packages/plugin/.claude-plugin/plugin.json` now declares **no** `version` key, leaving the marketplace entry — which `e2e/release/src/marketplaceEntryPreparer.ts` recomputes at every release — as the sole declared version. `packages/plugin/src/plugin-manifest-version.test.ts` asserts the key's absence and cites this section.

**Evidence caveat (load-bearing):** this fact comes from the vendor's published plugin-marketplace reference, read 2026-07-27, **not** from a spike, a live probe, or a package-level live test — unlike §12 (live-verified at 2.1.218) and §15 (verified against a real `--help` at 2.1.220). No `spikes/0N-*.mjs` probes it. A live verification — install the plugin from a scratch marketplace at a known manifest/entry version pair and read back the resolved version — is **OWED** and belongs on §11's list. Until then, treat §16 as the documented contract rather than an observed one. The remediation it motivated is safe in either direction: removing a redundant `version` from the manifest cannot pin users worse than declaring `0.0.0` did, whichever way precedence actually runs.

**Invalidation trigger (also listed in §10):** any change to the precedence chain, or to the silent-override behavior when both files declare a version.

---

## 17. Status-line payload contract and its two distribution constraints (2026-07-27)

**Added 2026-07-27. BINARY-SOURCED + DOCUMENTATION-CORROBORATED, not probe-verified** — read the evidence caveat below before relying on this the way §1–§9's live verdicts can be relied on.

**Source of the fact:** the payload builder was read directly out of the installed CLI binary at **2.1.220** (`~/.local/share/claude/versions/2.1.220`, the same `PATH` binary §15 was read from), and every field below was then cross-checked against the vendor's published status-line reference. The two agree field-for-field.

### 17.1 The payload

Claude Code spawns the configured `statusLine.command` through a shell and pipes one JSON object on stdin. The members this repository consumes:

| Member                                        | Shape                                   | Notes                                                                                                                                                             |
| --------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model.display_name`                          | string                                  | e.g. `"Claude Opus 5 (1M context)"`.                                                                                                                              |
| `effort.level`                                | `low`\|`medium`\|`high`\|`xhigh`\|`max` | **The whole `effort` object is ABSENT** when the current model does not support the reasoning-effort parameter. Ultracode reports as `xhigh`.                     |
| `context_window.used_percentage`              | number \| **null**                      | Pre-computed, input-only (`input + cache_creation + cache_read`; excludes output). `null` before the first API response of a session, and again after `/compact`. |
| `context_window.context_window_size`          | number                                  | 200000, or 1000000 on extended-context models.                                                                                                                    |
| `rate_limits.five_hour.used_percentage`       | number 0–100                            | Derived from the `anthropic-ratelimit-unified-5h-utilization` response header (`utilization × 100`).                                                              |
| `rate_limits.seven_day.used_percentage`       | number 0–100                            | Likewise from `-7d-`.                                                                                                                                             |
| `rate_limits.{five_hour,seven_day}.resets_at` | number                                  | Unix epoch **seconds**.                                                                                                                                           |
| `workspace.current_dir`, `cwd`                | string                                  | Session working directory.                                                                                                                                        |
| `workspace.repo`                              | `{host, owner, name}`                   | Parsed from the git remote URL.                                                                                                                                   |
| `worktree.branch`                             | string                                  | Present only inside a git worktree.                                                                                                                               |
| `fast_mode`, `thinking.enabled`               | boolean                                 |                                                                                                                                                                   |

**`rate_limits` is absent entirely** until the first API response of the session populates the header cache, and exists only for Claude.ai subscription auth. Each of `five_hour`/`seven_day` may be independently absent.

**THE GIT BRANCH IS NOT IN THE PAYLOAD.** `workspace.repo` carries only host/owner/name, and `worktree.branch` only populates inside a worktree. An ordinary branch name must be read from `git` by the status-line script itself.

`statusLine` settings shape: `{type: "command", command: string, padding?: number, refreshInterval?: number (min 1, seconds), hideVimModeIndicator?: boolean}`. There is **no `args` (exec) form** for `statusLine` — unlike hooks, it is shell-form only. Output is re-rendered on model/permission/token change with a 300ms debounce, plus the `refreshInterval` timer; stdout is split on newlines and each line rendered `dimColor` + truncate, so ANSI colour passes through but is composed with the engine's own dim attribute.

### 17.2 Constraint 1 — a plugin cannot register a status line

The plugin manifest schema at 2.1.220 accepts `commands`, `agents`, `skills`, `hooks`, `mcpServers` and `lspServers`. **It has no `statusLine` key.** `statusLine` exists only in `settings.json`, so a status line cannot be distributed the way the rest of this plugin's behaviour is — it has to be written into the consuming project's settings by the installer.

### 17.3 Constraint 2 — `${CLAUDE_PLUGIN_ROOT}` is rejected in `settings.json`

Placeholder substitution is applied to plugin-sourced config only. A `settings.json` command containing `${CLAUDE_PLUGIN_ROOT}` does not silently fail to expand — the engine **throws**, with the message `Hook command references ${CLAUDE_PLUGIN_ROOT} but the hook is not associated with a plugin. This variable is only available in hooks defined in a plugin's hooks/hooks.json file, not in settings.json.` `${CLAUDE_PROJECT_DIR}` **is** available: the same helper-exec path that runs hooks runs the status line, and it exports `CLAUDE_PROJECT_DIR` into the child environment.

**Consumer:** `packages/plugin/statusline/crabgic-statusline.mjs` reads the payload; `packages/cli/src/installer/statusline-writer.ts` copies it to `.claude/crabgic-statusline.mjs` in the target project and registers it via `$CLAUDE_PROJECT_DIR` (never `${CLAUDE_PLUGIN_ROOT}`, per §17.3) with a `:-.` cwd fallback. Both cite this section.

**Evidence caveat (load-bearing):** no `spikes/0N-*.mjs` probes this, and no live session was driven with a configured `statusLine` to observe a real payload end-to-end. §17.1's field list is a static read of the 2.1.220 binary plus the vendor reference; §17.2 is a static read of the manifest schema; §17.3's error string is quoted from the binary, not observed being thrown. A live verification — configure the status line in a scratch project, capture the actual stdin JSON, and confirm `CLAUDE_PROJECT_DIR` is exported to it — is **OWED** and belongs on §11's list. The consumer is written to be safe if §17.3's environment half turns out to be wrong: the `${CLAUDE_PROJECT_DIR:-.}` form degrades to the session cwd, which is the project directory in the ordinary case.

**Invalidation trigger (also listed in §10):** any member in §17.1 changing name/shape/nullability; `rate_limits` becoming available without an API response; the plugin manifest gaining a `statusLine` key (§17.2); or `${CLAUDE_PLUGIN_ROOT}`/`$CLAUDE_PROJECT_DIR` availability in `settings.json` commands changing (§17.3).

---

## 18. The human-interaction tool surface — `AskUserQuestion` is INTERACTIVE-ONLY; it is absent from the headless catalog on both transports (2026-07-27)

**Added 2026-07-27**, for the manager operating protocol (roadmap/10's managed `CLAUDE.md` block and Stop hook, roadmap/11's "irreducible product decision" stop condition). Producing script: `spikes/09-human-interaction-tool.mjs`. Fixtures: `spikes/fixtures/09-human-interaction-tool.verdicts.json`, `09-human-interaction-tool.catalogs.sanitized.json`.

**Read the two halves separately — they have deliberately different evidentiary strength**, and only the first is scripted.

### 18.1 Scripted and load-bearing: absent from the headless catalog, both transports

At engine **2.1.218 (SDK transport) / 2.1.220 (CLI transport)** — the exact transport split this document's header describes, reproduced again here and therefore corroborating it — a headless session's tool catalog does **not** contain `AskUserQuestion`:

| Probe                                                 | Transport                                                 | Catalog size | `AskUserQuestion` | Verdict                                                     |
| ----------------------------------------------------- | --------------------------------------------------------- | ------------ | ----------------- | ----------------------------------------------------------- |
| `human-interaction-tool.absent-headless-sdk`          | SDK (`query()`, the transport phase 06 spawns workers on) | 29           | **absent**        | **PASS**                                                    |
| `human-interaction-tool.absent-headless-cli`          | CLI (`-p --output-format stream-json`)                    | 29           | **absent**        | **PASS**                                                    |
| `human-interaction-tool.catalog-matches-baseline-4-4` | both                                                      | 29           | —                 | **PASS** (both equal §4.4's recorded 29-tool list as a set) |

**Why this is the load-bearing half:** it is what makes "a worker can never block a run waiting on a human" true **by construction** rather than by policy. A headless worker has no such tool in its catalog to call, independent of its permission profile. The profile's `dontAsk` + explicit allow-list (§3) is then a second, redundant layer rather than the only one.

The third probe is a drift guard: it re-asserts §4.4's 29-tool list, so that if the catalog ever changes, the failure surfaces here as well rather than silently changing _what_ `AskUserQuestion` is absent from. It passed, which additionally re-confirms §4.4's catalog unchanged at 2.1.220 on the CLI transport.

**A FAIL on any of the three is a real regression**, and phase 06's worker profile must be re-checked before shipping: workers would still be blocked by the allow-list, but the by-construction guarantee would be gone.

### 18.2 NOT scripted, UX-relevant only: presence in an interactive session

The complementary claim — that `AskUserQuestion` **is** present in an **interactive (TUI)** session, which is what the manager session runs as — is recorded as **UNRESOLVED**, not PASS. `spikes/09` cannot capture it, and says so:

- Interactive mode emits no `system/init` line; that is a `--print`/stream-json surface, so the technique §18.1's probes use does not apply.
- Two bounded attempts at driving a pty (`script -qec "claude --debug api --debug-file …"`, once with the prompt as a positional argument and once submitting via a `\r` on stdin) both produced a debug log containing **no outbound request payload** — the `api` debug filter does not dump the `tools` array. The first attempt additionally confirmed an unrelated obstacle worth recording: in an untrusted directory the run stalls on the workspace-trust dialog and logs `Skipping SessionEnd:other hook execution - workspace trust not accepted`.

What does exist is a **first-party in-session observation, which is NOT committed evidence**: in a live interactive Claude Code session on this host at engine 2.1.220, the tool is present, and its input schema carries `questions[]` (1–4 entries), each with `question`, `header` (≤12 chars), `options[]` (2–4 entries, each `label` + `description` + optional `preview`) and `multiSelect`; option sets are rendered by the TUI with an automatic "Other" escape hatch for free-text, and the user's per-question free-text notes come back in a top-level `annotations` map. This is recorded because it is the actual basis for the protocol's wording, and flagged because a reader must not mistake it for a probe result.

**Consequence, deliberately bounded:** nothing shipped depends on §18.2 resolving PASS. The manager operating protocol that mandates this tool is written to **degrade gracefully** — if the tool is absent, the instruction is to fall back to a single consolidated prose question rather than to a step-by-step interrogation. That fallback is the behavior the protocol is trying to prevent in its _worst_ case, which keeps the failure mode no worse than today's.

**MITIGATION (non-blocking, belongs on §11's owed list):** capture the interactive catalog properly before this fact is ever made load-bearing — a pty harness that reads the TUI's own tool-list surface, or an engine build that logs the request payload under a debug filter.

### 18.3 Invalidation triggers (also listed in §10)

- `AskUserQuestion` appearing in the **headless** catalog on either transport (§18.1 FAIL) — the by-construction guarantee is gone.
- The `AskUserQuestion` **input schema** changing shape: `questions[]`, `question`/`header`/`options[]`/`multiSelect`, option `label`/`description`/`preview`, or the `annotations` notes map (§18.2).
- The headless catalog drifting from §4.4's 29-tool list (already a §10 trigger; re-asserted by `human-interaction-tool.catalog-matches-baseline-4-4`).

---

## 19. The `Stop` hook control contract — a Stop hook CAN block a turn from ending, and `stop_hook_active` is the loop guard (2026-07-27)

**Added 2026-07-27**, for the manager autonomy gate (`packages/plugin/hooks/stop-autonomy-gate.mjs`, roadmap/10 amendment). Producing script: `spikes/10-stop-hook.mjs`. Fixtures: `spikes/fixtures/10-stop-hook.verdicts.json`, `10-stop-hook.payloads.sanitized.json`. Verified at CLI engine **2.1.220**.

**Why this needed its own probe.** The adaptation doc's hook analysis (§3.1) is entirely about **PreToolUse** — `permissionDecision`, exit-2-blocks-the-call, `updatedInput`. Nothing in it, and nothing previously in this baseline, says what a **`Stop`** hook can do. The autonomy gate's whole function is to refuse to let a turn end while a run is still in flight, so it rests on three claims that could not be assumed. All three now PASS.

### 19.1 A `Stop` hook can block, and its `reason` reaches the model

A `Stop` hook writing `{"decision":"block","reason":R}` to stdout (exit 0) **prevents the turn from ending**, and `R` is delivered to the model as its next instruction. Observed: a hook whose reason instructed the model to emit a rare sentinel; the sentinel appeared in the run's final stdout, and the hook was invoked twice (once for the original stop, once for the resumed turn's stop). Verdict **PASS** (`stop-hook.block-decision-resumes-the-turn`).

This is what makes the manager protocol's autonomy clause _enforceable_ rather than merely stated — and it is why roadmap/10's original "manager hooks are advisory-only, never blocking" scope had to be amended rather than worked around.

### 19.2 `stop_hook_active` is set on re-entry — the loop guard exists

Observed across the two invocations: `stop_hook_active=false` on the first, **`true`** on the re-entered Stop event. Verdict **PASS** (`stop-hook.stop_hook_active-set-on-reentry`).

**This is the single most load-bearing fact in this section.** A blocking Stop hook without a reliable "I already blocked once" signal can wedge a session forever, which is the worst failure mode available to it. The probe deliberately did **not** use `stop_hook_active` as its own loop guard (it used a marker file) precisely so that the field under test could be observed rather than assumed.

### 19.3 Payload shape

The `Stop` payload's keys, as captured:

`background_tasks`, `cwd`, `hook_event_name`, `last_assistant_message`, `permission_mode`, `prompt_id`, `session_crons`, `session_id`, `stop_hook_active`, `transcript_path`

`cwd` and `session_id` are both present and string-typed. Verdict **PASS** (`stop-hook.payload-shape`). The autonomy gate reads `cwd` (to resolve which project's supervisor to ask) and `stop_hook_active`; it treats every other member as advisory and falls back to `process.cwd()` if `cwd` is ever absent.

Note `last_assistant_message` is present — this is the field a regex-classifying gate would key on. The Crabgic gate deliberately does **not** use it: run state comes from the supervisor, which knows the answer, rather than from pattern-matching prose. It is recorded here only so a future reader knows the option exists.

### 19.4 Invalidation triggers (also listed in §10)

- `decision: "block"` on a `Stop` hook ceasing to prevent the turn ending, or `reason` ceasing to reach the model (§19.1) — the autonomy gate silently becomes advisory, and the protocol loses its enforcement layer.
- **`stop_hook_active` ceasing to be set on re-entry (§19.2) — treat as a release blocker, not a drift note.** The gate would lose its loop guard. Its own defense-in-depth (it also fails open on every error path) reduces but does not eliminate the wedge risk.
- The `Stop` payload losing `cwd` (§19.3), which is how the gate resolves the project.

---

## 20. `Read` measured — as-shipped BINDING, the deny/sandbox backstop ABSENT (R7-P1, 2026-08-05)

**This section amends §3 and §14.4 without editing them.** Both are cited by line number from
`docs/deploy-posture.md`, so this evidence is appended rather than inserted — the same discipline
`docs/interface-ledger.md` gets. Read §14.4 with this section beside it.

**Probe:** `packages/engine-claude/src/live/read-exposure.live.test.ts`. Owner-authorized; **30 of 30**
engine turns; engine 2.1.220 via the SDK transport. **Two verdicts, deliberately not one** — §14.4 was
itself corrected for drawing a single over-broad conclusion, and the same mistake was available here.

### 20.1 As shipped: BINDING

Under the compiled profile verbatim, runtime roots resolved as `run-dispatcher.ts` does, sandbox
enabled: `Read` was refused on all three sensitive targets (`~/.ssh`, `~/.aws`, the control state
root), attributably, with a positive control succeeding in **every** arm. **crabgic as it ships does
not expose them.**

### 20.2 The backstop: ABSENT

One arm added `Read` to `permissions.allow` and **changed nothing else** — sandbox still enabled, all
26 `permissions.deny` entries and all 6 `sandbox.filesystem.denyRead` entries byte-identical (verified
from the artifact, not from prose). The worker then read the control state file.

So the only thing binding as-shipped is **out-of-cwd `Read` matching no allow rule under `dontAsk`** —
defence-in-depth of depth one. ⚠️ `docs/claude-code-adaptation.md` Appendix B's own sketch shows
unconditional `Read`/`Grep`/`Glob` allows: **the change that removes the sole working barrier is
already written down as the obvious one.**

### 20.3 Two successes, two DIFFERENT facts — do not conflate them

- **The state root is a covering-rule failure.** Rules aimed squarely at it existed on **both** layers
  (`permissions.deny`, `disallowedTools`, and `sandbox.filesystem.denyRead`) and did not stop the read —
  79 bytes, marker observed. **ABSENT rests on this target alone, and survives on it.**
- **`~/.ssh` is a coverage gap, not a failed deny.** `SSH_DENY_PATH`/`AWS_DENY_PATH`
  (`packages/engine-core/src/compiler/xdg-default-paths.ts:54,57`) are **tilde-only by construction**,
  with no resolved-absolute sibling — unlike state and cache, which carry both — and `~` resolves to the
  **worker's provisioned HOME** (`packages/supervisor/src/worker-lifecycle/worker-provisioning.ts:28`).
  Nothing was ever aimed at the operator's real `~/.ssh` to fail.

### 20.4 Production finding, and why the remedy is smaller than it looks

The compiled profile carries **no deny of any kind, on either layer, over the operator's real `~/.ssh`
and `~/.aws`** — the same hazard `xdg-default-paths.ts:31-46`'s own carry-forward discharged for state
and cache and left open for these two.

⚠️ **Closing it restores the _intended_ defence-in-depth, not an _effective_ one.** §20.3's state-root
result shows a resolved-absolute deny does not stop a `Read` on this engine anyway, and as-shipped
auto-deny already refuses these paths. The remedy buys **configuration intent, in both worlds**. Worth
doing; do not oversell it.

### 20.5 What this amends

- **§3's row** "`dontAsk` auto-denies an unlisted tool (`Write`, not in any allow rule)" is **narrowed
  for `Read`**: auto-deny is **directory-scoped**, not tool-wide — in-worktree `Read` succeeded with no
  allow rule anywhere, in three arms.
- **§14.4's Limits** ("It does not measure `Read`…") is **discharged for `Read`** by this section.
- **§14.4's item 1** parenthetical — that the sandbox's own `denyRead`/`denyWrite` lists are "a
  different mechanism that does bind" — is true for shell-issued writes and **measured FALSE for the
  engine's `Read` tool with the sandbox enabled.** Item 1's advice to keep the deny entries still
  stands; its stated reason does not.
- A **new engine fact**: a path-scoped `Read(...)` deny **does** match — unlike §14.4's `Write` result —
  but only in its **tilde** form, resolved against the worker's own HOME.

### 20.6 Limits

n=1 per arm. **Nothing here is positively attributable to the sandbox**: the sandbox-on/off differential
is null, and the `Bash cat` arm was stopped by the permission layer before bwrap could matter — the
sandbox half of ABSENT rests on one negative. Allow-matching proved sufficient for `Read` but **not**
for `Bash`. **Not measured:** whether the tilde deny still binds once `Read` is allowed (dropped for
budget). Evidence: `docs/evidence/phase-00/r7-p1-read-exposure-transcript.md`.

---

## 21. Subagent turn bounds: `maxTurns` in agent frontmatter, its 200-turn default, and the drop-on-invalid behaviour (2026-08-06)

**Added 2026-08-06. BINARY-SOURCED, not probe-verified** — read the evidence caveat below before relying on this the way §1–§9's live verdicts can be relied on. Same evidentiary class as §16 (documentation-sourced) and §17 (a static read of the binary corroborated by the vendor reference), and weaker than §15, whose fact came off a real `--help` invocation.

**Why this section exists at all:** a subagent spawned through the `Task` tool runs its own conversation loop, and **that loop's turns never reach the parent's `num_turns`.** Measured on 2026-08-05 (`docs/verification-playbook.md` §BOUNDING A SUBAGENT-SPAWNING TEST): a single exploration request served ~51 distinct nested round trips behind ~2 parent turns while the parent's own ledger reported ~8. No caller-side cap bounds that, and §10's CLI-flag-surface bullet already records `--max-turns` as absent from `claude --help`. The frontmatter key below is the mechanism that does bound it, so anything in this repository that relies on a subagent being bounded relies on §21.

**Facts, read out of the engine binary bundled with `@anthropic-ai/claude-agent-sdk` 0.3.218 (`claude --version` → `2.1.218 (Claude Code)`), in decreasing order of load-bearing-ness:**

1. **`maxTurns` is a recognized agent-frontmatter key**, listed beside the keys this repository already writes:

```text
"keywords","compatibility","tools","disallowedTools","color","permissionMode","maxTurns","initialPrompt","memory","background","isolation","observer",…
```

2. **Its declared shape is a positive integer**, and the constraint is the schema's, not this repository's:

```text
maxTurns:b.number().int().positive().optional()
```

3. **Plugin agent files are validated for it specifically, and an unreadable value is warned about and then DROPPED** — the assembled agent simply omits the key, which silently restores the default in fact 4. A bound that looks installed and is not:

```text
Plugin agent file ${e} has invalid maxTurns '${$}'. Must be a positive integer.
```

4. **The built-in default is 200 turns** for an agent whose frontmatter is silent, and the loop's terminator is a `max_turns_reached` event carrying the bound and the count reached:

```text
tools:["*"],maxTurns:200,model:"inherit"
yield Ka({type:"max_turns_reached",maxTurns:c,turnCount:Ln},f)
```

**UNDETERMINED, and it is the question a reader is most likely to have: whether a QUOTED value (`maxTurns: "30"`) is coerced or dropped.** The loader's own accepting function reads:

```text
function $to(e){if(e===void 0||e===null)return;let t=typeof e==="number"?e:Md(String(e));if(Number.isInteger(t)&&t>0)return t;return}
```

That `String(e)` before the integer test **points toward** a quoted value being coerced and installed. It is not proof, because the bundle contains **two** functions named `Md`: a numeric parser at byte offset 245423091 (`function Md(e){let t=String(e).trim();return BMm(t)??parseInt(t,10)}`), under which a quoted `"30"` coerces to `30` and installs, and an unrelated highlight.js language definition at byte offset 268544071 (`function Md(e){let t={className:"string",…`), under which `$to` would return `undefined` for **every** non-number and quoted values would always be dropped. `$to` itself sits at byte offset 248915890 — nearer the first, which is suggestive and not dispositive in a bundle whose module scopes are not visible from the bytes.

An attempt to settle it empirically **failed and is recorded rather than hidden**: a scratch plugin directory was loaded through the pinned binary with `claude --plugin-dir <dir> plugin details <name>`, at `maxTurns` values `30`, `"30"`, `'30'`, `0`, `3.5` and `banana`, with and without `-d`. **No warning surfaced for any of them — including `banana`, the positive control** — so that command does not expose this loader's warn-level channel and the run discriminates nothing. Settling it needs a probe that reaches the channel (a real session load, or the debug-file output).

⇒ **Only the bare integer literal is established.** Do not write a quoted `maxTurns` anywhere in this repository on the strength of this section, and do not read the `$to` snippet as permission to.

**Consumer:** `packages/plugin/agents/eo-explore.md` declares `maxTurns: 30` and cites this section. `packages/plugin/src/plugin-manifest.ts`'s subagent validator refuses any declared `maxTurns` that is not a bare positive-integer literal — reading the verbatim frontmatter text rather than the parsed attribute, because this package's own `parseScalar` strips double quotes and would otherwise make `"30"` and `30` indistinguishable. The other four manager subagents deliberately declare none and run at fact 4's 200; that residual is pinned by an assertion in `packages/plugin/src/plugin-manifest.test.ts`.

**Evidence caveat (load-bearing):** every fact above is a byte read of an installed binary. No spike probes it, no live session was driven, and no `@live` test was run — the batch that landed this section had a standing prohibition on paid engine turns. The `--help`-sourced half of the neighbouring facts (`--max-budget-usd` present, `--model` single-arity, `--max-turns` absent) came from a free local `claude --help` on the same binary, which is §15's evidentiary class rather than this one's. A live verification — load a plugin whose agent declares a bound, drive a subagent past it, and observe `max_turns_reached` — is **OWED** and belongs on §11's list, together with the quoted-value question above. Transcript: `docs/evidence/phase-10/live-lane-preconditions-batchK.txt`.

**Invalidation trigger (also listed in §10):** any change to the agent-frontmatter `maxTurns` key name or schema, to the 200-turn built-in default, to the drop-on-invalid behaviour (a version that _rejects the agent_ rather than dropping the key would be a materially different failure mode), or to `max_turns_reached` as the loop's terminating signal.

---

## §11 addendum (2026-08-07) — two owed probes, recorded here rather than inside §11

**Why at EOF and not in §11 itself.** Merged `docs/deploy-posture.md` cites this file by line number
at `:290`, `:308`, `:312`, `:519`, `:523`, `:528`, `:545` and `:566`, and §11 sits above every one of
them. Inserting bullets into §11 would shift all eight and leave a merged document pointing at the
wrong lines forever — the exact failure the line-anchored discipline in
`docs/verification-playbook.md` exists to prevent. So the two entries live here, and §11's list
should be read as continuing into this section.

Both are **OWED and owner-gated**: each needs a live engine session, which no free channel provides.

- **§16's owed probe — marketplace install version resolution.** §16 records its own live
  verification as owed. The probe: install a plugin from a scratch marketplace at a KNOWN
  manifest-version / entry-version pair, then read the resolved version back out, so which of the two
  wins is observed rather than inferred from a static read of the binary.

- **§21's owed probe — an agent-declared `maxTurns` actually bounding a subagent loop.** §21 says in
  its own evidence caveat that a live verification is owed and belongs on §11's list. The probe: load
  a plugin whose agent frontmatter declares a bound, drive a subagent past it, and observe the
  `max_turns_reached` terminating signal. The **quoted-value question** §21 leaves open must be
  settled in the same run, and it needs a channel that reaches the loader's own warn output —
  `claude plugin details` is warn-blind here, measured: it surfaced no warning even for a
  deliberately invalid value, so its silence discriminates nothing (see the warn-blind-channel ruling
  in the playbook).

Neither is blocking. §16's consumer and §21's bound both degrade to already-recorded defaults, and
both facts are currently binary-sourced rather than probe-verified — which is the evidentiary class
each section already declares for itself.

---

## 22. `last_assistant_message` gains a consumer — an invalidation trigger for §19.3 (2026-08-11)

**This section amends §19.4 and §10 without editing them.** Both are ahead of this point in a file
carrying 22 line-numbered citations, so this is appended rather than inserted — the same discipline
§20 applies, and for the same reason. No new probe was run and no engine fact changed here; what
changed is who depends on one.

**What happened.** §19.3 recorded the `Stop` payload's keys, `last_assistant_message` among them,
and noted it as "the field a regex-classifying gate would key on ... recorded here only so a future
reader knows the option exists". That option has now been taken:
`packages/plugin/hooks/stop-report-format-gate.mjs` reads it to refuse a turn that would end on a
wall of prose, making `docs/presentation-policy.md`'s reporting rules enforceable for the manager
channel rather than merely stated.

The distinction §19.3 draws still holds, and is the reason two `Stop` hooks key on different things.
Run state is knowable from the supervisor, so `stop-autonomy-gate.mjs` asks it rather than
pattern-matching prose for an answer already available. Formatting is a property OF the text, so
there the text is the source rather than a proxy for one.

### 22.1 Added invalidation trigger for §19.3

- **The `Stop` payload losing `last_assistant_message`, or it ceasing to hold the message the turn
  is about to end on.** The report-format gate silently becomes a no-op and the manager channel
  reverts to instruction-only. **Not release-blocking** — the gate fails open by construction, so
  the failure mode is a lost check rather than a trapped session, and `docs/presentation-policy.md`
  states plainly what is lost.

This is deliberately a weaker trigger than §19.2's `stop_hook_active` one, which stays
release-blocking: losing the loop guard risks wedging a session, and both blocking `Stop` hooks now
depend on it rather than one.
