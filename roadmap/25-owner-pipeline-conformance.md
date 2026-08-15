# Phase 25 — Owner-pipeline conformance: domain panel, spec records, program-driven stages

| | |
|---|---|
| **Depends on** | 10, 11, 13, 14, 24 |
| **Blocked on** | **Nothing.** Rulings R1–R4 were given 2026-08-15 (`docs/design/owner-pipeline-conformance.md` §6): web research granted manager-side, `design-gate` added, two stop conditions defaultable, and the zero-findings exit **re-opened** — the 2026-07-29 closure rule does not stand |
| **Unlocks** | — (second post-v1 phase) |
| **Sources** | `docs/design/owner-pipeline-conformance.md` (the audit and design this phase implements); `docs/staged-review-pipeline.md` §5, §8.4 (the driver choice, made in the design doc's §5.3) and §8.7 (the record-shape doctrine this phase extends); ledger Gaps 18, 19, 20; `docs/claude-code-adaptation.md` §0 amendments 3 and 4 |
| **Primary package** | `packages/contracts` (records, lens roster, stage roster); the driver script and stage handlers land in `packages/cli`; agents and the workflow script in `packages/plugin` — no new workspace (`scripts/check-workspace-count.mjs` pins the roster at 18) |

## Goal

Before this phase, the owner's pipeline is implemented at **7 of 17 steps**
(`docs/design/owner-pipeline-conformance.md` §3). Design is done by one generalist;
research has no record and no web access; there is no owner design gate; the four
quality evaluators are two; the end product gets no per-domain audit; nothing
writes documentation; and stage sequencing exists only as prose in
`buildManagerProtocolBlock()`, so stage order, lens coverage and the round ceiling
are all suggestions a model may skip.

After this phase, the stage roster is nine stages driven by a `Workflow` script;
domains are an enumerable, stack-applicable table rather than a folder of agent
files; a work unit's packet carries the acceptance criteria it must satisfy
verbatim; and the guides are produced by an envelope-bounded worker with criteria
that derive from the artifact rather than from a reviewer's opinion.

**And the review loop's closure rule changes, by ruling R4.** A stage closes when
every applicable lens returns **zero admissible novel findings** — the owner's
literal exit, severity playing no part in it. That is made reachable by bounding
the finding space (scope, obligation, identity, monotonicity — design doc §4.3),
not by capping rounds. The 2026-07-29 ceiling survives only as a runaway guard at
a much higher value, and under R3 it defaults rather than halting the run.

## In scope

- **`DOMAIN_LENSES`** — a table in `@crabgic/contracts`, each entry
  `{id, question, appliesWhen}`, where `appliesWhen` is a predicate over
  `@crabgic/detect`'s stack classification. Covers the owner's six domains
  (`backend`, `frontend`, `infrastructure`, `testing`, `product-design`,
  `target-domain`) and the two missing evaluators (`compliance`, `clean-code`).
  Data and not agent files, so a skipped lens is **stateable**: the pipeline
  records which lenses did not apply and why.
- **`ResearchRecord`** — the artifact the research stage has never had
  (`staged-review-pipeline.md` §8.7 names its absence). Questions, answers, a
  citation per answer, and an explicit assumption list. Makes
  `research-questions-answered` and `research-no-silent-assumptions` **derived**
  rather than judged, exactly as `DesignRecord`/`PlanRecord` did for five criteria.
- **`SpecRecord`** — the SDD unit. Requirement ids, acceptance criteria
  **verbatim**, permitted interfaces, done-criteria, tests-first obligation.
  Emitted by the plan stage, carried on `TaskPacket`. This is the last hop of the
  requirements wiring phase 24 started: `design-record.ts:129-133` records that
  `design-addresses-every-acceptance-criterion` "stays judged until a requirements
  source is wired in", and today the worker still receives `requirementIds` only.
- **`DocumentationRecord`** + the `document` stage — user guide and maintenance
  guide, produced by an **envelope-bounded worker** in a worktree (§0 amendment 3:
  always workers, never the manager). Criteria derive: every public CLI command
  and gateway tool present; every operational failure mode the design names
  present; every command a guide claims **exists**.
- **Stage roster v2** — `PIPELINE_STAGES` grows to nine (design doc §5.1):
  `design-gate` after `design`, `audit` after `integrate`, `document` last.
  `clarify` and `integrate` unchanged.
- **Bounded closure (R4)** — the four admissibility bounds that make a
  zero-findings round reachable: a finding must concern a path in the
  `PlannedWriteSet`; each lens is issued an obligation checklist derived from the
  artifact; findings are keyed `(lens, normalized path, claim hash)` so a
  re-raising is the same finding; and a repair may not enlarge the write set.
  Path normalization uses `normalizePlannedPath` from `@crabgic/git-engine` — the
  same function the overlap analyzer uses, per §7.3's rule that two functions
  answering one question diverge. Closure becomes **zero admissible novel findings
  across every applicable lens**, with severity playing no part.
- **Autonomy defaults (R3)** — a per-run autonomy setting carrying pre-declared
  dispositions for `irreducible_product_decision` and `exhausted_repairs`. Each
  firing journals the condition, the open options, the default taken and its
  anchor, and surfaces in the change-set report beside `accepted-debt`.
  `expanded_authority` is not representable in the setting.
- **The driver** — a `Workflow` script (`packages/plugin/workflows/pipeline.mjs`),
  closing `staged-review-pipeline.md` §8.4. Owns stage order, lens fan-out,
  admissibility filtering, novelty keying, and the runaway guard. Panel stages use
  `pipeline()` so a lens's findings verify while other lenses still run.
- **Manager-protocol reconciliation** — `buildManagerProtocolBlock()` stops
  describing a sequence it does not control and starts naming the script that does.

## Out of scope

- **Widening the standing `EnvelopePolicy`, or any session-reachable path to it.**
  Gap 18's safety argument is that nothing reachable from a session may widen
  authority; the `design-gate` precedes dispatch and grants nothing.
- **Making `expanded_authority` defaultable.** R3 granted defaults for the other
  two stop conditions only. This exclusion is not negotiable within this phase,
  and a work item that erodes it is out of scope by construction rather than by
  review.
- **Worker web access.** R1 is manager-side and read-only.
  `WebFetch`/`WebSearch` stay in the compiled worker profile's default deny
  (`permission-profile.ts:41-42`); no compiled envelope gains either tool, and a
  test asserts that the grant did not leak into the compiler.
- **Deleting the 2026-07-29 measurement.** R4 replaces the rule the measurement
  produced, not the measurement. `docs/staged-review-pipeline.md` §2 stays
  verbatim and is annotated, per this repo's annotate-never-rewrite convention.
- **Composing the gate registry.** The `audit` stage's reachability depends on it
  (`docs/deploy-posture.md`, gate-registry row), and that defect is phase 14's.
  This phase's criterion 8 binds the audit stage to a **reached** stage rather
  than shipping a handler with no reader.
- **Multi-tenant anything.** `docs/deploy-posture.md` is unchanged by this phase.

## Interfaces produced

- `DOMAIN_LENSES`, `DomainLens`, `lensesApplicableTo(stack)` — `@crabgic/contracts`
- `ResearchRecordSchema`, `SpecRecordSchema`, `DocumentationRecordSchema` — `@crabgic/contracts`
- `PIPELINE_STAGES` extended to nine members; `PIPELINE_STAGE_IDS` gains
  `design-gate`, `audit`, `document`
- `TaskPacket.spec: SpecRecord` — `@crabgic/contracts` (required; absence must not compile)
- `review.submit` accepts `research` / `documentation` artifacts alongside
  `design` / `plan`, and derives their criteria server-side

## Interfaces consumed

- `PIPELINE_STAGES`, `exitCriteriaFor`, `ReviewVerdict`, `DesignRecord`, `PlanRecord` — phase 14's review surface
- `Registry<Requirement>` and the criteria seal — phase 24
- Stack classification — `@crabgic/detect` (phase 12)
- `dispatchAttempt` / `driveRun` — phase 13, for the `document` stage's worker
- `MANAGER_APPROVAL_GATES` — phase 10

## Work items

1. **`DOMAIN_LENSES` table + applicability.** Eight entries, each with a stack
   predicate. A lens with no `appliesWhen` is unrepresentable — a lens that always
   applies is a claim, and it must be written as one.
2. **`ResearchRecord` + derivation.** Schema, then the `review.submit` derivation
   for `research-questions-answered` and `research-no-silent-assumptions`.
   `research-prior-art-checked` stays judged and attested — whether a search was
   *diligent* is quality, not shape (the §8.7 boundary).
3. **`SpecRecord` + packet carriage.** Schema; plan-stage emission; required field
   on `TaskPacket`; a type-level fixture proving omission fails compilation, in the
   shape of `criteria-seal-required.type.test.ts`.
4. **Stage roster v2.** Three new stages with their exit criteria. Ids stay unique
   across the pipeline — a blocking finding names one, and a name that resolves to
   nothing is not a constraint (`pipeline-stages.ts:8-14`).
5. **`design-gate`** *(R2, granted)*. Fourth `MANAGER_APPROVAL_GATES` entry; the
   owner's verdict recorded durably; the stage cannot close on anything else; a
   rejection returns to `design` carrying the owner's reason.
6. **Bounded closure + the Gap 19 amendment** *(R4, re-opened)*. The four
   admissibility bounds, the novelty key, and closure on zero admissible novel
   findings across every applicable lens. **The coordinated ledger edit lands with
   this item, never ahead of it** — Gap 19 names the phases it affects and each is
   edited in the same change, so the rule and its mechanism cannot disagree. The
   runaway guard replaces `REVIEW_ROUND_CEILING`'s current job at a value proposed
   at 20 and **tuned from the first measured runs**, not guessed and frozen.
7. **The `Workflow` driver**. Stage order, panel fan-out via `pipeline()`,
   admissibility filtering, novelty keying, runaway guard, defaulted escalation.
   Nothing a reviewer self-reports may affect closure — the sycophancy inversion
   §7.1 was written against applies to the novelty key exactly as it did to
   `blockingClosedThisRound`.
8. **`document` stage**. `DocumentationRecord`, the derivations, the worker dispatch.
9. **Research web access** *(R1, granted)*. A manager-side, read-only agent holding
   `WebSearch`/`WebFetch`; a source-provenance field on `ResearchRecord`; a
   `docs/threat-model.md` amendment naming fetched content as untrusted input; and
   a test that the compiled **worker** profile is byte-unchanged by the grant.
10. **Autonomy defaults** *(R3, granted)*. The per-run setting, its journaling, and
    its change-set report surface. `expanded_authority` must be unrepresentable in
    it — a type the compiler rejects, not a check a reviewer performs.

## Test plan

- **Vacuity first, per this repo's playbook.** Every derivation gets a negative
  control that reddens when the derivation is deleted. A record whose empty list
  satisfies a criterion vacuously (`[].every(...)`) is the §8.7 failure and is
  tested for by name at each new criterion.
- **`DOMAIN_LENSES`**: property test that `lensesApplicableTo` over a generated
  stack returns a subset of the table and never an empty set for a stack with any
  classified component; example test that a repository with no front end runs no
  front-end lens **and says so**.
- **`SpecRecord`**: type-level fixture (omission fails `tsc -b`) plus an
  integration test that a dispatched worker's packet contains the acceptance
  criteria **text**, not ids — the whole point of the record.
- **Driver**: a script-level test that stage order is enforced (a skipped stage
  fails), that an unrun applicable lens fails, and that the runaway guard fires
  where it is set rather than where a constant says it is.
- **Bounded closure, the load-bearing suite.** Four tests, one per bound, each
  written so deleting the bound reddens it: an out-of-write-set finding is
  **inadmissible** and does not hold the stage open; a lens issued no obligation
  checklist fails rather than free-associating; the same finding raised twice
  under one key counts once; and a repair attempting to write outside the
  `PlannedWriteSet` is refused by the envelope, not by the driver.
- **The convergence test the old rule never had.** A fixture stage that returns
  the same finding every round terminates; a fixture stage whose findings are
  fixed one per round terminates on the round after the last one; and a stage
  where every applicable lens returns zero admissible novel findings closes on
  **that** round with no ceiling involved. The third is the owner's exit and is
  asserted as reachable, not merely as permitted.
- **`document`**: a guide claiming a command that does not exist fails the
  derivation. This is the criterion that distinguishes a guide from a plausible one.
- **Negative control on the panel**: deleting a domain lens's registration must
  redden a coverage assertion. A panel that silently runs five of six is the
  inert-control failure `docs/deploy-posture.md` exists to surface.

## Build status — 2026-08-15

**Three of the ten work items are built and green locally. Nothing is ticked below**,
because a tick needs a CI run and these have only run on a developer machine — the
third ground rule, and the reason this repository's closeout passes untick boxes
rather than trusting confidence.

| WI  | What landed                                                                   | Tests                        |
| --- | ----------------------------------------------------------------------------- | ---------------------------- |
| 1   | `DOMAIN_LENSES`, `DomainLensSchema`, `lensesApplicableTo`, `domainLensById`   | 17, coverage 100/100/100     |
| 2   | `ResearchRecord`, `deriveResearchCriteria`, `researchContradictions`          | 15, coverage 100/100/100     |
| 3   | `SpecRecord`, `deriveSpecCriteria`, `unresolvableRequirementIds`              | 14, coverage 100/100/100     |
| 4   | `PIPELINE_STAGES` at nine — `design-gate`, `audit`, `document` added          | 13 (5 new), roster suite     |
| 6   | The four admissibility bounds + `closureVerdict` — `review/admissibility.ts` | 29, coverage 100/100/100     |
| 6b  | **Wired into production** — `review-submit-handler.ts` closes on the new rule | 4 new handler tests          |
| 7   | `pipeline-driver.ts` + the `pipeline.plan` gateway tool                       | 19 + 12, registered + golden |
| 10  | `AutonomySettings` + `applyStopCondition` — R3's defaults, journaled          | 14 + 5, real journal + runs   |
| 5   | `OwnerDesignVerdict` + design-gate enforcement in the closure path            | 9 + 5 handler tests           |
| 8   | `DocumentationRecord` + derivations, wired into `review.submit`               | 15 + 5 handler tests          |
| 9   | Three producer agents + `eo-researcher`'s web grant, roster-pinned            | 13 roster tests               |
| 5b  | The design-verdict store + its read path through the production registry      | 10 store + 3 end-to-end       |
| 5c  | `crabgic design approve\|reject` — argv, handler, dispatch, help              | 10, incl. 4 argv refusals     |
| 7b  | `workflows/stage-round.mjs` + the `/eo:pipeline` skill — the DISPATCH        | 15 contract tests             |
| 7c  | `workflows/stage-loop.mjs` — plan → dispatch → submit → repeat, to closure   | 8 contract tests              |

Measured at this tree: `npm run typecheck` clean across the workspace;
`packages/contracts` 801 tests passing; the full suite 7234 passing with **two**
failures, both `check-criteria-closeout` refusing this phase file for want of a
baseline pin — a bookkeeping consequence of adding a phase, not a regression.

**Written RED first in every case.** Each module's test file was run against a
missing import before the implementation existed, and the roster's five new
assertions were captured failing against the six-stage roster.

**The closure engine terminates, and the suite proves it rather than asserting
it.** Two convergence tests drive the real loop to a fixed point: a reviewer that
raises the same finding every round goes quiet on round two under the identity
bound, and three distinct findings answered one per round close on round four —
not at the guard, which would be a stall wearing a verdict's clothes. This is the
property the superseded rule never had and could not have had.

**Two defects were found by these tests before any reviewer saw the code**, and
both are recorded because the way they were found is the argument for the
discipline:

1. `closureVerdict` required a disposition from EVERY finding on record,
   deferred ones included — which would have let an out-of-scope finding hold a
   stage open and defeat the scope bound entirely, restoring the unbounded loop
   by a second route. Caught by the test asserting an out-of-scope finding does
   not block closure. The check is now scoped to admissible findings.
2. `findingKey` read `finding.lens`, which does not exist — the lens lives on the
   `ReviewVerdict`. **Vitest passed and `tsc -b` failed**, which is precisely why
   the typecheck job is separate from the test job.

**What is NOT built, stated so the table above is not read as more than it is:**
work items 5, 7, 8, 9 and 10.

### WI 5 — the design gate closes on the owner and on nothing else

`resolveDesignGate` REPLACES the closure rule for that one stage rather than
being `&&`-ed with it. That is the stronger form: as a conjunct, a later change
making the criteria or bounded-closure rules easier to satisfy would have opened
a second route here too. As a replacement the only input is the owner's answer.

Proved by three negatives with a positive control: a reviewer's `approve`
verdict does not close it, a signed attestation naming the criterion does not
close it, and an owner approval of a **different design revision** does not close
it — while the owner's approval of this exact revision does. Without the last
one, every assertion would pass for a gate that can never be opened at all.

Two details the schema carries rather than a convention:

- **A rejection requires a reason.** Steps 6–7 are a loop; a rejection with no
  reason gives the next design round nothing to change, so it would be rejected
  again. An approval needs none — "yes, this is what I meant" is complete.
- **The verdict names the revision it was given over.** An approval that does not
  say what was approved carries forward across an edit, which is the
  material-amendment failure phase 24's criteria seal blocks at the requirements
  level, reproduced one stage earlier.

### WI 5b — the store, and the division that makes it a gate

`design-verdict-store.ts` lives in XDG state beside the `EnvelopePolicy` and the
finding store, with the same `ensureOwnedDir` / `openOwnedFile` hardening rounds
30-32 earned — a symlinked path, a hardlink, a FIFO and a foreign owner are all
refused.

**The gateway READS it and cannot write it.** There is deliberately no MCP tool
that records a verdict, and a test asserts the registry exposes none: if a tool
the model can call could write one, the model could approve its own design and
every other assertion about the gate would be theatre. The CLI is the only
writer — the owner typing on their own terminal, the same division ledger Gap 18
draws around the `EnvelopePolicy`.

**Proved end to end through the production registry**, not against the handler in
isolation. A store nobody reads and a reader with no store both look exactly like
a gate that works, so the test does the whole loop: the gate refuses naming the
owner, a verdict is recorded through the CLI-only writer, and the same gate then
opens. A second test keeps it refusing when the approval names a different
revision.

Verdicts **append**. A rejection followed by an approval is steps 6–7's loop
working, and flattening it would erase the evidence that the design changed
because the owner asked it to. `verdictInForce` takes the latest — the same
latest-wins rule phase 24's criteria seal uses, so an earlier approval cannot
satisfy a gate the owner has since re-answered.

### WI 5c — the command, and what the argv layer refuses

`crabgic design approve|reject <change-set-id> --revision <rev> [--reason <why>]`.
Registered in the exhaustive dispatch (adding the union member made every
unhandled case a compile error), in `--help`, and in the help snapshots.

**`--revision` is required on BOTH verbs**, not only on approve. An approval that
does not name what it approved carries forward across an edit; a rejection that
does not name what it rejected leaves the design stage unable to tell whether it
has already been answered.

**A rejection is refused without `--reason` at the point of typing**, as well as
by the schema. The design stage loops on that reason, and an operator learning
this from a rejected write rather than from the parser is an operator who has
already lost the context they would have typed it in.

**The timestamp is stamped by the handler, never accepted as an argument.** A
caller-supplied `recordedAt` could be backdated, and telling a later reader when
the owner actually answered is the only thing that field is for.

One parser detail worth recording because it fails silently: both flags had to be
declared to `tokenize` as value-taking. An undeclared `--revision sha256:abc`
tokenizes as a valueless flag plus a stray positional, and the positional would
have become the change-set id — a wrong verdict written against a real change
set, with no error anywhere.
- `audit` and `document` are stages with criteria and no producer, no driver and
  no reader — the harness-only vacuity this phase's criteria are written to
  refuse, and why those criteria stay unticked rather than being met by a roster
  entry.
### WI 10 — the post-design run no longer halts for the owner

`applyStopCondition` wraps `haltOnStopCondition` rather than changing it: that
function's ordering discipline (transition first, journal second, so a refused
transition leaves no stray record) was earned from an adversarial-validation
finding, and putting a "sometimes this does nothing" branch inside the one
function whose job is to stop a run would have put the change in the worst
possible place. The halt path is untouched and keeps its tests.

**`expanded_authority` is excluded structurally, not by a rule.** The autonomy
document is a `.strict()` object with exactly two keys, so a default for it
cannot be represented — not written by an operator, not introduced by a
migration, not needing a reviewer to catch. Gap 18's safety argument survives
without depending on anyone remembering it. Tested from both directions: the
schema refuses the key, and the runtime halts on that condition under the most
permissive document that can be constructed.

**The four conditions R3 never mentioned halt too**, asserted by name. Defaulting
one by omission is how a scope ruling quietly becomes a general permission.

**Absence means halt.** `HALTING_AUTONOMY` is a real document rather than a
sentinel, so the resolver needs no second code path for "unconfigured" — and a
project that never opted in behaves exactly as it did before this work item.

Every defaulted firing journals what was decided AND why the condition fired,
plus that it was declared before the run rather than chosen when the condition
fired. The owner is not asked at the time by design, so the journal is the only
place they can ever see it.

### WI 7 landed as a gateway tool, not a `Workflow` script — and why

Design doc §5.3 chose a `Workflow` script to close
`docs/staged-review-pipeline.md` §8.4. Implementing it surfaced a harness fact
the design did not account for: **workflow scripts have no imports and no
filesystem access.** A script therefore cannot read `PIPELINE_STAGES`,
`DOMAIN_LENSES` or a stage's exit criteria — it would have to inline copies of
all three, planting the "two lists that must agree" failure at the exact point
that decides what gets reviewed.

So the decisions are served the way every other server-decided answer in this
product is: as `pipeline.plan` on the gateway, beside `review.submit`. The
manager asks what to run; it does not decide. A `Workflow` script remains the
right vehicle for the fan-out and can carry the plan as its `args` — §8.4's
question is answered, by a different mechanism than §5.3 named, and the design
doc's §5.3 should be annotated to say so.

**What it enforces:** stage order (a completion set with a hole is refused,
naming the stage jumped), a non-empty obligation checklist per lens (bound 2
treats an empty one as unmet, so a lens dispatched without one would stall its
own stage), the domain-lens partition at `audit`, one round for owner-gated
stages, and the runaway guard elsewhere.

⚠️ **The bound, stated rather than implied.** `completedStages` comes from the
caller, because no durable stage-completion record exists: production passes
`appendEvidence: () => Promise.resolve()` for review verdicts, so a closed stage
leaves no journal trace to read back. This removes the SKIP; it does not stop a
caller claiming a stage it never ran. Closing that needs a journaled
stage-completion record — named here, not left for a reader to discover.

**What remains is the coordinated Gap 19 ledger amendment**, and the phase-25
baseline pin that needs this work committed first. Every stage now has
server-decided closure, a server-decided plan, a producer agent, a write path,
and — with WI 7b — something that actually dispatches it.

### WI 7b — the dispatch, and where the design doc was wrong twice

`workflows/stage-round.mjs` runs one round of one stage: it fans out one
`eo-domain-reviewer` per applicable lens through `pipeline()`, so each lens's
findings go to verification the moment that lens finishes rather than waiting for
the slowest. Every finding is then put to an independent skeptic prompted to
REFUTE it, because a finding nobody tried to break costs a repair attempt on one
reviewer's word.

`skills/pipeline/SKILL.md` is the callable surface that drives the loop:
`pipeline.plan` → dispatch → `review.submit` → repeat.

**Design doc §5.3 was wrong about the mechanism, in two stages.** It chose a
`Workflow` script to own stage order and lens coverage. Implementing that found
scripts cannot import — so WI 7 moved those decisions to `pipeline.plan` on the
gateway. This work item is the other half: the script is still the right vehicle
for the FAN-OUT, it just carries the plan as `args` instead of computing it. §8.4
is closed by both pieces together, not by either alone.

**The script never decides closure**, and a test asserts it never mentions
`stageClosable`. Closure is `review.submit`'s, computed from findings on record;
a script returning it would be the caller grading its own work.

Three properties tested because the script cannot be executed here (its globals
do not exist in this process, and `node --check` rejects the top-level `return`
the harness's async wrapper makes legal): a dead agent is recorded as **unrun**
rather than read as an approval; skipped lenses are reported, never dropped; and
an owner-gated stage runs no round at all.

One test of mine was wrong first and is worth recording: it asserted the script
never mentions `PIPELINE_STAGES`, and the docblock mentions it precisely to
explain why the script does not use it. Fixed to assert the real constraint — no
`import`, no `require` — after stripping comments.

`eslint.config.js` now declares the harness globals for `workflows/**`. Without
it every script is twelve `no-undef` errors, and a real defect would hide among
them.

### WI 7c — the multi-round loop

`stage-round.mjs` runs one round. `pipeline.plan` says what a round contains.
`review.submit` says whether the stage may close. The thing tying those three
together was a paragraph in a skill telling the manager to repeat — which is the
same "prose a model may skip" this whole phase was written about, one level up.

`workflows/stage-loop.mjs` closes that: plan, dispatch, submit, repeat, until the
stage closes or the guard stops it. It owns **how many times to go round**. It
does not own what a round contains, and it does not own whether the stage closes
— both stay the server's, and a loop deciding its own exit would be the caller
grading its own work.

Four properties tested, each a way it could be quietly wrong:

- a **dead round** is a failure, not a clean round — continuing would let a
  crashed dispatch look like a round that found nothing, and a round that finds
  nothing is what CLOSES a stage;
- reaching the guard reports **`stalled`**, never `closed`;
- an **owner-gated** stage returns immediately with `awaitingOwner`, because
  there is no loop to run on a human;
- a missing `changeSetId` is **refused** rather than defaulted, since every
  server call is scoped to one and a default would submit a real review against
  the wrong work.

### WI 9 — the producers, and the defect the roster test caught

Three agents were added: `eo-domain-reviewer` (the design panel and the audit,
one invocation per lens), `eo-researcher` (the research stage, and the only agent
with web access), `eo-documenter` (the guides).

**Adding the files was not enough, and the manifest's own docblock said so.**
`REQUIRED_SUBAGENT_NAMES` is a second list the installer copies from, and it
records that `eo-architect` and `eo-planner` were once added as files and not
added there — so a real `crabgic install` copied three of five and the other two
were unreachable from any consuming repo, silently. Adding three agents without
updating it would have reproduced that exactly. The roster test now pins both
lists against the directory, so the next person cannot repeat it either.

**`eo-domain-reviewer` is asserted to name all eight lenses.** `pipeline.plan`
returns lens ids from `DOMAIN_LENSES`; a lens the producer does not recognise is
a planned review nobody performs, and a stage that waits on it forever.

**R1's boundary is tested, not just documented.** `eo-researcher` holds
`WebSearch`/`WebFetch`; every other agent is asserted NOT to, and every agent is
asserted to hold no `Write`, `Edit` or `Bash`. The compiled worker profile is
unchanged — `WebFetch`/`WebSearch` remain in its default deny, guarded by
`permission-profile.test.ts`.

**The plugin content digest was re-pinned last**, after the agent files and the
installer's `CLAUDE.md` text had settled — twice, because prettier reformatting
the agents moved it again. `check:marketplace-pin` reports the known
ahead-of-pin residual, which resolves at the next release cut.

### WI 8 — the documentation stage decides on coverage and on truth

`DocumentationRecord` gives the stage three derived criteria, and the third is
the one that earns its keep. Coverage catches a thin guide, which a reader
notices immediately. `unresolvableClaims` catches confident prose about a command
that does not exist — which a reader does NOT notice: they try it, it fails, and
they conclude the product is broken rather than the document.

The documented surface is **server-supplied**, never taken from the record under
review. A guide declaring its own coverage target could pass by shrinking it,
which is the same reason `design-addresses-every-acceptance-criterion` is scored
against the `Requirement`s.

Both guides are required. The owner named user guides AND maintenance guides, and
an optional field would let the stage close having written one — always the
maintenance guide, which is the less rewarding to write and the more expensive to
lack at 3am.

Wired into `review.submit` on the same terms as design and plan: parsed and
refused rather than ignored, derivations server-side, and an attestation claiming
a criterion the guide contradicts is **voided**.

### The closure rule is live, and what that changed

WI 6 is no longer a library. `review-submit-handler.ts` — the one server-side
path that decides whether a stage may close — now closes on the conjunction of
its criteria AND a round that raised **no admissible novel finding**. Four
coordinated amendments were needed to make that true, each landing with the
mechanism rather than ahead of it:

| artifact                    | amendment                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `review-verdict.ts`         | `REVIEW_RUNAWAY_GUARD = 20`; the `round` schema cap moves off the superseded ceiling  |
| `review-submit-handler.ts`  | closure = criteria ∧ quiet round; escalation = the guard, not "closed no blocker"     |
| `manager-protocol.ts`       | the loop paragraph states the zero-findings exit; guard imported, not re-declared     |
| the three tests encoding it | amended to the new rule, each carrying why the old assertion stopped being true       |

**The schema cap was load-bearing and nearly missed.** `ReviewVerdictSchema`
capped `round` at 5, so round 6 was unrepresentable — a stalling stage could not
report the state that triggers its own escalation, and the guard was unreachable
by construction. Amending the rule without that cap would have shipped an
escalation path nothing could reach.

**What the production tests now prove:** a new `advisory` holds a stage open
(severity plays no part — the owner's clause); a finding about untouched code is
returned as deferred and does NOT hold the stage open; a round closing no
blocking finding no longer escalates; and the guard escalates saying the loop did
not converge.

Still owed on this item: `REVIEW_ROUND_CEILING` remains duplicated between
contracts and the plugin (pre-existing, not widened — the guard is imported), and
the **ledger Gap 19 amendment across phases 10, 11, 13 and 14 has not landed**.
Criterion 6 stays unticked until it does.

## Live-run status — 2026-08-15

**Three rounds run under owner authorization** (small scoped run; the full
pipeline was offered and declined). Nine blocking defects found in this phase's
own code, every one verified independently before it was fixed. Evidence:
`docs/evidence/phase-25/live-review-round-1.md`.

**The measured result that matters more than the count:** each round found
defects in the PREVIOUS round's fixes. The bounds did not converge on one
400-line module in three rounds. That is the loop working, and it is the first
real measurement against ledger Gap 19's disclosed residual — termination is
reachable, not proved.

**What an unattended run still needs, and what it would cost**, is written down
at `docs/evidence/phase-25/unattended-run-gap.md` so that authorizing it is a
decision about a known quantity. One gap in it is not a spend question at all:
the `audit` stage cannot fire where no production run reaches, which is phase
14's gate-registry composition and is why criterion 9 below stays unticked.

## Exit criteria

- [ ] `DOMAIN_LENSES` enumerates all eight lenses; `lensesApplicableTo` is
      property-tested; a skipped lens is recorded with its reason (unit + property tests).
- [ ] A `DomainLens` without an applicability predicate is unrepresentable — schema
      parse fails, with a positive control proving the fixture is otherwise valid.
- [ ] `ResearchRecord` makes `research-questions-answered` and
      `research-no-silent-assumptions` **derived**: an answer with no citation
      fails the derivation, and a claim to either criterion in `attestations` is
      discarded as server-derived (integration test through `review.submit`).
- [ ] A dispatched worker's `TaskPacket` carries its acceptance criteria verbatim;
      omitting `spec` fails compilation at every public dispatch entry point
      (integration test + type-level fixture in CI).
- [ ] `PIPELINE_STAGES` has nine members with unique criterion ids across the
      whole roster; `exitCriteriaFor` throws for an unknown stage (unit test).
- [ ] *(R2)* The `design-gate` stage closes **only** on a recorded owner verdict —
      no reviewer verdict, attestation or derivation can close it (integration test,
      one arm per attempted route).
- [ ] The `Workflow` driver enforces stage order, per-stage lens coverage and the
      runaway guard: a skipped stage, an unrun applicable lens, and a run past the
      guard each fail (script-level tests, one per clause).
- [ ] *(R4)* A stage closes on a round where every applicable lens returns zero
      admissible novel findings, **with no severity test applied** — an outstanding
      advisory finding holds the stage open exactly as a blocking one does
      (integration test, plus a negative control where one advisory remains).
- [ ] *(R4)* Each of the four admissibility bounds is enforced and independently
      falsifiable: deleting any one bound reddens its own test and no other's
      (four tests; the deletion is measured and reverted, per this repo's
      falsification convention).
- [ ] *(R4)* Admissibility and novelty are computed server-side from findings on
      record; a caller asserting either has **no effect** on closure (integration
      test with a lying caller).
- [ ] *(R4)* Path normalization in the novelty key uses `normalizePlannedPath`, and
      the finding index and the overlap analyzer cannot disagree about what a path
      names (test asserting one implementation, not two agreeing).
- [ ] *(R3)* `irreducible_product_decision` and `exhausted_repairs` take their
      pre-declared default without halting the run, each firing journaled with its
      options and anchor; `expanded_authority` is **unrepresentable** in the
      autonomy setting (type-level fixture + integration test per condition).
- [ ] The `audit` stage fires at a stage a production run **reaches**, evidenced by
      a journaled run that gets there — not by a harness-level fixture. If phase 14's
      gate-registry composition has not landed, this criterion stays unticked and
      says so, rather than being met by a handler nothing calls.
- [ ] The `document` stage's guides are produced by an envelope-bounded worker in a
      worktree, and a guide claiming a non-existent command fails the derivation
      (integration test + negative control).
- [ ] `buildManagerProtocolBlock()` no longer describes a sequence it does not
      control; the block is deterministic and its installer merge stays byte-preserving
      (golden test, as today).
- [ ] *(R1)* The research agent holds `WebSearch`/`WebFetch`, `ResearchRecord`
      carries source provenance, and the compiled **worker** profile is unchanged
      by the grant (profile golden test + `docs/threat-model.md` amendment committed).
- [ ] Ledger Gap 23 is written and every phase it names is reconciled in the same
      coordinated edit (10, 11, 13, 14, 25).
- [ ] *(R4)* Ledger Gap 19's amendment lands in the **same change** as work item 6,
      across every phase Gap 19 names (10, 11, 13, 14), and
      `docs/staged-review-pipeline.md` §2's measurement is annotated rather than
      rewritten. A rule amended without its mechanism, or a mechanism shipped
      against an unamended rule, fails this box.

## Risks & open questions

- **The driver is only as binding as its invocation.** A `Workflow` script the
  manager never calls constrains nothing. This phase moves enforcement from
  per-stage prose compliance to a single invocation — a large improvement, not a
  proof, and stated as such in the design doc §5.3. **Open:** whether a
  `UserPromptSubmit` or `SessionStart` hook should make the invocation structural.
- **Eight lenses per panel multiplies cost.** A design stage that fans out six ways
  and an implement stage that fans out four are real token spend. The applicability
  predicate is the control, and it is the reason the roster is data.
- **`audit` may be unreachable on arrival.** Criterion 9 is written to stay unticked
  rather than to be met vacuously. That is deliberate and follows the closeout
  discipline: an unticked box is a bookkeeping gap, and a box ticked from general
  confidence makes every other box worth less.
- **The zero-findings loop is reachable, not proven terminating.** The four bounds
  make the finding space finite and non-growing per element, which the superseded
  design never did. But a repair writes new code inside the write set and new code
  carries new obligations, so termination rests on the repair rate exceeding the
  new-obligation rate — empirical, not proved. The runaway guard exists **because**
  of that gap. **Open:** its value. 20 is a proposal; the first runs measure it,
  and a guard tuned from nothing is the syntactic kill-switch the literature warns
  about wearing a larger number.
- **A bounded reviewer can miss what an unbounded one found.** The scope bound
  sends out-of-write-set findings to the debt index rather than the loop. Rounds 30
  and 32 of the original experiment found two arbitrary-file-overwrite primitives,
  and whether either would have been in-scope under this rule is **unknown and not
  claimed either way**. The mitigation is §7.3's existing reopen-on-touch rule, and
  the residual is that debt in code nobody touches again is never paid — which
  staged-review-pipeline §7.3 already discloses and this bound makes load-bearing.
- **R1's grant puts fetched content into the design path.** The agent is read-only
  and never dispatched, so untrusted text reaches a proposal rather than a
  filesystem. The residual is a design argued from a poisoned source, which the
  source-provenance field makes attributable after the fact rather than impossible.
- **This phase's criteria are not part of the 211-criterion closeout census.** That
  tally covers phases 00–24 and is not moved by adding a phase. Stated so nobody
  reconciles the two and finds an error that is not there.
