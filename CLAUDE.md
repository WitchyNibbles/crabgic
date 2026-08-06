# CLAUDE.md

This repository is Crabgic: a harness that makes Claude operate as an
autonomous engineering orchestrator, per the design in `docs/claude-code-adaptation.md`.
Implementation is underway, under active development against the phased roadmap in
`roadmap/README.md`; the roadmap phase files govern all implementation work here (TDD,
evidence-based exit criteria — see the ground rules below). Read, in order, before doing
any work here:

1. `docs/claude-code-adaptation.md` §0 — confirmed product decisions.
2. `roadmap/README.md` — ground rules and phase dependency graph.
3. `roadmap/00-engine-spikes.md` and `roadmap/01-repo-bootstrap.md` — the two phases with
   no unresolved dependencies, and the current starting point for implementation.
4. **`docs/verification-playbook.md` — read this before verifying or closing out anything.**
   63 rulings, each earned from a real defect a green test suite did not catch: the vacuity
   patterns, the four-rule citation resolver, transcript and probe discipline, and the cost
   rules for live runs. Skipping it means re-earning them.
5. `docs/deploy-posture.md` — the sole authority on whether crabgic is certifiably deployable.
   Currently **conditional, not clear**.
6. `docs/evidence/criteria-closeout/defects/INDEX.md` — 37 filed defects with sized remedies.
   Bookkeeping inside the claim-space: **never cite it as evidence**, cite a record's own evidence.

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
