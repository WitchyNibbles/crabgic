# Staged review pipeline — design

**Status:** ruled and amended. §7's four questions were answered by the owner
2026-07-29, and the coordinated amendment §6 called for is **made**: ledger Gap
19 parts 3–4, `docs/claude-code-adaptation.md` §0 amendment 4, and the four
phases the gap names (`roadmap/10, 11, 13, 14`).

**The code has not caught up.** `packages/plugin/src/manager-protocol.ts` and
`packages/plugin/skills/protocol/SKILL.md` still render the superseded loop —
"no severity floor", "keep going until a round finds nothing new" — and
`packages/plugin/agents/eo-roaster.md` still forbids approval. Until those land,
the shipped protocol text and the ledger disagree, and the ledger is the
authority. §8 lists what is still unanswered.

Written 2026-07-29 against `feat/conversation-first-orchestration` @ `5d17113`.

**Supersedes:** nothing yet. Proposes an amendment to interface-ledger **Gap 19**
part 4 and to `docs/claude-code-adaptation.md` §0's 2026-07-28 amendment 4. Both
are owner-approved rulings; neither may be changed without an explicit ruling,
which this document exists to request.

---

## 1. Why this exists

The owner directed (2026-07-29) that the quality loop become a **staged
pipeline of specialised agents**: a worker produces an artifact, a reviewer (or
a panel of them) checks it, feedback loops until the reviewer agrees, and the
same pattern repeats for every stage — research, clarification, design,
planning, implementation.

That directive is compatible with today's architecture. The blocker is that
today's loop **does not terminate**, and running the owner's pipeline on top of
a non-terminating loop primitive would produce N non-terminating loops instead
of one.

## 2. Evidence — what rounds 21–32 actually measured

Gap 19 recorded a **disclosed residual risk**:

> termination rests entirely on the falsifiability test being applied strictly.
> If a reviewer's "concrete failure scenario" is accepted loosely, every round
> produces a novel-looking finding and the loop does not converge.

Rounds 21–32 are the experiment that risk called for. The result is **more
useful than the risk anticipated**, and it does not vindicate the loose-test
hypothesis:

| observation                                   | measurement                                                                                                    |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Rounds run on one subsystem                   | **12** (rounds 21–32, `sandbox-selftest` → state-file handling)                                                |
| Findings accepted loosely                     | **none** — every one carried an executed reproduction                                                          |
| Findings that were real                       | **all of them**, including two arbitrary-file-overwrite primitives and an unkillable hang                      |
| Rounds that found nothing novel + falsifiable | **zero**                                                                                                       |
| Severity trend                                | round 30 needed **no attacker foothold**; round 32 needed **write access to a 0700 directory the victim owns** |

**The falsifiability test was applied strictly and the loop still did not
converge.** That is the finding. Novelty and falsifiability successfully exclude
_manufactured_ findings — Gap 19's rationale is correct on its own terms — but
they do not bound the supply of _genuine_ ones. A non-trivial codebase contains
an effectively inexhaustible number of true, novel, reproducible defects of
declining severity.

So the termination criterion measures **reviewer exhaustion**, not artifact
quality. Those are different quantities, and only one of them is finite.

### 2.1 The structural half

Three artefacts make non-termination explicit rather than emergent:

| location                                | text                                                                                                         | consequence                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `packages/plugin/agents/eo-roaster.md`  | "Refute the artifact. **Do not approve it.** A round that returns 'looks good' has told the manager nothing" | the reviewer has no vocabulary for _done_                            |
| `manager-protocol.ts` (roast paragraph) | "**No severity floor**"                                                                                      | a cosmetic defect and a data-loss defect extend the loop identically |
| ledger Gap 19 part 3                    | "The loop is **unbounded in rounds**"                                                                        | no budget, so no escalation path                                     |

By contrast the **clarify loop terminates correctly today**, and its exit
condition is the model to copy: _every one of the nine `CONTRACT_SECTIONS` is
answerable_. A checkable oracle external to the reviewer's opinion.

## 3. What the external record says

- Fixed iteration caps are **"syntactic kill-switches"**, blind to whether the
  artifact is still improving — they overspend on easy work and truncate hard
  work. (arXiv 2606.27009, _Semantic Early-Stopping for Iterative LLM Agent Loops_)
- **Tool-grounded critique consistently outperforms pure self-critique** — a
  test suite, linter or type-checker as the critic's evidence source beats an
  LLM's opinion.
- A judge **without a calibrated threshold is decorative**; rubrics need
  weighted dimensions and an explicit pass/fail line.
- Reviewers exhibit **verbosity bias**: more critique reads as better critique,
  which is precisely the pressure an "always refute" instruction amplifies.

## 4. Design

### 4.1 The rule that makes it terminate

> **A stage advances when (a) every one of its written exit criteria is met,
> (b) no open finding is classified `blocking`, and (c) every finding raised has
> a recorded disposition.**

Termination is decided by **the artifact against its criteria**, never by
whether a reviewer ran out of ideas.

### 4.2 The rule that stops anything being swept away

The owner's constraint on the severity floor is explicit: _findings must be
checked; it does not work for known issues to be passed unvalidated or
unhandled._ The floor therefore gates **the loop**, not **the ledger**.

Every finding, whatever its severity, walks the same path:

```
raised → verified → classified → dispositioned → reported
```

- **verified** — `confirmed` | `refuted` | `unverified`. A finding is verified by
  execution, not by a second opinion. `refuted` requires the counter-evidence.
- **classified** — `blocking` only if it names **the specific exit criterion it
  violates**. A finding that violates no stated criterion cannot block. It is
  still real, still recorded, still dispositioned.
- **dispositioned** — `fixed` | `refuted` | `accepted-debt`. **This field can
  never be empty**, and `accepted-debt` requires a reason and surfaces in the
  owner-facing report for that change set.

A stage may not advance with an _undispositioned_ finding of any severity. What
the floor changes is only whether a finding forces **another round** — not
whether it gets looked at.

This is the reconciliation with Gap 19's stated reason for rejecting a floor
("a genuine minor defect is still a defect"). Under this design a genuine minor
defect is still recorded, still verified, still answered, and still shown to the
owner. It simply does not hold the pipeline open indefinitely.

### 4.3 Deterministic gates decide first

Any property a gate can decide is **decided by the gate**, and a reviewer may
not raise findings in gate territory.

| question                                                 | decided by                                       |
| -------------------------------------------------------- | ------------------------------------------------ |
| Is it correct? Does it build, type, pass, meet coverage? | `packages/gates` — `GateVerdict`                 |
| Is it complete against the contract?                     | reviewer agent, against the `acceptance` section |
| Is it tasteful?                                          | **nobody** — out of scope                        |

This is the "tool-grounded critique" the literature favours, and crabgic already
ships the tooling: `coverage-gate`, `flake-gate`, `engine-conformance-gate`,
`material-amendment-guard`.

### 4.4 Stages

Each stage has one **producer** and one or more **reviewer lenses**. Reviewers
are read-only and manager-side; producers of code are envelope-bounded workers.

| #   | stage     | producer                | reviewer lenses                     | exit criteria (sketch)                                                                                    |
| --- | --------- | ----------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | Research  | `eo-explore`            | completeness, source-quality        | every question the contract needs has a **cited** answer; no unknown silently assumed                     |
| 2   | Clarify   | orchestrator ↔ owner    | —                                   | all 9 `CONTRACT_SECTIONS` answerable; acceptance criteria **testable** _(exists today, terminates today)_ |
| 3   | Design    | architect               | contract-fit, security, operability | every acceptance criterion addressed; every interface named; each risk carries a mitigation               |
| 4   | Plan      | planner                 | coverage-of-design, sequencing      | every design element maps to ≥1 task; every task has testable done-criteria; dependency order acyclic     |
| 5   | Implement | envelope-bounded worker | correctness, security               | gates pass **and** the task's done-criteria are met                                                       |
| 6   | Integrate | existing publish path   | —                                   | `final-candidate` gate                                                                                    |

Stage 2 already works and is the template. Stages 1, 3, 4 are new. Stage 5
exists as dispatch; it gains a reviewer.

### 4.5 Reviewer output is structured, not prose

```jsonc
{
  "stage": "design",
  "artifactRef": "…",
  "lens": "security",
  "verdict": "approve" | "revise",
  "findings": [{
    "id": "…",
    "claim": "…",
    "evidence": { "reproduction": "…", "observed": "…", "expected": "…" },
    "verification": "confirmed" | "refuted" | "unverified",
    "classification": "blocking" | "advisory",
    "violates": "exit-criterion-id",      // REQUIRED when blocking
    "disposition": "fixed" | "refuted" | "accepted-debt",
    "dispositionEvidence": "…"            // REQUIRED, never empty
  }]
}
```

`verdict: "approve"` must be reachable, or the stage cannot close. This is the
single change to `eo-roaster`'s charter.

### 4.6 Budgets and escalation

Each stage gets a **revise budget**. On exhaustion the pipeline does not loop
and does not silently proceed — it raises the existing stop condition
`irreducible_product_decision`, which is already defined as _"two defensible
options lead to materially different products and no amount of reading the repo
decides between them"_ and already routes to `AskUserQuestion`.

`exhausted_repairs` remains untouched, per Gap 19 part 1. A review round is
still read-only and still spends no repair attempt.

### 4.7 Diversity by lens, not by repetition

Gap 19 part 5 (**fresh reviewer per round**) stands. What changes is that
rounds differ by **lens** rather than being repeated hostile passes. Diversity
of perspective catches failure modes redundancy cannot; repetition mainly
amplifies verbosity bias.

## 5. Constraint: subagents cannot converse

The owner's sketch has "designer and architect agents talk to each other." In
Claude Code, **subagents cannot address one another** — all traffic is mediated
by the orchestrator. Two implementable readings:

| approach                      | cost                                                                     |
| ----------------------------- | ------------------------------------------------------------------------ |
| Orchestrator-mediated turns   | simple; consumes orchestrator context per exchange                       |
| A `Workflow` script per stage | deterministic fan-out and barriers; agents still never converse directly |

This is a harness fact, not a design preference, and any stage design has to sit
inside it.

## 6. What changes in this repository

| artifact                                        | change                                                                                     | needs                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `docs/claude-code-adaptation.md` §0 amendment 4 | "unbounded roast loops / no severity floor" → staged pipeline with blocking/advisory split | **owner ruling**                                 |
| `docs/interface-ledger.md` Gap 19               | amend parts 3 and 4; parts 1, 2, 5 stand unchanged                                         | coordinated edit across the phases the gap lists |
| `roadmap/11, 13, 14, 10`                        | the phases Gap 19 names as affected                                                        | follow the ledger                                |
| `packages/plugin/agents/eo-roaster.md`          | `approve` becomes reachable; findings carry classification + disposition                   | code                                             |
| `packages/plugin/src/manager-protocol.ts`       | roast paragraph → staged pipeline paragraph                                                | code                                             |
| new agent definitions                           | architect, planner, and per-lens reviewers                                                 | code                                             |
| `@crabgic/contracts`                            | a `ReviewVerdict` schema                                                                   | code, ledger entry                               |

The ledger explicitly lists _"reintroducing a severity floor as an
optimization"_ as a way to get Gap 19 wrong. **This is not that.** It is not an
optimization and it is not a token-cost argument: it is a correction made
against measured evidence that the current criterion does not terminate, and it
preserves the property the floor was rejected to protect — every genuine defect
is still verified, answered and surfaced.

## 7. Owner rulings (2026-07-29)

The four questions this section opened are answered. Each ruling is recorded
with the mechanism it obliges, because a decision whose implementation is left
implicit is how §0's amendments came to need this document in the first place.

### 7.1 Revise budget — progress-based, ceiling 5

A stage keeps looping **while each round closes at least one `blocking`
finding**. The first round that closes none escalates immediately. A hard
ceiling of **5 rounds** applies regardless.

This is the literature's semantic early-stopping rather than a syntactic cap: a
stage that was finished after one round costs one round, and a stalling stage
surfaces the moment it stalls instead of burning a fixed budget first.

**Obliges:** each round records `blockingClosedThisRound`. The value is derived
from finding dispositions, never self-reported by the reviewer — a reviewer that
scores its own progress is the sycophancy failure Gap 19 was written to avoid,
inverted.

### 7.2 `accepted-debt` lives in the journal

Debt is written as an `EvidenceRecord` and surfaced in the change-set report at
approval time. It is queryable through the existing `crabgic evidence
<change-set-id>` path.

Chosen over a standing backlog file precisely because this repository already
has the flake catalogue as a worked example of what an unmanaged standing list
becomes. The journal is durable, already audited, and needs no new artifact.

**Obliges:** a finding→`EvidenceRecord` mapping, and a `ReviewVerdict` field
that carries the record id so the two are linkable after the fact.

### 7.3 Debt becomes blocking when its code is next touched

An advisory finding is **indexed by the paths it concerns**. When a later change
set's `PlannedWriteSet` intersects that index, the finding is **reclassified
`blocking` for that stage**.

Debt is therefore paid at the cheapest possible moment — when the context is
already loaded — and nothing accumulates silently.

**Obliges:**

- Findings carry a normalized path set, keyed with `normalizePlannedPath` from
  `@crabgic/git-engine` so the index and the overlap analyzer cannot disagree
  about what a path names. (Round 31's lesson: two functions answering the same
  question diverge.)
- The implement stage queries open debt against its `PlannedWriteSet` **before**
  the first review round, so inherited debt is visible from the start rather
  than appearing mid-loop.
- Inherited debt is subject to §7.1's budget like any other blocking finding. A
  change set that inherits more debt than it can absorb therefore **escalates to
  the owner** rather than looping — the "surprise mid-task" cost of this option
  is bounded by the same escalation path as everything else.

**Residual risk, disclosed:** debt in code nobody touches again is never paid.
That is accepted deliberately — it is also debt nobody is exposed to — but it
means the journal's debt query is the only place it can ever be seen, which is
an argument for keeping §7.2's report honest.

### 7.4 Research stage gets three lenses

`completeness`, `source-quality`, and `assumption-audit`.

Chosen over the two-lens recommendation in this document's first draft. The
reasoning that carried it: research runs first and its output is what every
later stage commits to, so a stale-but-well-cited source is more expensive here
than anywhere else in the pipeline. The extra lens is paid once, early, against
a cost that compounds.

## 8. Still open

### 8.0 RESOLVED — the finding store, without touching the closed union

`review.submit` computes closure from findings on record, and nothing supplied
them durably. The first read of this was that it was **blocked** on an owner
ruling. That was wrong, and the error is worth recording because it stopped work
for no reason.

What is genuinely closed: `JournalEntryType` is closed at thirteen members and
forbids a unilateral fourteenth. That constraint is real and is respected — no
`review_verdict` entry kind was added. `EvidenceRecord` genuinely does not fit
either: its `objectId` is a **Git object id**, not a payload pointer, and
`command` / `toolchainFingerprint` are required fields a review has no honest
value for. Filling those with plausible strings to make a record validate is how
a schema stops meaning anything.

What was never blocked: **the journal is not the only durable store this product
has.** The `EnvelopePolicy` — the artifact that decides what runs WITHOUT review
— already lives in XDG state rather than the journal. Findings are strictly less
privileged than that, so the precedent covers them comfortably, and the store
sits behind `loadFindings` / `saveFindings` so a later coordinated round can move
it into the journal as a migration rather than a redesign.

The store reuses `ensureOwnedDir` and `openOwnedFile`, so a predictable state
path gets the same treatment the policy and signing key got in rounds 30-32: a
symlinked component, a hardlink, a FIFO and a foreign owner are all refused. It
reads as empty for every failure — absent, unparseable, not ours — because
losing the record is bad and refusing to review at all is worse; invalid entries
are dropped individually so a malformed one never reaches the closure
computation, where a finding with no disposition would hold a stage open forever
with nothing able to answer it.

**The lesson, since it cost a stop:** "the obvious implementation is forbidden"
is not the same as "this is blocked". The constraint ruled out one storage
medium, not the feature.

### 8.1-8.4 Engineering work

Not questions for the owner — work this document does not yet answer, listed so
they are not mistaken for settled:

1. ~~Exit criteria are sketched, not written.~~ **Done** — `PIPELINE_STAGES` in
   `@crabgic/contracts`, six stages, ids unique across the pipeline because a
   blocking finding references them by name.
2. ~~Lens definitions.~~ **Done** — nine lenses in `eo-reviewer`'s charter, and
   `eo-architect` / `eo-planner` added because the design and plan stages had
   reviewers and no makers.
3. **Calibration — harness built, corpus empty.** The same error as §8.0, in
   smaller form: this was recorded as "cannot be closed by writing code", which
   is half true. The DATA needs the owner — only they can say whether a finding
   called `advisory` should have blocked. The HARNESS did not, and without it
   there was nowhere to put that judgement when it came.

   `scoreCalibration` measures Cohen's kappa rather than raw agreement, because
   raw agreement is inflated by the common class: a classifier marking
   everything `advisory` on a 90%-advisory corpus scores 0.9 raw and 0.0 kappa
   while being unable to identify a single blocker. It reports over-blocking and
   under-blocking separately, since one stalls the pipeline and the other lets
   defects through, and it refuses to call a classifier calibrated on fewer than
   twenty samples however well it scored.

   **What remains is a corpus.** Until the owner classifies real findings
   against the classifier's calls, the split stays asserted — and the harness
   now says so with a number instead of a caveat.

4. **Where the pipeline is driven from.** Orchestrator-mediated turns and a
   `Workflow` script are both viable (§5); the choice is unmade and is not
   blocked by anything — it is simply not yet made.
