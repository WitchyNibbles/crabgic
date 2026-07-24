# Phase 10 evidence — Claude Code plugin, installer, upgrade/uninstall

Governing spec: `roadmap/10-plugin-and-installer.md`. Packages: `packages/plugin`
(plugin artifacts + validation tooling) and `packages/cli` (installer/doctor backend,
per the phase file's own "installer/doctor backend lands in `packages/cli`, owned by
09 but 10 adds to it"). Raw gate output captured verbatim in `gate-results.txt`.

## Exit criterion → evidence mapping

| # | Exit criterion (verbatim) | Suite named in spec | Evidence |
|---|---|---|---|
| 1 | Installation matrix passes end-to-end: empty dir, invalid `.git`, unborn HEAD, dirty repo, monorepo, config drift, interrupted upgrade, rollback, uninstall preserving user edits | `install.matrix.test` | `packages/cli/src/installer/install.matrix.test.ts` — one `it` per named case, all against real tmp git repos (`git init`/`config`/`add`/`commit` via `child_process`), driving the real `runInstall`/`runUpgrade`/`recoverInterruptedUpgrade`/`runUninstall` |
| 2 | Add-only merge property test passes: user keys byte-preserved, security keys never loosened, over a fuzzed fixture corpus | `merge.monotonic.property` | `packages/cli/src/installer/merge.monotonic.property.test.ts` — `fast-check`, 200–500 runs per property, over `mergeManagedTextBlock` (CLAUDE.md text) and `mergeSettingsJson` (settings.json), fuzzing key presence/absence/value |
| 3 | `.mcp.json` project-scope entry key equals `GATEWAY_MCP_SERVER_NAME` and its command equals `engineering-orchestrator gateway mcp`, byte-for-byte | `mcp-entry.golden.test` | `packages/cli/src/installer/mcp-entry.golden.test.ts` — byte-for-byte `JSON.stringify` comparison, entry built only via the imported `GATEWAY_MCP_SERVER_NAME` constant (never a hand-typed `"eo_gateway"` literal — see "sole-definition-site" note below) |
| 4 | Drift detector flags every seeded single-artifact mutation across `CLAUDE.md`, `settings.json`, `.mcp.json`, and `eo-*.md` | `drift.fixtures` | `packages/cli/src/installer/drift.fixtures.test.ts` — `it.each` over all 4 artifact kinds, each single-byte-mutated; plus a missing-file case, a zero-drift case, and a CRLF/LF-normalization-is-not-drift case |
| 5 | Doctor reports each seeded plugin/installer fault (drift, unpinned source, stale digest) with a non-destructive repair plan | `doctor.plugin-faults.test` | `packages/cli/src/doctor/doctor.plugin-faults.test.ts` — all 3 faults seeded simultaneously, registered into 09's `runDoctorChecks`/`buildRepairPlan`; asserts a 3-step non-destructive repair plan (regex-checked to exclude `delete`/`force`/`rm -rf`) and an all-clear case with zero faults |
| 6 | `marketplace.json` is SHA-pinned and schema-valid; a vendored `--plugin-dir` install resolves to the identical digest as the marketplace listing | `marketplace.schema.test` + `vendored-install.digest.test` | `packages/plugin/src/marketplace-schema.test.ts` (schema validity + work item 8's own first-failing-test framing: a branch-ref `commit` — e.g. `"main"` — is rejected); `packages/cli/src/installer/vendored-install.digest.test.ts` (a real filesystem copy of `packages/plugin` — simulating a vendored `--plugin-dir` — digests identically to the committed `marketplace.json`'s recorded `digest`) |
| 7 | `@live`: plugin loads in a real session on the 06 baseline range — skills visible, gateway MCP tools listed, subagents spawnable | `plugin.live-smoke` | `packages/plugin/src/live/plugin-negative-space.live.test.ts` (work item 9's own first-failing-test framing: absence, correctly reported, BEFORE any `--plugin-dir` load) + `packages/plugin/src/live/plugin-load.live.test.ts` (positive: `claude plugin validate`, then `claude --plugin-dir <root> plugin details` lists all 5 skills/2 subagents/`eo_gateway`, then a real subagent-spawn turn). **Not executed end-to-end in this build** (no `CLAUDE_CODE_OAUTH_TOKEN` here) — CI wiring (`vitest.live.config.ts`'s `include` glob) is being handled by the orchestrator separately, not by this phase's own edit scope; see Deviations §1 |
| 8 | A post-install commit made from the manager session carries no attribution (empty `commit`/`pr`, `sessionUrl: false`), cross-checked against 17's renderer lint | `attribution.none.test` | `packages/cli/src/installer/attribution.none.test.ts` — structural check (a fresh install's `settings.json` has empty `attribution`/`sessionUrl: false`) PLUS an independent cross-check via `@eo/renderer`'s real `lint()` (a synthetic post-install commit body passes 17's attribution-neutral stage; a sanity case with a vendor name/co-author trailer is confirmed still caught) |

**Work item 1's own first failing test** ("plugin-manifest schema validation rejects a
manifest missing a required skill or subagent entry") — `packages/plugin/src/plugin-manifest.test.ts`,
`describe("validatePluginManifest — rejects an incomplete manifest ...")`.

## Adversarial-review fixes (2026-07-24)

An independent adversarial validation pass confirmed the security axes sound (SHA-pin trust,
`.mcp.json` wiring, attribution neutrality, hooks, content-digest) but found 3 real fixes plus one
engine-fact that needed live verification rather than assumption. All fixes are TDD (failing
regression test added first, confirmed to fail against the pre-fix code, then fixed), scoped to
`packages/plugin`/`packages/cli` only.

| # | Severity | Finding | Fix | Regression test |
|---|---|---|---|---|
| 1 | MEDIUM (confirmed monotonicity violation) | `mergeSettingsJson`'s `enabledPlugins` guard (`settings-merge.ts`) and `mergeMcpJson`'s `mcpServers` guard (`mcp-json-merge.ts`) both used `isPlainObject(...)` to detect "absent" — a present-but-non-object value (e.g. `enabledPlugins: "foo"`, PoC from the finding) was treated as absent and SILENTLY OVERWRITTEN with `{"engineering-orchestrator": true}`, destroying the user's own value. Violates this module's own "never touch a present key" invariant. | Both guards now check presence first (`"enabledPlugins" in merged` / branch on `"mcpServers" in existing`) — a key present as ANY value, of ANY type, is never touched; only a wholly-absent key is added. | `settings-merge.test.ts` (string/array/null PoC cases); `mcp-entry.golden.test.ts` (identical 3 cases for `mcpServers`); `merge.monotonic.property.test.ts` extended with a `mapLikeFixtureArbitrary` fuzzing `enabledPlugins`/`mcpServers` across absent/object-with-own-key/object-without-own-key/**non-object** (string, number, boolean, null, array) — the non-object branch asserts byte-for-byte preservation, 500 runs each, for both `mergeSettingsJson` and (new) `mergeMcpJson` |
| 2 | LOW/MEDIUM (confirmed) | `eo-reviewer.md` declared `tools: ["Read","Grep","Glob","Bash"]` — `Bash` is not read-only-constrainable at the tool-declaration level (it can mutate the filesystem, run `git` writes, etc.), defeating roadmap/10's "never write-capable" requirement for manager subagents. `plugin-manifest.ts`'s validator only rejected `Write`/`Edit`, so it certified this subagent as compliant. | Removed `Bash` from `eo-reviewer.md`'s `tools` (Read/Grep/Glob suffice for a reviewer); `plugin-manifest.ts`'s `WRITE_CAPABLE_TOOLS` set now also rejects `Bash` and `NotebookEdit`, not just `Write`/`Edit`. | `plugin-manifest.test.ts`: a new case asserting a `Bash`-declaring subagent is rejected, a `NotebookEdit` case, and a regression guard proving this package's own real `eo-reviewer.md` now passes |
| 3 | LOW (confirmed edge case) | `upgrade.ts`'s `recoverInterruptedUpgrade`, if ITSELF killed after `deleteBackup` but before `removeUpgradeMarker` (a "double interruption"), left a marker whose `backupPath` pointed at an already-deleted file. A re-run's `restoreBackup` (`state-store.ts`) did a bare `readFile` and threw an unhandled `ENOENT`, so recovery was not idempotent under a second fault. | `restoreBackup` now catches `ENOENT` on the backup read and treats it as "already restored/cleaned by a prior partial recovery attempt" — a documented no-op, never a throw. `recoverInterruptedUpgrade` (and hence a repeated recovery attempt) is now safe to call any number of times. | `state-store.test.ts` (direct: `restoreBackup` against a missing backup path resolves, doesn't throw, leaves the destination untouched); `upgrade.test.ts` (the full double-interruption scenario: a marker survives with a `backupPath` pointing nowhere, `recoverInterruptedUpgrade` still resolves `recovered: true` and clears the marker) |

### Engine-fact verified live (not assumed) — `enabledPlugins` key format

The finding correctly flagged that the installer wrote the bare plugin name
(`"engineering-orchestrator"`) as the `enabledPlugins` key, while Claude Code's real convention might
be `name@marketplace`. **Verified against the real local `claude` 2.1.218 binary** (never asserted
from memory, per `roadmap/README.md`'s engine-fact-drift ground rule): in a scratch project + scratch
`HOME`, `claude plugin marketplace add <packages/plugin>`, then
`claude plugin install engineering-orchestrator@engineering-orchestrator-marketplace --scope project`,
then `claude plugin enable engineering-orchestrator@engineering-orchestrator-marketplace --scope
project` produced this real, on-disk project `.claude/settings.json`:

```json
{ "enabledPlugins": { "engineering-orchestrator@engineering-orchestrator-marketplace": true } }
```

**Confirmed: the key format is `<plugin-name>@<marketplace-name>`, NOT the bare plugin name.** Fixed:

- `packages/plugin/src/marketplace-schema.ts` gained `MARKETPLACE_NAME = "engineering-orchestrator-marketplace"` (byte-identical to the committed `marketplace.json`'s own `name` field; a citation test fails if it drifts).
- `packages/plugin/src/enabled-plugin-key.ts` (new) composes `ENABLED_PLUGIN_KEY = `${PLUGIN_CAPABILITY_NAME}@${MARKETPLACE_NAME}`` — the full live-verified procedure is cited verbatim in this file's own doc comment, exported from `@eo/plugin`'s barrel.
- `packages/cli/src/installer/install.ts`'s `INSTALLER_PLUGIN_NAME` now re-exports `ENABLED_PLUGIN_KEY` instead of a bare literal — the one call site (`mergeSettingsJson(existingSettings, INSTALLER_PLUGIN_NAME)`) picks up the fix automatically.
- Tests: `packages/plugin/src/enabled-plugin-key.test.ts` (golden value + composition + freshness against the real `marketplace.json`); `packages/cli/src/installer/install.test.ts`'s new case (`runInstall` end-to-end writes `enabledPlugins: {"engineering-orchestrator@engineering-orchestrator-marketplace": true}`, not the bare name).
- `docs/engine-baseline.md` should record this format — **out of this phase's allowed edit scope**
  (root/shared doc owned by phase 00); noted here as a carry-forward for whoever next touches it.

## Files produced/modified

### `packages/plugin` (the plugin package itself)

Static, on-disk plugin artifacts (loaded directly by a Claude Code session, never imported):

- `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.mcp.json`
- `skills/{run,status,approve,evidence,connections}/SKILL.md` — see Deviations §2 for the
  `skills/<name>/SKILL.md` (not `skills/<name>.md`) layout correction
- `agents/eo-explore.md`, `agents/eo-reviewer.md`
- `hooks/hooks.json`, `hooks/post-tool-use-format-warning.mjs`, `hooks/stop-reminder.mjs`

Validation/build tooling (`src/`): `plugin-root.ts`, `frontmatter.ts`, `plugin-manifest.ts`,
`content-digest.ts`, `capability-entry.ts`, `marketplace-schema.ts`, `hooks-manifest.ts`,
`enabled-plugin-key.ts` (new — adversarial-review fix, live-verified `enabledPlugins` key format),
`index.ts` (barrel), each with a co-located `*.test.ts`; `src/live/{live-gate,plugin-inventory-probe}.ts`
+ two `*.live.test.ts` files. `package.json`/`tsconfig.json` gained `@eo/contracts`/`@eo/engine-claude`
dependencies + project references, and a `./package.json` export entry (needed for `@eo/cli`'s
real Node-module-resolution-based `pluginSourceDir` lookup). `agents/eo-reviewer.md` had `Bash`
removed from its `tools` (adversarial-review fix #2).

### `packages/cli` (installer/doctor backend)

New: `src/installer/` (whole directory) — `checksum.ts`, `state-store.ts`, `merge-text.ts`,
`claude-md.ts`, `settings-merge.ts`, `mcp-json-merge.ts`, `agents-writer.ts`, `git-repo-state.ts`,
`drift-detector.ts`, `diff-renderer.ts`, `install.ts`, `upgrade.ts`, `uninstall.ts`, `types.ts`,
`real-installer-dependencies.ts`, each with a co-located `*.test.ts`, plus the named suites
(`install.matrix.test.ts`, `merge.monotonic.property.test.ts`, `mcp-entry.golden.test.ts`,
`drift.fixtures.test.ts`, `vendored-install.digest.test.ts`, `attribution.none.test.ts`).
`src/commands/installer-handlers.ts` + `installer-dispatch.test.ts`.
`src/doctor/checks/{checksum-drift,plugin-trust-pin,capability-manifest-freshness}.ts` + tests,
`src/doctor/doctor.plugin-faults.test.ts`.

Modified (pre-existing 09 files, additive-only): `src/commands/types.ts` (`CliDependencies.installer?`,
optional — every pre-existing test that never supplies it is unaffected), `src/commands/dispatch.ts`
(`install`/`upgrade`/`uninstall` delegate to the real backend only when `deps.installer` is present,
else the exact same `NOT_IMPLEMENTED` shape as before), `src/commands/real-handlers.ts` (`doctor`
now also passes `deps.installer` through when present), `src/doctor/run-doctor.ts`
(`buildDefaultDoctorChecks` registers this phase's 3 checks only when its own new optional
`installer` option is supplied), `src/bootstrap.ts` (`buildRealCliDependencies` now always wires
real `InstallerDependencies` by default). `package.json`/`tsconfig.json` gained `@eo/plugin`
(dependency) and `@eo/renderer` (devDependency, test-only) + project references.

### `docs/evidence/phase-10/` — this file + `gate-results.txt`.

## Gate results (this build)

- `npx tsc -b packages/plugin packages/cli` — clean.
- `npx vitest run packages/plugin packages/cli --coverage.enabled=false` — **382 tests / 59 files, all green**
  (includes every pre-existing roadmap/09 test in `packages/cli`, unmodified in behavior — see
  `cli.commands.schema.test.ts`'s own `NOT_IMPLEMENTED` suite, which still asserts `install`/`upgrade`/
  `uninstall` as `NOT_IMPLEMENTED` for a `CliDependencies` without `installer`, exactly as before).
- `npx eslint packages/plugin packages/cli` — clean, zero warnings/errors.
- `npx prettier --check packages/plugin packages/cli` — clean.
- Coverage, scoped to this phase's new/substantially-new files (`packages/plugin/src/**`,
  `packages/cli/src/installer/**`, `commands/installer-handlers.ts`,
  `doctor/checks/{checksum-drift,plugin-trust-pin,capability-manifest-freshness}.ts`; excludes
  `*.test.ts`, `src/live/**`, and pre-existing 09 files this phase only lightly touched):
  **statements 98.01%, branches 90.57%, functions 100%, lines 98.09%** — all four ≥ the 80%
  line+branch ground-rule floor by a wide margin. Full raw numbers (including the mixed
  whole-package view) are in `gate-results.txt`.

## Ground-truth discovery during this phase's own build (real, live `claude` binary)

This build environment happened to have a real `claude` CLI (`2.1.218` — **outside**
`docs/engine-baseline.md`'s pinned `2.1.207–2.1.210` range, so not a substitute for a real `@live`
baseline run, but sufficient for structural, non-auth, local plugin-manifest facts):

- `claude plugin validate <path>` and `claude --plugin-dir <path> plugin details <name>` are real,
  local, **non-auth, non-model** commands — no `EO_LIVE`/OAuth needed. Running them against this
  phase's own `packages/plugin` was the actual source of the `skills/<name>/SKILL.md` correction
  (Deviations §2) and confirmed the plugin's inventory before any live-model test was written:
  `Skills (5) approve, connections, evidence, run, status`, `Agents (2) eo-explore, eo-reviewer`,
  `Hooks (2) PostToolUse, Stop`, `MCP servers (1) eo_gateway`.
- `claude plugin validate --strict` flags this package's own `commit`/`digest` marketplace-entry
  extension fields as "unknown field" warnings (Claude Code's own schema tolerates, doesn't require,
  them) — an intentional, documented tradeoff: those two fields are how this phase's own
  `MarketplaceSchema`/digest-freshness machinery works, not part of Anthropic's own marketplace
  schema.
- `packages/plugin/src/live/plugin-load.live.test.ts` exercises the non-auth `claude plugin validate`
  call for real (still gated behind `EO_LIVE=1`, matching this repo's own `@live` convention, since
  it also runs a real model turn in the same file for the subagent-spawn check).

## Deviations / carry-forward gaps

1. **`@live` CI wiring.** `vitest.live.config.ts`'s `include` glob was scoped to
   `packages/engine-claude/src/live/**/*.live.test.ts` only, so `packages/plugin/src/live/
   *.live.test.ts` was correctly excluded from the default gate (`vitest.config.ts` excludes all
   `*.live.test.ts` globally) but was not picked up by `npm run test:live` / the `engine-live` CI job.
   **This is being fixed by the orchestrator directly (root-config edit, outside this phase's own
   allowed scope)** — not a gap in this phase's own deliverable, both live test files are otherwise
   real (spawn the actual `claude` binary; fail red without `EO_LIVE=1`, matching `engine-claude`'s
   own convention) and were never executed end-to-end in THIS build (no `CLAUDE_CODE_OAUTH_TOKEN`
   configured here).
2. **`skills/<name>.md` → `skills/<name>/SKILL.md` layout correction.** roadmap/10 §In scope and
   adaptation §5.5 both describe skills living under `skills/` without specifying the
   `<name>/SKILL.md` subdirectory convention. A live `claude plugin details` run (see above) showed
   the flat form is silently invisible to the engine (`Skills (0)`) — corrected in both the shipped
   plugin layout and `plugin-manifest.ts`'s own validator, cited as a live-verified fact rather than
   asserted from the docs alone (consistent with this phase's own risk note: "confirm against the
   live engine ... rather than asserting specific prompt text").
3. **No `--plugin-dir`/`--plugin-url` flag on the `install` CLI command itself.** The "vendored
   digest-pinned install path" is proven at the content-digest layer
   (`vendored-install.digest.test.ts`) and enforced at doctor-check layer (`plugin-trust-pin`), but
   `engineering-orchestrator install` always resolves its plugin source via real Node module
   resolution (`resolvePluginSourceDir`, `real-installer-dependencies.ts`) — there is no argv flag
   to point it at an arbitrary vendored directory or URL. A reasonable, scoped-down interpretation
   given remaining budget; flagged here as a real gap for whichever phase next touches `install`'s
   argv surface (`argv/types.ts`'s `InstallCommand` and `argv/parse-command.ts` would need a new
   optional field).
4. **CapabilityManifest is entries-only, not the full instance.** `buildPluginCapabilityEntry`/
   `buildEngineCapabilityEntry` (`packages/plugin/src/capability-entry.ts`) each build one
   schema-valid `CapabilityManifestEntry`; assembling the full `CapabilityManifest` (with
   `changeSetId`, folding in 12's quarantine entries) is 11's job per the roadmap dependency graph
   and is correctly not attempted here. Both entries start `decision: "pending"` — this phase never
   self-approves (12's quarantine pipeline owns that transition).
5. **Marketplace `commit` is a placeholder SHA (`"0"×40`).** Schema-valid (40 hex chars) but not a
   real git commit SHA, since this phase's own work is uncommitted at build time. **Explicit
   carry-forward (b), per adversarial review — do not fix now:** whichever phase packages/publishes
   the plugin for real (23, per roadmap) owns replacing it with the actual packaging commit's SHA;
   `marketplace-schema.test.ts` only proves the *shape* is SHA-like, not that it corresponds to a
   real commit yet.
6. **`enabledPlugins`/`attribution` monotonicity is enforced at "already present at all" granularity**,
   not partial-key granularity within `attribution` (e.g. a pre-existing `{commit: "x"}` missing `pr`
   is left exactly as-is, `pr` is never added) — a deliberately conservative reading of "never loosen
   a security key already present," see `settings-merge.ts`'s own doc comment.
7. **Explicit carry-forward (a), per adversarial review — do not fix now: drift-detector false
   positives on merged files.** `drift-detector.ts` compares WHOLE-FILE checksums for
   `CLAUDE.md`/`settings.json`/`.mcp.json`, not just this installer's own managed region within them.
   A user's own hand-edit anywhere else in one of these files (e.g. adding an unrelated key to
   `settings.json`, or writing prose elsewhere in `CLAUDE.md`) is indistinguishable from drift to this
   installer's own content, and `uninstall.ts` then reports that whole artifact as `preserved-drifted`
   (leaves it, including this installer's own managed block, entirely in place) rather than
   surgically removing just the managed portion. **Imprecise but safe** — it never destroys a user
   edit, it just over-preserves (a stale managed block can outlive an uninstall). A future refinement
   would need per-region (not whole-file) checksums for merged artifacts.
8. **Explicit carry-forward (c), per adversarial review — do not fix now: `stripManagedTextBlock`
   (`merge-text.ts`) is effectively dead in the current call graph.** `uninstall.ts` restores a merged
   artifact's recorded `originalContent` snapshot verbatim (or deletes the file if it never existed
   pre-install) rather than calling `stripManagedTextBlock` — a design decision made specifically
   because whole-file snapshot-restore is simpler and more robust than reverse-engineering which
   JSON keys/text spans this installer itself added (see `state-store.ts`'s `ArtifactRecord
   .originalContent` doc comment). `stripManagedTextBlock` is kept (not removed) because: it is still
   exercised by its own real, meaningful tests (the merge/strip round-trip contract in
   `merge-text.test.ts`), and it is a plausible utility for a future `upgrade --dry-run` diff-preview
   refinement that wants to show "what would be removed" without a full snapshot. Kept and documented
   here rather than fixed/removed, per the adversarial-review instruction to record, not act.

## Interfaces consumed from 06/09 — confirmations

- **06 (`@eo/engine-claude`):** `TESTED_ENGINE_VERSION` reused verbatim (not re-derived) in
  `capability-entry.ts`'s `buildEngineCapabilityEntry` for the plugin's CapabilityManifest engine
  pin — a different reuse posture than 09's own pre-existing `doctor/checks/engine-version.ts`,
  which deliberately does NOT import `@eo/engine-claude` (that file's own comment explains why); both
  are correct per their respective phases' own instructions, not a contradiction.
- **09 (`@eo/cli`):** `install`/`upgrade`/`uninstall` argv skeletons, the doctor `check =
  {id,severity,evidence,repairStep}` framework, and `GATEWAY_MCP_SERVER_NAME`/`gateway mcp` were all
  consumed as-is, never redefined. The `.mcp.json` entry's command (`engineering-orchestrator gateway
  mcp`) is byte-identical to 09's own `gateway mcp` boot convention.
