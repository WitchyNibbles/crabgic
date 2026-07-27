# Changelog

Release notes for the published `crabgic` package.

This root file is the one `roadmap/23-release-hardening.md`'s reproducible-build
exit criterion (`:136`, "`CHANGELOG.md` entry present") reads, and it mirrors the
per-package notes changesets generates at `packages/cli/CHANGELOG.md`. Both are
derived from the same reviewed `.changeset/*.md` entries — neither is written by
hand at release time, so the two cannot disagree about what shipped.

## 1.2.0

Give the manager session an operating protocol, and enforce the autonomous half of it.

Installed projects received a managed `CLAUDE.md` block that listed the plugin's capabilities and
said nothing about how to operate. With no instruction to the contrary a Claude Code session uses
its conversational default and checks in after every step — the opposite of a harness whose own
design names seven, and only seven, conditions that may halt a run. Reported from real use: the
manager asked the owner to type "continue" after every step, and asked genuine questions as
plain-text "option 1 / 2 / 3 / 4" lists.

**The manager operating protocol** is new. Autonomy by default, the seven stop conditions as the
only legitimate halts, the approval gates, and `AskUserQuestion` as the way to put a decision to
the owner. It ships in the managed `CLAUDE.md` block, and `/eo:protocol` carries the long form.

**The Stop autonomy gate** is new, and is the first manager hook permitted to block. It refuses to
end a turn while a run is in flight, so the autonomy clause is enforced rather than requested. It
allows the stop at `awaiting_approval` — blocking there would trap you in a session whose only
exit is the approval the block prevents you reaching — and at every terminal state. It cannot
loop, and it fails open on every error path: no supervisor, no runs, a timeout or a bad response
all end the turn normally, so it does nothing at all in a project that has never run Crabgic.

**Repos with an `AGENTS.md` now get the protocol too.** The `@AGENTS.md` bridge collapsed the
entire managed block to that one import line, so such projects received no Crabgic instructions of
any kind. The bridge is now additive.

**`CRABGIC_NO_SPAWN=1`** is new: it makes a CLI command observe an already-running supervisor
rather than start one on demand.

Engine facts behind both features are recorded in `docs/engine-baseline.md` §18 and §19, each with
a re-runnable spike. §18's interactive half is deliberately left UNRESOLVED, so the protocol
degrades to a single consolidated prose question if the tool is ever absent.

## 1.1.2

Stop publishing `dist/.tsbuildinfo`, which was 15% of the package.

`files: ["dist"]` swept in `tsc -b`'s incremental build state — 199 kB of the 1299 kB
unpacked package, of no use to a consumer. It is also the only file that differs between
two builds of identical sources in different environments, so shipping it made the
published artifact non-reproducible, directly undermining the reproducible-build criterion
the release gate exists to enforce. Shipped in 1.0.0 through 1.1.1.

The published package is now 1099 kB across 28 files; every other file is byte-identical
to 1.1.1. `scripts/check-published-tarball.mjs` now fails on any `.tsbuildinfo` in the
tarball, so it cannot come back silently.

## 1.1.1

Fix the status line rendering nothing when it is invoked through a symlink.

The script's main-module guard compared `import.meta.url` against `process.argv[1]`
directly. `argv[1]` is the path as invoked, but `import.meta.url` is the real path — Node
resolves symlinks for module identity — so a symlinked invocation looked like a plain
import and the entry point silently declined to run: exit 0, empty stdout, no error, and
Claude Code rendering a blank status row with nothing to debug. Resolving `argv[1]` before
the comparison makes both invocations agree.

Direct-path invocation, which is what `crabgic install` writes into
`.claude/settings.json`, was never affected. This only bit a status line pointed at the
script through a symlink — for example one at `~/.claude/crabgic-statusline.mjs` aimed at
a globally installed copy, which is how it was found.

The suite now spawns the script for real, both directly and through a symlink, because the
regression is invisible to a test that imports it.

## 1.1.0

Add a Claude Code status line, installed and registered by `crabgic install`.

The line shows the model and its reasoning effort, the current git branch and dirty flag,
session context-window usage as a meter, and the 5-hour and weekly subscription usage
windows — each value clearly divided from the next, on one shared green → amber → red
scale. A reset countdown appears on a usage window only once it passes 80%. The two usage
segments render only for Claude.ai subscription auth, and only once the session's first
API response populates the rate-limit headers; `CRABGIC_STATUSLINE_ASCII=1` selects plain
glyphs for fonts without emoji coverage, and `NO_COLOR` is honoured.

Two engine constraints shape how it is delivered, both read from the 2.1.220 binary and
recorded as `docs/engine-baseline.md` §17: the plugin manifest has no `statusLine` key, so
a plugin cannot register one, and a `settings.json` command referencing
`${CLAUDE_PLUGIN_ROOT}` is rejected outright rather than left unexpanded. The installer
therefore copies the script to `.claude/crabgic-statusline.mjs` as a wholly-owned artifact
and registers it through `$CLAUDE_PROJECT_DIR`, so a committed `.claude/settings.json`
stays portable across machines. `statusLine` is add-only like every other key the
installer writes: a status line already configured is never replaced.

The renderer is a zero-dependency `.mjs` rather than compiled TypeScript, for the same
reason the hooks are — the engine re-runs it on every token change, so process startup is
on the hot path (~34ms standalone against ~300ms through the bundled CLI).

## 1.0.2

Stop the plugin manifest pinning every install to version `0.0.0`, and give the package a
README.

A plugin's effective version resolves `plugin.json` → marketplace entry → source commit
SHA, and when both files declare one the manifest wins silently. The manifest carried the
`0.0.0` workspace placeholder while the marketplace entry carried the real release
version, so every install of `crabgic@crabgic-marketplace` resolved to `0.0.0` — and no
later release would have reached an already-installed user. The manifest no longer
declares a version at all, leaving the marketplace entry, which the release preparer
recomputes each release, as the sole declared version. The resolution order is now
recorded as `docs/engine-baseline.md` §16, flagged documentation-sourced rather than
probe-verified, with a live verification recorded as owed.

The published package also had no README — `npm view crabgic readme` returned "No README
data found" — so the npm listing rendered blank. It now ships one, using absolute asset
URLs because npm resolves neither relative images nor relative links.

The marketplace listing carries the real owner address in place of a placeholder, plus the
optional discovery metadata the marketplace reference supports (`displayName`, `author`,
`homepage`, `repository`, `keywords`). Deliberately no `icon`: the plugin system has no
such field on either a marketplace entry or `plugin.json`.

## 1.0.1

Ship the plugin's distributable assets in the published package.

`1.0.0` bundled the CLI's JavaScript but not the plugin's DATA — the two subagents, the
hooks, the five skills, `.mcp.json` and `.claude-plugin/marketplace.json`.
`@crabgic/plugin` is a private workspace package that is never published, so
`resolvePluginSourceDir` looked for a module that does not exist outside the monorepo. In
any consuming repo both `crabgic doctor` and `crabgic install` — the command the package
exists to be installed for — failed with
`Cannot find module '@crabgic/plugin/package.json'`.

The assets now ship at `<dist>/plugin`, byte-identical to the source so the content digest
`marketplace.json` records still validates, and the resolver prefers that layout with the
workspace path as a fallback.

`scripts/check-install-smoke.mjs` now runs `crabgic doctor` from the installed package
rather than only probing the argument parser — the gap that let this reach the registry
with every other check green.

## 1.0.0

Initial public release.

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

Requires Node.js >= 24 and Linux x86-64/ARM64 (including WSL2). Supported
integration targets are recorded in `docs/compatibility-matrix.md`; the pinned
Claude Code engine range is recorded in `docs/engine-baseline.md`.
