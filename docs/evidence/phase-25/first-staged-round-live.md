# The first staged review round driven through the shipped surface

**2026-08-16**, change set `5a1e0c30-7b21-4a44-9c10-2f7d4e9b8c01`, stage
`research`, round 1. Authorized by owner ruling **R7**
(`docs/design/owner-pipeline-conformance.md` §6b).

**What is new here.** `pipeline-plan-live.md` measured the DECIDING half — the
server issuing nine stages in order with their lens rosters. This is the first
time reviewers have actually ANSWERED a round issued by that surface, and the
first time the amended closure rule has been evaluated against a real artifact
rather than a fixture.

## The round, measured

`pipeline.plan` with an empty completion set returned stage `research`, three
lenses, a shared obligation checklist of three criteria, `roundBudget: 20`,
`ownerGated: false`. Every lens carried `reviewer: "eo-reviewer"` — the per-lens
routing PR #140 added, working on the wire.

| lens               | verdict     | findings   |
| ------------------ | ----------- | ---------- |
| `completeness`     | **revise**  | 1 blocking |
| `source-quality`   | **approve** | 2 advisory |
| `assumption-audit` | **approve** | 2 advisory |

**Five novel admissible findings. The stage does not close.**

### R4's clause fired, live, for the first time

Two of three lenses returned `approve` — and the stage stays open anyway,
because they raised novel admissible findings. Under the superseded progress
rule this round would have closed the stage: it closed no blocking finding, and
two reviewers said approve.

That is the owner's "no issues, warnings, or buts" clause working against a real
artifact rather than a fixture, and it is the first measurement of it.

### The blocking finding, verified before it was accepted

`completeness` found that the research record recommends `install.ts`'s
unconditional `writeInstallState` as the pattern to follow, without asking
whether that write is crash-safe to graft onto a branch that today performs
**zero** writes.

Verified by reading, not by second opinion:

- `state-store.ts:66-70` — `writeInstallState` calls `writeFile` directly.
- `state-store.ts:148-154` — `atomicWriteFile`, in the **same file**, does
  write-then-rename "so a mid-write kill never leaves a torn/partial artifact".
- `state-store.ts:55-63` — `readInstallState` catches only `ENOENT`. A truncated
  file throws out of `JSON.parse`, uncaught, through every doctor check.

The up-to-date branch is the most common `upgrade` invocation. A repair attempt
would have been spent on a fix that introduced a worse defect than the one it
closed — caught before a line was written.

### The advisories are citation defects, not taste

Both `approve` lenses attacked the citations by opening them:

- `checksum-drift.ts:22-33` is cited for a claim about `installedChecksum`; the
  token is not in that range. The real read is `drift-detector.ts:50`, never
  cited.
- `CLAUDE.md:1` is cited for "is git-tracked" — that line shows file content,
  not index membership.
- `q4` states a design judgement ("restamping is consistent with established
  semantics") as settled fact.
- `q2`'s live-repo citation proves ordinary drift exists, not specifically the
  `unchanged`-classification hole it is offered for.

Every claim is _true_; the citations do not establish them. Both lenses also
independently re-ran the record's two universal negatives — no reader of
`installedAt`, no existing reconcile helper — and confirmed both, so
`assumptions: []` survived that attack on its own terms.

## Two structural findings the round surfaced

These are about the product, not about the artifact under review, and neither
was raised by a reviewer — both fell out of driving the surface.

### 1. `review.submit` cannot record a verdict before intake

```
review.submit(stage: "research", changeSetId: "5a1e0c30-…")
  -> {"error":"unknown ChangeSet \"5a1e0c30-…\""}
```

`pipeline.plan` will issue a plan for a change set that does not exist;
`review.submit` refuses to record the answer. So the pre-implementation stages
have a surface that plans work whose result cannot be stored until a ChangeSet
has been created by intake.

That is not obviously wrong — intake creates the ChangeSet in `draft`, so the
intended order may be intake-first — but nothing states it, `pipeline.plan` does
not enforce it, and the failure arrives as an opaque refusal at the moment a
reviewer's work is ready to be recorded. Named here rather than left for the
next caller to rediscover.

### 2. The design gate cannot stop a run

**`resolveDesignGate` and `OwnerDesignVerdict` appear nowhere in
`packages/cli/src/daemon/` or `packages/supervisor/src/`** — the entire run
path. Measured by grep over both trees, non-test files only. The only production
reference is `review-submit-handler.ts:659`.

So the gate decides whether the `design-gate` **review stage** may close.
Nothing in `crabgic run` → intake → standing-policy containment → dispatch
requires that stage to have closed, or consults the verdict store at all.

Ruling R2 says the gate "precedes dispatch". In the shipped product it precedes
only the closure of a review stage that the dispatch path has no dependency on.
The gate's enforcement is real and strong **within the review pipeline** —
CLI-only writer, no gateway tool can record a verdict, `resolveDesignGate`
replaces rather than conjoins the closure rule — and all of that is orthogonal
to whether a run dispatches.

This sharpens ledger Gap 23's disclosed residual 1. That residual says the
driver is only as binding as its invocation. The stronger statement is that the
**run path has no dependency on the pipeline at all**, so skipping the pipeline
is not a manager forgetting to call a script — it is the default behaviour of
the command that starts a run.

**Correction, recorded because it was written the same day.**
`unattended-run-gap.md`'s R7 note claims "the design gate will stop and wait, by
construction … this run cannot complete without the owner answering exactly
once." That is **false** and is corrected in place. It was written from the
gate's own tests, which prove what they claim about stage closure, and not from
the dispatch path.

### 3. `PIPELINE_STAGES` names two different things

| declaration                            | meaning                                          |
| -------------------------------------- | ------------------------------------------------ |
| `@crabgic/contracts`                   | the **nine** review stages                       |
| `run-dispatcher.ts:372` (module-local) | the **three** non-absorbing run-lifecycle states |

Both are correct in their own file and the local one is documented. But the
collision sits on the exact identifier ledger Gap 23 part 1 is about — "the
roster is data" — and a reader who greps the name to find the roster finds a
list of run states instead.

## What this round does NOT establish

- **No verdict was recorded.** The server refused for want of a ChangeSet, so
  closure was never computed by `review.submit`. The five findings are recorded
  here, in a document, which is exactly the weaker form this pipeline exists to
  replace.
- **One stage of nine.** `clarify`, `design`, `design-gate`, `plan`,
  `implement`, `integrate`, `audit` and `document` remain unrun.
- **No convergence measurement.** One round. Ledger Gap 19's residual is
  untouched by this.
- **The lenses were dispatched by the manager, not by `crabgic-stage-loop`.**
  The workflow exists and is installed; this round did not use it, so the
  script's own fan-out is still unexercised in a real round.
