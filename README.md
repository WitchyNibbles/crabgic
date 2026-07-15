# Engineering Orchestrator

Engineering Orchestrator is a Claude Code-native harness that makes Claude operate as an
autonomous engineering orchestrator. A supervisor dispatches implementation work to
sandboxed Claude Code workers — running on the owner's Claude subscription via the Agent
SDK's in-process transport, each in its own Git worktree — and confines every worker
behind an AuthorizationEnvelope compiled to native Claude Code permission and sandbox
profiles. All Jira and Grafana connectivity is routed through a single policy-gateway MCP
server rather than direct credentials in worker hands. Work is required to pass quality,
security, and performance gates, and a reviewed, eval-gated learning pipeline, before it
is proposed for integration. The design goal is full autonomy end to end, with a human
required only at blocking approval gates — intent-contract/envelope approval and
capability-quarantine decisions — so results are validated and tested without human
intervention anywhere else.

Per `docs/claude-code-adaptation.md` §0 (owner-confirmed product decisions), the harness
targets distribution as a published Apache-2.0 npm package plus a Claude Code plugin
marketplace entry — the Claude Code plugin session as the flagship interactive surface,
with a companion `engineering-orchestrator` CLI for approvals, scripting, CI, and
recovery — and v1 scope is the full original plan: Jira Cloud and Data Center, Grafana
Cloud/OSS/Enterprise, performance contracts, and the learning pipeline. Model routing is
balanced by default (`sonnet` implementation workers, `opus` for architecture/planning and
integration/security review, `haiku` for mechanical chores), and subscription rate/usage
limits pause and resume work rather than silently degrading to a different tier. Per §1's
verdict, roughly 70-75% of the design is engine-agnostic (the supervisor/journal/lease/
idempotency core, the control-repo + worktree Git engine, the Jira/Grafana connector layer
and policy gateway, the neutral-communication renderer/linter, performance contracts, and
the learning pipeline); the part that changes per engine is isolated behind an
`EngineAdapter` boundary, with the Claude Code adapter as the only one built and tested in
v1.

## Status

Under active development, building out `docs/claude-code-adaptation.md` per the phased
roadmap in `roadmap/README.md`. As of 2026-07-15, phases `00` (engine verification spikes)
and `01` (monorepo bootstrap) are in progress — they have no dependencies on each other and
are the current starting point. Remaining phases `02` through `23` follow the dependency
graph in `roadmap/README.md` and land in sequence as their prerequisites close.

## Repository map

- **`docs/claude-code-adaptation.md`** — the authoritative research doc adapting the
  original (Codex-CLI-oriented) plan to Claude Code. §0 holds the owner-confirmed product
  decisions; the rest is verified engine-mapping research and design detail.
- **`docs/interface-ledger.md`** — the settled, binding record of cross-phase interface
  rulings (shared tool names, schema members, constants, path conventions) referenced by
  the roadmap phase files.
- **`roadmap/`** — `README.md` (ground rules, phase index, dependency graph) plus 24 phase
  files (`00` through `23`), one file per independently verifiable unit of work.

Implementation artifacts (source packages, engine-verification spikes, CI workflows, and
so on) land under this map as their owning phases complete; each phase file states what it
produces and where.

## Reading order for newcomers

1. `docs/claude-code-adaptation.md` §0 — confirmed product decisions.
2. `roadmap/README.md` — ground rules and the phase dependency graph.
3. `roadmap/00-engine-spikes.md` and `roadmap/01-repo-bootstrap.md` — the two phases with
   no unresolved dependencies, and the current starting point for implementation.

## Ground rules

The rules that apply to every phase (TDD requirement, coverage threshold, evidence-based
exit criteria, definition of "done") are stated once, in the ground-rules block at the top
of `roadmap/README.md`. They are not duplicated here — read them there.

## Version-drift caveat

Claude Code ships weekly, and the design in `docs/claude-code-adaptation.md` was verified
against a specific pinned version (see that doc's header). Anything engine-touching —
permission syntax, hook behavior, sandbox schema, session semantics — must cite
`docs/engine-baseline.md` (produced by roadmap phase `00`) and the pinned version range it
records, never memory or this README.

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
