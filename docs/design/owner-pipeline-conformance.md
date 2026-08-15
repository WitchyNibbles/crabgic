# Owner-pipeline conformance — audit and design

**Status:** audit complete; design ruled. **Rulings R1–R4 given 2026-08-15 (§6).**
**Audited at:** `main` @ `7bef0a6`, 2026-08-15.
**Subject:** the owner's stated pipeline (2026-08-15) — requirements → research →
clarify → per-domain design → design research → owner design approval →
autonomous SDD swarm → four-lens quality loop → per-domain audit → documentation.

**Supersedes:** nothing. **Amends, on the owner's rulings and not on its own
authority:** ledger Gap 19 and `docs/claude-code-adaptation.md` §0 amendment 4 (by
R4), and `docs/threat-model.md` (by R1). Each amendment is a coordinated edit
carried by roadmap phase 25's work items, never by this document alone.
**Closes** `docs/staged-review-pipeline.md` §8.4 — where the pipeline is driven
from — in favour of a `Workflow` script (§5.3).

---

## 1. The answer

Crabgic implements **7 of the owner's 17 pipeline steps** end to end. Four more
exist as partial machinery, four are absent, and two — the zero-findings exit
loops — were ruled out in 2026-07-29 after being measured non-terminating.

**Updated 2026-08-15, after the rulings in §6.** All four were answered and the
audit above is unchanged, but its conclusion is: R4 **re-opened** the zero-findings
exit. §4.3 is rewritten to deliver it, by bounding the finding space so a
zero-findings round is reachable rather than by capping rounds. All 17 steps are
now in scope for phase 25.

The gap is not in the execution substrate, which is the hard part and is built:
envelope-bounded workers, worktrees, journal, gates, the DAG driver, server-side
stage closure. The gap is that the **stage roster is six generalist stages driven
by prose**, where the owner asked for a **per-domain panel driven by a program**.

## 2. Method

Every row below cites the artifact that decides it. Where a row says ABSENT, the
evidence is a search that returned nothing — those are named as such, because
"I did not find it" and "it is not there" are different claims and only the
second one is checkable.

## 3. Conformance table

| #   | Owner's step                             | State         | Evidence                                                                                                                                                                                                                                                                                 |
| --- | ---------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Take requirements from the user          | **PRESENT**   | `IntentContract` + `CONTRACT_SECTIONS`; `packages/supervisor/src/intake/`                                                                                                                                                                                                                |
| 2   | Deep research about it                   | **PARTIAL**   | `research` stage + 3 lenses exist (`pipeline-stages.ts:77-98`); **no `ResearchRecord`**, so all 3 criteria are judged-only (`staged-review-pipeline.md` §8.7); **no web access anywhere** — see §4.1                                                                                     |
| 3   | `AskUserQuestion` to clarify             | **PRESENT**   | `clarify` stage closes on all 9 `CONTRACT_SECTIONS` answerable; `manager-protocol.ts:315-322` mandates the tool. This is the pipeline's strongest stage and the model the rest copies                                                                                                    |
| 4   | Design by **per-domain** specialists     | **ABSENT**    | One generalist `eo-architect`. The whole agent roster is five files (`packages/plugin/agents/`); no backend/frontend/infra/testing/product-design agent, and no domain-lens list in `@crabgic/contracts`                                                                                 |
| 5   | Deep research that the design is best    | **ABSENT**    | Design lenses are `contract-fit`, `security`, `operability` (`pipeline-stages.ts:108`). No alternatives-considered criterion, no prior-art criterion at design stage                                                                                                                     |
| 6   | `AskUserQuestion` to confirm the design  | **ABSENT**    | `MANAGER_APPROVAL_GATES` has three entries (`manager-protocol.ts:220-230`); none is the design. Design closes on reviewer verdict + attestation, never on the owner                                                                                                                      |
| 7   | Loop until the owner approves the design | **ABSENT**    | Follows from 6 — there is no owner verdict to loop on                                                                                                                                                                                                                                    |
| 8   | Autonomous from that point               | **PRESENT**   | Standing `EnvelopePolicy` (ledger Gap 18) removes per-ChangeSet consent; `driveRun` executes the DAG; `manager-protocol.ts:278-282` forbids permission-asking. **Bounded by §4.2**                                                                                                       |
| 9   | Prepare SDD documents for subagents      | **PARTIAL**   | `PlanRecord` tasks and `TaskPacket` exist; a task is a **work order, not a spec** — no requirements/design/tasks triad per unit, no acceptance criteria in the packet (`TaskPacket` carries `requirementIds` only)                                                                       |
| 10  | Review the development documents, loop   | **PRESENT**   | `plan` stage, 2 lenses, 3 criteria **derived from the artifact** rather than judged (`review-submit-handler.ts`; `staged-review-pipeline.md` §8.7)                                                                                                                                       |
| 11  | Orchestrate with Workflows + goal skills | **ABSENT**    | **Zero references** to the `Workflow` tool or the `/goal` skill in the entire repository. `PIPELINE_STAGES` has exactly one consumer — `review-submit-handler.ts` — which **judges** a stage; nothing **sequences** them. §8.4 records the choice as unmade                              |
| 12  | Each specialist develops its document    | **PRESENT**   | `dispatchAttempt` / `driveRun`; worktree per unit, ≤4 concurrent, delegation depth 1                                                                                                                                                                                                     |
| 13  | Four skill-charged evaluators            | **PARTIAL**   | `implement` lenses are `correctness` and `security` — **2 of 4**. No compliance lens; no stack-best-practices lens; no clean-code lens. And see §4.1: a "research best practices" lens has nothing to research with                                                                      |
| 14  | Loop until zero issues/warnings/buts     | **RE-OPENED** | **Measured non-terminating over 12 rounds** on one subsystem, every finding real and reproducible (`staged-review-pipeline.md` §2). Owner ruling 2026-07-29 replaced it with progress-based closure, ceiling 5 — **re-opened by R4 on 2026-08-15**; §4.3 delivers the zero-findings exit |
| 15  | Per-domain audit of the end product      | **ABSENT**    | `integrate` has **zero lenses** and one criterion (`pipeline-stages.ts:180-190`). Separately: the final-candidate gate's own reachability is a disclosed defect — `docs/deploy-posture.md` gate-registry row                                                                             |
| 16  | Main loop ends when audits are clean     | **RE-OPENED** | Same ruling as 14                                                                                                                                                                                                                                                                        |
| 17  | Documentation loop — user + maintenance  | **ABSENT**    | No seventh stage, no documentation agent, no documentation criteria. Searched `PIPELINE_STAGES`, the agent roster and the contracts index                                                                                                                                                |

**Score at audit: 7 present, 4 partial, 4 absent, 2 refused.** After the rulings,
the two refused rows are re-opened and all 17 are in scope for phase 25.

## 4. The four things that are not simply missing work

These four are the reason this is a design document and not a task list. Each is
a place where the owner's pipeline meets something already ruled, already
measured, or already load-bearing — and where building the literal request would
break something that works.

### 4.1 There is no web research capability, by design

Steps 2, 5 and 13 all say **research**. Crabgic cannot do the kind meant.

- Every manager agent declares `tools: ["Read", "Grep", "Glob"]` — all five of them.
- `WebFetch` and `WebSearch` are in the compiled worker profile's **default deny**
  list (`packages/engine-core/src/compiler/permission-profile.ts:41-42`).

So "research" today means _prior art in this repository_. That is a real
capability and the `research-prior-art-checked` criterion exercises it honestly.
It is not what "deep research about it" and "research best practices for the tech
stack" ask for, and no amount of stage plumbing produces it.

The block is not technical. It is that a design informed by fetched web content
is a design informed by **untrusted input**, and the manager relays designs into
an envelope that authorizes writes. Granting `WebSearch`/`WebFetch` to a
manager-side, read-only, non-write-capable research agent is the narrow version;
it still needs a ruling, because the threat model is a settled artifact.

> **RULED 2026-08-15 (R1): granted, manager-side only.** A read-only research
> agent holds `WebSearch`/`WebFetch`. Workers keep the default deny unchanged —
> `permission-profile.ts:41-42` is not touched, and no compiled envelope gains
> either tool. Obliges: a threat-model amendment naming fetched content as
> untrusted input, and a **source-provenance field** on `ResearchRecord` so a
> later stage can see which of its foundations came from outside the repository.
> The agent is never write-capable and never dispatched as a worker, so the
> untrusted content reaches a **proposal**, never a filesystem.

### 4.2 "No human feedback needed" collides with the stop conditions

Step 8 says autonomous from design approval onward. The architecture agrees and
was built for it — Gap 18 exists precisely to remove routine consent.

But three conditions still route to `AskUserQuestion`, and each fires _after_ the
design gate:

| condition                      | when it fires                                                 |
| ------------------------------ | ------------------------------------------------------------- |
| `irreducible_product_decision` | two defensible options, materially different products         |
| `expanded_authority`           | the compiled envelope is not contained in the standing policy |
| `exhausted_repairs`            | three attempts on one work unit                               |

`expanded_authority` **must** stay — it is the one thing making it true that the
model cannot widen its own authority, and Gap 18's whole safety argument rests
on it. The other two are policy, not safety, and could carry a declared default
disposition for an autonomous run. That is a ruling, not an implementation
detail: choosing wrong silently is exactly the failure the escalation exists to
prevent.

> **RULED 2026-08-15 (R3): both default; each defaulted decision is journaled.**
> `irreducible_product_decision` and `exhausted_repairs` carry a declared default
> disposition in an autonomous run rather than halting for the owner.
> `expanded_authority` **never** defaults, and no work item in phase 25 may make
> it defaultable.
>
> **What a default must be, so this does not become silent choosing.** The
> default is declared **before** the run, not chosen at the moment it fires — a
> disposition picked while the decision is live is the model deciding, wearing a
> default's name. Each firing journals the condition, the options that were open,
> the default taken, and the point in the artifact it applies to, and each
> surfaces in the change-set report at the same place `accepted-debt` does. The
> owner sees every one after the fact; what they no longer do is block on it.
>
> **Residual, disclosed:** a defaulted `irreducible_product_decision` is, by that
> condition's own definition, a fork where two defensible options lead to
> materially different products. Defaulting it means the run can deliver the
> other product. That cost is the point of the ruling and is accepted, not
> mitigated — the mitigation is that it is visible afterwards, not that it is
> unlikely.

### 4.3 The zero-findings exit — re-opened by ruling, and made to terminate

Steps 14 and 16 ask for a loop that exits when reviewers find no
issues/warnings/buts. This repository ran that experiment and it did not converge.

Rounds 21–32 on one subsystem: **12 rounds, zero rounds that found nothing novel
and falsifiable, every finding real** — including two arbitrary-file-overwrite
primitives found at rounds 30 and 32. The falsifiability test was applied
strictly and the loop still did not converge, which is why the owner ruled on
2026-07-29 for progress-based closure with a ceiling of 5.

> **RULED 2026-08-15 (R4): re-opened. A true zero-findings exit is required.**
> The owner was shown the measurement and ruled against the 2026-07-29 closure
> rule. This section is rewritten to deliver the ruling rather than to argue
> with it, and the rest of this document follows the rewrite.

**Re-reading the measurement, now that it has to be solved rather than avoided.**
The 12-round result is real, but it does not say what it was taken to say. It
measured an **unbounded search space**, not an infinitely defective artifact: the
reviewer's charter was "refute the artifact" over a whole subsystem, with no
bound on what was in scope, no key by which two findings were the same finding,
and no enumeration of what the reviewer owed an answer about. Under those
conditions a round that finds nothing is not evidence of quality and was never
reachable — there was always more surface to walk.

**A zero-findings round becomes reachable when the finding space is finite,
enumerable, and non-growing.** Four bounds do that, and none of them discards a
genuine defect:

| bound            | rule                                                                                                     | why it is not a severity floor                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Scope**        | A finding is admissible only if it concerns a path in this change set's `PlannedWriteSet`                | Code this change set does not touch is pre-existing. It goes to the debt index, which §7.3 already reopens on touch |
| **Obligation**   | Each lens is issued a checklist **derived from the artifact** — per element, per interface, per task     | The reviewer answers a finite list rather than free-associating. Nothing is excluded; the questions are enumerated  |
| **Identity**     | Findings are keyed `(lens, normalized path, claim hash)`; a re-raised finding is the **same** finding    | Deduplication, not dismissal. The first raising is fully verified, classified and dispositioned                     |
| **Monotonicity** | A repair may only touch paths already in the `PlannedWriteSet` — enforced by the envelope, not by policy | The space cannot grow sideways mid-loop. Widening it means re-entering the plan stage, in the open                  |

Under those four, **the loop exits on a round where every applicable lens returns
zero admissible novel findings** — the owner's exit, literally. Severity plays no
part in it: an advisory finding holds the loop open exactly as a blocking one
does, which is what "no issues, warnings, or buts" means and is the clause the
superseded rule could not honour.

**Where the termination argument genuinely stops.** A repair writes new code
inside the write set, and new code carries new obligations. The obligation set is
therefore non-increasing **per element** but not globally, so termination rests on
the repair rate exceeding the new-obligation rate. That is an empirical property,
not a proof, and pretending otherwise would repeat the 2026-07-29 error in the
opposite direction.

So the ceiling does not disappear — it **changes job and changes size**. It stops
being the closure rule and becomes a runaway guard set far above any healthy
loop (proposed: 20 rounds per stage, measured and tuned from the first runs). And
because R3 defaults `exhausted_repairs`, hitting that guard **no longer stops the
run**: the stall is journaled with its open findings and the declared default is
taken. Autonomy survives the pathological case without the loop pretending it
converged.

**Coverage still widens by lenses.** §5.2's domain panel is unchanged and is now
doing a second job: with the four bounds in place, more lenses per round means the
finite obligation set is retired faster, rather than more rounds meaning more
chances to find something new.

### 4.4 The pipeline is prose, not a program

This is the finding with the widest blast radius, and the one step 11 names.

`PIPELINE_STAGES` is real data with real criteria, and `review.submit` computes
closure server-side from findings on record — genuinely enforced, genuinely not
takeable from the caller. But **nothing advances a stage**. The sequencing lives
in `buildManagerProtocolBlock()`'s prose, which lands in the consuming repo's
`CLAUDE.md` and is followed by a model reading it.

Consequences, all of them observable:

- Stage order is a suggestion. A manager that goes design → implement, skipping
  plan, violates nothing mechanical.
- Lens coverage is a suggestion. Nothing checks that all three research lenses ran.
- The round ceiling is a suggestion. `REVIEW_ROUND_CEILING = 5` is a constant
  interpolated into a paragraph; no counter enforces it.
- Fan-out is serial by construction — orchestrator-mediated turns consume manager
  context per exchange, which is why a six-domain design panel is impractical today.

The `Workflow` tool is the fix §5.3 proposes, and it is the one the owner named.

## 5. Design

### 5.1 Stage roster v2 — nine stages

| #   | stage             | change                           | producer                  | closes on                              |
| --- | ----------------- | -------------------------------- | ------------------------- | -------------------------------------- |
| 1   | `research`        | gains `ResearchRecord`           | `eo-explore` + web lens   | derived: every question cited          |
| 2   | `clarify`         | unchanged                        | orchestrator ↔ owner      | 9 contract sections answerable         |
| 3   | `design`          | gains **domain panel**           | `eo-architect` per domain | derived from `DesignRecord` + panel    |
| 4   | **`design-gate`** | **new** — owner confirms         | orchestrator ↔ owner      | **the owner's recorded verdict**       |
| 5   | `plan`            | gains `SpecRecord` emission      | `eo-planner`              | derived from `PlanRecord`              |
| 6   | `implement`       | gains 2 lenses (4 total)         | envelope-bounded worker   | gates + done-criteria (derived)        |
| 7   | **`audit`**       | **new** — per-domain end-product | domain reviewers          | every applicable domain lens `approve` |
| 8   | `document`        | **new** — user + maintenance     | envelope-bounded worker   | derived from `DocumentationRecord`     |

`integrate` keeps its place between `implement` and `audit`, unchanged: same
final-candidate gate, still no lenses, because a gate decides it. Nine stages in
total — the eight rows above plus `integrate`.

**Stage 4 is the only new human act**, and it is placed _before_ dispatch, so it
widens no authority and does not touch Gap 18's argument: standing approval still
governs what may execute, and this gate governs what is worth executing. They are
different questions and only the second one was ever the owner's to skip.

> **RULED 2026-08-15 (R2): `design-gate` is added.** A fourth
> `MANAGER_APPROVAL_GATES` entry. The stage closes on **the owner's recorded
> verdict and on nothing else** — no reviewer verdict, no attestation and no
> server-side derivation may close it, which is what makes it a gate rather than
> a checkpoint the model can satisfy. Rejection returns to `design` with the
> owner's reason attached, and steps 6–7 of the owner's pipeline (`ask`, then
> `loop while not happy`) are that return edge.

### 5.2 Domains are data, not agent files

The owner named six domains (backend, front-end, infrastructure, testing, product
design, target-domain expert). Shipping six `.md` agent files would make the
roster a plugin-packaging concern and unenumerable by any check.

Instead: a `DOMAIN_LENSES` table in `@crabgic/contracts`, each entry naming its
lens id, the one question it answers, and its **applicability predicate** over the
detected stack (`@crabgic/detect` already classifies the project). A repository
with no front end runs no front-end lens, and — this is the load-bearing half —
**the pipeline can state which lenses it skipped and why**, which a roster of
files never could.

The four evaluators of step 13 join the same table: `compliance`,
`clean-code`, plus the existing `correctness` and `security`.

`eo-architect`, `eo-reviewer` and `eo-roaster` stay as they are. They are already
lens-parameterized (`eo-reviewer` §"You are invoked with a LENS"); the domains
extend that table rather than forking the agents.

### 5.3 §8.4 decided: a `Workflow` script per stage

Of the two options §5 of the staged-review-pipeline document left open,
**`Workflow` is chosen**, for reasons that are now measured rather than aesthetic:

- A domain panel is a fan-out of 6. Orchestrator-mediated turns pay manager
  context per exchange; a script pays none.
- Round counting, lens coverage and stage ordering become **program state** rather
  than instructions a model may skip — which is §4.4's entire complaint.
- `pipeline(items, stage1, stage2)` is the shape the panel-then-verify pattern
  already wants, with no barrier between a lens finishing and its findings being
  verified.

**The honest cost, stated:** the harness's `Workflow` tool is invoked by the
manager model, so "the program enforces it" means "the program enforces it once
invoked". A model that never calls the script is not constrained by it. This
moves enforcement from _per-stage prose compliance_ to _one invocation_, which is
a large improvement and not a proof.

Subagents still cannot converse (staged-review-pipeline §5). The panel is
fan-out + synthesis, never a conversation, and any design that reads as
"the architects talk it over" is not implementable on this harness.

### 5.4 `SpecRecord` — the SDD unit step 9 needs

A `PlanRecord` task states what to do and how it will be known done. A spec-driven
work unit needs the acceptance criteria **in the packet**, because the worker is
the party that has to satisfy them and today it never sees them.

`SpecRecord` per work unit: the requirement ids it serves, their acceptance
criteria **verbatim** (not by reference — the worker cannot resolve a registry),
the interfaces it may touch, the done-criteria, and the tests-first obligation.
It is emitted by the plan stage, reviewed with the plan, and carried on the
`TaskPacket`.

This also discharges a defect the repo already knows about:
`design-addresses-every-acceptance-criterion` "stays judged until a requirements
source is wired in" (`design-record.ts:129-133`) — phase 24 wired the registry;
this carries it the last hop to the worker.

### 5.5 The documentation stage is a worker stage, not a review stage

Guides are **written artifacts in the repository**, so they are produced by an
envelope-bounded worker in a worktree like any other write — never by the manager,
per §0 amendment 3 ("always workers, never the manager").

`DocumentationRecord` gives the stage derivable criteria rather than judged ones:
every public CLI command and gateway tool appears in the user guide; every
operational failure mode named in the design appears in the maintenance guide;
every guide claim that names a command has that command exist. That last one is
the difference between a guide and a plausible guide.

## 6. Owner rulings — given 2026-08-15

All four were put to the owner and answered. Each is recorded with what it
obliges, because §0's amendments needed a whole document to fix precisely for
want of that.

| #   | Ruling                        | Answer                                              | Obliges                                                                                         |
| --- | ----------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| R1  | Web research, manager-side    | **GRANTED**                                         | threat-model amendment; source-provenance on `ResearchRecord`; worker deny unchanged            |
| R2  | `design-gate` before dispatch | **GRANTED**                                         | a fourth `MANAGER_APPROVAL_GATES` entry; a durably recorded owner verdict; a return edge        |
| R3  | Autonomous defaults           | **GRANTED for two** — `expanded_authority` excluded | pre-declared defaults; every firing journaled and surfaced in the change-set report             |
| R4  | Zero-findings exit            | **RE-OPENED** — the 2026-07-29 rule does not stand  | the four bounds of §4.3; ceiling demoted to a runaway guard; **a coordinated Gap 19 amendment** |

**R4 is a change to an owner-approved ruling, not a clarification of one**, and it
is the reason this document now proposes an amendment rather than only a phase.
The 2026-07-29 rule was itself taken against measured evidence; replacing it
requires the same coordinated edit across every phase Gap 19 names, and phase 25's
work item 6 is written so the amendment lands with the mechanism rather than
ahead of it. The measurement is not deleted — §4.3 keeps it verbatim and explains
what it did and did not establish.

## 7. Reconciliation with settled authorities

| authority                          | this document                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| §0 amendment 3 (always workers)    | **honoured** — the documentation stage dispatches a worker; every new reviewer is read-only                              |
| §0 amendment 4 / Gap 19            | **AMENDED, by ruling R4** — closure becomes zero admissible novel findings; the ceiling survives only as a runaway guard |
| Gap 18 (standing approval)         | **honoured** — the design gate precedes dispatch and widens nothing; `expanded_authority` never defaults                 |
| Gap 20 (schema over prose)         | **applied** — `ResearchRecord`, `SpecRecord`, `DocumentationRecord`, `DOMAIN_LENSES` are all schema                      |
| Gap 5 (journal union closed at 13) | **honoured** — no new `JournalEntryType`; new records follow the finding store's XDG-state precedent                     |
| `deploy-posture.md`                | **untouched** — nothing here widens the certified scope, and nothing here needs a broad `Read` allow                     |
| `threat-model.md`                  | **amended, by ruling R1** — fetched web content is named as untrusted input reaching a manager-side proposal             |

Proposed as **ledger Gap 23** — "the pipeline's stage roster is generalist and its
sequencing is prose" — affecting phases 10, 11, 13, 14 and the new 25. The Gap 19
amendment R4 obliges is a **separate coordinated edit** across the phases Gap 19
itself names, and must not be folded into Gap 23: one ruling, one gap.

## 8. What this does not claim

- It does not claim the substrate is finished. `docs/deploy-posture.md` governs
  that and says single-tenant trusted-operator only.
- It does not claim the reachability of stage 7 is solved. The gate registry has
  no production composition (deploy-posture, gate-registry row); an `audit` stage
  that fires nowhere would be the harness-only vacuity this repo's own discipline
  exists to catch, so phase 25's exit criteria bind it to a reached stage.
- It does not claim a `Workflow` script makes the pipeline mandatory. §5.3 states
  exactly how far the enforcement goes.
- **It does not claim the zero-findings loop is proven to terminate.** §4.3's four
  bounds make a zero-findings round _reachable_, which the superseded design never
  did. Termination past that rests on the repair rate exceeding the
  new-obligation rate, which is empirical. The runaway guard exists because of
  that gap, not in spite of it, and the first runs are the measurement.
