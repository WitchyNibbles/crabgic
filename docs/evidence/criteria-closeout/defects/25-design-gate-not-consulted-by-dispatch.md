# Defect 25-design-gate-not-consulted-by-dispatch

**Phase:** 25 — Owner-pipeline conformance (`roadmap/25-owner-pipeline-conformance.md`, work item 5)

**Ruling (verbatim), `docs/design/owner-pipeline-conformance.md` §5.1:**

> **Stage 4 is the only new human act**, and it is placed _before_ dispatch, so it widens no authority
> and does not touch Gap 18's argument: standing approval still governs what may execute, and this
> gate governs what is worth executing.

**Found:** 2026-08-16, while driving the staged pipeline live under ruling R7. Not raised by any
reviewer — it fell out of `review.submit` refusing a verdict and the resulting read of the dispatch
path. Measured at `docs/evidence/phase-25/first-staged-round-live.md`, structural finding 2.

**Severity:** the ruling is implemented one layer short of where it was given. **Exit criterion 6 is
NOT violated** and is not affected by this record — it constrains what may close the `design-gate`
stage, and that constraint holds exactly as written and as tested.

**Effort: M–L, and the size depends on a product decision that is not this record's to take** — see
"Remedies" below.

## The measurement

`resolveDesignGate` and `OwnerDesignVerdict` have exactly one production reference:

| tree                         | references                                                          |
| ---------------------------- | ------------------------------------------------------------------- |
| `packages/cli/src/review/`   | `review-submit-handler.ts:659`                                      |
| `packages/cli/src/commands/` | the CLI writer (`design-verdict-handler.ts`, `dispatch.ts:110-111`) |
| `packages/cli/src/daemon/`   | **none**                                                            |
| `packages/supervisor/src/`   | **none**                                                            |

Swept over both trees, non-test files only. `packages/supervisor/src/intake/` mentions the string
"design" once, in a docblock about idempotency, and nowhere else.

So the verdict store has a writer (the CLI) and one reader (stage closure). The run path —
`crabgic run` → intake → standing-`EnvelopePolicy` containment → dispatch — neither reads the store
nor requires the `design-gate` stage to have closed.

## What is and is not true of the gate

**True, and tested:** the `design-gate` stage closes only on a recorded owner verdict;
`resolveDesignGate` REPLACES that stage's closure rule rather than being conjoined with it, so no
reviewer verdict, attestation or derivation opens a second route; the CLI is the sole writer and the
gateway deliberately exposes no tool that can record a verdict; an approval naming a different design
revision does not close it.

**Not true:** that any of the above prevents a run from dispatching. It does not, and nothing else
does either.

## Why this is worse than "the driver is only as binding as its invocation"

Ledger Gap 23 discloses that residual: a `Workflow` script the manager never calls constrains
nothing. This defect is the sharper form of it. Skipping the staged pipeline is not a manager
forgetting to call a script — **the command that starts a run has no dependency on the pipeline at
all**, so bypassing the gate is the default path rather than the negligent one. Both of this
repository's completed runs took it.

## Remedies, and the decision inside them

Three shapes, materially different in what the product then promises. This record does not choose;
it sizes them.

1. **Dispatch requires a recorded `OwnerDesignVerdict` for the change set.** Strongest, and closest
   to the ruling's words. Cost: every run now needs an owner act before dispatch, which removes the
   unattended run the standing `EnvelopePolicy` exists to enable — the two rulings then have to be
   reconciled. Effort M.
2. **Dispatch requires the `design-gate` stage to have closed**, which requires the pipeline to have
   been driven. Cost: needs the journaled stage-completion record ledger Gap 23 residual 2 already
   names as absent, because `completedStages` is caller-supplied today. Effort L.
3. **Leave dispatch alone; make the gate advisory and say so.** Cost: R2's "placed before dispatch"
   framing is withdrawn to "placed before the design stage may close", and the ruling is amended
   rather than implemented. Effort S, and it is an owner amendment rather than an engineering task.

Option 2 is the only one that also closes Gap 23's residual 2, and it is the most expensive. Option 3
is the only one that is not a code change at all.

## Corrections this record carries

Two same-day claims asserted the opposite and are struck in place rather than deleted, per this
repository's annotate-never-rewrite convention:

- `docs/evidence/phase-25/unattended-run-gap.md` — the R7 note.
- `docs/design/owner-pipeline-conformance.md` §6b — the R7 ruling block.

Both were written from the gate's own tests, which are sound about stage closure, without reading the
dispatch path. That is the error this record exists to stop being repeated: a gate's tests can be
entirely correct about what the gate decides while saying nothing about whether anything asks it.

---

## RULED 2026-08-16 (R8) — remedy 2 is chosen

**Dispatch requires the `design-gate` stage to have CLOSED.** The owner took the
most expensive of the three sized above, deliberately and on those terms. Full
wording at `docs/design/owner-pipeline-conformance.md` §6c.

**Status moves `open` -> `owner-ruled, unimplemented`.** The index row stays
`open` under that table's mechanical rule — the record still evidences no remedy
— and this section is why it is not `owner-gated`: nothing here needs an
owner-authorised run, only work.

### What the remedy now owes

1. **A journaled stage-completion record.** Production passes
   `appendEvidence: () => Promise.resolve()` for review verdicts, so a closed
   stage leaves no trace to read back. This is ledger Gap 23's disclosed residual
   2, and R8 cannot be built without discharging it.
2. **`completedStages` derived rather than caller-supplied.** `pipeline.plan`
   today refuses a completion set with a **hole** in it but cannot refuse a
   caller claiming a stage it never ran. Once stage completion is journaled, the
   plan reads it instead of trusting the argument.
3. **A dispatch-time precondition.** The run path gains a check that the
   `design-gate` stage has closed for this change set. It grants nothing and
   widens nothing — a precondition on dispatch is not a change to what may
   execute — so Gap 18's argument is untouched.

### The scope is larger than this record's title

R8 makes the run path depend on the **pipeline**, not on one gate. The whole
staged loop stops being optional, which is a bigger change than R2 alone needs.
Recorded here so that whoever implements it does not scope it down to the design
gate and believe they have finished.

### The two rejected branches, on the record

- **Dispatch requires a recorded `OwnerDesignVerdict`** — closest to R2's literal
  words, effort M. Rejected because it puts a human act in front of every run,
  which is what ledger Gap 18's standing `EnvelopePolicy` exists to remove.
- **Leave the gate advisory and amend R2** — free, and honest about what is
  built. Rejected because it accepts that an unattended run can implement a
  design the owner never saw.

---

## Implementation status — 2026-08-16

**Items 1-3 of R8 are built, tested and merged. Item 4 is scoped and NOT built.**

| #   | R8 owes                                                    | State         | Evidence                                                                     |
| --- | ---------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------- |
| 1   | a journaled stage-completion record                        | **done**      | `StageCompletionRecord` + `stage-completion-store.ts`, 27 tests              |
| 2   | `review.submit` writes it from its own closure computation | **done**      | 5 tests, incl. the negative — nothing recorded when the stage does not close |
| 3   | `completedStages` derived rather than caller-supplied      | **done**      | 6 tests; ledger Gap 23 residual 2 discharged                                 |
| 4   | the dispatch precondition                                  | **NOT BUILT** | scoped below                                                                 |

### Item 4's seam, decided and recorded so it is not re-derived

`transitionChangeSetToReady` (`packages/supervisor/src/intake/readiness-gate.ts`)
is the right place, and the reasoning is worth keeping:

- it is **the only path** from `awaiting_approval` to `ready`, and `ready` is
  what dispatch requires — so refusing here refuses dispatch;
- it leaves the **seven stop conditions unchanged in number and meaning**, which
  phase 11's own amendment requires;
- it leaves ledger Gap 18's containment check exactly as it is. A precondition on
  dispatch is not a widening of what may execute.

The shape: a `DesignGateNotClosedError` beside the existing
`UnmappedRequirementError`, and a **required** `stageCompletions` option checked
with `stageCompleted(..., "design-gate")` **before** the criteria seal — the same
ordering discipline the unmapped-requirement check already follows, so a refused
transition leaves no seal implying the run got further than it did.

Required rather than optional, for the reason the `requirements` field beside it
already records: this is the one funnel both activation paths share, and an
optional field would let a caller that forgot it produce a `ready` ChangeSet
whose design nobody approved — the defect reintroduced one layer up.

The predicate lives in `@crabgic/contracts` and the STORE lives in
`packages/cli`, because the package graph runs cli -> supervisor. So the option
is threaded by the caller rather than read in the supervisor.

### Why it is not built yet, stated plainly

The change is mechanically simple and its blast radius is not: making the field
required correctly forces **every** call site to supply it, which is about
twenty-five test fixtures plus four production threading points
(`standing-approval.ts`, `contract-approve-handler.ts`,
`complete-envelope-approval.ts`, and `bootstrap.ts`/`approve.ts` above them).

That is the right cost — an optional field would have shipped a gate that
silently does nothing — but it is a whole change set rather than a tail-end edit,
and it was stopped rather than half-landed. The work in progress is stashed on
the branch as `R8 item 4 WIP: design-gate readiness precondition`.

**The most important line in that path is `standing-approval.ts`.** That is the
Gap 18 path — the one that dispatches with no human in the sequence — and it is
therefore exactly where a design nobody approved would reach a worker. Whoever
finishes item 4 should treat that call site as the point of the exercise rather
than as one of five.

### Citation drift this change set caused, recorded rather than absorbed

R8 items 2 and 3 inserted lines into
`packages/cli/src/gateway-mcp/build-tool-registry.test.ts`, which moved text a
**merged** citation pins:

| record             | pinned span                           | before                    | after                        |
| ------------------ | ------------------------------------- | ------------------------- | ---------------------------- |
| `phase-11.json#c2` | `build-tool-registry.test.ts:177-187` | `OK@187`, `MOVED@196-197` | `MOVED@191`, `MOVED@200-201` |

The baseline was regenerated (`--update-baseline`), and the counts moved
`anchored` 2639 -> 2638 and `seededStale` 682 -> 683. **That is one new stale
entry**, and the baseline's own note is explicit that seeded stale entries "are
not licence to add more" — so it is named here rather than left to be found in a
count.

The citation's CLAIM is unaffected: the test it points at still exists, still
asserts what the record says it asserts, and moved only because a fixture field
was added above it. What is now weaker is the pointer, and the honest statement
is that this change set spent a small amount of citation precision to add a
required field to a shared test fixture.

### Item 4 was attempted twice. What the second attempt learned

The production wiring is **straightforward and was completed** in the attempt:
`readiness-gate.ts` (the error and the check), `standing-approval.ts`,
`contract-approve-handler.ts`, `complete-envelope-approval.ts`,
`run-intake-command.ts`, `real-handlers.ts`, `approve.ts`, `types.ts`,
`bootstrap.ts` and `build-tool-registry.ts` all typechecked clean. That half
took one pass and is not the problem.

**The test fixtures are, and a scripted patch cannot do them.** 49 call sites
across 9 files, and they are heterogeneous in a way a regex cannot see:

- some need `stageCompletions` (an array of records, keyed to the ChangeSet the
  test built, whose variable name differs per test);
- others need `stageCompletionsPath` (a string, on a different deps interface
  one or two layers up);
- several are nested inside helper factories rather than inline literals, so
  "insert after the opening brace following the error line" lands in a function
  signature and produces `TS1109: Expression expected`.

That is exactly what happened, and the attempt was reset rather than repaired.

**Guidance for whoever finishes it: do the fixtures by hand, file by file, and
typecheck between files.** The production half can be lifted straight from the
description above. Budget the work by the fixture count, not by the diff size of
the change that motivates it — the ratio here is roughly ten lines of behaviour
to four hundred lines of fixture, and reading it the other way is what made this
look like a tail-end edit twice.

### Third attempt — the production design is now settled, and it is SMALLER

The third attempt changed the shape of the dependency and that halved the
cascade. **The production half compiles clean; only fixtures remain.** The
design below is the one to build, and it supersedes the threading described in
the second attempt.

**Use a CLOSURE, not a path or a value.** The first two attempts threaded a
`stageCompletionsPath: string` through every deps interface, which forced a new
required field onto `IntakeDependencies`, `RunIntakeCommandDeps`,
`ContractApproveDeps` and `CompleteEnvelopeApprovalDeps` — and through them onto
every fixture that constructs any of them.

A closure shaped exactly like the `loadPolicy` field that already sits beside it:

```ts
readonly loadStageCompletions: () => Promise<readonly StageCompletionRecord[]>;
```

It reads at the moment of the decision rather than from a value captured when
the command was assembled — so a design approved while a run was being put
together counts — and, because it matches an existing field's shape, it lands
next to `loadPolicy` at every site instead of introducing a new threading
pattern.

**Measured difference:** 49 failing call sites became 24, and
`packages/cli/src/commands/types.ts` takes ONE new field instead of a path plus
its resolution.

**The full production set, all compiling:** `readiness-gate.ts` (the error, the
required option, the check before the seal), `standing-approval.ts`,
`contract-approve-handler.ts`, `complete-envelope-approval.ts`,
`run-intake-command.ts`, `real-handlers.ts`, `approve.ts`, `types.ts`,
`bootstrap.ts`, `build-tool-registry.ts`.

Note the split that falls out of it: the two paths that already resolve durable
state (`standing-approval` via `run-intake-command`, and `approve`) take the
CLOSURE; the two that are handed their inputs (`contract-approve-handler`,
`complete-envelope-approval`) take the RECORDS. Following the surrounding
convention at each site rather than imposing one shape is what kept the change
small.

**What still has to be done by hand, and why a script cannot.** The remaining
sites are test fixtures, and an anchored insertion after the existing
`loadPolicy:` line fails on a specific case worth naming: several helpers
declare `loadPolicy` as a FUNCTION PARAMETER with a type annotation
(`loadPolicy: () => LoadPolicyResult,`), which is textually identical to an
object-literal field. Inserting a field-shaped line after it produces
`loadStageCompletions: () => Promise.resolve([]),` inside a parameter list —
`TS1005`. Those helpers need the dependency threaded as a real parameter with a
default, not injected as a field.

That is the whole remaining task: roughly two dozen fixtures, a handful of which
are helper signatures rather than literals. It is an afternoon of careful,
boring work and it does not need another design pass.

---

## RESOLVED 2026-08-16 — item 4 is built

**Dispatch now requires the `design-gate` stage to have closed.** All four of
R8's work items are complete.

`transitionChangeSetToReady` — the only path from `awaiting_approval` to `ready`,
and `ready` is what dispatch requires — refuses with `DesignGateNotClosedError`
unless `stageCompleted(..., "design-gate")` holds for that ChangeSet. Checked
**before** the criteria seal, on the same ordering discipline the
unmapped-requirement check follows, so a refused transition leaves no journal
record implying the run got further than it did.

**The seven stop conditions are unchanged in number and meaning**, and ledger
Gap 18's containment check is untouched: a precondition on dispatch is not a
widening of what may execute.

### The chain, end to end

```
dispatch  ->  ready  ->  design-gate CLOSED  ->  resolveDesignGate
          ->  OwnerDesignVerdict  ->  written by the CLI alone
```

Every link is server-decided or owner-written. No gateway tool records a
verdict, so no session can open the gate for itself.

### Six tests, and the one that makes the rest mean anything

Refuses on an empty store; names the gate in the refusal so an operator knows
whether to run the design stage or approve the design; refuses a closure
belonging to a **different** ChangeSet; refuses when some **other** stage closed;
and leaves no criteria seal behind on refusal.

The sixth is the positive control — the owner's closure for THIS ChangeSet opens
it. Without that one, all five refusals would pass for a gate that can never be
opened at all.

### Both approval paths, and the shape that kept it small

| path                                   | takes         | why                                                                 |
| -------------------------------------- | ------------- | ------------------------------------------------------------------- |
| `standing-approval` (Gap 18, no human) | a **closure** | already resolves durable state; reads at the moment of the decision |
| `crabgic approve` (human)              | a **closure** | same, via `IntakeDependencies`                                      |
| `contract-approve-handler`             | **records**   | is handed its inputs                                                |
| `complete-envelope-approval`           | **records**   | a composition step, threads what it is given                        |

Following the surrounding convention at each site rather than imposing one shape
is what cut the cascade from 49 call sites to 24.

`standing-approval.ts` was the point of the exercise and it is now closed: the
path that dispatches with no human in the sequence asks the design-gate question
before it moves a ChangeSet to `ready`.

### The cost, stated because it is large

**53 citations moved from `anchored` to `seededStale`** (2638 -> 2585, 683 ->
736). Adding a required field to nine shared test fixtures shifts lines under
merged citations, and this check exists to make exactly that visible.

That is fifty-three pointers made less precise, against one for the whole of
items 1-3. The baseline's own note says seeded stale entries "are not licence to
add more", so the number is put here rather than left in a count diff. Every
claim those citations make is unaffected — the tests they point at still exist
and still assert what the records say — but a reader following one now lands
near the text rather than on it.

It was not avoidable by writing smaller insertions: the check pins exact line
positions, so any shift breaks every citation below it in the same file. The
count is a function of which files were touched, not of how many lines were
added.
