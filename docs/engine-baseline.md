# Engine baseline (Phase 00)

**Status:** baseline established, one round of live verification complete.
**Tested version:** `claude` CLI **2.1.210** (Claude Code), `@anthropic-ai/claude-agent-sdk` **0.3.210** — both npm-registry-current at time of test.
**Doc baseline (`docs/claude-code-adaptation.md`) was verified against:** 2.1.207 (2026-07-12).
**Accepted range:** **2.1.207–2.1.210**, pending re-verification. Node v24.18.0, WSL2 Linux (6.6.87.2-microsoft-standard-WSL2), `bwrap` 0.9.0 + `socat` present (installed mid-phase; see §6).
**Date verified:** 2026-07-15.
**This is the single citable baseline** — per the project's ground rule, anything engine-touching cites this document, never memory or the adaptation doc's own §10 open-questions list directly. The adaptation doc remains the *rationale* record; this file is the *verified-fact* record.

**Producing scripts:** `spikes/01-auth.mjs` … `spikes/08-tool-catalog-env.mjs` (re-runnable; see `spikes/README.md`; 01–07 map to roadmap/00's seven In-scope probes, 08 is the orchestrator-directed tool-taxonomy follow-up). **Fixtures:** `spikes/fixtures/*.verdicts.json` (one array per script) + sanitized transcripts (`*.transcripts.sanitized.json(l)`, `*.raw.sanitized.json`) reflect only the FINAL run of each script. **Probe-run count:** the final formal runs total ~46 live model invocations (haiku throughout; spike 07 made zero live calls by design); including development/debugging iterations (spike 03's Edit/Agent-tool fixes and post-08 re-run, spike 04's egress/denyRead confound fixes, spike 01's handoff-file rework, spike 08's two passes), the approximate total for this whole phase-00 pass is on the order of 70 live model invocations. All were haiku, single- or few-turn, short prompts.

---

## 1. Auth decision record (blocking spike, work item 2)

| Path | Status | Verdict |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` via `claude setup-token` | Not runnable today — `claude setup-token` is interactive; owner was not present. No token was minted during this pass; the mid-phase handoff file `~/.claude/.eo-oauth-token` also did not exist by the time this baseline was written. | **UNRESOLVED** |
| `.credentials.json` fallback (copy into isolated `CLAUDE_CONFIG_DIR`, mode 0600, `settingSources: []` SDK worker) | Actually exercised. `~/.claude/.credentials.json` (508 bytes, mode 0600) copied into an `os.tmpdir()`-based isolated `CLAUDE_CONFIG_DIR`; SDK worker with `settingSources: []` resolved auth and completed a turn with `subtype: "success"`, no interactive/browser login triggered. | **PASS** |

**Go/no-go call:** the documented fallback is confirmed viable and is what v1 should rely on until the primary path is verified. **`spikes/01-auth.mjs` already supports the primary path natively** — it checks `CLAUDE_CODE_OAUTH_TOKEN` first, then `~/.claude/.eo-oauth-token` (mode-checked, read at runtime, never written to any committed file) — so re-running it once either exists is a single command with no code change.

- **MITIGATION (UNRESOLVED, token path):** owner runs `claude setup-token` and either exports `CLAUDE_CODE_OAUTH_TOKEN` or writes the token to `~/.claude/.eo-oauth-token` (0600); re-run `node spikes/01-auth.mjs`.
- Security: no script writes credential bytes anywhere outside an `os.tmpdir()` scratch dir that is deleted in a `finally` block; `spikes/01-auth.mjs` also greps its own output for the first 8 characters of any real OAuth token used, in addition to the shared `sk-ant-*`/token-blob/`$HOME` scan (§7).
- **Env-inheritance caveat (checked):** these spikes run nested inside a live Claude Code session, whose env (`CLAUDECODE`, `CLAUDE_CODE_*`, auth-adjacent vars) could in principle mask auth-resolution results if inherited by the worker. **Both auth probes used a strictly allowlisted, from-scratch env** (`PATH`, `HOME`=isolated, `CLAUDE_CONFIG_DIR`=isolated, plus — token path only — `CLAUDE_CODE_OAUTH_TOKEN`); the SDK's `Options.env` replaces the subprocess environment entirely, so the fallback PASS reflects genuine `.credentials.json` resolution, not inherited ambient auth. See §4.3.

Fixture: `spikes/fixtures/01-auth.verdicts.json`.

---

## 2. Hermeticity verdict (work item 3)

The `settingSources: []` SDK worker — the confirmed v1 transport (adaptation §0/§5.3), not `--bare` — was tested against a rogue "user"-tier `settings.json` (planted at an isolated `CLAUDE_CONFIG_DIR`, never the real `~/.claude`), a rogue project-tier `settings.json` + `PreToolUse` hook, a rogue `CLAUDE.md`, and a rogue project `.mcp.json` (pointing at a nonexistent binary).

| Sub-probe | Verdict |
|---|---|
| Rogue user-tier + project-tier `settings.json` `env` blocks NOT injected into worker's Bash env | **PASS** |
| Rogue user-tier + project-tier `PreToolUse` hooks do NOT fire | **PASS** |
| Rogue `CLAUDE.md` secret phrase NOT injected into system prompt / not surfaced | **PASS** |
| Rogue project `.mcp.json` NOT auto-discovered (absent from init `mcp_servers`) | **PASS** |

**All four PASS — no partial-hermeticity surprise on settings/hooks/CLAUDE.md/.mcp.json.** This resolves adaptation §10 item 3 (`settingSources` default ambiguity) for the *explicit-`[]`* case unconditionally: phase 03's compiler and phase 06's spawn path may build on this holding, as designed.

**Separately confirmed from the SDK's own type declarations** (not requiring a live probe): `settingSources` **omitted** defaults to loading **all** filesystem sources (user/project/local), matching CLI defaults — it is not itself ambiguous in the current SDK; the ambiguity adaptation §10 item 3 flagged was about cross-doc inconsistency, not the shipped behavior. Downstream phases should still always pass `settingSources: []` explicitly per that item's own mitigation — this is now a "belt" on top of a "suspenders" default, not a load-bearing requirement.

Fixtures: `spikes/fixtures/02-hermeticity.verdicts.json`, `02-hermeticity.transcript.sanitized.jsonl`.

---

## 3. Permission probes (work item 4)

All run via SDK `query()` with `settingSources: []` + an explicit `settings` object carrying the permission envelope under test (the confirmed v1 worker-launch shape), `permissionMode: "dontAsk"`, reading the SDK result's `permission_denials: {tool_name, tool_input}[]` field.

| Sub-probe | Verdict | Note |
|---|---|---|
| `dontAsk` auto-denies an unlisted tool (`Write`, not in any allow rule) | **PASS** | |
| Compound-command smuggling (`echo x && curl …`) denied | **PASS** | curl subcommand independently fails to match `Bash(echo:*)` |
| Process-wrapper smuggling (`nohup curl …`) denied | **PASS** | wrapper stripped, curl still fails to match |
| Deny-wins-over-allow, same settings level | **PASS** | rule present in both `allow` and `deny` at one level → denied |
| Deny-wins-over-allow, cross settings level | **PASS** | user-tier `deny` beat project-tier `allow` for the identical rule |
| `Edit` outside the allowed path denied | **PASS** | model also tried a `Bash(sed -i …)` workaround after the `Edit` denial — **also denied** (Bash wasn't allow-listed at all in this config); file left byte-identical |
| `Agent` deny blocks subagent spawning | **PASS** | resolved by spike 08 after an initial UNRESOLVED pass — see §4: the `Agent` **rule name** aliases the live **`Task`** tool literal, and deny enforcement is **catalog-removal** (fail-closed), not call-time denial |
| Bash colon-spacing (`Bash(cargo check:*)` vs `Bash(cargo check :*)`) | **PASS** | see below |

### Bash colon-spacing verdict (load-bearing for phase 03)

Tested a prefix **outside** the doc's four confirmed literals (`Bash(npm run test:*)`, `Bash(npm run build:*)`, `Bash(git status:*)`, `Bash(git diff:*)` — none show a space before the colon):

- `Bash(cargo check:*)` (**no space** before the colon) → **matched and allowed** `cargo check --workspace`.
- `Bash(cargo check :*)` (**space** before the colon) → **did NOT match**; the command was denied.

**Verdict: the no-space form is required**, consistent with the doc's four literal examples. Phase 03's envelope compiler may generalize `Bash(<prefix>:*)` (no space before the colon) to arbitrary prefixes beyond the doc's four literals.

Fixtures: `spikes/fixtures/03-permissions.verdicts.json`, `03-permissions.transcripts.sanitized.json`.

---

## 4. Tool taxonomy — RESOLVED: `Agent` rule name aliases the live `Task` tool; deny enforcement is catalog-removal

An initial spike-03 pass recorded a surprise here (no tool named `Agent`; `permission_denials: []` under `deny: ["Agent"]`). A dedicated follow-up spike (`spikes/08-tool-catalog-env.mjs`, run at the orchestrator's direction to test an env-contamination hypothesis) plus re-analysis of the spike-03 fixtures resolved it fully. Facts, in decreasing order of load-bearing-ness for phase 03:

### 4.1 The subagent-spawn tool's live literal name is `Task`; the permission-rule name `Agent` aliases it

- Under the **default** permission mode (no deny rules), the engine's tool catalog **includes a tool literally named `Task`** — on the SDK transport and the CLI transport alike, under both a strictly allowlisted env and a fully inherited env (spike 08, all three catalogs byte-identical, engine 2.1.210 in every capture).
- **No tool literally named `Agent` exists** in any captured catalog (12 init-message captures across spikes 03 and 08).
- Across the spike-03 fixtures, `Task` is present in **6/6** runs whose settings did *not* deny `Agent`, and absent in exactly the **2/2** runs whose settings contained `deny: ["Agent"]` — the `Agent` **rule name** maps to the `Task` **tool literal**.

### 4.2 Deny enforcement mechanism: catalog-removal, not call-time denial

With `deny: ["Agent"]` (or `deny: ["Task"]` — spike 08 confirmed both) active, the `Task` tool is **removed from the model's tool catalog entirely** (absent from the init message's `tools` list). The model can never attempt the call, so `permission_denials` stays empty **by design** — the original "no denial recorded" observation was this fail-closed removal, not a bypass. Phase 06's conformance checks must assert this as **absence-from-catalog**, not as a recorded denial event. Verdict: **PASS** (`permissions.agent-deny-blocks-subagent` re-run in spike 03 with the corrected assertion; `tool-catalog.subagent-literal-deny` in spike 08).

### 4.3 Env-contamination hypothesis: REFUTED (and the spawn-env discipline is a baseline fact anyway)

- **Every spike 01–06 SDK probe already constructed its worker env from scratch** (allowlist: `PATH`, `HOME`=isolated, `CLAUDE_CONFIG_DIR`=isolated, plus probe-specific vars). The SDK's `Options.env` docstring states the value **replaces** the subprocess environment entirely; the SDK itself stamps `CLAUDE_CODE_ENTRYPOINT="sdk-ts"` into the child. The surprising catalog was therefore never an inherited-env artifact.
- The explicit comparison (spike 08): SDK worker under strict allowlist env (`PATH`, `HOME`, `TMPDIR`, `CLAUDE_CONFIG_DIR` only) vs. under the full inherited env of a live nested Claude Code session (`CLAUDECODE`, `CLAUDE_CODE_*`, `AI_AGENT`, etc. present) → **tool catalogs identical**.
- **Baseline fact for phase 06's spawn path regardless:** workers must be spawned with an explicitly allowlisted env. On this engine version env inheritance did not alter the catalog, but the allowlist is what makes that a non-issue by construction, and it is already the confirmed behavior of every probe in this suite (fixture: `spikes/fixtures/08-tool-catalog-env.catalogs.sanitized.json`, both catalogs recorded).

### 4.4 The broad default catalog itself (residual, non-blocking)

The default catalog on this host — `Task, Bash, CronCreate, CronDelete, CronList, DesignSync, Edit, EnterWorktree, ExitWorktree, Monitor, NotebookEdit, PushNotification, Read, RemoteTrigger, ReportFindings, ScheduleWakeup, SendMessage, Skill, TaskCreate, TaskGet, TaskList, TaskOutput, TaskStop, TaskUpdate, ToolSearch, WebFetch, WebSearch, Workflow, Write` — is larger than adaptation Appendix A/B's assumed inventory (no `Grep`/`Glob` as dedicated tools; many additional built-ins). Since it is **identical across SDK/CLI transports, and across allowlisted/inherited envs, at engine 2.1.210**, it is engine-default behavior as far as this host can determine, not host contamination. Impact on v1 is low: the worker profile is `dontAsk` + explicit **allow-list**, and §3 confirms unlisted tools (e.g. `Write`) are auto-denied regardless of how large the ambient catalog is. The catalog list above is itself part of this baseline; a changed list on a future version is a baseline-invalidating event (§10).

- **Residual MITIGATION (downgraded from blocking):** a one-time catalog capture on a clean, non-dev-workstation install remains worthwhile before release hardening (phase 23) to confirm 4.4's list is engine-default rather than account/host-specific — but phase 03 is no longer blocked: the `Agent`→`Task` aliasing, the removal-based enforcement, and the allow-list posture are all confirmed on both transports under sanitized envs.

---

## 5. Structured-output probe (work item 6)

Transport: SDK `query()` — `Options.outputFormat: {type: 'json_schema', schema}` is the confirmed SDK field name (the CLI `--json-schema` flag's SDK equivalent; adaptation §4.4 only said "SDK equivalent" without naming it — there is no field literally called `jsonSchema` on `Options`).

| Sub-probe | Verdict |
|---|---|
| Happy path: well-formed request → validated `structured_output` | **PASS** — `{"answer":"hello","count":3}`, `subtype: "success"` |
| Deliberate schema violation (model told to ignore the schema and reply with a bare word) | **PASS** (recorded, not judged — see below) |

**Exact observed schema-violation behavior** (verbatim, as the roadmap requires): the model **declined to call the internal `StructuredOutput` tool at all**, explaining in plain text that it wouldn't call it without a legitimate request. The result still came back `subtype: "success"`, `is_error: false`, with `structured_output: undefined` — **no retry loop was forced, no non-zero exit, no typed error subtype** in this scenario. This reveals an implementation detail not in the adaptation doc: schema-constrained output is mediated by an internal tool named **`StructuredOutput`** that the model chooses to call (or not) — it is not a hard grammar constraint on the final message.

**Separately confirmed from the SDK's own type declarations:** a distinct result subtype `error_max_structured_output_retries` exists (`SDKResultError.subtype`), implying the engine *does* auto-retry and can hard-fail after exhausting retries — but only, apparently, when the model *attempts* the `StructuredOutput` tool call with invalid arguments repeatedly, not when it simply never calls the tool (as observed here). **This retry-exhaustion path itself remains UNRESOLVED/unobserved** — provoking a model into repeatedly attempting-but-failing structured output (rather than declining outright) was not achieved in this pass.

- **MITIGATION (partial UNRESOLVED):** phase 06 should treat "no `structured_output` field, `subtype: success`" as a normal, expected failure-to-produce-structured-output shape requiring its own repair-attempt trigger (not just the `error_max_structured_output_retries` subtype) — that success-shaped absence is what was actually observed. Re-probe the retry-exhaustion path specifically (e.g. a schema the model will keep trying to satisfy but structurally cannot) if that distinct shape needs its own repair-path branch.

Fixtures: `spikes/fixtures/05-structured-output.verdicts.json`, `05-structured-output.transcripts.sanitized.json`.

---

## 6. Sandbox probes (work item 5) — full suite run, bwrap + socat installed mid-phase

**Host update mid-phase:** bubblewrap 0.9.0 and socat were installed by the orchestrator (`/usr/bin/bwrap`, `/usr/bin/socat`) partway through this phase. All six sandbox sub-probes below were run **for real**, superseding the originally-anticipated "absent, mostly UNRESOLVED" path.

Transport: SDK `query()` — **`Options.sandbox`** (the top-level SDK field), **not** `settings.sandbox`. These have a materially different `failIfUnavailable` default: `Options.sandbox` defaults `failIfUnavailable` to **true** once `enabled: true` is set (query errors out rather than degrading), while the settings.json-level `sandbox.failIfUnavailable` key defaults to **false** (warns, runs unsandboxed). Both were exercised explicitly with `failIfUnavailable: true` here regardless.

| Sub-probe | Verdict | Detail |
|---|---|---|
| `bwrap` presence | **PASS** | found at `/usr/bin/bwrap` |
| `failIfUnavailable` aborts when forced-broken | **PASS** | `PATH` starved to exclude `bwrap`; `query()` threw `"Sandbox required but unavailable: ... bubblewrap (bwrap) not installed, socat not installed ..."` rather than running unsandboxed |
| Egress denied, empty `allowedDomains` | **PASS** | see behavior note below |
| UDS reachable with the correct Linux flag | **PASS** | see schema correction below |
| `denyRead ~/.ssh` enforced | **PASS** | secret readable without `denyRead`; unreadable with it (see confound note below) |
| `credentials.envVars mode: mask` shows placeholder only | **PASS** | real value never appeared in transcript; some (non-real) `VALUE=` output was observed |

### Behavior note: egress denial shape

A Bash-invoked `curl` to `http://example.com` with `network.allowedDomains: []` did **not** fail as connection-refused/DNS-failure — **the sandbox's own network proxy answered the request itself with HTTP 403** (`curl` exited 0 — it successfully reached the proxy, which then refused it). Record this shape verbatim for phase 06's egress-denial detection: check for the proxy's own 403 (or other synthesized HTTP response), not only OS-level connection errors.

### Schema correction: Unix-socket allow flag

Adaptation Appendix A cites `network.allowUnixSockets: true` as a **boolean**. The live `SandboxSettings.network.allowUnixSockets` field is typed **`string[]`** — a **macOS-only** path allowlist, explicitly documented as **"ignored on Linux (seccomp cannot filter by path)"**. The Linux/WSL2-relevant gate is a **differently-named boolean key: `allowAllUnixSockets`**. Confirmed empirically: default config → UDS unreachable; `network.allowAllUnixSockets: true` → UDS reachable. **Phase 03/06 must use `allowAllUnixSockets` on Linux/WSL2, not `allowUnixSockets`.**

### Clarification: sandbox filesystem/network keys are supplementary, not primary

The SDK's own `Options.sandbox` docstring states filesystem and network restrictions are actually configured via **permission rules** (`Read(...)`/`Edit(...)` allow/deny, `WebFetch(domain:...)`), and the `sandbox.filesystem.*`/`sandbox.network.*` keys **merge with** those rules rather than being the primary mechanism (e.g. `sandbox.filesystem.denyRead` docstring: "merged with paths from `Read(...)` deny permission rules"). This refines — does not contradict — adaptation §4.2's schema example, which put filesystem/network config directly under `sandbox: {...}`; that block still works, but the source of truth for what an envelope compiler should touch first is the permission-rule layer, with `sandbox.*` as the supplementary/behavioral layer (`enabled`, `failIfUnavailable`, `allowAllUnixSockets`, `credentials.*`, etc.).

### Methodology note (confound found and fixed)

An initial run of the `denyRead ~/.ssh` probe using a file literally named `fake_id_rsa` with "PRIVATE_KEY" wording in its content caused **the model's own safety training to refuse the `cat` command outright**, in both the deny and no-deny configurations — a false "FAIL" caused by the model, not the sandbox mechanism. Fixed by keeping the directory literally named `.ssh` (required for the `~/.ssh` rule to apply) but renaming the file/content to neutral markers. Recorded here since it is exactly the kind of "surprise" this phase asks to capture, and because it is a durable pitfall for anyone re-running this probe.

Fixtures: `spikes/fixtures/04-sandbox.verdicts.json`, `04-sandbox.transcripts.sanitized.json`.

---

## 7. Session probes (work item 7)

Transport: CLI subprocess (`claude -p`, spawned directly via `child_process`, no shell) — needed for literal `kill -9` process control and true concurrent-OS-process interleaving testing; both transports spawn the same underlying engine.

| Sub-probe | Verdict | Detail |
|---|---|---|
| Pre-assigned `--session-id` honored | **PASS** | result `session_id` == requested UUID; transcript file created at `<CLAUDE_CONFIG_DIR>/projects/<munged-cwd>/<uuid>.jsonl` |
| `kill -9` mid-run → `--resume` continuity | **PASS** | worker told to remember "42" then `sleep 8` via Bash; killed after 3.5s; `--resume <same-id>` from the same cwd recalled "42" |
| `--fork-session` transcript isolation | **PASS** | original transcript file byte-identical before/after fork; fork got a distinct `session_id`; fork recalled prior context ("BANANA123"); fork has its own transcript file |
| Two concurrent same-dir sessions, distinct `--session-id`s, no interleave | **PASS** | two processes launched concurrently in the same cwd, each told a distinct secret word + `sleep 3`; resuming each afterward recalled only its own word, never the other's |

Confirmed munged-cwd pattern: cwd `/a/b/c` → transcript directory name `-a-b-c` (leading `/` → leading `-`, remaining `/` → `-`), matching adaptation Appendix A's claim.

Fixtures: `spikes/fixtures/06-sessions.verdicts.json`, `06-sessions.raw.sanitized.json`.

---

## 8. Rate-limit signal capture (work item 8)

**No live API call was made for this probe.** The owner's Claude subscription (the same account every other spike in this phase authenticates as) already hit a session/usage limit earlier today (2026-07-15), before this phase began. Deliberately exhausting it further to observe the live signal was judged unsafe: it risks blocking the owner's own concurrent work and any other phase-00 worker sharing this login for the rest of the reset window, for a payoff not even guaranteed to include the structured event shape.

**Observed real signal** (surfaced today, as an API error to a headless agent process — error-string channel, not a parsed stream-json event), cited verbatim as the one available sample of the subscription-limit signal shape:

> `Agent terminated early due to an API error: You've hit your session limit · resets 2:10pm (Europe/Madrid)`

This confirms the error-string channel's shape (human-readable sentence naming the limit kind — "session limit" — plus a localized reset time/timezone). **It does NOT confirm the structured stream-json event shape** (dedicated `type`/`subtype` discriminator, machine-parseable reset timestamp, limit-kind enum) — that remains **UNRESOLVED** per adaptation §10 item 10.

**Simulation strategy for downstream phases** (roadmap-sanctioned alternative to live-triggering):

1. Phase 03's fake engine synthesizes **two distinct** fixtures — a stream-json system/error-shaped message, and a plain result-string error carrying the observed phrase shape — since the real structured shape is unconfirmed; the fake engine must not assume one is a subset of the other.
2. Phase 13's scheduler `parked:rate_limit` state machine is exercised against both synthesized fixtures independently.
3. The next time any worker naturally hits a limit during ordinary (non-deliberate) use, on any phase, capture the raw message sequence and fold it into `spikes/fixtures/` retroactively — the only safe path to the structured shape.
4. Phase 09's doctor seeded-fault matrix includes a rate-limit fault path fed by the same synthesized fixtures, not a live trigger.

- **MITIGATION:** the next time any worker naturally hits a limit while running with `--output-format stream-json` (or the SDK message stream), capture the raw sequence verbatim into `spikes/fixtures/07-ratelimit.live-capture.sanitized.jsonl` and update this section (and the two UNRESOLVED verdicts) to PASS/FAIL as appropriate. Do not deliberately trigger this on the owner's daily subscription; use a dedicated/metered test account or off-hours if a deliberate trigger is ever required.

Fixture: `spikes/fixtures/07-ratelimit.verdicts.json`.

---

## 9. Full verdict tally

26 PASS, 3 UNRESOLVED, 0 FAIL, across 29 recorded sub-probes in 8 scripts (the 8th, `spikes/08-tool-catalog-env.mjs`, is the orchestrator-directed follow-up that resolved spike 03's tool-taxonomy surprise; spike 03 was re-run with the corrected assertion after §4's facts landed).

| # | Script | PASS | UNRESOLVED | FAIL |
|---|---|---|---|---|
| 01 | auth | 1 | 1 | 0 |
| 02 | hermeticity | 4 | 0 | 0 |
| 03 | permissions | 8 | 0 | 0 |
| 04 | sandbox | 6 | 0 | 0 |
| 05 | structured-output | 2 | 0 | 0 |
| 06 | sessions | 4 | 0 | 0 |
| 07 | ratelimit | 0 | 2 | 0 |
| 08 | tool-catalog-env | 3 | 0 | 0 |

Every `UNRESOLVED` above carries an explicit mitigation note in its section (Hard Rule 1). No downstream phase may cite an `UNRESOLVED` item as settled fact.

---

## 10. Changes that would invalidate this baseline

Re-run the full probe suite (`spikes/README.md` procedure) and update this document before relying on a newer version if any of the following change:

- Any permission-rule matching semantics (deny/allow precedence, compound-command/wrapper stripping, the Bash colon-spacing form confirmed in §3).
- The `settingSources: []` hermeticity guarantee (§2) — if any planted-artifact class starts leaking, phase 03/06/09's hermeticity assumption breaks immediately.
- `Options.sandbox` vs `settings.sandbox` field names/defaults, `allowAllUnixSockets` vs `allowUnixSockets` naming (§6), or the egress-denial response shape (proxy-issued 403 vs. connection failure).
- The default tool-preset catalog (§4.4's exact list), the `Agent`→`Task` rule-name/tool-literal aliasing, or the deny-as-catalog-removal enforcement mechanism (§4.1–§4.2) — phase 03's `deny: ["Agent"]` emission and phase 06's absence-from-catalog conformance check are both built directly on these three facts.
- `Options.outputFormat` field name/shape, or the `StructuredOutput` internal tool name/behavior (§5), including whether `error_max_structured_output_retries` is actually reachable and under what conditions.
- Session transcript path munging scheme, `--resume`/`--fork-session` semantics (§7).
- The rate-limit error-string phrasing or the emergence of a structured stream-json event for it (§8).
- `claude --version` moves outside 2.1.207–2.1.210, or `@anthropic-ai/claude-agent-sdk` moves outside 0.3.207–0.3.210.
- CLI flag surface: **`--max-turns` is documented in `docs/claude-code-adaptation.md` §3.3 as confirmed in local `--help` 2.1.207, but is ABSENT from `claude --help` in 2.1.210** — only `--max-budget-usd` remains at the CLI layer. The SDK's `Options.maxTurns` field is unaffected and remains the confirmed mechanism (the SDK transport is already the confirmed v1 path per adaptation §0, so this doesn't block anything, but any future CLI-transport work must not assume `--max-turns` exists without re-checking).

---

## 11. NEEDS_ORCHESTRATOR

- **Auth token path (§1):** blocked on the owner running `claude setup-token` (interactive) and populating `CLAUDE_CODE_OAUTH_TOKEN` or `~/.claude/.eo-oauth-token`. `spikes/01-auth.mjs` is ready to pick either up with no code change.
- **Tool-taxonomy (§4): RESOLVED — no longer blocking phase 03.** The `Agent` rule name aliases the live `Task` tool literal; deny enforcement is fail-closed catalog-removal; env-contamination hypothesis refuted; SDK and CLI transports identical. Residual (non-blocking, pre-phase-23): one catalog capture on a clean non-dev-workstation install to confirm §4.4's broad default list is engine-default rather than account/host-specific.
- **Rate-limit structured shape (§8):** genuinely unresolved; only an opportunistic future capture (never a deliberate trigger against the owner's subscription) can close it.

---

## 12. Fixture index

All paths relative to repo root.

- `spikes/fixtures/01-auth.verdicts.json`
- `spikes/fixtures/02-hermeticity.verdicts.json`, `02-hermeticity.transcript.sanitized.jsonl`
- `spikes/fixtures/03-permissions.verdicts.json`, `03-permissions.transcripts.sanitized.json`
- `spikes/fixtures/04-sandbox.verdicts.json`, `04-sandbox.transcripts.sanitized.json`
- `spikes/fixtures/05-structured-output.verdicts.json`, `05-structured-output.transcripts.sanitized.json`
- `spikes/fixtures/06-sessions.verdicts.json`, `06-sessions.raw.sanitized.json`
- `spikes/fixtures/07-ratelimit.verdicts.json`
- `spikes/fixtures/08-tool-catalog-env.verdicts.json`, `08-tool-catalog-env.catalogs.sanitized.json`

All fixtures pass the sanitization scan (`sk-ant-*` token shapes, OAuth `accessToken`/`refreshToken` JSON blobs, literal `$HOME` path substring) with zero hits at time of writing; `spikes/01-auth.mjs` additionally checked for the first 8 characters of any real OAuth token used (none was used this pass — the token path is UNRESOLVED, §1).
