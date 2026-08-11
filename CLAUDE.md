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
   Currently **certified for the single-tenant, trusted-operator scope only** (owner ruling
   2026-08-07); multi-tenant is NOT certified.
6. `docs/evidence/criteria-closeout/defects/INDEX.md` — 45 filed defects with sized remedies.
   Bookkeeping inside the claim-space: **never cite it as evidence**, cite a record's own evidence.

## Reporting to the owner

`docs/presentation-policy.md` governs everything said to this repo's owner — by
crabgic, and by anyone working on crabgic. The owner has a condition that makes
long unordered prose very hard to read, so this is an **accessibility
requirement, not a style preference**: an answer buried inside an
undifferentiated block has not been delivered, and "it was in there" is not a
defence. The short form:

- **Answer first**, in ≤2 lines. Never build up to it.
- Past 5 lines use headings; never more than 3 unbroken prose lines.
- Bullets (≤15 words, ≤7 per section) over paragraphs. Once 3+ items each carry
  2+ attributes, make it a table.
- **No preamble, no recap, no closer.** Park tangents as named follow-ups.
- End on the single next action.
- Signpost state with that document's closed glyph vocabulary — never
  decorative emoji, which destroy the affordance they appear to add.

Brevity is the default; a request for detail makes the answer longer, not
looser. The limits live in `PresentationPolicy` (`@crabgic/contracts`) and are
enforced structurally for CLI stdout — cite them from there, never retype them.

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
