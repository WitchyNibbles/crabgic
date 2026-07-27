# crabgic

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
