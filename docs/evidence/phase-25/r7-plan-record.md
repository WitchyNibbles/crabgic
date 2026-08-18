# Plan — Collapse the duplicated `CPU_BUDGET_FRACTION` into one exported constant

**Change set:** `7d3f8a21-6c94-4e5b-a83f-2b410d97e6c5`. **Stage:** `plan` (5 of 9).
**Design under implementation:** `docs/evidence/phase-25/r7-design-record.md`, revision `r1`,
approved by the owner at the design gate on 2026-08-18.

**Obligations this record owes an answer about**, as issued by `pipeline.plan`:
`plan-covers-every-design-element`, `plan-tasks-have-done-criteria`,
`plan-dependencies-acyclic`.

## Coverage of the design — every element, mapped

The design names six elements. Each maps to at least one task, and no task exists that no
element asks for.

| design element                | tasks                  |
| ----------------------------- | ---------------------- |
| **E1** the single declaration | T1                     |
| **E2** the two call sites     | T2                     |
| **E3** re-duplication guard   | T3                     |
| **E4** citation repair        | T5, T6, T8, T7         |
| **E5** scope fence            | T3 (its scan root), T4 |
| **E6** value non-goal         | T4                     |

⚠️ **E5 and E6 are negative elements** — they say what must NOT happen. A plan that mapped
them to nothing would satisfy a coverage check by counting rows while leaving the two
clauses the owner ruled on unenforced. Each therefore gets an executable form: E5 is the
scan root T3 hard-codes, and E6 is an assertion in T4.

## Tasks

Each task states its done-criteria as a checkable condition, not as an activity.

### T1 — declare the constant once, in production

**Do:** append `export const CPU_BUDGET_FRACTION = 0.01;` to
`packages/supervisor/src/idle-budget/resource-probe.ts` after `:45`, with a doc comment
naming the `<1% of one core` bound and its roadmap source.

**Done when:** `grep -c 'export const CPU_BUDGET_FRACTION' packages/supervisor/src/idle-budget/resource-probe.ts`
returns `1`; `npx tsc -b` is clean; the name resolves through the existing barrel
(`packages/supervisor/src/index.ts:80`) with no edit to that file.

**Depends on:** nothing.

### T2 — delete both private copies and import the shared one

**Do:** delete `idle-budget.integration.test.ts:15` and `heartbeat-scheduler.test.ts:11`;
add `CPU_BUDGET_FRACTION` to each file's existing `./resource-probe.js` import.

**Done when:** both files declare no `CPU_BUDGET_FRACTION`; both import it; the assertion
text at `idle-budget.integration.test.ts:46` and `heartbeat-scheduler.test.ts:39` and the log
line at `:42` are byte-identical to before (`git diff` shows no change on those lines);
`npx vitest run packages/supervisor/src/idle-budget/` is green.

**Depends on:** T1 — the import has nothing to resolve until the export exists.

### T3 — the re-duplication guard

**Do:** add `packages/supervisor/src/idle-budget/one-cpu-budget-declaration.test.ts`: a
raw-text scan of every `.ts` under `packages/supervisor/src/idle-budget/` asserting no file
other than `resource-probe.ts` contains `CPU_BUDGET_FRACTION =`. Model:
`packages/supervisor/src/router/no-change-set-operation.test.ts:51-53`.

**Done when:** the test passes on the post-T2 tree; it **fails** when a private copy is
reintroduced into either test file (measured, then reverted); and it carries
`expect(files.length).toBeGreaterThan(0)` so an empty scan cannot report success.

⚠️ **The anti-vacuity control is a done-criterion, not a nicety.** A scan that globs nothing
passes every assertion it makes. That is the failure this repository names most often, and a
guard shipped without the control would be the same defect in the tool built to prevent it.

**Depends on:** T2 — before it, the guard is red for the state the change set is removing,
which is a different signal from the one it exists to give.

### T4 — the two non-goals, made executable

**Do:** assert in T3's file that the surviving declaration's value is exactly `0.01` (E6),
and hard-code T3's scan root to `packages/supervisor/src/idle-budget/` with a comment naming
the owner's two-sites ruling (E5).

**Done when:** changing the literal to any other value reddens a named test (measured, then
reverted); and `grep -rn 'CPU_BUDGET_FRACTION' e2e/` returns nothing this change set wrote —
`e2e/attestation`'s third copy is untouched, which the owner ruled.

**Depends on:** T3 — both assertions live in its file.

### T5 — re-pin the citation baseline

**Do:** run `npm run check:citation-content -- --update-baseline`.

**Done when:** the command exits 0 and its report names **exactly** the citations T2's edit
moved — no more, no fewer.

⚠️ **Not "the known-stale count has not risen".** That was this task's first done-criterion
and it is unsatisfiable at the point the order reaches T5. T2 moves lines that merged
`phase-05.json` citations pin by embedded marker; a fragment's line range comes from its OWN
marker, not from the citation's `ref` span, so those fragments classify `MOVED` the moment T2
lands. `--update-baseline` refuses only on the `unanchored` class, so it proceeds and folds
them in as stale. The count therefore MUST rise at T5 and can only come back down at T8. A
criterion that cannot hold when its task runs is not a criterion.

**Depends on:** T2 — the lines move there.

### T6 — correct the merged citations by the recipe, never by rewriting

**Do:** for each merged citation whose fragments moved, **widen the `ref`** to cover them and
write the stale line numbers in backticks, per `docs/evidence/citation-resolver/README.md:53-79`.
For `roadmap/05-supervisor-daemon.md:122` the correction goes **inside** the existing
`— **Evidence …**` annotation; the criterion wording before that marker is hash-frozen.

**Done when:** every citation the T5 report named carries a widened `ref` covering its
fragments, and `npm run check:criteria-closeout` and `npm run check:criteria-baseline` pass
with no criterion text hash changed.

⚠️ **`check:citation-content` is deliberately NOT in this task's done-criteria.** Widening a
`ref` is itself a baseline divergence of class `changed`, which is blocking, so the plain
check fails immediately after T6 by construction. It comes back green at T8, not here.
Asserting it at T6 would make the task unpassable and send the next reader hunting for a
defect that is the ratchet working.

⚠️ **The trap the design names, restated as a done-criterion:** editing a citation's
`quotedAssertion` re-classes it `unanchored`, and `--update-baseline` then **refuses**. So T6
must precede a re-run of T5, and "just fix the line numbers" is the one thing that hard-blocks
the change set.

**Depends on:** T5 — the report from T5 is what names which citations moved.

### T8 — re-pin, and only now assert the check green

**Do:** run `npm run check:citation-content -- --update-baseline` a second time, then
`npm run check:citation-content`.

**Done when:** the plain check passes, **and** the known-stale count is no higher than before
this change set. This is where the criterion T5 could not carry actually belongs: it is the
first point in the order at which it can be true.

⚠️ **This node was missing from the first draft of this plan**, and its absence was caught by
the `sequencing` lens in round 1 rather than by the author. The graph without it is not merely
untidy — it is not executable, because T6 is a terminal node whose own output leaves the
repository red.

**Depends on:** T6 — regenerating before the refs are widened re-pins the wrong state.

### T7 — the two unchecked prose assertions

**Do:** append a dated line to `docs/evidence/gap-18/known-gate-flakes.md:119-124` and
`docs/verification-playbook.md:989-991`, each of which asserts the now-false "each file
carries its own private copy". Append; do not edit the sentence.

**Done when:** both documents carry a dated correction naming this change set, and the
original sentences are byte-identical.

**Depends on:** T2 — the statements become false there.

## Dependency graph, and why it is acyclic

```
T1 ──> T2 ──> T3 ──> T4
        │
        ├──> T5 ──> T6 ──> T8
        └──> T7
```

Every edge points from a task to one that strictly follows it in time, and no task appears on
both sides of any edge. A topological order exists: **T1, T2, T3, T4, T5, T6, T8, T7**.

**The edge that had to be added, and why the first draft was wrong.** The first version of
this plan ran `T5 ──> T6` and stopped, defending that shape against a cycle objection by
arguing any second regeneration was "a verification step of T6's done-criteria, not a second
node". That defence was sound about cycles and wrong about executability: a regeneration the
repository cannot go green without is a node, whatever it is called. T8 is that node, made
explicit and given its own done-criteria.

**What the correction is NOT.** There is still no cycle. `T5 → T6 → T8` is three distinct
actions in one direction: T5 reports what moved, T6 widens the refs the report names, T8
re-pins and asserts green. T8 is not "T5 again" — its done-criteria differ, and it is the only
task in the plan that may assert `check:citation-content` passes.

## What this plan does NOT do

- **No new exit criterion.** Phase 25's roster is frozen at 18; nothing here adds to it.
- **No touch of `e2e/attestation`.** The third copy stays, by owner ruling. T4 asserts it.
- **No change to `0.01`, and no change to either measurement window.** The contract's stated
  non-goals, made executable in T4 rather than left as prose.
- **No fix to the idle-budget flake.** Named a non-goal by the contract; it belongs to
  `docs/evidence/criteria-closeout/defects/05-idle-budget-arm-not-calibrated-for-its-channel.md`.
