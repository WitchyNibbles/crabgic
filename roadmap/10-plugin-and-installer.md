# Phase 10 — Claude Code plugin, installer, upgrade/uninstall

| | |
|---|---|
| **Depends on** | 06, 09 |
| **Unlocks** | 11 |
| **Sources** | original plan "Distribution and installation"; adaptation §2 rows 1, 4, 9, 15; §3.4; §5.4–§5.5; §6.1–§6.3; §9 row 4; §10 risks 1, 6, 11; Appendix A |
| **Primary package** | `packages/plugin` (installer/doctor backend lands in `packages/cli`, owned by 09) |

## Goal

A Claude Code plugin (skills, subagents, advisory hooks, gateway MCP registration) and a drift-safe installer both exist and are independently verifiable: `crabgic install` scaffolds a target project's `CLAUDE.md`, `.claude/settings.json`, `.claude/agents/`, and `.mcp.json` idempotently and reversibly; `upgrade`/`uninstall` round-trip cleanly against that recorded state; and the plugin loads in a real Claude Code session with its skills, subagents, and gateway MCP tools all visible. None of this is true before this phase lands — 09 ships only `NOT_IMPLEMENTED` stubs for `install`/`upgrade`/`uninstall` until this phase wires them.

## In scope

- **Plugin** (`.claude-plugin/plugin.json`): skills `/eo:run`, `/eo:status`, `/eo:approve`, `/eo:evidence`, `/eo:connections`, `/eo:protocol` (thin wrappers over the CLI/gateway MCP tools; `disable-model-invocation: true` on state-changing ones — `/eo:approve` MUST set it, since adaptation §5.5 requires approval never be a bare model-initiated tool call, and this skill only wraps 09's human-confirmed terminal approval flow, never mints a token itself; `/eo:protocol` is model-invocable and state-free, carrying the long form of the manager operating protocol); manager subagents `eo-explore`, `eo-reviewer` (narrow `tools:`, routed `model:`, read-heavy exploration/review, manager-side only — never write-capable workers); manager hooks — **advisory PostToolUse formatting warnings and Stop-time reminders, plus exactly ONE deliberately blocking hook, the Stop autonomy gate (see the amendment below)**; gateway MCP registration reference (see Interfaces consumed).
- **Manager operating protocol** (ledger Gap 17): `src/manager-protocol.ts` owns the text — autonomy by default, 11's seven stop conditions as the only legitimate halts, the approval gates, and `AskUserQuestion` as the way to put a decision to the owner. Rendered into the managed `CLAUDE.md` block by the installer and into `skills/protocol/SKILL.md` in long form. Cites `docs/engine-baseline.md` §18 for the question tool.
- **Installer artifacts (§6.1):** `CLAUDE.md` managed block — capability list + the manager operating protocol, **plus** an `@AGENTS.md` import when the target repo already has one (§3.4/§6.2). The import is **additive, never a replacement**: §6.2's "one source of truth" argument governs the target repo's own instructions, not Crabgic's protocol, which has no second source and previously vanished entirely from any repo that kept an `AGENTS.md` (ledger Gap 17, part 2); `.claude/settings.json` add-only keys — `attribution: {"commit": "", "pr": ""}`, `sessionUrl: false` (§5.4), `enabledPlugins` — honoring monotonicity (never loosen a security key already present in the target repo); `.claude/agents/eo-*.md`; project-scope `.mcp.json` entry keyed **`GATEWAY_MCP_SERVER_NAME`** (constant, 02) whose command is exactly **`crabgic gateway mcp`** (09); ownership + original/installed checksums + source version + backups recorded in an on-disk state store.
- **CLI backends wired into 09's skeletons:** `install [--dry-run] [--json]`, `upgrade [--dry-run]`, `uninstall [--keep-state]` — the first three of 09's `NOT_IMPLEMENTED` stubs to actually land.
- **Doctor checks contributed** (registered into 09's `check = id, severity, evidence, repair step` framework): checksum/drift check, plugin-trust/pin check, CapabilityManifest-digest-freshness check; repair plans are non-destructive-only, matching 09's `--repair-plan` convention.
- **Lifecycle:** full dry-run diff preview (`--json`); drift warnings; upgrade with backup + rollback; interrupted-upgrade recovery; uninstall removing only unchanged owned content.
- **Non-Git projects:** `git init` only after explicit approval; never sweep ignored files/secrets into a first commit.
- **Distribution:** marketplace repo (`marketplace.json`, SHA-pinned) + vendored `--plugin-dir`/`--plugin-url` flow for digest-pinned installs; a CapabilityManifest entry (schema owned by 02) for the plugin itself, digest-pinned.

## Scope amendment — manager hooks may block, for `Stop` only (2026-07-27)

**What changed.** This phase originally scoped every manager-side hook as advisory and non-blocking,
"distinct from the worker-context blocking hooks owned by 03/06". That is amended for exactly one event:
`Stop`.

**Why.** Reported from real use in a consuming repo: the manager session asked the owner to type "continue"
after every step, and rendered genuine questions as plain-text "option 1 / 2 / 3 / 4" lists. The root cause
was that the managed `CLAUDE.md` block carried a capability list and no instructions, so the session used
Claude Code's conversational default. The protocol above fixes the instruction half — but "be autonomous" is
exactly the instruction a model under uncertainty violates by being polite, and the defect as reported *was*
a model ignoring its own product's stated posture. An instruction-only fix would have shipped the same class
of bug with better documentation.

**What the amendment permits, precisely.** One hook, `hooks/stop-autonomy-gate.mjs`, registered on `Stop`.
It asks the supervisor whether any run is in one of the six in-flight run-lifecycle states and, if so,
returns `{"decision":"block","reason":…}` to keep the turn going. It allows the stop at `awaiting_approval`
— where a human gate is legitimately open and blocking would trap the owner in a session whose only exit is
the act the block prevents — and at all four absorbing states.

**What it does not permit.** `PreToolUse` remains forbidden in the manager context, and
`MANAGER_HOOK_EVENTS` in `src/hooks-manifest.ts` still enforces the allowlist. The asymmetry is deliberate:
blocking a turn from *ending* is bounded, recoverable, and has an engine-provided loop guard
(`stop_hook_active`, `docs/engine-baseline.md` §19.2); blocking arbitrary tool calls from a user-editable
settings scope has none of those properties and stays 03/06's worker-context privilege.

**Evidence.** `docs/engine-baseline.md` §19, produced by `spikes/10-stop-hook.mjs` at engine 2.1.220 — three
PASS verdicts covering the block contract, the `stop_hook_active` loop guard, and the payload shape. §19.2 is
flagged release-blocking on drift.

**Fail-open, as a scope condition.** The gate runs on every session end in every project with the plugin
installed, including projects that have never started a run. Every error path — no CLI, no supervisor,
timeout, malformed JSON, unrecognized state — must allow the stop. A false negative costs one unnecessary
"continue"; a false positive costs the owner a session they cannot exit. Any future change to this hook that
weakens fail-open is outside this amendment.

**Ledger:** Gap 17. **Coordinated with:** `roadmap/11-intake-contract-approval.md`.

## Scope amendment — `install` bootstraps the `EnvelopePolicy` (2026-07-28)

**What changed.** This phase's installer artifact set (§6.1) gains one file: the **`EnvelopePolicy`**, the
standing approval that replaces per-ChangeSet consent. Schema is 02's; writing it is this phase's.

**Why here.** Owner ruling: the user types no Crabgic command, so a per-run approval prompt has nowhere to
live. A standing policy needs exactly one authoring moment, and `install` is the only one that already exists,
is already interactive, and is already understood as a setup act. A policy re-confirmed per run would be the
prompt it replaced wearing a different interface.

**What the amendment permits, precisely.** `install` derives a candidate policy from what the repo already
states about itself — write paths, the command set implied by the project's own scripts, **default-deny
network and credential references** — renders it in full, and writes it only after the owner confirms. It
lands in the project's XDG **state** root at `0600`, never in the repo, and is covered by this phase's
existing ownership/checksum/backup/drift machinery. `--dry-run` shows it like any other artifact.

**What it does not permit.** Nothing reachable from a manager session may create or widen the policy — no
MCP tool, no CLI subcommand a session could invoke, no skill (ledger Gap 18, part 3). `upgrade` may narrow a
policy or leave it alone; **widening is always an owner edit or a fresh `install`**. `uninstall --keep-state`
retains it; plain `uninstall` removes it, since a standing grant must not outlive the installation that
carried it.

**Doctor.** This phase's doctor contribution gains a fourth check: the policy exists, parses, is `0600`, is
not tracked by git, and is rendered in full so an owner can read what they are standing behind.

**Ledger:** Gap 18. **Coordinated with:** `roadmap/02-contracts-and-schemas.md`,
`roadmap/03-envelope-compiler-engine-adapter.md`, `roadmap/09-cli-and-doctor.md`,
`roadmap/11-intake-contract-approval.md`, `roadmap/13-scheduler-packets-context.md`.

## Scope amendment — the manager protocol renders the roast/repair distinction (2026-07-28)

**What changed.** `src/manager-protocol.ts` (Gap 17, part 1) gains one more thing it must say: a **roast
round** is read-only and unbounded, while a **repair attempt** is capped at initial + 2 by
`exhausted_repairs`. Same single-source-of-truth rule as the rest of the protocol — the module owns the text,
the managed block and `skills/protocol/SKILL.md` render it, and no phase restates it.

**Why.** The protocol currently presents `exhausted_repairs` as the only bounded-retry concept a manager
session knows about. A session running an unbounded design or test roast against that text will read its own
third round as a stop condition and halt work that was never failing.

**Ledger:** Gap 19. **Coordinated with:** `roadmap/11-intake-contract-approval.md`,
`roadmap/13-scheduler-packets-context.md`, `roadmap/14-quality-security-gates.md`.


## Out of scope

- Gateway MCP tool *implementations* (`tracker.*`, `observability.*`, `evidence.*`, `result.submit`, forwarded `run.*`) — owned by 16, registered into the registry 09's `gateway mcp` command exposes. This phase only writes the `.mcp.json` entry that boots that process.
- The `gateway mcp` command's own implementation, the doctor command/framework machinery, and approval-token minting (HMAC, envelope-hash binding, expiry) — owned by 09; `/eo:approve` and the `.mcp.json` entry are thin wrappers only.
- IntentContract/AuthorizationEnvelope assembly and the manager-session contract/DAG drafting flow — owned by 11.
- Capability-quarantine review of this plugin's own hooks/`bin/` — owned by 12 (mechanism) and 23 (pre-publication gate). This phase has no dependency edge on either; it produces a quarantine-reviewable artifact (SHA/digest-pinned, hooks enumerable) but does not run the review.
- Worker-side envelope compiling, sandbox profiles, and the worker `EngineAdapter` — owned by 03/06. `eo-explore`/`eo-reviewer` run under the manager's own interactive permissions, never the compiled worker profile.
- Stack/capability detection populating `ProjectProfile`/`StackEvidence` — owned by 12.
- Reproducible npm build, provenance, and the final release-gate checklist — owned by 23; this phase produces the artifacts (`marketplace.json`, plugin package) that 23's pipeline packages and gates.

## Interfaces produced

- **Plugin package** `packages/plugin` → `.claude-plugin/plugin.json` — loaded by the manager session (11) and packaged/gated by 23.
- **Skills**: `/eo:run`, `/eo:status`, `/eo:approve`, `/eo:evidence`, `/eo:connections` (`skills/`, frontmatter `description` + `disable-model-invocation` where applicable) — `/eo:approve` is 11's only non-model-satisfiable approval path besides 09's own CLI prompt.
- **Subagents**: `.claude/agents/eo-explore.md`, `.claude/agents/eo-reviewer.md` — manager-session read-heavy exploration/review, available to 11's inspection/drafting flow.
- **Manager hooks** (manager-context only) — operate inside the same manager session 11 drives. Two advisory (non-blocking, always exit 0) and one blocking: the **Stop autonomy gate**, `hooks/stop-autonomy-gate.mjs`.
- **Manager operating protocol** — `buildManagerProtocolBlock()` (consumed by 09/10's installer for the managed `CLAUDE.md` block) and `MANAGER_STOP_CONDITIONS` (keyed by 11's own `STOP_CONDITION_KINDS`, parity-tested in `packages/cli`).
- **Installer-written artifacts**: `CLAUDE.md` managed block; `.claude/settings.json` add-only keys (`attribution`, `sessionUrl`, `enabledPlugins`); `.claude/agents/eo-*.md` (copied); project-scope `.mcp.json` entry — **key `GATEWAY_MCP_SERVER_NAME`, command `crabgic gateway mcp`**; ownership/checksum/backup state store — together, these are what makes the manager session (11) and the gateway MCP connection possible in a target project.
- **CLI command backends**: `install [--dry-run] [--json]`, `upgrade [--dry-run]`, `uninstall [--keep-state]` (implementations of 09's command shapes) — re-exercised by 23's installation E2E matrix.
- **Doctor checks**: checksum-drift, plugin-trust/pin, CapabilityManifest-digest-freshness (registered into 09's doctor framework) — re-run as part of 23's release gate.
- **`marketplace.json`** (SHA-pinned) + vendored `--plugin-dir`/`--plugin-url` digest-pinned install path — the artifact 23 publishes.
- **CapabilityManifest entry** for the plugin (digest-pinned; schema owned by 02) — one entry in the manifest 11 assembles; re-verified at 23's release gate.

## Interfaces consumed

From **06** (Claude Code worker runtime):
- Tested Claude Code baseline version range / version-gate convention that 06's `EngineAdapter` enforces — reused (not re-derived) for this phase's own doctor/install compatibility checks and the plugin's CapabilityManifest version pin.
- The `@live`-tagged conformance convention (established 00, wired 06) — reused for this phase's own `@live` plugin-load smoke test; this phase does not own or extend 06's worker conformance suite.

From **09** (CLI & doctor):
- Command skeletons `install [--dry-run] [--json]`, `upgrade [--dry-run]`, `uninstall [--keep-state]` (parser + typed UDS client, `NOT_IMPLEMENTED` until wired) — this phase supplies the backend.
- `gateway mcp` command — boots the `crabgic_gateway` MCP server (stdio) over 16's extensible tool registry; this phase's `.mcp.json` entry invokes it verbatim and implements none of it.
- Doctor framework (`check = id, severity, evidence, repair step`) — this phase registers checks into it.
- Secret-reference argument type and stdout/stderr/exit-code conventions — installer commands conform, they don't redefine them.
- Approval-token lifecycle (terminal prompt, HMAC bound to envelope hash, journaled) — `/eo:approve` wraps it; this phase never mints tokens itself.

From **02** (`packages/contracts` — ambiently available to every phase per the ledger; consuming it here needs no direct dependency edge, the same pattern Gap 11 applies to 06):
- `GATEWAY_MCP_SERVER_NAME = "crabgic_gateway"` — the `.mcp.json` entry key, byte-identical to the exported constant.
- `CapabilityManifest` schema — this phase populates one entry (the plugin itself).

## Work items

1. Plugin package scaffold: `.claude-plugin/plugin.json`, the five skills, `eo-explore`/`eo-reviewer` subagents, advisory hooks; local `--plugin-dir` smoke test. First failing test: plugin-manifest schema validation rejects a manifest missing a required skill or subagent entry.
2. Installer artifact writers (add-only, marker-delimited): `CLAUDE.md` (+ `@AGENTS.md` bridge), `.claude/settings.json`, `.claude/agents/eo-*.md`, `.mcp.json` entry keyed `GATEWAY_MCP_SERVER_NAME`. First failing test: a golden-file comparison of the generated `.mcp.json` entry against the literal `{"crabgic_gateway": {"command": "crabgic", "args": ["gateway", "mcp"]}}` shape, run against a stub writer that doesn't yet exist.
3. Ownership/checksum state store + drift detector. First failing test: a single-byte external mutation of an owned file goes undetected by a stub detector.
4. `install [--dry-run] [--json]` backend across the installation matrix (empty dir, invalid `.git`, unborn HEAD, dirty repo, monorepo) + non-Git `git init`-after-approval gate. First failing test: install into an unborn-HEAD repo against the current `NOT_IMPLEMENTED` stub.
5. `upgrade [--dry-run]` backend: diff renderer, backup/rollback, interrupted-upgrade recovery. First failing test: a process kill mid-write leaves torn state under the stub (no recovery).
6. `uninstall [--keep-state]` backend: preserves user edits, removes only unchanged owned content. First failing test: uninstall over a file with a user edit deletes the user's edit under the stub.
7. Doctor checks (checksum-drift, plugin-trust/pin, CapabilityManifest-digest-freshness) registered into 09's framework. First failing test: a seeded stale-digest fixture produces no finding because the check isn't registered yet.
8. Marketplace packaging (`marketplace.json`, SHA-pinned) + vendored digest-pinned `--plugin-dir`/`--plugin-url` path + the plugin's own CapabilityManifest entry. First failing test: marketplace-listing schema validation currently passes an unpinned (branch-ref) entry that must fail.
9. First-use UX docs + `@live` plugin-load smoke test + post-install neutrality assertion. First failing test: the `@live` smoke assertion, run before the plugin is installed, correctly reports skills/agents absent (sanity-checks the assertion itself before the plugin exists to install).

## Test plan

**Unit:** add-only merge writer (marker round-trip, idempotent re-merge — running `install` twice diffs clean); checksum/drift hash stability across line-ending normalization; `.mcp.json` entry-key/command byte-comparison against `GATEWAY_MCP_SERVER_NAME` and the literal `crabgic gateway mcp`; CapabilityManifest-entry digest computed from the packaged plugin's commit SHA.

**Property:** install→upgrade→uninstall preserves every user-added key across randomly generated pre-existing `CLAUDE.md`/`settings.json` fixtures; no generated merge ever loosens a security key already present in the target repo (fuzzed over key presence/absence/value combinations).

**Integration:** full installation matrix (empty dir, invalid `.git`, unborn HEAD, dirty repo, monorepo, config drift, interrupted upgrade, rollback, uninstall-preserving-edits) in disposable tmp git repos; interrupted-upgrade kill-mid-write fixture; doctor fault-injection matrix (drift, unpinned plugin source, stale manifest digest).

**Conformance:** `@live` plugin-load smoke test — real Claude Code session, plugin installed, skills/subagents/gateway-MCP-tools all visible, one subagent spawnable — tagged `@live`, run in the `engine-live` CI job (01/06 convention).

**Security:** adversarial merge fixture — a pre-existing `settings.json` with a stricter-than-default security key must retain it after install (monotonicity), and a crafted attempt to widen `enabledPlugins` or clear `attribution` via a pre-existing file is rejected; non-Git target never runs `git init` without explicit approval and never sweeps ignored/secret-pattern files into the first commit; plugin hooks/`bin/` are enumerable and SHA-pinned so 12's quarantine pipeline and 23's gate have a fixed artifact to review (this phase does not run that review itself).

## Exit criteria

- [ ] Installation matrix passes end-to-end: empty dir, invalid `.git`, unborn HEAD, dirty repo, monorepo, config drift, interrupted upgrade, rollback, uninstall preserving user edits — suite `install.matrix.test`.
- [ ] Add-only merge property test passes: user keys byte-preserved, security keys never loosened, over a fuzzed fixture corpus — suite `merge.monotonic.property`.
- [ ] `.mcp.json` project-scope entry key equals `GATEWAY_MCP_SERVER_NAME` and its command equals `crabgic gateway mcp`, byte-for-byte — golden test `mcp-entry.golden.test`.
- [ ] Drift detector flags every seeded single-artifact mutation across `CLAUDE.md`, `settings.json`, `.mcp.json`, and `eo-*.md` — fixture suite `drift.fixtures`.
- [ ] Doctor reports each seeded plugin/installer fault (drift, unpinned source, stale digest) with a non-destructive repair plan — suite `doctor.plugin-faults.test`.
- [ ] `marketplace.json` is SHA-pinned and schema-valid; a vendored `--plugin-dir` install resolves to the identical digest as the marketplace listing — `marketplace.schema.test` + `vendored-install.digest.test`.
- [ ] `@live`: plugin loads in a real session on the 06 baseline range — skills visible, gateway MCP tools listed, subagents spawnable — `@live` suite `plugin.live-smoke`.
- [ ] A post-install commit made from the manager session carries no attribution (empty `commit`/`pr`, `sessionUrl: false`) — assertion `attribution.none.test`, cross-checked against 17's renderer lint.

## Risks & open questions

- Plugins execute code via hooks/`bin/` (adaptation §10 risk 11) — mitigated downstream by 12's capability-quarantine pipeline before 23's publication gate; on managed hosts, org policy may additionally set `disableSideloadFlags`/`strictKnownMarketplaces` (Appendix A) — neither is configured by this phase; both are host-owner controls this phase must not assume are present.
- This phase has no dependency edge on 12 or 23 — both process the plugin as a downstream artifact after this phase builds it; nothing here is gated on their completion, and nothing here should assume quarantine has already run.
- Release velocity (adaptation §10 risk 1): this phase's doctor/install compatibility checks pin to the same baseline range 06 enforces; a `claude` version bump that fails 06's `@live` gate also blocks this phase's own `@live` plugin-load smoke test, by the same deliberate policy.
- Native worktree/subagent isolation is young (adaptation §10 risk 6; §3.2) — `eo-explore`/`eo-reviewer` may use `isolation: worktree` frontmatter, but remain read-heavy/manager-side only; the plan's supervisor-owned worktrees stay authoritative for write-capable work regardless.
- Verify-at-build-time: the exact prompt copy/flow for the `.mcp.json` first-use approval UX (adaptation §6.1 calls it "expected UX," not fixture-verified) — confirm against the live engine during work item 9 rather than asserting specific prompt text.
