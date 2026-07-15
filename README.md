# Engineering Orchestrator

Engineering Orchestrator is a Claude Code-native multi-agent development harness: a
supervisor that dispatches implementation work to sandboxed Claude Code workers running
on the owner's Claude subscription (Agent SDK, in-process transport), confines those
workers behind an AuthorizationEnvelope compiled to native permission and sandbox
profiles, and routes all Jira and Grafana connectivity through a single policy gateway.
It ships as a published Apache-2.0 npm package plus a Claude Code plugin marketplace
entry, with the Claude Code plugin session as the flagship interactive surface and a
companion `engineering-orchestrator` CLI for approvals, scripting, CI, and recovery. v1
targets the full original plan — Jira Cloud and Data Center, Grafana Cloud/OSS/Enterprise,
performance contracts, and the learning pipeline — with balanced model routing
(`sonnet` implementation workers, `opus` for architecture/planning and integration/security
review, `haiku` for mechanical chores) and pause-and-resume handling of subscription
rate/usage limits rather than silent tier degradation. Per the adaptation doc's verdict,
roughly 70-75% of the design is engine-agnostic (the supervisor/journal/lease/idempotency
core, the control-repo + worktree Git engine, the Jira/Grafana connector layer and policy
gateway, the neutral-communication renderer/linter, performance contracts, and the learning
pipeline); the part that changes per engine is isolated behind an `EngineAdapter` boundary,
with the Claude Code adapter as the only one shipped and tested in v1.

## Status

Planning complete / pre-implementation. This repository currently contains only the
planning corpus described below — no application code exists yet. The next work is
roadmap phases `00` (engine verification spikes) and `01` (monorepo bootstrap), which run
in parallel and have no dependencies on each other.

## Repository map

- **`docs/claude-code-adaptation.md`** — the authoritative research doc adapting the
  original (Codex-CLI-oriented) plan to Claude Code. §0 holds the owner-confirmed product
  decisions; the rest is verified engine-mapping research and design detail.
- **`docs/interface-ledger.md`** — the settled, binding record of cross-phase interface
  rulings (shared tool names, schema members, constants, path conventions) referenced by
  the roadmap phase files.
- **`roadmap/`** — `README.md` (ground rules, phase index, dependency graph) plus 24 phase
  files (`00` through `23`), one file per independently verifiable unit of work.

## Reading order for newcomers

1. `docs/claude-code-adaptation.md` §0 — confirmed product decisions.
2. `roadmap/README.md` — ground rules and the phase dependency graph.
3. `roadmap/00-engine-spikes.md` and `roadmap/01-repo-bootstrap.md` — the two phases with
   no unresolved dependencies, and the actual starting point for implementation.

## Ground rules

The rules that apply to every phase (TDD requirement, coverage threshold, evidence-based
exit criteria, definition of "done") are stated once, in the ground-rules block at the top
of `roadmap/README.md`. They are not duplicated here — read them there.

## Version-drift caveat

Claude Code ships weekly, and this corpus was verified against a specific pinned version
(see `docs/claude-code-adaptation.md`'s header). Anything engine-touching — permission
syntax, hook behavior, sandbox schema, session semantics — must cite `docs/engine-baseline.md`
(produced by roadmap phase `00`) and the pinned version range it records, never memory or
this README.

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
