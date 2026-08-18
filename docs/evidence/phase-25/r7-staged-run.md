# The full staged run — owner ruling R7

**2026-08-17.** Change set `7d3f8a21-6c94-4e5b-a83f-2b410d97e6c5`, driven through the
shipped pipeline surface. Authorized by owner ruling **R7**
(`docs/design/owner-pipeline-conformance.md` §6b): one change set, small, through
every stage.

**The subject.** Collapse the duplicated `CPU_BUDGET_FRACTION` threshold in
`packages/supervisor/src/idle-budget/` into one exported constant. It is
precondition 0 of
`docs/evidence/criteria-closeout/defects/05-idle-budget-arm-not-calibrated-for-its-channel.md`,
sized **S** by that record and marked ticket-ready. Chosen because it is real,
small, confined to `packages` (inside the standing envelope), and leaves the
suite green — the properties a first full run needs.

---

## 1. THE HEADLINE: the run path now depends on the pipeline

The previous round's second structural finding
(`first-staged-round-live.md`) was that **the design gate could not stop a run**:
`resolveDesignGate` had zero references anywhere in `packages/cli/src/daemon/` or
`packages/supervisor/src/`, so `crabgic run` dispatched without consulting it.
That was the sharpest statement of ledger Gap 23's residual 1 — skipping the
pipeline was not a manager forgetting to call a script, it was the default
behaviour of the command that starts a run.

Ruling **R8** was made to close it, and PR #143 built it. This is the first time
it has been exercised by the real CLI on a real intake:

```
$ crabgic run --json < r7-intake.json
intake: cannot transition to ready — the design-gate stage has not closed for
ChangeSet 7d3f8a21-6c94-4e5b-a83f-2b410d97e6c5. Run the pipeline's design stage
and record the owner's answer with `crabgic design approve`.
```

**Measured, not inferred.** The refusal names the change set, names the stage
that has not closed, and names the command that closes it. Nothing dispatched.

Two things this establishes that no test could:

- **The dependency is real in the shipped binary**, not only in a suite. The
  command a human actually types now refuses.
- **The ChangeSet still exists afterwards**, at `awaiting_approval`, with its
  work unit — verified by reading `change-sets.json` and `work-units.json`
  directly. That matters because the review stages cannot record a verdict for a
  change set that does not exist, which was the previous round's FIRST structural
  finding. Intake-then-review is now a workable order, and R8 makes it the only
  one.

## 2. The previous round's first structural finding is resolved

`review.submit` refused with `unknown ChangeSet` when the pipeline was driven
against a change set intake had never created. This run does intake FIRST, so the
change set exists before any verdict is submitted. The finding was never a defect
in `review.submit` — it was an unstated ordering. R8 now states it, and enforces
it from the other end.

## 3. Stage 1 of 9 — `research`

`pipeline.plan` with an empty completion set returned `research`, three lenses
(`completeness`, `source-quality`, `assumption-audit`), a shared three-criterion
obligation checklist, `roundBudget: 20`, `ownerGated: false` — each lens carrying
`reviewer: "eo-reviewer"`.

**The artifact.** `docs/evidence/phase-25/r7-research-record.md`, produced by
`eo-researcher` against the seven questions the contract depends on.

**Its citations were verified by hand before it was accepted**, because the
previous round failed a research record for citations that did not resolve. Six
were re-opened independently — `e2e/attestation/src/performanceContracts.ts:90-91`,
`packages/supervisor/src/runtime/xdg-supervisor-layout.ts:35,38`,
`roadmap/05-supervisor-daemon.md:25`, `docs/verification-playbook.md:991`,
`packages/supervisor/src/runtime/runtime-dir.test.ts:11`,
`packages/supervisor/src/index.ts:79-81` — and every one resolved to the quoted
token.

**A finding the research produced, worth more than the change set.** The record
found a **THIRD** live copy of the same 0.01 threshold, under a different name, in
a different package:
`e2e/attestation/src/performanceContracts.ts:91`'s
`SUPERVISOR_IDLE_CPU_FRACTION_BUDGET`, asserted against at
`performanceContracts.test.ts:118`. The defect record's precondition 0 says
"apply it to BOTH sites"; there are three. The record surfaces it as a fact and
explicitly declines to rule on scope, which is the correct division — a research
record that decided scope would be making the design decision it exists to inform.

**The stage was driven through `crabgic-stage-loop`**, the workflow the previous
round could not exercise ("the lenses were dispatched by the manager, not by
`crabgic-stage-loop` … the script's own fan-out is still unexercised in a real
round").

### 3a. ⚠️ The loop could not dispatch a round — in any environment

The first invocation escalated with **0 of 3 lenses submitted**. `stage-loop.mjs`
dispatched an AGENT and asked it to run the sibling `crabgic-stage-round` workflow; a
subagent has no workflow runtime, so the instruction could not be carried out anywhere.
The loop had shipped, installed, and been byte-identical in the plugin cache in a state
where it could never run a single round.

Root cause isolated by probe, from a workflow script body:

| call                                               | result                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------- |
| `workflow("crabgic-stage-round", …)`               | **THREW** — "no workflow with that name. Available: deep-research, code-review" |
| `workflow({ scriptPath: "…/stage-round.mjs" }, …)` | **RESOLVED**                                                                    |

So the composition is supported, but only from the script, by path — a plugin workflow is
not in the name registry anywhere. Scripts compose workflows; agents make tool calls, and
the two responsibilities were the wrong way round.

⚠️ **The dispatched agent behaved correctly**: it refused to fabricate verdicts, refused
to review the artifact itself, and refused to hand-roll the fan-out — naming, as its
reason, that doing so would re-plant the lens-to-reviewer routing that commit `0e4512b`
had just consolidated. The loop failed safe. It still failed.

Defect `25-stage-loop-cannot-dispatch-a-round.md`. Fixed, with the first test this script
has ever had (`packages/plugin/src/stage-loop-workflow.test.ts`), whose assertions were
verified to FAIL against `git show HEAD:…/stage-loop.mjs` before being accepted — one of
them was vacuous on the first draft and was corrected.

### 3b. ⚠️ `review.submit` demanded a design and a plan the research stage cannot have

With the loop fixed, three real reviewers produced three real verdicts — and none could
be recorded. Two declarations of one tool disagreed:

| declaration                                                                     | says                                            |
| ------------------------------------------------------------------------------- | ----------------------------------------------- |
| `packages/cli/src/review/tool-definitions.ts:115` — the PUBLISHED descriptor    | `required: ["stage", "changeSetId", "verdict"]` |
| `packages/cli/src/gateway-mcp/build-tool-registry.ts` — the VALIDATED zod shape | `design: z.unknown()`, `plan: z.unknown()`      |

Under zod 4 a bare `z.unknown()` is required **as an object member**, so the SDK derived
`design`/`plan` as required while the descriptor said otherwise. Reproduced directly:
`z.object({a: z.unknown()}).safeParse({})` fails; `z.unknown().safeParse(undefined)`
succeeds. Every caller obeying the published contract was refused.

Passing `null` is worse, not better: the handler PERSISTS a supplied design as the design
of record, so a placeholder invented to clear a schema check would become the artifact the
later `design` and `plan` stages are judged against. **The agent refused to fabricate
one**, and named that consequence as its reason.

⚠️ This is the same defect class as `WorkerAuthoredResultSchema`'s own docblock records
one surface over — a published contract and an enforced contract disagreeing, with every
obedient caller rejected. Both were found by a real run and by nothing else.

Defect `25-review-submit-requires-a-design-it-cannot-have.md`. Fixed, plus a conformance
test that derives both required sets and compares them, verified to fail against the
pre-fix shape (`buggy: ["changeSetId","design","plan","stage","verdict"]` versus
`descriptor: ["changeSetId","stage","verdict"]`).

### 3c. The reviewers found real defects in the artifact

Round 1's three lenses, once they could run:

| lens               | verdict     | finding                                                                                                                                                  |
| ------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source-quality`   | **approve** | opened all twelve cited paths; every quote verbatim-accurate                                                                                             |
| `assumption-audit` | **revise**  | ⚠️ blocking — the record asserts what the defect record says TWICE with no in-document citation, while its own Assumptions section claims total coverage |
| `completeness`     | **revise**  | ⚠️ blocking — q2 is answered with no `Citations:` block, unlike every sibling question                                                                   |

Both blocking findings are correct, and I wrote the artifact they are about. The
`completeness` finding cites `research-record.ts:130`'s `isSilentlyAssumed` to show that
an answered, uncited question does not merely fail one obligation — it CONTRADICTS the
"no silent assumptions" claim the record makes about itself. `assumption-audit`
independently verified the underlying claim TRUE before classifying it, so it reported a
sourcing gap rather than a factual error.

Both were fixed in the artifact and the stage re-run.

### 3d. The loop converged; the surface could not record that it had

With the first three defects fixed, four rounds ran against one artifact through the real
loop. The reviewers converged:

| round | `completeness`       | `source-quality`     | `assumption-audit`  | lenses recorded                |
| ----- | -------------------- | -------------------- | ------------------- | ------------------------------ |
| 1     | revise (1 blocking)  | approve              | revise (1 blocking) | 0 — `review.submit` uncallable |
| 2     | **approve**          | approve              | revise (1 blocking) | 3                              |
| 3     | approve              | approve (0 findings) | revise (1 blocking) | 3                              |
| 4     | approve (0 findings) | approve (0 findings) | revise (1 blocking) | 2 — the third refused          |

> **CORRECTED 2026-08-18**, when the two long-running loop invocations finally returned.
> The table above was written from a PARTIAL view — the rounds visible while the runs were
> still going. The complete record is that **each of the two invocations ran NINE rounds**,
> and every one of the eighteen reported the identical closure reason:
> `an obligation went unanswered: research-no-silent-assumptions, research-prior-art-checked`,
> with `lensesSubmitted: 3` throughout.
>
> That is stronger evidence for the section below than the four rounds originally recorded,
> and in the same direction: nine rounds of genuine review, on an artifact that was
> demonstrably improving, could not move the closure decision by one criterion. Neither run
> reached the runaway guard of 20 — one stopped on the integrity escalation in §3f, the
> other on the same wall of undispositioned findings.

**Every blocking finding was correct, and all four were about an artifact I wrote:**

1. the record asserts what the defect record says, twice, with no in-document citation,
   while its own Assumptions section claims total coverage;
2. q2 is answered with no `Citations:` block, unlike every sibling question — cited against
   `research-record.ts:130`'s `isSilentlyAssumed`, which makes an answered uncited question
   CONTRADICT the no-silent-assumptions claim rather than merely fail it;
3. q3's "ruled out as unrelated" list presents itself as complete and omits a fourth `0.01`
   occurrence — verified independently: 8 tracked files carry it, the record accounted for 7;
4. q3's "Judgement, not fact" paragraph describes what a module doc says without citing it.

Each was fixed and the next round confirmed the fix. That is the review pipeline doing
exactly what it exists to do, on a real document, four times.

### 3e. ⚠️ And the stage still cannot close — the fifth defect

After round 3 the server reported `openBlocking: 3`, `undispositioned: 6`, and "2
attestations voided by prior blocking findings". Three of those findings were from rounds
whose defects had already been repaired.

`stage-loop.mjs` has no step that DISPOSES of a finding. The manager protocol requires
every finding to get one (`fixed`, `refuted`, `accepted-debt`) and forbids a stage
advancing while holding an undispositioned one; `review.submit` enforces it. So findings
accumulate monotonically, and **a stage that has ever raised one finding can never close
through this loop, however completely the artifact is fixed.**

That is filed as `25-stage-loop-never-disposes-a-finding.md` and deliberately NOT patched:
who may assert a disposition, on what evidence, and against which open set are design
questions, and the obvious shortcut — having the submitting agent mark everything `fixed` —
would manufacture the caller-grades-its-own-work property the entire review surface exists
to deny.

---

## 4. What R7 established, and what it did not

**Established:**

- ⚠️ **R8 binds in the shipped binary.** `crabgic run` refuses to reach `ready` until the
  design gate closes, naming the change set, the stage and the command. The previous
  round's central structural finding is closed.
- **Intake-then-review is a workable order**, closing the previous round's other structural
  finding.
- **The loop genuinely dispatches, reviews, submits and has closure computed server-side** —
  none of which had ever happened before this run.
- **Reviewers find real defects in real artifacts and converge**, four for four.
- **Five blocking product defects**, four of them fixed here with tests, all five found by
  running the thing rather than by reading it.

**NOT established, and stated plainly:**

- **No stage closed.** Defect 5 is why, and it is a design question rather than a patch.
- **Eight stages of nine never ran.** `clarify`, `design`, `design-gate`, `plan`,
  `implement`, `integrate`, `audit` and `document` remain unrun, as they were before.
- **The two owner-gated stages were never reached**, so R7's "one human act inside an
  otherwise autonomous run" is still unmeasured. It could not have completed autonomously
  in any case: `clarify` and `design-gate` close on the owner by design.
- **No engine worker was dispatched**, so R5's publish refusal and R6's changed-line gate
  are untouched by this run.

R7's grant of engine spend is **not exhausted** — what stopped the run was five defects and
one design question, not budget.

### 3f. A submitting agent refused a payload it could not attribute

One of the two concurrent loop invocations stopped itself, and its reason is worth
recording verbatim because the behaviour is the one this pipeline is built to produce:

> while I was preparing the submission, my scratchpad copy of the three verdicts was
> rewritten by a writer that is not me, with materially different content … I did NOT
> submit the rewritten content — I submitted the three verdicts verbatim from the
> dispatching task message. A human should determine who rewrote … since the two differ on
> whether this stage should close.

**Investigated, and it was this operator's own concurrency.** Two stage-loop runs were in
flight at once (`wf_a5bb520b-f17`, 44 agents, and `wf_88fa5aa6-73c`, 43 agents, ending 37
seconds apart) and both staged their verdicts at the same un-namespaced scratchpad
`verdicts.json`. Two files survive with different mtimes. Same session, same uid, no
boundary crossed — **not an intrusion and not a security finding**, and the agent's own
report is careful to attribute the escalation to itself rather than to the server: "NOT the
server's escalate — the server returned escalate=false."

⚠️ It is filed as a defect anyway (`25-stage-loop-runs-share-one-scratchpad.md`) because in
THIS pipeline a path collision is a correctness hazard rather than a nuisance: the colliding
payload was a set of review verdicts that disagreed about whether a stage should close, and
the collision was silent. What stopped it being a corrupt review record was an agent
noticing, refusing, and escalating — which is not a control, it is luck with good manners.

### 3g. ⚠️ THE DECISIVE MEASUREMENT — twenty rounds, and the guard fired

The second loop invocation (`wf_88fa5aa6-73c`) returned on 2026-08-18 after **10,576
seconds and 94 agents**. It ran to the runaway guard:

```
roundsRun: 20
stalled  : true
reason   : "the runaway guard stopped this loop at round 20; it did not converge,
            and these stand: an obligation went unanswered:
            research-no-silent-assumptions, research-prior-art-checked"
```

**CORRECTION, and it is the second time this document has published a round count from
partial data — recorded rather than quietly amended.** §3e's correction said "each of the
two invocations ran NINE rounds". That was true of `wf_a5bb520b-f17` and false of this one.
The complete record is **9 rounds and 20 rounds**. Both corrections were written while a
run was still in flight; the lesson is that a round count is not a measurement until the
run returns.

**Why this settles defect `25-stage-loop-never-disposes-a-finding.md`.** The server's own
accounting, from the loop's own report:

| round | openBlocking | undispositioned |
| ----- | ------------ | --------------- |
| 1     | 3            | 6               |
| 19    | **19**       | **24**          |

The findings grew monotonically for twenty rounds. And the two blockers voiding the
attestations at round 19 — `b6056996-4b61-437d-bfd8-e6c6f1d02f17` and
`50a1ab27-ef8d-468b-9245-8921d1701640` — are **the same two named at round 1**. Twenty
rounds of real review, on an artifact that measurably improved, could not resolve the two
findings raised before any of it started, because nothing in the loop can dispose of one.

Two things the loop got exactly right while failing:

- it reported the guard as a **STALL**, never as a closed stage — "reaching the guard is a
  STALL, not a close … the syntactic kill-switch wearing a verdict's clothes";
- rounds 8 and 17 show the server distinguishing the accumulated backlog from that round's
  own work: "1 admissible finding(s) have no disposition … ; 1 admissible novel finding(s)
  this round". The review surface was measuring correctly throughout. Only the loop could
  not act on it.

**Round 1 also carried the `violates` refusal in the wild** — "that lens was not journaled
because its blocking finding carries no `violates` field, **and I did not invent one**" —
which is defect `25-blocking-finding-needs-violates.md`, met by an agent that refused to
manufacture the missing field to get past a validator.

---

## 5. STAGE 1 CLOSED — 2026-08-18

After the disposition step landed, the `research` stage **closed**, and the pipeline
advanced. This is the first stage crabgic has ever closed through its own surface.

```
LENS assumption-audit -> revise (1 finding)
LENS completeness     -> approve (0 findings)
LENS source-quality   -> revise (1 finding)
SUBMIT   closable=false  lenses=3  openFindings=26
DISPOSE  disposed=26     leftOpen=0
         -> ok=true, openBlocking=0, undispositioned=0, stageClosable=true
```

**One more defect had to be fixed first, and it was created by fixing the last one.**
`PLAN_SCHEMA` declared each lens as `{lens, obligations}` and a structured-output schema
DROPS every property it does not name — so the server's per-lens `reviewer` was stripped
out of the plan before `crabgic-stage-round` saw it, and every lens was refused with
"carries no reviewer — pipeline.plan is older than this workflow". The server was not old;
the schema was lossy. It stayed invisible while the loop could not pass its own plan
through; fixing the dispatch is what surfaced it
(`25-plan-schema-strips-the-lens-reviewer.md`).

### The disposition was checked rather than believed

⚠️ **26 of 26 disposed `fixed`, 0 left open, is exactly the shape the anti-sycophancy guard
exists to catch**, so it was verified independently rather than accepted:

| the disposer claimed                                        | checked by                                | result                                                    |
| ----------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------- |
| it made real edits this round                               | `git diff` on the artifact                | **64 insertions, 10 deletions** of substantive correction |
| `SUPERVISOR_IDLE_CPU_FRACTION_BUDGET` has 7 hits in 2 files | `grep -rn`                                | **exactly 7, exactly 2**                                  |
| the directory holds 5 files, 3 of them tests                | `ls`                                      | **exact**                                                 |
| the stage may now close                                     | `pipeline.plan` with `research` completed | **advanced to `clarify`**                                 |

Its own reasoning was the right shape too: it reported that "the 26 findings collapse to 7
distinct defects; 22 of them are near-duplicate restatements of three", said it "re-ran
every search the record claims" rather than trusting a prior round's note, and named the
four findings that required real edits this round.

One of those edits is worth quoting, because it is the kind a padding pass never makes:
q3 called the third declaration a "private copy", and the disposer corrected it because
**the record's own quoted citation shows `export const`** — a self-contradiction between a
claim and the evidence cited for it, in a document that had already survived four review
rounds.

## 6. The run is now at the FIRST OWNER GATE

```
pipeline.plan(completedStages: ["research"])
  -> stage: "clarify", ownerGated: true, roundBudget: 1, lenses: []
```

`roundBudget: 1` with no lenses is the machine-readable form of "no review round can close
this; a human does". The loop returns immediately for such a stage rather than looping on a
person, which is `stage-loop.mjs`'s own documented behaviour.

**This is where R7 stops without the owner**, and it stops here by design rather than by
defect: `clarify` and `design-gate` are the two stages the ruling itself calls "the one
human act inside an otherwise autonomous run".
