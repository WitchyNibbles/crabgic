# 25 — the stage loop never disposes of a finding, so a stage that ever had one can never close

**Phase:** 25. Surface: `packages/plugin/workflows/stage-loop.mjs`.

**Found:** 2026-08-17, owner ruling **R7**'s staged run, after four rounds on one artifact.

**Severity: blocking, and architectural** — unlike the three defects fixed alongside it,
this is a missing capability rather than a wrong line. Recorded rather than patched.

## What the measurement shows

Four rounds ran against one research record. Each round the artifact was genuinely
improved and the reviewers genuinely converged — `completeness` went `revise` -> `approve`,
`source-quality` held `approve` with zero findings by round 3. The server's own accounting
after round 3:

```
stageClosable : false
openBlocking  : 3
undispositioned: 6
unmetCriteria : [research-no-silent-assumptions, research-prior-art-checked]
"2 attestations voided by prior blocking findings b6056996 and 50a1ab27"
```

**Six undispositioned findings, three of them from rounds that had already been fixed.**

## Root cause

The manager protocol states the rule plainly: "Every finding gets a disposition (`fixed`,
`refuted`, `accepted-debt`) whatever its severity, and a stage **may not advance** holding
one without". `review.submit` enforces it — an undispositioned admissible finding blocks
closure at any severity, and a prior blocking finding VOIDS an attestation for the
criterion it names.

`stage-loop.mjs` has no step that disposes of anything. It plans, dispatches, submits, and
repeats. So findings accumulate monotonically across rounds, and every round after the
first inherits every earlier round's findings still open.

⚠️ **The consequence is exact: a stage that has ever raised one finding can never close
through this loop, no matter how completely the artifact is fixed.** Round 4's reviewers
found the round-1 and round-2 defects genuinely repaired — and the stage stayed open on
the records of those very repairs.

## Why this is not the same defect as the other three

The other three were surfaces disagreeing with each other, each fixable in a line or two.
This one is a capability the loop was specified to have and does not:

- **who decides a disposition.** A reviewer that disposed of its own finding would be
  grading its own work. The producer that fixed the artifact is the natural asserter, and
  it needs evidence — `review.submit` "rejects … a disposition with no evidence".
- **when.** After the artifact is amended and before the next round is submitted, or the
  next round re-raises what was already fixed.
- **against what.** Findings are identified server-side by a novelty key; the loop never
  reads back the open set, so today it does not even know what is outstanding.

None of those are decidable from inside a dispatch loop without a design ruling, which is
why this is filed rather than fixed. Papering over it — for instance by having the
submitting agent mark everything `fixed` — would manufacture exactly the caller-grades-its-
own-work property the whole review surface exists to deny.

## Remedy — sized, not chosen

1. **A disposition step in the loop, fed by the producer.** After the artifact is amended,
   the producer reports which findings its amendment addresses and with what evidence; the
   loop submits those dispositions before the next round. **Effort: M.** Needs a read-back
   of the open finding set, which no tool currently exposes to the loop.
2. **A `review.dispositions` read surface**, so the loop can enumerate what is open rather
   than inferring it from the last round it happened to see. **Effort: S**, and a
   precondition on option 1 being honest rather than guesswork.

**Ticket-ready:** yes, as a design question rather than a patch.

## Not claimed

- **Not claimed** that the server's rule is wrong. "A stage may not advance holding an
  undispositioned finding" is the rule that stops a stage closing over its own open
  problems, and R4's amendment strengthened it deliberately.
- **Not claimed** that the loop converges badly. It converged well — the artifact improved
  every round and two of three lenses reached zero findings. What it cannot do is record
  that the improvements happened.
- **Not claimed** that any stage previously closed while holding findings. No stage had
  ever closed through this loop at all.

## Remediated 2026-08-18 — PR #149

The loop gained a disposition step, dispatched separately from the review and the submit,
running only while the stage is still open. It reads the open set from the SERVER's
findings rather than from its own memory of the round, offers all three dispositions,
requires `dispositionEvidence` with each, reuses the original finding id, and is told it
MAY refuse — a finding it cannot verify is left open, which holds the stage open.

**Pinned by** `packages/plugin/src/stage-loop-workflow.test.ts`, under
`describe("the disposition step (defect 25-stage-loop-never-disposes-a-finding)")` — eight
assertions, including
`it("tells the disposer it may refuse, and that refusing holds the stage open")`, which is
what stops this remedy from becoming a self-clearing loop.

⚠️ **Corrected on the record.** This defect was first filed as "needs an owner ruling on
the disposition mechanism". That was wrong: `review.submit`'s handler already documents
that this round's version of a finding supersedes the recorded one, and its response
already returns the finding set with ids. It was a build task, and building it is what
closed the first stage.

📎 The measurement that made this decisive: the last loop before the fix ran to the runaway
guard at **20 rounds**; `openBlocking` grew 3 -> 19, `undispositioned` 6 -> 24, and the two
blockers voiding the attestations at round 19 were the SAME two raised at round 1.
