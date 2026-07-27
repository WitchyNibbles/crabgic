# crabgic

## 1.1.0

### Minor Changes

- b70d118: Add a Claude Code status line, installed and registered by `crabgic install`.

  The line shows the model and its reasoning effort, the current git branch and dirty
  flag, session context-window usage as a meter, and the 5-hour and weekly subscription
  usage windows — each value clearly divided from the next, on one shared green → amber →
  red scale. A reset countdown appears on a usage window only once it passes 80%.

  Two engine constraints shape the delivery (recorded in `docs/engine-baseline.md` §17,
  read from the 2.1.220 binary): the plugin manifest has no `statusLine` key, and a
  `settings.json` command referencing `${CLAUDE_PLUGIN_ROOT}` is rejected outright. So the
  installer copies the script to `.claude/crabgic-statusline.mjs` as a wholly-owned
  artifact and registers it via `$CLAUDE_PROJECT_DIR`, keeping a committed
  `.claude/settings.json` portable across machines.

  `statusLine` is add-only like every other key the installer writes: a status line you
  already configured is never replaced.

## 1.0.2

### Patch Changes

- Stop the plugin manifest pinning every install to version `0.0.0`, and give the package a README.

  A plugin's effective version resolves `plugin.json` → marketplace entry → source commit SHA,
  and when both files declare one the manifest wins silently. The manifest carried the `0.0.0`
  workspace placeholder while the marketplace entry carried the real release version, so every
  install of `crabgic@crabgic-marketplace` resolved to `0.0.0` — and no later release would have
  reached an already-installed user. The manifest no longer declares a version at all, leaving
  the marketplace entry, which the release preparer recomputes each release, as the sole
  declared version. The resolution order is now recorded as `docs/engine-baseline.md` §16.

  The published package also had no README — `npm view crabgic readme` returned "No README data
  found" — so the npm listing rendered blank. It now ships one.

  The marketplace listing carries the real owner address in place of a placeholder, plus the
  optional discovery metadata the marketplace reference supports (`displayName`, `author`,
  `homepage`, `repository`, `keywords`).

## 1.0.1

### Patch Changes

- Ship the plugin's distributable assets in the published package.

  `1.0.0` bundled the CLI's JavaScript but not the plugin's DATA — the two
  subagents, the hooks, the five skills, `.mcp.json` and
  `.claude-plugin/marketplace.json`. `@crabgic/plugin` is a private workspace
  package that is never published, so `resolvePluginSourceDir` looked for a
  module that does not exist outside the monorepo. In any consuming repo both
  `crabgic doctor` and `crabgic install` — the command the package exists to be
  installed for — failed with
  `Cannot find module '@crabgic/plugin/package.json'`.

  The assets now ship at `<dist>/plugin`, byte-identical to the source so the
  content digest `marketplace.json` records still validates, and the resolver
  prefers that layout with the workspace path as a fallback.

  `scripts/check-install-smoke.mjs` now runs `crabgic doctor` from the
  installed package rather than only probing the argument parser — the gap that
  let this reach the registry with every other check green.

## 1.0.0

### Major Changes

- Initial public release.

  Crabgic is a harness that makes Claude operate as an autonomous engineering
  orchestrator: it plans work into change sets, runs them through a supervised
  worker runtime against isolated git worktrees, and gates every result behind
  quality, security and performance verification before anything is published.

  - Supervised daemon and UDS control plane, with crash recovery, idempotent
    resume and lease-based concurrency over an append-only event journal.
  - Git control repo and worktrees, with overlap analysis, merge preflight and
    neutral branch/commit rendering that never leaks development-engine
    attribution.
  - Connector gateway with Jira Cloud/Data Center and Grafana adapters,
    exactly-once mutation with read-back verification, and an operation journal.
  - Quality, security and performance gates, including PerformanceContract
    decisioning and a reviewed learning pipeline.
  - `crabgic` CLI and doctor, plus a Claude Code plugin and installer.
