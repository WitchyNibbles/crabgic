# crabgic

## 1.3.0

### Minor Changes

- a2bd006: Add a presentation policy for owner-facing output.

  Crabgic now formats what it says to its owner under an explicit contract:
  answer first, headings past five lines, bullets and tables over paragraphs, a
  fixed semantic glyph vocabulary (✅ ❌ ⚠️ 🛑 ⏳ 🔄 ⏸️ ❓ 📎 ℹ️) instead of ad-hoc
  markers, and colour by verdict. This is an accessibility requirement, not a
  style change.

  - New `presentation` module in `@crabgic/contracts`: the glyph vocabulary with
    `emoji`/`text`/`ascii` profiles, a 256-colour role palette sharing the status
    line's hues, `HUMAN_REPORT_LIMITS`, and `resolvePresentation()`.
  - New human-mode stdout primitives in the CLI (`renderStatusLine`,
    `renderHeading`, `renderBullets`, `renderKeyValues`, `renderHumanReport`) —
    status lines coloured by verdict, leads and headings bold, scaffolding dimmed.
  - `status --watch` gains an optional presentation context. Its default is
    unchanged: piped and redirected output is byte-identical to before.
  - The manager session's `CLAUDE.md` operating protocol gains reporting rules,
    quoted from the policy rather than restated.

  Selection: `emoji` + colour on a TTY, monochrome `text` when piped, `ascii`
  under `CRABGIC_ASCII=1`. `CRABGIC_PRESENTATION=emoji|text|ascii` forces the
  glyph profile; `CRABGIC_COLOR=1|0` forces colour on (even when piped) or off;
  `NO_COLOR` disables colour without touching structure.

  Colour is additive only — stripping the escapes from any coloured render
  reproduces the monochrome render byte for byte, so nothing is visible in colour
  alone. `--json` output is untouched, and outbound artifacts (PR, commit, Jira,
  Grafana) remain neutral and emoji-free under `CommunicationPolicy`.

  See `docs/presentation-policy.md`.

## 1.2.0

### Minor Changes

- 153e3c6: Give the manager session an operating protocol, and enforce the autonomous half of it.

  Installed projects previously received a managed `CLAUDE.md` block that listed the plugin's
  capabilities and said nothing about how to operate. With no instruction to the contrary a Claude
  Code session uses its conversational default and checks in after every step — the opposite of a
  harness whose own design names seven, and only seven, conditions that may halt a run.

  - **New: the manager operating protocol.** Autonomy by default, roadmap/11's seven stop conditions
    as the only legitimate halts, the approval gates, and `AskUserQuestion` as the way to put a
    decision to the owner — never a plain-text list of numbered options. Written once in
    `manager-protocol.ts`, rendered into the managed `CLAUDE.md` block and into a new
    `/eo:protocol` skill that carries the long-form rationale.
  - **New: the Stop autonomy gate.** A deliberately blocking `Stop` hook that refuses to end a turn
    while a run is in flight, so the autonomy clause is enforced rather than merely requested. It
    allows the stop at `awaiting_approval` (a human gate is legitimately open) and at every terminal
    state, cannot loop (`stop_hook_active`), and fails open on every error path — no supervisor, no
    runs, a timeout or a bad response all end the turn normally.
  - **Fixed: the protocol reached repos with an `AGENTS.md`.** The `@AGENTS.md` bridge collapsed the
    entire managed block to that one import line, so those projects received no Crabgic instructions
    at all. The bridge is now additive.
  - **New: `CRABGIC_NO_SPAWN=1`.** Makes any CLI command observe an already-running supervisor
    instead of starting one on demand — what lets a hook ask "is a run in flight?" without booting a
    daemon as a side effect of a session ending.

  Engine facts behind both features are recorded in `docs/engine-baseline.md` §18 (the question
  tool) and §19 (the `Stop` hook control contract), each with a re-runnable spike.

## 1.1.2

### Patch Changes

- 1eba6b2: Stop publishing `dist/.tsbuildinfo`, which was 15% of the package.

  `files: ["dist"]` swept in `tsc -b`'s incremental build state — 199 kB of the
  1299 kB unpacked package, of no use to a consumer. It is also the only file
  that differs between two builds of identical sources in different
  environments, so shipping it made the published artifact non-reproducible,
  directly undermining the reproducible-build criterion the release gate exists
  to enforce. Shipped in 1.0.0 through 1.1.1.

  The published package is now 1099 kB across 28 files; every other file is
  byte-identical to 1.1.1. `scripts/check-published-tarball.mjs` now fails on
  any `.tsbuildinfo` in the tarball, so it cannot come back silently.

## 1.1.1

### Patch Changes

- 75d204e: Fix the status line rendering nothing when it is invoked through a symlink.

  The script's main-module guard compared `import.meta.url` against
  `process.argv[1]` directly. `argv[1]` is the path as invoked, but
  `import.meta.url` is the real path — Node resolves symlinks for module
  identity — so a symlinked invocation looked like a plain import and the entry
  point silently declined to run: exit 0, empty stdout, no error, and Claude
  Code rendering a blank status row with nothing to debug. Resolving `argv[1]`
  before the comparison makes both invocations agree.

  Direct-path invocation, which is what `crabgic install` writes into
  `.claude/settings.json`, was never affected. This only bit a status line
  pointed at the script through a symlink — for example one at
  `~/.claude/crabgic-statusline.mjs` aimed at a globally installed copy, which
  is how it was found.

  The suite now spawns the script for real, both directly and through a
  symlink, because the regression is invisible to a test that imports it.

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
