# Crabgic — Claude Code Adaptation Research

**Status:** Research complete — pre-implementation
**Verified against:** Claude Code **2.1.207** (local CLI + official docs at code.claude.com/docs + changelog), 2026-07-12
**Scope:** Adapting the "Crabgic — Complete Replacement Plan" (written for OpenAI Codex CLI) to Claude Code.

---

## 0. Confirmed product decisions (owner-approved, 2026-07-12)

| Decision | Choice |
|---|---|
| Audience / distribution | **Published OSS product from v1** — Apache-2.0 npm package + plugin marketplace, full installer/doctor/upgrade/uninstall polish |
| Engine strategy | **Claude Code only** — `EngineAdapter` kept as an internal seam, but only the Claude Code adapter ships and is tested; Claude-only mechanisms (sandbox, `canUseTool`, `--json-schema`, `dontAsk`) are load-bearing |
| v1 scope | **Full plan** — all 10 phases including Jira Cloud + Data Center, Grafana Cloud/OSS/Enterprise, performance contracts, and the learning pipeline |
| Worker auth | **Owner's Claude subscription (OAuth)** — see §5.7; metered API-key mode is not required for v1 |
| Worker transport | **Agent SDK in-process** (§5.3) — also pins a reproducible bundled engine version per release |
| Manager UX | **Claude Code plugin session is the flagship surface** (`/eo:` commands + gateway MCP); the `crabgic` CLI covers scripting, CI, recovery, and approval *escalations* — no longer routine approval (see the 2026-07-28 rows below) |
| Model routing default | **Balanced** — `sonnet` implementation workers, `opus` architect/planner + integration/security review, `haiku` mechanical chores; per-role overrides in config |
| Plan-limit policy | **Pause and resume** — on subscription rate/usage limits, work units park (journaled) and resume via session `resume` when the window resets; no silent tier degradation |

### Amendments (owner-approved, 2026-07-28)

These four rows amend the table above rather than extending it; each names the row it changes. They were
taken after a live audit of the shipped `crabgic@1.3.0` binary and are binding on the same terms as the
2026-07-12 set. Interface rulings: **ledger Gaps 18 and 19**.

| Decision | Choice | Amends |
|---|---|---|
| Command surface | **The user types no Crabgic command.** A request in an ordinary session, answers to clarifying questions, and a finished change set out. Slash commands and the CLI remain, for operators and escalations — never as the required path | Manager UX |
| Approval model | **Standing approval over an envelope class**, not per-ChangeSet consent. `crabgic install` writes an `EnvelopePolicy`; dispatch is a containment check; anything outside it halts on `expanded_authority`. Nothing reachable from a session may widen the policy | §5.5 (Gap 18) |
| Execution model | **Always workers, never the manager.** The manager researches, clarifies, designs, roasts and reviews; every write goes through an envelope-bounded worker in its own worktree. The dispatch chain is on the critical path, not optional | §5.3 (unchanged in mechanism; promoted from one option to the only one) |
| Quality loops | **A staged pipeline of specialised agents**: each stage has a producer, reviewer lenses, and written exit criteria. A review round is read-only and never spends a repair attempt. A stage advances when its criteria are met, no finding is `blocking`, and **every finding has a disposition**. Loops while a round closes a blocking finding; ceiling 5, then escalates. Advisory findings are journaled and become blocking when their code is next touched. `exhausted_repairs` untouched at initial + 2 | Amended 2026-07-29 (Gap 19; was "unbounded adversarial convergence, no severity floor" — measured non-terminating over 12 rounds). **Re-amended 2026-08-15 — see below** |

### Amendment (owner ruling R4, 2026-08-15) — the zero-findings exit is re-opened

Amendment 4's closure rule is superseded; the row above is left verbatim, per this repo's
annotate-never-rewrite convention. The owner was shown the 12-round measurement and ruled against the rule
it produced.

**A stage closes on a round that raises no admissible novel finding.** Severity plays no part: a new
`advisory` holds a stage open exactly as a `blocking` one does — the owner's "no issues, warnings, or buts",
which the progress rule could not honour. "Loops while a round closes a blocking finding; ceiling 5" is
replaced; the ceiling survives only as a runaway guard (20) that reports a **stall**, never a close.

This is reachable rather than aspirational because the finding space is bounded — scope, obligation,
identity, monotonicity — so a quiet round is a statement about a finite set instead of about a reviewer
running out of ideas. Design: `docs/design/owner-pipeline-conformance.md` §4.3. Ledger: Gap 19, amended.
Implementation: `roadmap/25-owner-pipeline-conformance.md`.

Three further rulings were given the same day and are recorded in the same design document §6: **R1** grants
`WebSearch`/`WebFetch` to a manager-side, read-only research agent (workers keep the default deny); **R2**
adds a `design-gate` stage the owner alone can close, before dispatch; **R3** lets
`irreducible_product_decision` and `exhausted_repairs` carry pre-declared defaults in an autonomous run,
with `expanded_authority` excluded permanently and unrepresentably.

---

## 1. Verdict

Roughly **70–75% of the plan is engine-agnostic** and carries over unchanged: the supervisor/journal/lease/idempotency core, the control-repo + worktree Git engine, the Jira/Grafana connector layer and policy gateway, the neutral-communication renderer/linter, performance contracts, and the learning pipeline. What changes is the **engine adapter edge** — how workers are spawned, confined, configured, and how results come back.

Claude Code is a **stronger substrate than Codex on every axis the plan cares about**:

| Plan requirement | Codex reality (per plan) | Claude Code reality (verified) |
|---|---|---|
| Enforce an authorization envelope on workers | Hooks are advisory; gateway is the only boundary | **Four enforceable layers**: deny-by-default permission rules, blocking PreToolUse hooks, OS sandbox (bubblewrap/Seatbelt), plus the gateway |
| Structured worker output | `codex exec --output-schema` | `claude -p --json-schema '<schema>'` → validated `structured_output` field (v2.1.205+); SDK equivalent |
| Deterministic managed worker config | Scaffolds `.codex/config.toml`, hopes nothing else loads | `--bare` mode + `--setting-sources` + `--settings <file>`: hermetic, supervisor-supplied config only |
| Per-worker isolation | Manual worktrees + env sanitization only | Same, **plus** native sandbox with fs/network/credential isolation, and native worktree support |
| Crash recovery of worker conversations | Not available; replay from journal | `--session-id` / `--resume` / `--fork-session`; JSONL transcripts as evidence artifacts |
| Budget caps | Manual token accounting | `--max-budget-usd` + `--max-turns` + per-result `total_cost_usd`/`usage` |
| Monotonic security config | Own config precedence rules | Native: managed settings cannot be overridden; `deny` at any level cannot be re-allowed at another; `allowManaged*Only` lockdowns |

The single most important architectural recommendation: **introduce an `EngineAdapter` boundary** in phase 1 so the core never touches engine specifics. The Claude Code adapter is the reference implementation; a Codex adapter remains possible later. Everything below is the Claude Code adapter design plus the corrections it forces on the plan text.

---

## 2. Concept mapping (Codex → Claude Code)

| # | Plan concept (Codex) | Claude Code equivalent | Notes / source |
|---|---|---|---|
| 1 | Codex plugin (`learn.chatgpt.com/docs/build-plugins`) | **Plugin system (GA)**: `.claude-plugin/plugin.json`; bundles skills, agents, hooks, MCP servers, LSP servers, monitors, `bin/` executables, default settings | docs `/plugins`. Install via marketplace (`claude plugin install name@marketplace`, pinned to commit SHA) or `--plugin-dir` / `--plugin-url` for local/vendored |
| 2 | `AGENTS.md` project instructions | **`CLAUDE.md`** (project root or `.claude/CLAUDE.md`); hierarchy: managed `/etc/claude-code/CLAUDE.md` → `~/.claude/CLAUDE.md` → `./CLAUDE.md` → `CLAUDE.local.md`. **AGENTS.md is NOT read natively** — supported via `@AGENTS.md` import or symlink; `/init` incorporates an existing AGENTS.md | docs `/memory`. See §6.2 for the dual-engine trick |
| 3 | `.codex/config.toml` | **`.claude/settings.json`** (project), `.claude/settings.local.json`, `~/.claude/settings.json`, managed `/etc/claude-code/managed-settings.json` (+ `managed-settings.d/*.json` drop-ins) | docs `/settings` |
| 4 | `.codex/agents/*.toml` | **`.claude/agents/*.md`** — YAML frontmatter: `name`, `description`, `tools`, `disallowedTools` (v2.1.186+), `model` (`sonnet`/`opus`/`haiku`/`fable`/full ID), `isolation: worktree` (v2.1.157+), `background` | docs `/sub-agents`; also inline via `--agents '<json>'` CLI flag or SDK `agents` option |
| 5 | `codex exec -C <worktree>` with structured I/O | **(a)** `claude -p` subprocess spawned with `cwd=<worktree>` (no `--cwd` flag exists — confirmed absent), or **(b)** Agent SDK `query({options: {cwd, env, ...}})` (`@anthropic-ai/claude-agent-sdk`, TS-native — matches the plan's Node 24 stack) | docs `/headless`, `/agent-sdk/*` |
| 6 | `--output-schema` | **`--json-schema '<json-schema>'`** with `--output-format json` → response gains `structured_output` (schema-validated). Belt-and-suspenders: gateway MCP `result.submit` tool with server-side (zod) validation | `--help` 2.1.207; docs `/headless`; changelog v2.1.205 |
| 7 | Codex native subagents (read-only exploration; "no per-child worktree binding") | Subagents (Task/Agent tool) **do** have per-child worktree binding: `isolation: "worktree"` frontmatter; parallel + background execution; nesting up to 5 levels (v2.1.172) — plan's depth-1 cap must be **enforced by config**, not assumed | docs `/sub-agents`, `/worktrees`; changelog. §3.2 |
| 8 | Codex hooks = "observability and warning mechanisms, not authorization boundaries" | **FLIPS.** PreToolUse hooks deterministically **block** tool calls (exit 2 or `permissionDecision: "deny"`), take precedence over allow rules, and can rewrite inputs (`updatedInput`). Managed settings can enforce hooks users cannot remove (`allowManagedHooksOnly`) | docs `/hooks`, `/permissions`. §3.1 |
| 9 | Codex skills (`build-skills`) | **Agent Skills**: `skills/<name>/SKILL.md`, frontmatter `description` (required), `disable-model-invocation`; progressive disclosure (~50–100 tokens/skill preloaded, body loads on invoke) — same context-economy concern as the plan states | docs `/skills` |
| 10 | Codex multi-agent docs | Subagents (GA) + **Agent Teams (experimental**, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, breaking changes as recent as v2.1.178) — **do not build on agent teams**; the supervisor remains the orchestrator | docs `/agent-teams`. §10 |
| 11 | MCP registration for the policy gateway | Identical architecture. Register the gateway (stdio) via `--mcp-config gateway.json` + **`--strict-mcp-config`** (ignore all other MCP sources). Tool names `mcp__crabgic_gateway__<tool>`; permission patterns support `mcp__server__*` wildcards; `allowedMcpServers`/`deniedMcpServers`/`allowManagedMcpServersOnly` settings exist | docs `/mcp`, `/permissions` |
| 12 | OpenAI Evals deprecation note | **Drop.** No Anthropic managed-evals dependency exists to avoid. Keep provider-neutral local eval format + optional Promptfoo adapter (unchanged decision, simpler rationale) | — |
| 13 | Codex model | Model routing per role via agent `model` field / `--model` / SDK option. Aliases verified: `sonnet` (Claude Sonnet 5), `opus` (Claude Opus 4.8), `haiku` (Claude Haiku 4.5), `fable` (Claude Fable 5). Pin full IDs (`claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5`, `claude-fable-5`) in the CapabilityManifest; use aliases in scaffolded config | docs `/model-config`; claude-api reference |
| 14 | "Feature-compatible Codex CLI releases" | Pin a tested Claude Code version **range**; `doctor` gates on `claude --version`. Org-managed installs can enforce `requiredMinimumVersion`/`requiredMaximumVersion` in managed settings | docs `/settings` (managed keys) |
| 15 | Git identity / attribution | `attribution: {"commit": "", "pr": ""}` (+ `sessionUrl: false`) in settings hides all Claude Code attribution (supersedes deprecated `includeCoAuthoredBy`); per-worktree `git config user.name "Crabgic"` + service email. Renderer lint stays as final gate | docs `/settings` → Attribution settings. §5.4 |
| 16 | Run lifecycle / durable execution | Unchanged (supervisor-owned journal). Additionally persist each worker's Claude `session_id`; crash recovery can `--resume <session-id>` (scoped to the same project dir/worktree) or `--fork-session` for repair attempts on divergent state | docs `/sessions`. §5.6 |
| 17 | Worker telemetry prohibition | OTel export is **opt-in** (`CLAUDE_CODE_ENABLE_TELEMETRY`); leave unset. `CLAUDE_CODE_SKIP_PROMPT_HISTORY` / `--no-session-persistence` available, but transcripts are useful local evidence — keep them, they never leave the machine | docs `/monitoring-usage`, `/sessions` |
| 18 | XDG state/cache dirs | Unchanged for orchestrator state. Per-worker Claude state isolated via **`CLAUDE_CONFIG_DIR`** (relocates `~/.claude`: credentials, projects/transcripts, config) | docs `/sessions` (storage location row) |

---

## 3. Corrections to plan assumptions

These plan statements are Codex-specific and must be rewritten for the Claude Code edition.

### 3.1 "Treat hooks as observability and warning mechanisms, not authorization boundaries" — inverted

Verified from docs `/hooks` and `/permissions`:

- A **PreToolUse** hook that exits with code 2 **blocks the tool call**, and "takes precedence over allow rules … the block applies even when an allow rule would otherwise let the call proceed."
- Structured stdout supports `hookSpecificOutput.permissionDecision: "allow" | "deny" | "ask" | "defer"` with `permissionDecisionReason`, plus **`updatedInput`** (a hook may rewrite the tool input — e.g., normalize a path into the owned tree).
- Hook events (settings-level) include: `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`, `PreToolUse`, `PostToolUse`, `SubagentStop`, `PermissionRequest`, `PermissionDenied`, `ConfigChange`, `WorktreeCreate`, and more. SDK in-process hooks add `SubagentStart`, `PostToolUseFailure`, `PostToolBatch`, `TaskCompleted`, etc.
- Managed settings can pin hooks organization-wide: `allowManagedHooksOnly: true` loads **only** managed/SDK/force-enabled-plugin hooks and blocks user+project hooks.

**Revised policy for the adaptation:** hooks are a *deterministic enforcement layer*, not merely advisory. The trust model becomes:

1. **Gateway (UDS)** — still the primary authorization boundary and the only place credentials live.
2. **Permission rules** — deny-by-default compiled from the AuthorizationEnvelope (§5.2).
3. **Hooks / `canUseTool`** — supervisor-side per-call adjudication + journaling (§5.3).
4. **OS sandbox** — kernel-level fs/network/credential confinement (§5.5).

Caveat that keeps the gateway primary: user-scope settings are editable by whoever owns `$HOME`, so hooks/permissions are only *tamper-proof* when delivered via managed settings or via supervisor-generated `--settings` files in `--bare` mode. Defense-in-depth stands; single-layer trust does not.

### 3.2 "Native subagents have no documented per-child worktree binding" — false on Claude Code

Native worktree support exists and is GA:

- `claude --worktree [name]` / `-w` creates `.claude/worktrees/<name>/` on branch `worktree-<name>` (v2.1.154+).
- Subagent frontmatter `isolation: "worktree"` gives each subagent a temp worktree, auto-removed when it made no changes (v2.1.157+).
- `EnterWorktree` tool can switch between managed worktrees mid-session; cleanup prompts interactively, does **not** auto-clean in `-p` mode, and a sweep removes stale clean worktrees after `cleanupPeriodDays`.
- Known recent bug (fixed v2.1.203): worktree-isolated subagents sometimes ran shell commands in the parent checkout — a reminder that this feature is young.

**Design decision:** keep the plan's **supervisor-owned control repository + worktrees** for write-capable workers. Reasons: the supervisor needs crash-safe lifecycle ownership, quarantine of dirty/uncertain worktrees, CAS ref integration, and worktrees outside the user's checkout — none of which Claude-managed `.claude/worktrees/` guarantees (interactive cleanup semantics, per-checkout location, young feature). Native isolation (`isolation: "worktree"`, `Agent(isolation:worktree)` permission rules) is used only for the *manager's* read-heavy exploration subagents, where the plan already allowed native subagents.

Also: subagents can nest **5 levels deep** (v2.1.172) and run in the background **by default** (v2.1.198). The plan's caps (delegation depth 1, concurrency 4) must therefore be enforced, not assumed: workers get `deny: ["Agent"]`; the manager gets parameter-scoped rules (docs confirm `Agent(model:opus)`, `Agent(isolation:worktree)`-style parameter matching and per-agent rules like `Agent(Explore)`).

### 3.3 `codex exec` → two supported worker transports

No `--cwd` flag exists; the working directory is the spawned process's cwd (CLI) or the SDK `cwd` option. Verified worker-relevant surface (all in local `--help` 2.1.207 unless noted):

- **Lifecycle:** `-p/--print`, `--output-format text|json|stream-json`, `--input-format text|stream-json`, `--include-partial-messages`, `--replay-user-messages`, `--max-turns`, `--max-budget-usd`, `--no-session-persistence`, `--session-id <uuid>`, `--resume [id]`, `--continue`, `--fork-session`.
- **Config isolation:** `--bare` (skip hooks, plugins, skills, MCP discovery, keychain reads, CLAUDE.md auto-discovery), `--settings <file-or-json>`, `--setting-sources user,project,local`, `--add-dir`.
- **Capability:** `--allowedTools`, `--disallowedTools`, `--tools`, `--permission-mode manual|default|acceptEdits|plan|auto|dontAsk|bypassPermissions`, `--agents '<json>'`, `--mcp-config`, `--strict-mcp-config`.
- **Model/output:** `--model`, `--fallback-model`, `--effort low|medium|high|xhigh|max`, `--json-schema`, `--system-prompt`, `--append-system-prompt`.
- **Worktree/background:** `-w/--worktree [name]`; background session management: `claude --bg`, `claude agents`, `claude attach|stop|respawn|logs <id>`.

`--permission-prompt-tool` appears in the CLI reference docs (headless MCP-mediated permission prompting) but **not** in local `--help` 2.1.207, and its return schema is undocumented — treat as unstable; prefer the SDK `canUseTool` callback (§5.3), which is a documented, typed equivalent.

### 3.4 `AGENTS.md` is not read natively

Docs `/memory` state explicitly: "Claude Code reads `CLAUDE.md`, not `AGENTS.md`." Supported bridges: a `CLAUDE.md` containing `@AGENTS.md` (imports recurse ≤4 hops), a symlink, or `/init` folding AGENTS.md content in. See §6.2 for how the installer exploits this for dual-engine support.

### 3.5 Codex-specific citations to replace

| Plan citation | Replacement |
|---|---|
| Codex plugin docs (learn.chatgpt.com/docs/build-plugins) | https://code.claude.com/docs/en/plugins |
| Codex skills docs | https://code.claude.com/docs/en/skills |
| Codex hooks docs | https://code.claude.com/docs/en/hooks + /hooks-guide |
| Codex multi-agent docs | https://code.claude.com/docs/en/sub-agents (+ /agent-teams for the experimental surface) |
| OpenAI Evals deprecation | remove (no equivalent dependency) |
| — (new) | https://code.claude.com/docs/en/headless, /agent-sdk/overview, /permissions, /sandboxing, /settings, /mcp, /worktrees, /sessions, /memory |

---

## 4. Where Claude Code strengthens the design

### 4.1 The AuthorizationEnvelope compiles to native permission rules

Verified rule semantics (docs `/permissions`):

- Evaluation order **deny → ask → allow**, first match wins; specificity is irrelevant; a deny at *any* settings level cannot be re-allowed at another level (including `--allowedTools`).
- `Bash(prefix *)` matching is shell-operator-aware: compound commands (`&&`, `||`, `;`, `|`, `|&`, `&`, newlines) require **each subcommand** to match a rule independently; recognized process wrappers (`timeout`, `time`, `nice`, `nohup`, `stdbuf`) are stripped before matching; space-before-`*` enforces a word boundary (`Bash(ls *)` matches `ls -la`, not `lsof`).
- File rules are gitignore-style with explicit anchors: `//abs/path/**` (filesystem root), `~/`, `/path` (relative to the settings file's project), bare (cwd-relative).
- `WebFetch(domain:…)`, `mcp__server`, `mcp__server__tool`, `mcp__server__*`, `Agent`, `Agent(<name>)`, and **parameter-level** rules (`Agent(isolation:worktree)`, `Bash(run_in_background:true)`).
- Permission modes: the worker-relevant one is **`dontAsk` — auto-deny anything not pre-approved**. That is exactly "deny-by-default envelope execution" with no interactive prompts and no `bypassPermissions` (which this project never uses; managed/profile settings additionally set `disableBypassPermissionsMode: "disable"`).

So the envelope compiler is a small, testable function: `AuthorizationEnvelope → {permissions: {allow: [...], deny: [...], ask: []}, permissionMode: "dontAsk"}` written into the worker's generated settings file.

### 4.2 The sandbox implements the plan's isolation demands natively

Verified schema (docs `/sandboxing`; GA; macOS Seatbelt, Linux + **WSL2** via bubblewrap + socat; WSL1/native Windows unsupported — plan is Linux-first, so fine):

```jsonc
"sandbox": {
  "enabled": true,
  "failIfUnavailable": true,            // workers must not silently run unsandboxed
  "allowUnsandboxedCommands": false,
  "network": {
    "allowedDomains": [],               // from envelope; empty = no egress
    "allowUnixSockets": true,           // gateway UDS
    "allowLocalBinding": false
  },
  "filesystem": {
    "allowWrite": ["<worktree>", "<worker-tmp>"],
    "denyRead":  ["~/.ssh", "~/.aws", "<control-repo>", "<journal-dir>"]
  },
  "credentials": {
    "files":   [{ "path": "~/.ssh", "mode": "deny" }, { "path": "~/.aws/credentials", "mode": "deny" }],
    "envVars": [{ "name": "CRABGIC_SECRET_X", "mode": "mask", "injectHosts": ["api.example.com"] }]
  },
  "excludedCommands": []
}
```

Two details matter:

- **Default read access includes credential files.** The sandbox default is write-restricted but read-open; `~/.ssh`, `~/.aws` are readable unless denied. The worker profile must always ship the `credentials`/`denyRead` blocks.
- **`envVars: mode: "mask"` + `injectHosts`** substitutes a placeholder in the worker environment and injects the real secret only into egress to allowlisted hosts — a stronger mechanism than the plan's "sanitized environment containing only explicitly approved secrets," and a direct analog of its "store only secret references" rule. Known limitation: the network proxy allowlists by hostname without TLS termination by default (domain fronting caveat; `tlsTerminate: {}` is experimental) — one more reason workers should have **no** general egress and reach Jira/Grafana only through the gateway.

Managed settings can additionally pin `sandbox.network.allowManagedDomainsOnly` and `sandbox.filesystem.allowManagedReadPathsOnly`. The same primitives ship standalone as `@anthropic-ai/sandbox-runtime` if the supervisor ever wants to wrap non-Claude processes (e.g., benchmark runs) in the same jail.

### 4.3 The Agent SDK is the natural worker harness

`@anthropic-ai/claude-agent-sdk` is Claude Code as a TypeScript library — same harness, programmatic control — which fits the plan's strict-TS/Node-24 supervisor perfectly. Verified options relevant to workers: `cwd`, `env`, `settingSources`, `systemPrompt`/`append`, `permissionMode`, `allowedTools`/`disallowedTools`/`tools`, `mcpServers` (incl. `createSdkMcpServer` + `tool()` for **in-process** gateway tools — no child process, no socket for the result channel), `agents`, `hooks` (in-process callbacks), **`canUseTool`** (per-call permission adjudication with allow/deny + updated input), `maxTurns`, `maxThinkingTokens`, `model`, `fallbackModel`, `includePartialMessages`, `abortController`, `resume`, `forkSession`, `additionalDirectories`, `strictMcpConfig`, `stderr`, `extraArgs`. Query handles: `interrupt()`, `setPermissionMode()`, `setModel()`.

`canUseTool` is the load-bearing upgrade: the supervisor adjudicates **every tool call in-process** against the envelope and journals the decision before returning it — the plan's "persist the operation record before network I/O" discipline applied to local tool use, with no shell hook subprocess in the hot path.

One sharp edge: agents reported the SDK's default `settingSources` inconsistently across docs. **Always set it explicitly** (workers: `settingSources: []` — the SDK analog of `--bare`).

### 4.4 Structured results are first-class

- CLI: `claude -p --output-format json --json-schema '<schema>'` → result JSON carries schema-validated `structured_output` (plus `total_cost_usd`, `usage`, `session_id`, model). `stream-json` + `--include-partial-messages` gives live progress for the supervisor's 1 MiB ring buffer/log streaming requirements.
- The WorkerResult schema from the plan's contracts becomes the `--json-schema` argument; malformed output fails validation at the harness rather than in the supervisor parser.
- Keep the gateway `result.submit`/`evidence.attach` MCP tools for **mid-run** artifacts (they also give server-side validation independent of engine version).

### 4.5 Durable-execution alignment

- Persist `session_id` (supervisor-chosen via `--session-id <uuid>`, so the journal knows it **before** the process starts) in the WorkUnit record. On crash: `--resume <session-id>` continues with context intact (resume is scoped to the same project directory *and its worktrees* — matches the per-worktree spawn model). Repair attempts that must not contaminate the original conversation use `--fork-session`.
- Transcripts live at `CLAUDE_CONFIG_DIR`-relative `projects/<munged-cwd>/<session-id>.jsonl` — point `CLAUDE_CONFIG_DIR` at supervisor-owned per-worker state dirs, and the transcript becomes a journaled evidence artifact with a stable path. (Format is documented as unstable — treat as opaque evidence, parse only the stream-json stdout.)
- `--max-turns`, `--max-budget-usd`, and the result `usage` block map onto the plan's repair-attempt limits and PerformanceContract cost accounting.

### 4.6 Version discipline

`doctor` must record and gate on `claude --version` (tested range), sandbox availability (`bwrap` present; WSL2 quirks: sandboxed commands cannot invoke Windows binaries under `/mnt/c/`; Ubuntu 24.04+ needs an AppArmor `bwrap` profile), and auth mode. Where the host is org-managed, `requiredMinimumVersion`/`requiredMaximumVersion` + `forceLoginMethod` in managed settings do this declaratively.

---

## 5. Reference worker-launch design

### 5.1 Defense-in-depth stack (per worker)

| Layer | Mechanism | Compiled from |
|---|---|---|
| 0. Process | spawn cwd = dedicated worktree; sanitized `env`; per-worker `HOME`/`TMPDIR`/`CLAUDE_CONFIG_DIR` | TaskPacket |
| 1. Config hermeticity | `--bare` (CLI) / `settingSources: []` (SDK) + supervisor-generated `--settings worker.json` | ProjectProfile + envelope |
| 2. Permissions | `permissionMode: dontAsk`; `allow` list from envelope (owned paths as `Edit(//…/worktree/**)`, command prefixes as `Bash(cmd *)`); `deny: ["Agent", "WebFetch", "WebSearch", …]` with a single allow for `mcp__crabgic_gateway__*`; `disableBypassPermissionsMode: "disable"` | AuthorizationEnvelope |
| 3. Adjudication + journal | SDK `canUseTool` (primary) or PreToolUse hook → supervisor over UDS; decision journaled pre-execution; `updatedInput` used to canonicalize paths | AuthorizationEnvelope + journal |
| 4. OS sandbox | `sandbox.enabled + failIfUnavailable`; fs write = worktree+tmp only; `denyRead` control repo, journal, `~/.ssh`, `~/.aws`; network: no domains unless envelope grants; UDS allowed; secrets via `mask`+`injectHosts` | envelope + host profile |
| 5. Gateway | provider-neutral MCP tools only; credentials never in worker env; plan→validate→journal→apply→read-back for every remote mutation | unchanged from plan |
| 6. Post-hoc | integration verifies the diff touches only owned paths at the exact base object ID (Git plumbing, engine-independent) | unchanged from plan |

No layer uses `bypassPermissions` / `--dangerously-skip-permissions`, ever.

### 5.2 CLI transport (subprocess — escape hatch; the SDK is the confirmed v1 transport)

```bash
# supervisor spawns with cwd=<worktree>, env sanitized, CLAUDE_CONFIG_DIR=<worker-state>/claude
claude --bare -p "$(cat task-packet-prompt.md)" \
  --settings "$WORKER_SETTINGS_JSON" \
  --mcp-config "$GATEWAY_MCP_JSON" --strict-mcp-config \
  --permission-mode dontAsk \
  --allowedTools "Read" "Edit" "Write" "Grep" "Glob" "Bash(npm run test:*)" "mcp__crabgic_gateway__*" \
  --disallowedTools "Agent" "WebFetch" "WebSearch" \
  --append-system-prompt "$(cat role-and-policy-preamble.md)" \
  --model sonnet --effort high \
  --session-id "$WORKER_SESSION_UUID" \
  --max-turns 80 --max-budget-usd 8.00 \
  --output-format stream-json --include-partial-messages \
  --json-schema "$(cat worker-result.schema.json)"
```

Notes: the CLI transport is documented as an escape hatch, not the v1 path. `--bare` gives deterministic context (no CLAUDE.md/skill/hook/plugin discovery — task packet and role preamble are always passed explicitly) **but skips OAuth credential sources** (reads only `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`/`apiKeyHelper`), which conflicts with the confirmed subscription-auth mode. If this transport is ever used under subscription auth: inject `CLAUDE_CODE_OAUTH_TOKEN` and verify resolution, or replace `--bare` with `--setting-sources ""` + explicit `--settings`. Full auth design in §5.7.

### 5.3 SDK transport (confirmed v1 transport)

```ts
import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";

const gateway = createSdkMcpServer("crabgic_gateway", "1.0.0", [
  tool("tracker_plan", "…", TrackerPlanSchema, supervisorHandlers.trackerPlan),
  tool("result_submit", "…", WorkerResultSchema, supervisorHandlers.resultSubmit),
  // … provider-neutral tools only
]);

for await (const msg of query({
  prompt: packet.prompt,
  options: {
    cwd: worktreePath,
    env: sanitizedEnv,                       // incl. CLAUDE_CONFIG_DIR per worker
    settingSources: [],                      // hermetic — nothing from disk
    systemPrompt: { type: "preset", preset: "claude_code", append: rolePreamble },
    permissionMode: "dontAsk",
    allowedTools: envelope.allowedTools,     // compiled
    disallowedTools: ["Agent", "WebFetch", "WebSearch"],
    mcpServers: { crabgic_gateway: gateway },
    strictMcpConfig: true,
    canUseTool: async (name, input, ctx) => supervisor.adjudicate(runId, name, input), // journal-first
    hooks: { PostToolUse: [auditHook], SessionEnd: [evidenceHook] },
    model: route(packet.role),               // haiku | sonnet | opus | fable per role
    maxTurns: packet.limits.turns,
    abortController: worker.abort,
    resume: recovery?.sessionId, forkSession: recovery?.fork,
  },
})) { supervisor.ingest(runId, msg); }      // stream-json equivalent, typed
```

The SDK spawns/embeds the same Claude Code engine; process-level isolation (sandbox, cwd, env) still applies because the engine child runs under the same profile.

### 5.4 Neutral identity

- Generated worker/manager settings: `"attribution": { "commit": "", "pr": "" }` (docs: empty strings hide commit and PR attribution; also set `sessionUrl: false`; supersedes deprecated `includeCoAuthoredBy`).
- Control repo + every worktree: `git config user.name "Crabgic"`, `user.email <project-configured service email>`.
- The blocking artifact lint from the plan remains the final gate for *all* surfaces (branch names, commit bodies, PR text, Jira/Grafana payloads) — attribution settings only cover Claude Code's own additions.

### 5.5 Manager surface

The manager is an interactive `claude` session in the user's checkout, provisioned by the plugin — **confirmed as the flagship UX**; the standalone CLI covers approvals, scripting, CI, and recovery:

- **Slash commands** (`skills/` with `disable-model-invocation: true` where appropriate): `/eo:run`, `/eo:status`, `/eo:approve`, `/eo:evidence`, `/eo:connections` → thin wrappers over the `crabgic` CLI/MCP tools.
- **Gateway MCP tools** (core ops from the plan: `project.inspect`, `contract.*`, `capability.*`, `run.*`, `change_set.*`, `evidence.get`, `learning.*`, `tracker.*`, `observability.*`) — names unchanged.
- **Approval flow (amended 2026-07-28 — ledger Gap 18).** Routine approval is **standing, given once over an envelope *class*** rather than per ChangeSet: `crabgic install` writes an `EnvelopePolicy` (owner-only, XDG state, never committed), and at dispatch the compiled `AuthorizationEnvelope` is tested for containment in it. Contained → the run proceeds with no prompt and no token. Not contained → `expanded_authority` halts it. **No session-reachable surface — MCP tool, CLI command or skill — may write or widen the policy**, which is what still makes it true that the model cannot satisfy its own gate. The token machinery is retained for the escalation paths it is now scoped to: MCP `contract.approve` (still verify-only), `crabgic trust review`/`capability.approve`, and `crabgic learn approve`. The **superseded** form of this bullet — approval in the CLI terminal prompt or via an explicitly-confirmed `/eo:approve`, per ChangeSet — is recorded in Gap 18 along with what the amendment knowingly gives up.
- Read-heavy exploration: native subagents (optionally `isolation: worktree`), per the plan's original intent.
- Advisory hooks in the manager context (PostToolUse formatting warnings, Stop-time reminders) — here "observability" framing is fine because the manager runs under the user's normal interactive permissions.

### 5.6 Crash recovery & background runs

- Journal stores `{workUnitId, sessionId, worktree, attempt}`. Recovery policy: attempt `--resume` when the worktree passes the porcelain-v2 snapshot check; otherwise quarantine worktree + `--fork-session` from the last good state or restart from packet (existing plan logic; resume is an optimization, the journal remains the source of truth).
- `claude --bg` / `claude agents|attach|logs|stop|respawn` exists for background session management, but the supervisor owns worker processes directly; these CLI facilities are for the *human's* ad-hoc use, not the orchestration path.
- Headless runs keep background bash children alive briefly after the result (grace ceiling `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`) — the supervisor must still own service processes (dev servers, DBs) outside the worker per the plan's resource-namespace design.
- **Plan-limit parking (confirmed policy):** on subscription rate/usage-limit signals, the scheduler parks the work unit (journal state `parked:rate_limit`, `session_id` retained), backs off past the reset window, and re-dispatches with `resume` — the same machinery as crash recovery with a different trigger. No automatic model-tier degradation.

### 5.7 Worker authentication (confirmed: subscription OAuth)

Workers run on the owner's Claude subscription rather than metered API keys:

- Mint one long-lived token via **`claude setup-token`**; the supervisor stores it in its secret store and injects `CLAUDE_CODE_OAUTH_TOKEN` into each worker's env (auth precedence resolves it without interactive login; no per-worker browser flows).
- The SDK transport gets hermeticity from `settingSources: []`, which governs *settings*, not credentials — so subscription auth and hermetic config are compatible. **Phase-0 spike (blocking):** verify an SDK worker with `settingSources: []` and an isolated `CLAUDE_CONFIG_DIR` resolves `CLAUDE_CODE_OAUTH_TOKEN`; fallback is copying `.credentials.json` (0600) into each worker's `CLAUDE_CONFIG_DIR`. (`--bare` on the CLI transport is documented to skip OAuth sources — one more reason the SDK path is primary.)
- **Budget semantics shift:** `--max-budget-usd` is meaningful for metered keys only. Primary caps become `maxTurns` plus token accounting from result `usage` (journaled as evidence); dollar figures stay informational.
- All workers share the plan's rate/usage limits — this is what makes pause-and-resume (§0) load-bearing, and why balanced model routing is the default at 4-way concurrency.
- For the OSS audience, other installs authenticate however their host's Claude Code is already configured (API key, subscription, Bedrock/Vertex); the supervisor treats engine auth as host-provided and validates it in `doctor` rather than managing provider keys itself. Jira/Grafana credentials remain gateway-owned and are unaffected.

---

## 6. Installer / scaffolding surface

### 6.1 Artifacts written by `crabgic install`

| Artifact | Purpose | Notes |
|---|---|---|
| `CLAUDE.md` (add-only merge block) | project instructions for the manager session | see 6.2 |
| `.claude/settings.json` (add-only keys) | attribution off, advisory manager hooks, `enabledPlugins` | never loosen existing user security keys (plan's monotonicity rule) |
| `.claude/agents/eo-*.md` | manager-side exploration/review subagents with narrow `tools:` and routed `model:` | project-owned, like the plan's `.codex/agents/*.toml` note |
| `.mcp.json` (project scope) | `crabgic_gateway` stdio entry (`crabgic gateway mcp`) | first-use approval prompt is expected UX; document it |
| Plugin (marketplace or vendored) | commands, skills, hooks, gateway MCP, `bin/` | pin by commit SHA; vendor via `--plugin-dir` for digest-pinned installs (CapabilityManifest) |
| Worker profiles (XDG state, not repo) | generated per-run settings/permission/sandbox JSON | never checked in; hashed into the envelope |
| **`EnvelopePolicy`** (XDG state, not repo) | the standing approval every dispatch is checked against (§5.5, ledger Gap 18) | owner-only `0600`; **never committed**, never written by anything a session can reach; `doctor` renders it in full |

Checksum/ownership/backup/drift/rollback/uninstall behavior: unchanged from the plan.

**The `EnvelopePolicy` is bootstrapped here, and only here (2026-07-28).** It is authored once, during
`install`, from what the repo already states about itself — write paths, the command set implied by the
project's own scripts, and **default-deny network and credential references** — and confirmed by the owner
before it is written. It is deliberately not a per-run question: a standing approval re-negotiated every run
is just the per-ChangeSet prompt Gap 18 replaced, wearing a different interface. `upgrade` never silently
widens it; a policy change is an owner edit or a fresh `install`, both out-of-band by construction.

### 6.2 Instruction files

**Claude Code only (confirmed)** — `CLAUDE.md` is the primary scaffolded instruction file. When a target repo already maintains an `AGENTS.md` for other tooling, the installer scaffolds the managed block as an import instead of duplicating content:

```markdown
<!-- CLAUDE.md (managed block) -->
@AGENTS.md
```

One source of truth per repo; no dual-engine obligation.

### 6.3 Skills

Stack/domain skills ship in the plugin as Agent Skills. Context cost model verified: ~50–100 tokens of frontmatter per skill preloaded; bodies load on invocation — so the plan's "select only relevant skills" becomes "keep descriptions tight, gate rarely-relevant skills behind `disable-model-invocation: true` and explicit invocation."

---

## 7. Jira / Grafana connectors — unchanged, with three Claude Code notes

The entire connector architecture (ExternalConnection, CapabilitySnapshot, RemoteMutationPlan, exactly-once journal, canonical errors, rendering limits, ADF lint) is engine-independent and carries over verbatim. Claude Code specifics:

1. **Workers never see Atlassian/Grafana MCP servers.** The gateway process is the MCP *client* to upstream servers (or REST). Claude Code's own remote-MCP OAuth is interactive (`/mcp` browser flow; token storage undocumented) and unsuitable for unattended runs — which the plan already anticipated by preferring service-account OAuth client-credentials/PATs held by the gateway.
2. **Enforce result-size budgets in the gateway itself** (32 KiB item / 256 KiB result). Do not rely on harness-side MCP output limits (`MAX_MCP_OUTPUT_TOKENS` is unconfirmed in current docs); the gateway truncating with typed `validation`/`unsupported` errors is deterministic across engine versions.
3. If a deployment ever wants Claude Code to talk to an MCP server besides the gateway, managed settings can constrain it (`allowedMcpServers`, `allowManagedMcpServersOnly`, `managed-mcp.json`) — but the default posture stays "gateway only" via `--strict-mcp-config` + explicit tool allowlists.

---

## 8. What stays exactly as planned

- Journal (hash-chained, fsync-before-side-effect), leases (PID/start-time, 5 s heartbeat), idempotency keys, one-initial+two-evidence-driven-repair attempts, cancellation/quarantine.
- Control clone (`git clone --no-local`), frozen base object IDs, porcelain-v2 dirty snapshots, rename-aware overlap analysis, `git merge-tree --write-tree` preflight, CAS ref updates, local-branch publication without checkout/push.
- Session → change set → work-unit DAG; IntentContract/AuthorizationEnvelope/CapabilityManifest/PerformanceContract and the full contract list; configuration precedence with monotonic security tightening (now partially *native* via managed settings + deny-wins).
- Intake/synchronization policy with Jira; milestone-only updates; comment dedup; workflow-transition mapping; rate-limit compliance.
- Neutral naming/rendering limits and the blocking artifact lint.
- Quality gates (TDD, coverage ratchet, NIST SSDF-selected checks, exact-revision evidence, flake quarantine), performance methodology, learning pipeline (observation → … → promotion with independent review).
- CLI surface and MCP tool names.

---

## 9. Implementation-sequence deltas

| Phase | Delta for Claude Code edition |
|---|---|
| 1. Schemas & invariants | **Add `EngineAdapter` contract** (spawn/resume/cancel/adjudicate/capabilities: `supportsJsonSchema`, `supportsSessionResume`, `permissionModel`, `sandboxModel`) + engine conformance fixtures. Add envelope→permissions/sandbox compiler schemas. |
| 2. Journal/supervisor | Persist engine `session_id` per attempt; adjudication journaling for `canUseTool`. |
| 3. Git engine | Unchanged. Explicitly document non-use of `.claude/worktrees/` for workers (§3.2 rationale). |
| 4. CLI/plugin/installer | Write `.claude/*` + `.mcp.json` + plugin instead of `.codex/*`; CLAUDE.md `@AGENTS.md` bridge; attribution keys; doctor gains: version-range gate, `bwrap`/WSL2 sandbox self-test, `--bare` hermeticity self-test, auth-mode probe. |
| 5. Stack detection/capabilities | Skills as Agent Skills; capability quarantine extends to **plugins/marketplaces** (pin SHA, review `hooks/`, `bin/`, `.mcp.json` inside third-party plugins before enabling — plugins can execute code via hooks). |
| 6. Connector transport | Unchanged; gateway registers as the sole MCP server; size budgets gateway-side. |
| 7–8. Jira/Grafana adapters | Unchanged. |
| 9. Verification gates | Add permission/hook/sandbox conformance gates to the exact-revision evidence set. |
| 10. Release | Compatibility doc states tested Claude Code version range; release CI runs the conformance suite against that pinned range (mirrors the plan's provider-schema drift CI). |

**New test-matrix items** (extending the plan's acceptance plan):

- *Envelope conformance:* forged tool call outside envelope → denied at layers 2–4 (test each layer independently by disabling the others); compound-command smuggling (`allowed-cmd && curl …`) denied; process-wrapper smuggling (`nohup curl …`) denied; path escape via `../` and absolute paths denied; `updatedInput` canonicalization verified.
- *Hook enforcement:* PreToolUse exit-2 blocks despite allow rule; `permissionDecision: deny` honored; hook timeout behavior; `disableAllHooks` in worker profile has no effect on SDK-level `canUseTool`.
- *Sandbox:* egress to non-allowlisted domain fails; UDS to gateway works; read of `~/.ssh`/control repo fails; write outside worktree fails; masked secret placeholder (not value) visible in worker env; `failIfUnavailable` aborts when `bwrap` missing.
- *Hermeticity:* `--bare` worker ignores planted user/project settings, hooks, CLAUDE.md, rogue `.mcp.json`.
- *Structured output:* invalid worker JSON → schema rejection → repair-attempt path; `structured_output` round-trips WorkerResult.
- *Sessions:* kill -9 worker mid-run → resume continues in same worktree; fork-session leaves original transcript intact; two workers same project dir don't interleave (distinct `--session-id`s).
- *Neutrality:* commits/PR bodies contain no attribution with the generated settings; lint still catches engine-name leakage in artifact text.
- *Version drift:* doctor refuses to run against an untested `claude --version`.

---

## 10. Risks & open items

| # | Risk / unknown | Mitigation |
|---|---|---|
| 1 | **Release velocity** — 2.1.x ships weekly; behaviors (worktree cleanup, hook matchers, background defaults) changed within the last ~50 releases | Version-range pinning + doctor gate + conformance suite in release CI; treat exit codes and stream-json internals as version-scoped |
| 2 | `--permission-prompt-tool` undocumented schema / absent from local `--help` | Don't build on it; SDK `canUseTool` is the documented equivalent. Re-verify at build time |
| 3 | SDK `settingSources` default ambiguity (docs disagree) | Always pass explicitly; hermeticity self-test in doctor & CI |
| 4 | Sandbox network allowlisting is hostname-based without TLS termination (domain fronting) | Workers get zero egress; only the gateway (outside the worker sandbox) talks to providers |
| 5 | Sandbox default leaves credential paths readable | Worker profile always ships `credentials`/`denyRead` blocks; conformance test |
| 6 | Native worktree/subagent isolation is young (v2.1.203 fixed workers escaping into parent checkout) | Supervisor-owned worktrees for write work; native isolation only for manager exploration |
| 7 | Agent Teams experimental, breaking changes | Not used; supervisor is the only orchestrator |
| 8 | OAuth'd remote MCP is interactive-only | Gateway owns provider auth (service accounts, client-credentials/PAT) — already the plan's preference |
| 9 | Subscription-auth workers (confirmed mode) share plan rate limits, weaken per-worker USD attribution, and `--bare` skips OAuth sources | §5.7: `setup-token` → `CLAUDE_CODE_OAUTH_TOKEN` injection; SDK hermeticity via `settingSources: []` (phase-0 auth spike); pause-and-resume scheduler; token-based rather than USD budgets |
| 10 | `MAX_MCP_OUTPUT_TOKENS`, hook-input field details, exact stream-json event taxonomy | Marked verify-at-build-time; enforce budgets gateway-side so nothing load-bearing depends on them |
| 11 | Plugins execute code (hooks, `bin/`) | Third-party plugins go through the plan's capability-quarantine pipeline like any executable capability; `strictKnownMarketplaces`/`disableSideloadFlags` on managed hosts |

---

## Appendix A — verified fact inventory (for citation in the spec)

- **CLI 2.1.207 flags confirmed locally:** `--agents`, `--bare`, `--effort`, `--fork-session`, `--json-schema`, `--max-budget-usd`, `--no-session-persistence`, `--permission-mode`, `--setting-sources`, `--strict-mcp-config`, `-w/--worktree`. (`--permission-prompt-tool` not present in `--help`; documented in CLI reference only.)
- **Settings docs:** `attribution: {commit, pr}` (+ `sessionUrl`), empty string hides; precedence managed → CLI → local → project → user; managed paths `/etc/claude-code/managed-settings.json` (+ `.d/`); managed-only keys incl. `allowManagedHooksOnly`, `allowManagedPermissionRulesOnly`, `allowManagedMcpServersOnly`, `disableSideloadFlags`, `strictKnownMarketplaces`, `requiredMinimumVersion`/`requiredMaximumVersion`, `forceLoginMethod`.
- **Permissions docs:** deny→ask→allow first-match; cross-level deny supremacy; Bash operator/wrapper awareness; `//` / `~/` / `/` path anchors; `WebFetch(domain:)`; MCP wildcards; `Agent(<name>)` and parameter rules; modes incl. `dontAsk`, `auto`; `disableBypassPermissionsMode`/`disableAutoMode`; cwd-bounded writes + `additionalDirectories`.
- **Hooks docs:** exit 2 blocks pre-permission-evaluation; `permissionDecision allow|deny|ask|defer`; `updatedInput`; `additionalContext`; timeout default 600 s; matchers exact/pipe/regex incl. `mcp__…`; `disableAllHooks`; plugin + managed hook sources.
- **Sandboxing docs:** GA; Seatbelt / bubblewrap+socat; macOS/Linux/**WSL2** (no WSL1/native Windows); schema incl. `failIfUnavailable`, `network.allowedDomains/allowUnixSockets/allowLocalBinding/tlsTerminate`, `filesystem.allowWrite/denyRead/…`, `credentials.files/envVars` with `mode: deny|mask` + `injectHosts`, `excludedCommands`; default read-open caveat; WSL2 `/mnt/c` note; `@anthropic-ai/sandbox-runtime`.
- **Headless docs:** `--output-format json` fields (`result`, `structured_output`, `session_id`, `total_cost_usd`, `usage`); `stream-json` event stream incl. `system/init`; `--bare` load behavior; background-bash grace (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`).
- **Sessions docs:** transcript path `~/.claude/projects/<munged-cwd>/<session-id>.jsonl`; `CLAUDE_CONFIG_DIR` relocates state; resume scoped to project dir + worktrees; same-dir `--continue` interleaving hazard; `cleanupPeriodDays`; `CLAUDE_CODE_SKIP_PROMPT_HISTORY`.
- **Auth docs:** precedence Bedrock/Vertex/Foundry env → `ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_API_KEY` → `apiKeyHelper` → `CLAUDE_CODE_OAUTH_TOKEN` → interactive login; `--bare` skips keychain/OAuth reads; Linux creds `~/.claude/.credentials.json` (0600); helper TTL env var `CLAUDE_CODE_API_KEY_HELPER_TTL_MS`.
- **Subagents/worktrees docs + changelog:** frontmatter `tools`/`disallowedTools`(2.1.186)/`model`/`isolation: worktree`(2.1.157)/`background`(2.1.198 default bg); nesting ≤5 (2.1.172); `--worktree`(2.1.154); `EnterWorktree` confirmation (2.1.206); worktree-escape fix (2.1.203); Agent Teams experimental env flag; `claude --bg/agents/attach/stop/respawn/logs`.
- **Models (claude-api reference):** `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5`, `claude-fable-5`; CLI aliases `opus|sonnet|haiku|fable`; `--effort low..max`.

## Appendix B — worker permission profile sketch

```jsonc
// generated per work-unit by the envelope compiler — never hand-edited
{
  "permissions": {
    "defaultMode": "dontAsk",
    "disableBypassPermissionsMode": "disable",
    "allow": [
      "Read", "Grep", "Glob",
      "Edit(//abs/path/worktree/**)", "Write(//abs/path/worktree/**)",
      "Bash(npm run test:*)", "Bash(npm run build:*)", "Bash(git status:*)", "Bash(git diff:*)",
      "mcp__crabgic_gateway__*"
    ],
    "deny": [
      "Agent", "WebFetch", "WebSearch",
      "Bash(git push:*)", "Bash(curl:*)", "Bash(wget:*)",
      "Read(//abs/path/control-repo/**)", "Read(~/.ssh/**)", "Read(~/.aws/**)",
      "Edit(//abs/path/worktree/.git/**)"
    ]
  },
  "attribution": { "commit": "", "pr": "" },
  "sandbox": { /* §4.2 block */ },
  "hooks": { /* PostToolUse audit → UDS; SessionEnd evidence capture */ }
}
```

> ⚠️ Rule-compiler edge case, verified in docs: **deny always wins over allow, at any level**. A blanket `deny: ["mcp__*"]` would kill the gateway allow above. So the profile must NOT deny `mcp__*`; instead, single-server exposure is guaranteed structurally by `--strict-mcp-config` + an `--mcp-config` file containing only the gateway. This class of interaction is exactly what the envelope-compiler conformance suite must cover.
