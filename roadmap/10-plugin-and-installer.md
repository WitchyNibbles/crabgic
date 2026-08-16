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

## Scope amendment — the manager protocol renders the review/repair distinction (2026-07-28, amended 2026-07-29)

**What changed.** `src/manager-protocol.ts` (Gap 17, part 1) gains one more thing it must say: a **review
round** is read-only and spends no repair attempt, while a **repair attempt** is capped at initial + 2 by
`exhausted_repairs`. Same single-source-of-truth rule as the rest of the protocol — the module owns the text,
the managed block and `skills/protocol/SKILL.md` render it, and no phase restates it.

**Amended 2026-07-29.** The protocol's roast paragraph is replaced by the staged pipeline of
`docs/staged-review-pipeline.md`: written exit criteria per stage, findings classified `blocking` only by
naming the criterion they violate, every finding dispositioned, and a progress-based budget that escalates to
`irreducible_product_decision`. The agent charters change with it — `eo-roaster`'s "do not approve it" is
what made the previous loop structurally unable to terminate, so `approve` becomes a reachable verdict.

**Why.** The protocol presented `exhausted_repairs` as the only bounded-retry concept a manager session knows
about. A session running an unbounded design or test review against that text will read its own third round
as a stop condition and halt work that was never failing. The 2026-07-29 amendment adds the converse hazard,
measured over twelve rounds: a review loop with no bound of its own does not stop at all.

**Ledger:** Gap 19. **Coordinated with:** `roadmap/11-intake-contract-approval.md`,
`roadmap/13-scheduler-packets-context.md`, `roadmap/14-quality-security-gates.md`.

**AMENDED 2026-08-15 (owner ruling R4, ledger Gap 19).** The sentence above — "a review loop with no bound
of its own does not stop at all" — stays, because the measurement behind it stands. What it produced, the
progress bound, does not. A stage now closes on a round raising **no admissible novel finding**, severity
playing no part, which is reachable because the finding space is bounded rather than because rounds are
capped. The manager protocol block renders the new rule (`buildManagerProtocolBlock`), and the round ceiling
it used to interpolate is now the runaway guard `REVIEW_RUNAWAY_GUARD`. **Also coordinated with:**
`roadmap/25-owner-pipeline-conformance.md`, which implements it.

**AMENDED 2026-08-16 (ledger Gap 23, parts 1 and 5).** This phase owns the three rosters the manager session
reads, and all three had drifted from what actually ships. (a) `buildManagerProtocolBlock()` stops implying
that stage order, lens coverage and the round budget are the session's to interpret and **names the surface
that owns them** — `pipeline.plan` and the `crabgic-stage-loop` workflow. It keeps the loop's rules, which
are model behaviour and have no other delivery path. (b) The installer's slash-command roster is **derived
from `REQUIRED_SKILL_NAMES`** rather than typed a second time; the two lists had diverged, and the skill that
went unadvertised was `/eo:pipeline` — the only one that drives the pipeline. (c) `MANAGER_APPROVAL_GATES`
gains the **fourth** gate ruling R2 granted, `crabgic design approve`: its enforcement shipped with phase 25
while the roster that announces it still had three entries. **Coordinated with:**
`roadmap/{11,13,14,25}` in the same change.


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

**Closeout pass 2026-08-02:** 7/8 ticked against recorded evidence. The one unticked box is
owner-gated on a real-engine run, not an open defect in the deliverable — see
`docs/evidence/criteria-closeout/defects/10-plugin-live-smoke-unrun.md` and that box's own note.
Machine-readable index: `docs/evidence/criteria-closeout/phase-10.json`. No box below carries a
wording correction; none was needed.

Shared citations reused by several boxes below. **`CI` run
[30741826008](https://github.com/WitchyNibbles/crabgic/actions/runs/30741826008)**, green at
`eabb65a` — its `unit-test+coverage (ubuntu-latest)` job
([91480519773](https://github.com/WitchyNibbles/crabgic/actions/jobs/91480519773)), step "test
with 80% line+branch coverage gate", executed 625 test files / 6155 tests, and the step log names
every suite the seven offline criteria rest on individually — eight files, because criterion 6
names two (job-log lines 779, 947, 950, 956, 985, 987, 990, 1010). Scoped local `--reporter=verbose` re-runs of each criterion's own
suites are committed verbatim as `docs/evidence/phase-10/closeout-c<k>-*.txt`; each file's
header names the UTC time, the HEAD it ran at, the command and the exit status.

Two disclosed installer carry-forwards date the boxes below that touch drift or uninstall, and are
recorded once here rather than repeated in each. (a) Drift detection compares **whole-file**
checksums, not per-managed-region ones, so an unrelated user edit elsewhere in `settings.json` or
`CLAUDE.md` is indistinguishable from drift in this installer's own content. (b) `uninstall`
restores each merged artifact's recorded **pre-install snapshot verbatim** rather than surgically
stripping the managed block. Both are deliberate, documented in `docs/evidence/phase-10/README.md`
§Deviations 7 and 8 and `docs/upgrade-guide.md`, and both err only toward **over-preservation** —
a stale managed block can outlive an uninstall; a user edit is never destroyed. They therefore
bound criterion 1's "removes only unchanged owned content" to whole-file granularity, and they do
not weaken criterion 4 at all, whose claim is sensitivity.

Reader's note on the older evidence trail. `docs/evidence/phase-10/README.md` was written for the
2026-07-24 build and is stale in three places the walk checked: row 3 still spells the gateway
command `engineering-orchestrator gateway mcp` and its key `"eo_gateway"` (pre-rename; the
roadmap, ledger Gap 11 and the tests all agree on `crabgic gateway mcp` / `crabgic_gateway`),
§Deviations 5 still describes the marketplace `commit` as the all-zero placeholder (it has been
pinned at a real release commit since v1.5.0), and §Deviations 1's `vitest.live.config.ts` glob
gap has since been fixed. Every path that README names still exists; nothing below rests on its
prose.

- [x] Installation matrix passes end-to-end: empty dir, invalid `.git`, unborn HEAD, dirty repo, monorepo, config drift, interrupted upgrade, rollback, uninstall preserving user edits — suite `install.matrix.test`. — **Evidence (2026-08-02):** `packages/cli/src/installer/install.matrix.test.ts` drives the real `runInstall`/`runUpgrade`/`recoverInterruptedUpgrade`/`runUninstall` against real tmp git repos, one `it()` per named case (ten in total — the empty-dir case is split into approve/decline): `:67-71` the `git init`-after-approval gate is asserted to have been *asked* (`expect(asked).toBe(true)`) and performed, `:79-81` declining it writes nothing at all (`expect(existsSync(join(dir, "CLAUDE.md"))).toBe(false)`), `:89` `invalid-git`, `:98` `unborn-head`, `:111` `dirty`, `:121` `expect(result.monorepoDetected).toBe(true)` — four different repo-state values, so a detector that always answers one thing fails; `:137-143` config drift (a wholly overwritten `CLAUDE.md` is re-merged and the state store reconciled, `expect(second.status).toBe("up-to-date")`); `:166-168` interrupted upgrade against a genuinely torn fixture, asserting the recovered bytes *equal* the pre-upgrade bytes and the marker is cleared; `:188` rollback via `runUpgrade` itself; `:202-205` uninstall preserves a user-edited `eo-explore.md`, read back off disk, with `:208-209` `expect(reviewer?.action).toBe("removed")` in the same uninstall as the anti-vacuity control. `CI` run 30741826008 green at `eabb65a`; `docs/evidence/phase-10/closeout-c1-install-matrix.txt`. Scope: "removes only unchanged owned content" holds at whole-file granularity — see carry-forwards (a) and (b) above.
- [x] Add-only merge property test passes: user keys byte-preserved, security keys never loosened, over a fuzzed fixture corpus — suite `merge.monotonic.property`. — **Evidence (2026-08-02):** `packages/cli/src/installer/merge.monotonic.property.test.ts` — `:124` `expect(result.settings[fixture.userKeyName]).toEqual(fixture.userKeyValue)` over a fuzzed key *name* and scalar *value*; `:127`/`:130` a pre-existing `attribution`/`sessionUrl` is left exactly as the fixture had it; `:137-139` a pre-existing `enabledPlugins[<plugin>]` is never re-widened, **including when it is `false`** — the sharpest form of "never loosened"; `:146` and `:214` the 2026-07-24 adversarial-review regression, a present-but-wrong-typed `enabledPlugins`/`mcpServers` (fuzzed across string/integer/boolean/null/array) preserved byte-for-byte rather than clobbered; `:134`/`:141` the non-degenerate control, so a merge that returned its input unchanged cannot satisfy the preservation assertions; `:45` the same byte-preservation property for the `CLAUDE.md` text merge and `:57` its idempotence. `:149`/`:217` set 500 fast-check runs per monotonicity property. The implementation the fuzzer drives is presence-guarded (`packages/cli/src/installer/settings-merge.ts:59`), which is why the wrong-typed arm is a real branch. `CI` run 30741826008 green at `eabb65a`; `docs/evidence/phase-10/closeout-c2-merge-monotonic.txt`. Scope: the property runs at the merge-function level, which is what this box says; the §Test plan's stronger `install→upgrade→uninstall` round-trip form is covered by worked examples in `install.matrix.test.ts`, not by a fuzzer.
- [x] `.mcp.json` project-scope entry key equals `GATEWAY_MCP_SERVER_NAME` and its command equals `crabgic gateway mcp`, byte-for-byte — golden test `mcp-entry.golden.test`. — **Evidence (2026-08-02):** `packages/cli/src/installer/mcp-entry.golden.test.ts:34-37` — `expect(JSON.stringify(result.mcpJson.mcpServers)).toBe(expectedJson)` against `JSON.stringify({[GATEWAY_MCP_SERVER_NAME]: { command: "crabgic", args: ["gateway", "mcp"] }})`, byte-identical to ledger Gap 11's own pinned literal `{"crabgic_gateway": {"command": "crabgic", "args": ["gateway", "mcp"]}}`, with the key taken from the imported constant and never hand-typed. `:45` `expect(Object.keys(buildGatewayMcpServerEntry())).toEqual(["command", "args"])` closes the other direction — no extra field may creep in and still pass. `:65` proves a *different* pre-existing entry under the same key is left alone, so the golden shape is what a fresh merge produces rather than something that overwrites a user's server. The golden test drives the production merge: `packages/cli/src/installer/install.ts:153` calls `mergeMcpJson` inside `buildDesiredArtifacts`, whose output is written to `.mcp.json` at `:181-184`. `CI` run 30741826008 green at `eabb65a`; `docs/evidence/phase-10/closeout-c3-mcp-entry-golden.txt`.
- [x] Drift detector flags every seeded single-artifact mutation across `CLAUDE.md`, `settings.json`, `.mcp.json`, and `eo-*.md` — fixture suite `drift.fixtures`. — **Evidence (2026-08-02):** `packages/cli/src/installer/drift.fixtures.test.ts:24-29` seeds exactly the four artifacts the criterion names, `:54` `it.each(TRACKED_ARTIFACTS.map((a) => a.relPath))` parameterizes over that same list (so "every" is structural, not four hand-written cases), and `:70` `expect(findings).toEqual([{ relPath: mutatedRelPath, kind: "modified" }])` after appending exactly one byte — `toEqual` on the whole array, so a detector that flagged everything on any mutation would fail. `:86` `expect(await detectDrift(dir, state)).toEqual([])` with nothing changed is the anti-vacuity control; `:80` distinguishes a deleted artifact as `missing`; `:94` asserts a CRLF/LF-only rewrite is *not* drift. `packages/cli/src/installer/drift-detector.ts:50-52` is the whole-file comparison, which is strictly more sensitive than a per-region one and so makes the criterion's claim easier rather than harder — carry-forward (a) above is a false-positive imprecision whose cost lands on criterion 1, not here. `CI` run 30741826008 green at `eabb65a`; `docs/evidence/phase-10/closeout-c4-drift-fixtures.txt`.
- [x] Doctor reports each seeded plugin/installer fault (drift, unpinned source, stale digest) with a non-destructive repair plan — suite `doctor.plugin-faults.test`. — **Evidence (2026-08-02):** `packages/cli/src/doctor/doctor.plugin-faults.test.ts:92-94` seeds all three named faults simultaneously and asserts each by its own check id (`installer.checksum-drift`, `installer.plugin-trust-pin`, `installer.capability-manifest-freshness`); `:97-101` `expect(repairPlan).toHaveLength(3)` followed by `expect(step).not.toMatch(/\bdelete\b|\bforce\b|\brm -rf\b/i)` for every step — the length assertion is what stops the loop being vacuous, and because 09's `buildRepairPlan` (`packages/cli/src/doctor/framework.ts:58-61`) only emits findings that carry a `repairStep`, a length of three proves all three failing checks supplied one. `:122-123` is the fault-free negative control and `:146-148` re-runs the full check set against the **real shipped** `packages/plugin` directory with zero findings. The three checks are registered into the shipped doctor, not assembled only in the test: `packages/cli/src/doctor/run-doctor.ts:121-123`. `CI` run 30741826008 green at `eabb65a`; `docs/evidence/phase-10/closeout-c5-doctor-plugin-faults.txt`. Scope: this box evidences the three faults it enumerates; the fourth doctor check added by the 2026-07-28 Gap 18 amendment (standing `EnvelopePolicy`) has its own suite and is deliberately not read into this criterion.
- [x] `marketplace.json` is SHA-pinned and schema-valid; a vendored `--plugin-dir` install resolves to the identical digest as the marketplace listing — `marketplace.schema.test` + `vendored-install.digest.test`. — **Evidence (2026-08-02):** `packages/plugin/src/marketplace-schema.test.ts:111-113` asserts this package's **own committed** listing is pinned — `expect(raw.plugins[0]!.commit).not.toBe(NULL_GIT_OBJECT_ID)` and `toMatch(/^[0-9a-f]{40}$/)` — and `:44`/`:49`/`:57-61` reject a branch ref, a short SHA and the all-zero placeholder respectively, which is what stops "SHA-pinned" from being satisfied by a 40-hex non-commit; `:37` is the valid-fixture control and `:73`/`:77` pin `.strict()` unknown-key rejection. `packages/cli/src/installer/vendored-install.digest.test.ts:41-46` copies the real plugin tree to a fresh directory and asserts `expect(vendoredDigest).toBe(marketplace.plugins[0]!.digest)`. The assertion that actually bites against drift is the freshness pair (`marketplace-schema.test.ts:141-143`, `vendored-install.digest.test.ts:49-51`): `2ff3bce` edited `packages/plugin/statusline/crabgic-statusline.mjs` and had to refresh the recorded digest in the same commit. `packages/plugin/src/content-digest.ts:21-28` bounds what "identical digest" covers — `skills/`, `agents/`, `hooks/`, `statusline/` and `.mcp.json`, but not `.claude-plugin/plugin.json`. `CI` run 30741826008 green at `eabb65a`; `docs/evidence/phase-10/closeout-c6-marketplace-vendored-digest.txt`, and `docs/evidence/phase-10/closeout-c6b-marketplace-pin-resolves.txt` for the one thing the cited test says it does not do (resolving the pin: `git cat-file -t` reports `commit`). Scope: `crabgic install` has no `--plugin-dir`/`--plugin-url` argv flag of its own (`docs/evidence/phase-10/README.md` §Deviations 3) — `--plugin-dir` is the *engine's* flag, and what this box evidences is digest identity for a vendored copy, not an installer argument that accepts one.
- [ ] `@live`: plugin loads in a real session on the 06 baseline range — skills visible, gateway MCP tools listed, subagents spawnable — `@live` suite `plugin.live-smoke`. — **Left unticked 2026-08-02, owner-gated live handoff filed:** `docs/evidence/criteria-closeout/defects/10-plugin-live-smoke-unrun.md`. The suite exists, is wired into `vitest.live.config.ts` and `engine-live.yml`, asserts all three clauses (`packages/plugin/src/live/plugin-load.live.test.ts:44-51`), and fails red rather than skipping when `CRABGIC_LIVE` is unset. What is missing is an execution against the *current* plugin. Three facts: running it spends the owner's subscription and is owner-gated, so this pass did not; `engine-live.yml` has **zero** recorded runs, so there is no CI channel to cite either; and the one recorded live execution — `docs/evidence/gap-18/live-verification.md`, 2026-07-28, `claude` 2.1.220, inside the accepted `2.1.207`–`2.1.220` range — describes by its own words a **three**-subagent plugin, while `packages/plugin/src/plugin-manifest.ts:45-51` now requires five: `eo-architect` and `eo-planner` were added by `3210730` the following day and have never been seen by a real engine. `docs/evidence/phase-10/closeout-c7-live-suite-not-in-default-gate.txt` records that the default gate excludes `**/*.live.test.ts` entirely, so no green `CI`/`npm test` run covers this box. Remedy is S-sized and needs the live engine plus owner approval; it needs no new code and no CI wiring. **Left unticked; RUN 2026-08-05, 3 of 4 green — which supersedes the "unrun" framing, now only half true.** Executed live, scoped to `packages/plugin/src/live/`, at a **pinned `2.1.218`** engine (inside the accepted `2.1.207`–`2.1.220`) because the host's `PATH` CLI has drifted to **`2.1.221`**, one patch outside the range, and this suite resolves `claude` from `PATH`. Transcript: `docs/evidence/phase-10/plugin-live-smoke-2026-08-05.md`. **Two of three clauses now evidenced live:** `plugin details` lists all **6** required skills, all **5** required subagents and `crabgic_gateway`, so the `REQUIRED_SUBAGENT_NAMES` loop passed for the first time at five entries — `eo-architect` and `eo-planner` have now been seen by a real engine. **The third clause's own case is RED:** the spawn case failed on its own `{ timeout: 120_000 }` at `120064ms`, in a run needing ~185s — the timeout firing, not an assertion. The engine's session transcript records `{"agentType":"crabgic:eo-explore", "spawnDepth":1}` and a parent answer naming the subagent, so the clause's **subject held while the test did not.** That is a defect in the test — a 120s bound on an unbounded, tree-dependent prompt, invoked with no model pinned — not in the deliverable, and neither the test nor the manifest was adjusted to force a pass. **The box stays unticked because the criterion names the suite and the suite is not green.** Remedy remains S-sized and needs no plugin change. ⚠️ **Note for whoever re-runs it:** the spawn case's cost is invisible to `result.num_turns` (it lives in a nested subagent — ~51 round trips here, independently recounted), and **`--max-turns` cannot bound it either**, because that flag and `num_turns` read the same top-level loop counter while the subagent loop carries its own `maxTurns` from frontmatter (default 200). The bounds that bind are `maxTurns:` in `packages/plugin/agents/eo-explore.md`, `--max-budget-usd`, a process-group kill, and a bounded prompt — see the transcript's §5.
- [x] A post-install commit made from the manager session carries no attribution (empty `commit`/`pr`, `sessionUrl: false`) — assertion `attribution.none.test`, cross-checked against 17's renderer lint. — **Evidence (2026-08-02):** `packages/cli/src/installer/attribution.none.test.ts:43-46` runs a real `runInstall` and reads the result back **off disk** — `expect(settings.attribution).toEqual({ commit: "", pr: "" })` and `expect(settings.sessionUrl).toBe(false)`, the criterion's parenthetical exactly; `packages/cli/src/installer/settings-merge.ts:31-38` is the add-only writer behind it. The cross-check runs `@crabgic/renderer`'s real `lint()`, not a copy of its rules: `:62-63` a synthetic post-install commit body passes, and it is guarded by two sensitivity controls — `:68-69` a bare engine-vendor name with no trailer at all is still caught, `:74-79` the canonical `Co-Authored-By` trailer is caught. `CI` run 30741826008 green at `eabb65a`; `docs/evidence/phase-10/closeout-c8-attribution-none.txt`. Scope, stated rather than left to be noticed: no real Claude Code session makes a commit anywhere in this evidence. The remaining link — that the engine honours these two settings keys at commit time — is doc-derived (adaptation §2 row 15 / §5.4) and is **not** recorded in `docs/engine-baseline.md`. That is why the criterion names 17's lint as well: per §5.4 the lint, not the settings, is the final gate for every surface, and the lint is what is exercised here.

## Risks & open questions

- Plugins execute code via hooks/`bin/` (adaptation §10 risk 11) — mitigated downstream by 12's capability-quarantine pipeline before 23's publication gate; on managed hosts, org policy may additionally set `disableSideloadFlags`/`strictKnownMarketplaces` (Appendix A) — neither is configured by this phase; both are host-owner controls this phase must not assume are present.
- This phase has no dependency edge on 12 or 23 — both process the plugin as a downstream artifact after this phase builds it; nothing here is gated on their completion, and nothing here should assume quarantine has already run.
- Release velocity (adaptation §10 risk 1): this phase's doctor/install compatibility checks pin to the same baseline range 06 enforces; a `claude` version bump that fails 06's `@live` gate also blocks this phase's own `@live` plugin-load smoke test, by the same deliberate policy.
- Native worktree/subagent isolation is young (adaptation §10 risk 6; §3.2) — `eo-explore`/`eo-reviewer` may use `isolation: worktree` frontmatter, but remain read-heavy/manager-side only; the plan's supervisor-owned worktrees stay authoritative for write-capable work regardless.
- Verify-at-build-time: the exact prompt copy/flow for the `.mcp.json` first-use approval UX (adaptation §6.1 calls it "expected UX," not fixture-verified) — confirm against the live engine during work item 9 rather than asserting specific prompt text.
