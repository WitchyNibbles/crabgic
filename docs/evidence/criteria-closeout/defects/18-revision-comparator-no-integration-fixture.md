# 18 — the revision comparator has no caller, no poll, and no integration fixture

**Phase:** 18 — Jira Cloud adapter + intake/milestone synchronization
(`roadmap/18-jira-cloud-adapter.md`, exit criterion 6)

**Criterion (verbatim):**

> Revision comparator detects a seeded material remote edit between two milestone polls and produces the amendment-review signal (evidence: property + integration fixture).

**Found:** 2026-08-02, criteria-closeout pass, batch 4 (phase 18), at `main` @
`d60398f6b1d3aca2f2efbb8adfbac081d6c16904`.

**Severity:** blocking-guarantee. This is not only a missing test. The comparator function is
correct and well tested in isolation, but nothing in the repository calls it, and the milestone
polling loop the criterion describes does not exist — so the behaviour the box asserts is not
delivered by any code path, only by a function that could deliver it if something invoked it.

## Gap

### What the criterion asks for

Four clauses, and the parenthetical names the evidence channel explicitly:

1. detects a **seeded material remote edit**,
2. **between two milestone polls**,
3. produces the **amendment-review signal**,
4. evidenced by a **property** _and_ an **integration fixture**.

The phase's §In scope is the governing prose:

> Revision polling at every milestone feeds the revision comparator; a material remote edit
> triggers 11's contract-amendment stop condition (wired in 21).

The parenthetical "(wired in 21)" defers only the _stop-condition_ wiring. The polling that
"feeds the revision comparator" is 18's own scope, and §Interfaces produced repeats it:
"stamps each intake-tracked issue's `RemoteResource` … **at every milestone poll**".

### What exists

`packages/connectors-jira/src/intake/revision-comparator.test.ts`, six cases, all green:

- clause 1 — `:31-36`, a seeded `rev-1` → `rev-2` pair asserted `signal.material === true`;
- clause 4 (property half) — `:57-67`, a `fast-check` property that any two distinct revision
  strings are always material, with `:69-78` as its non-vacuity partner (identical revisions are
  always non-material, so a comparator that flagged everything fails);
- a guard at `:48-53` that comparing two different resources throws rather than silently
  reporting "no change".

The signal shape itself is real: `MaterialChangeSignal` carries `previousRevision`/
`currentRevision` on the material branch (`revision-comparator.ts:37-39`), which is a reasonable
reading of clause 3 for this phase, given 21 owns the stop-condition wiring.

### What is missing

**Clause 2 — no poll exists.** `git grep -in poll -- packages/connectors-jira/src`, excluding
`.test.ts`, returns exactly two lines, both inside `revision-comparator.ts`'s own doc comment
quoting the roadmap (`:7`, `:9`). `planMilestoneSync`
(`packages/connectors-jira/src/intake/milestone-sync.ts`) neither polls a revision nor stamps a
`RemoteResource`; its only revision reference is `:121`,
`existing?.updatedRevision ?? "unknown"`, used for the comment's own precondition. Both stamps in
every test are hand-built by `buildRemoteResource` from `@crabgic/testkit`.

**Clause 4 — no integration fixture exists.** `compareRemoteResourceRevisions` has **zero**
production callers repository-wide. `git grep -n` finds it only in its own module, in the package
barrel (`packages/connectors-jira/src/index.ts:148`), and in its own unit test.

### The evidence README's claim does not survive reading the file

`docs/evidence/phase-18/README.md`'s row for this criterion says:

> `src/intake/milestone-sync.test.ts`'s dedup-marker tests are the companion integration evidence
> for the polling/sync loop this comparator feeds.

`milestone-sync.test.ts` is 139 lines and never imports or calls the comparator, never stamps a
`RemoteResource`, and never polls. Its four cases are the create path, the edit-in-place path,
the distinct-marker case, and a lint-blocked case. The README row is a description of an
intention, not of the file.

### The near miss, recorded so the next reader does not re-derive it

The comparator's sibling `stampJiraRemoteResource` **is** consumed in production, by phase 21's
`packages/gates/src/remote-resource-binding.ts:131` — a module whose own doc comment (`:19-26`)
records that before it existed, `stampJiraRemoteResource` "had ZERO production callers anywhere
in this repository — definitions, barrel re-exports and `.test.ts` files only." Phase 21 closed
that gap for the stamp and did not close it for the comparator.

### Search trail

1. Read `revision-comparator.ts` and `revision-comparator.test.ts` in full.
2. `git grep -n "compareRemoteResourceRevisions\|stampJiraRemoteResource\|MaterialChangeSignal"`
   over `packages/`, `e2e/`, `scripts/` → the comparator appears only in its module, the barrel
   and its test; the stamp additionally appears in `packages/gates/src/remote-resource-binding.ts`.
3. `git grep -in poll -- packages/connectors-jira/src packages/gates/src`, `.test.ts` excluded →
   two doc-comment lines in `revision-comparator.ts` and one in
   `packages/gates/src/materiality-classifier.ts`.
4. Read `milestone-sync.ts` and `milestone-sync.test.ts` in full to check the README's claim.
5. Read `packages/gates/src/remote-resource-binding.ts`'s header for phase 21's own account of
   the caller gap.

## Proposed remedy

1. **Give the comparator a caller inside the milestone loop.** `planMilestoneSync` already reads
   the tracked issue through the resource client; have it stamp the issue's current revision with
   `stampJiraRemoteResource` on each invocation, accept the previous stamp as an optional
   dependency, and return the `MaterialChangeSignal` alongside its plan. This is what makes
   "between two milestone polls" true rather than aspirational, and it is additive — an absent
   previous stamp means no signal, so no existing caller changes behaviour.
2. **Add the integration fixture the criterion names.** In
   `packages/connectors-jira/src/intake/milestone-sync.test.ts`, script two consecutive
   `planMilestoneSync` cycles against a fake transport whose second `issues.get` returns a
   different `updated` value, and assert the second cycle's returned signal is
   `{ material: true, previousRevision: "rev-1", currentRevision: "rev-2" }`. Its negative
   control is the same two cycles with an unchanged `updated`. Write it failing-first: it is red
   today because the return type has no signal field.
3. Leave the contract-amendment stop-condition wiring to 21, as §In scope directs. This remedy
   closes 18's box only.

**Effort sizing: M** — one additive parameter and one additive return field on
`planMilestoneSync`, plus ~40 lines of test. No CI job, no live engine, no owner input. Runs
inside the default `npm test` fan-out. Coordinate with phase 21's owner, since 21 is the
declared consumer of the signal.

**Ticket-ready:** yes.
