# CLAUDE.md

This repository is the pre-implementation planning corpus for Engineering Orchestrator —
implementation has not started. Read, in order, before doing any work here:

1. `docs/claude-code-adaptation.md` §0 — confirmed product decisions.
2. `roadmap/README.md` — ground rules and phase dependency graph.
3. `roadmap/00-engine-spikes.md` and `roadmap/01-repo-bootstrap.md` — the two phases with
   no unresolved dependencies, and the current starting point for implementation.

## Non-negotiables

- `docs/claude-code-adaptation.md` §0's decisions are owner-approved and settled. Do not
  re-ask or re-litigate them; treat them as fixed inputs.
- `docs/interface-ledger.md` is the settled authority on cross-phase interface rulings
  (tool names, schema members, constants, path conventions). Reconcile any new work with
  it; never contradict it or edit it casually — a ruling change requires a coordinated
  edit across every phase file the ledger lists as affected.
- The five ground rules in `roadmap/README.md` (TDD mandatory, ≥80% line+branch coverage,
  evidence-based exit criteria, the "done" definition, and the engine-fact-drift rule)
  apply to every phase without exception.
- Engine facts about Claude Code drift weekly. Anything engine-touching cites
  `docs/engine-baseline.md` (produced by roadmap phase `00`) plus the pinned version
  range it records — never memory, and never this file.
- Commits use conventional-commit format (`feat|fix|refactor|docs|test|chore|perf|ci`).
