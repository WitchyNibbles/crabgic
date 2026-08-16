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
