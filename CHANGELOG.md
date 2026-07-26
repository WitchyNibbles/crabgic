# Changelog

Release notes for the published `crabgic` package.

This root file is the one `roadmap/23-release-hardening.md`'s reproducible-build
exit criterion (`:136`, "`CHANGELOG.md` entry present") reads, and it mirrors the
per-package notes changesets generates at `packages/cli/CHANGELOG.md`. Both are
derived from the same reviewed `.changeset/*.md` entries — neither is written by
hand at release time, so the two cannot disagree about what shipped.

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
