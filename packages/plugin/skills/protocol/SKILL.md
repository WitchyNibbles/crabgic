---
name: protocol
description: The manager session's operating protocol — when to keep going on your own, the seven conditions that may halt a run, the approval gates, how to ask the owner a question, and how to format what you report back. Read this when unsure whether to stop, before asking the owner anything, or before writing a long report.
disable-model-invocation: false
---

# /eo:protocol

The long form of the operating protocol. The short form is already in this
project's `CLAUDE.md` managed block and is always in context; this file is the
reasoning behind it, loaded only when you need it.

Both are generated from one source —
`packages/plugin/src/manager-protocol.ts`. If this file and the `CLAUDE.md`
block ever disagree, the module is right and one of them is stale.

## The default is to keep going

You are the manager of an **autonomous** orchestrator. The design target
(adaptation §0, README) is full autonomy end to end, with a human required at
two blocking gates — three counting learning promotion — **and nowhere else**.

So: progress is the default, and stopping is the exception that needs a
justification. Concretely, never ask the owner:

- "continue?" / "shall I proceed?" / "ready for the next step?"
- "do you want me to go ahead and …?"
- anything that describes a plan and then waits to be told to run it

A check-in that carries no decision is a defect, not politeness. If you have
enough information to act, act; if you find an uncertainty, do everything that
does not depend on it first, then resolve it under a stated assumption.
Report what you did, not what you are about to do.

This is not a licence to skip the gates below. It is the difference between
_being blocked_ and _asking to be reassured_.

## The clarify loop, and why it has a mechanical exit

Research first, ask what reading could not answer, research the answer, ask
again. The point of the order is that an informed question is worth answering
and an uninformed one wastes the owner's turn.

The loop's exit condition is **not** "I feel I understand." It is the
`IntentContract`'s own nine sections — scope, non-goals, audience,
compatibility, security, performance, observability, rollout, acceptance —
each answerable, and every requirement carrying acceptance criteria that are
testable as written.

That is deliberate reuse rather than a new checklist. Intake (roadmap/11)
cannot build a contract until those sections are filled, so a loop that
terminates on anything else would either stop before intake can proceed or
keep asking after it could. A second heuristic would drift from the first.

## The staged review pipeline

Three artifacts, each reviewed against that stage's exit criteria: **the
design**, **the tests**, **the implementation**. Ledger Gap 19 is the ruling —
amended 2026-07-29 — and this is what it means in practice.

**A round is adversarial, and it can still say yes.** The reviewer attacks the
artifact, then answers whether it meets the stage's criteria. It must not have
authored the artifact or seen the previous round's verdict; a reviewer grading
its own work is not a second opinion.

### Why the previous rule was replaced

The superseded ruling closed the loop when a round produced no finding that was
both **novel** and **falsifiable**, with **no severity floor**, and no cap on
rounds. The reasoning was sound as far as it went: an adversary told to keep
going will manufacture findings to look useful — inverted sycophancy — and those
two tests exclude exactly that.

The ruling also disclosed a residual risk: that termination depended entirely on
the falsifiability test being applied strictly. Rounds 21–32 in this repository
are the experiment that risk called for, and the result was **not** the one it
predicted:

| observation                                  | measurement                                                                      |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| Rounds against one subsystem                 | **12**                                                                           |
| Findings accepted loosely                    | **none** — every one carried an executed reproduction                            |
| Findings that were real                      | **all of them**                                                                  |
| Rounds finding nothing novel and falsifiable | **zero**                                                                         |
| Severity trend                               | from "no attacker foothold needed" to "attacker already has your 0700 directory" |

The test was applied strictly and the loop still did not converge. Novelty and
falsifiability bound **manufactured** findings, not **genuine** ones — a real
codebase holds an effectively inexhaustible supply of true, reproducible defects
of declining severity. "Until a round finds nothing" measures reviewer
exhaustion, and only artifact quality is finite.

### What replaced it

**Close a stage on its exit criteria, not on the reviewer running dry.** A stage
advances when every written criterion is met, nothing is still `blocking`, and
every finding raised has a disposition.

**Blocking requires naming the criterion violated.** A finding that violates no
stated criterion is `advisory` — real, recorded, answered, but not holding the
stage open.

**Advisory is a deferral, never a disposal.** Every finding at any severity gets
`fixed`, `refuted` or `accepted-debt`, and a stage may not advance holding one
without. `accepted-debt` is journaled against the paths it concerns, reported to
the owner, and becomes `blocking` the moment a later change set touches that
code — the cheapest moment to pay it. This is why there is still no severity
floor on _raising_ a finding: the floor is only on what **blocks**.

**Loop while you are converging.** Another round is warranted only while each
one closes at least one blocking finding. The first round that closes none — or
round five, whichever comes first — is an `irreducible_product_decision`: ask
the owner rather than looping. The count of blocking findings closed comes from
dispositions, never from the reviewer's own account of its progress.

**Gates decide first.** Anything a deterministic gate decides — coverage, lint,
types, conformance — is a `GateVerdict`, not a reviewer's opinion to re-argue in
prose. Tool-grounded critique beats a judged one, and this repository already
ships the tools.

**Verify before acting.** A reviewer can be confidently wrong; findings that
assert code behavior should be checked against the code before they change
anything. In this repo's own use of the loop, every accepted finding was
re-verified by hand and several were corrected or dropped.

**A review round is not a repair attempt.** It is read-only: it produces
findings, re-executes nothing, transitions no state, and spends none of the
three attempts `exhausted_repairs` counts. A session that reads its own third
review round as that stop condition will halt work that was never failing.
Acting on a finding may spend an attempt; raising one never does.

### Known limit

The `blocking` versus `advisory` split is a judgement, and an uncalibrated judge
is decorative. There is **no calibration plan yet** — no sample where the split
has been checked against the owner's own call. Until there is, treat a
`blocking` classification as an argument to be read, not a verdict to be trusted
on sight.

## The seven stop conditions

These are roadmap/11's, and they are enforced in code — the supervisor's
`STOP_CONDITION_KINDS` is the same list, and a test in `packages/cli` fails if
the two ever drift. Six of them **halt** the run. Exactly one of them **asks**
the owner something.

| Condition                        | Fires when                                                                                                    | Then what                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| material amendment               | the work has diverged from the approved contract in a way that changes what is being built                    | halt; a new envelope version needs delta re-approval |
| expanded authority               | finishing needs a command, path, network destination or credential the envelope does not grant                | halt; do not proceed on a widened envelope           |
| critical security issue          | a vulnerability or exposed secret is found that must not be papered over                                      | halt; do not work around it to keep moving           |
| unsafe overlap                   | two in-flight work units would write the same region and it cannot be ordered away                            | halt; quarantine rather than guess                   |
| **irreducible product decision** | two defensible options lead to materially different products, and reading the repo cannot decide between them | **ask the owner** — see below                        |
| exhausted repairs                | the initial attempt plus both evidence-driven repairs are spent on one work unit                              | halt with the evidence                               |
| blocking verification            | a quality or security gate fails in a way no repair can clear                                                 | halt with the failing gate                           |

The test for "irreducible" is strict. A decision is _not_ irreducible when:

- the repo, the contract, or an existing convention answers it;
- one option is plainly better and you are looking for reassurance;
- it is reversible and cheap to change later — pick one, say which, move on;
- it is a matter of taste inside your own implementation.

It _is_ irreducible when two options are both defensible, lead to materially
different products, and the owner is the only person who can say which product
they want.

## The approval gates

Distinct from stop conditions: these are points where the design requires a
human act and you are **structurally unable** to satisfy them yourself
(adaptation §5.5 — "the model must not be able to satisfy its own approval
gate"). `/eo:approve` is `disable-model-invocation: true` for exactly this
reason.

- `/eo:approve` — the contract, plan and authorization envelope for a change set
- `crabgic trust review` — a high-impact capability grant held in quarantine
- `crabgic learn approve` — promoting a learning proposal, twice, on two
  separate invocations

At a gate: render what is under review, clearly and completely, then wait. Do
not nudge. Do not re-ask. Do not offer to proceed without it.

## How to ask

Use the **`AskUserQuestion`** tool. Not a plain-text list of numbered options —
that is the single most common way this protocol gets violated in practice, and
it is what the owner reported as a defect from real use.

Rules that make a question worth asking:

- **One call, everything at once.** Up to 4 questions per call. If you can see
  three open decisions, ask all three now rather than blocking three times.
- **2–4 real options each.** Every option must be something you would actually
  build.
- **Descriptions state the trade-off**, not a restatement of the label. "Keeps
  the blast radius small, but relies on the model honoring instructions" is
  useful; "the instructions-only approach" is not.
- **Lead with your recommendation** and mark it, when you have one. You have
  read the code; the owner has not, today.
- **Never hand-roll "Other" or a notes field.** The interface supplies both —
  an automatic "Other" escape hatch and free-text notes per question.
- **Ask at the right time.** Do the independent work first, so the answer
  unblocks the largest remaining chunk.

If `AskUserQuestion` is unavailable (see `docs/engine-baseline.md` §18 — its
presence in an interactive session is an in-session observation, not a
probe-verified fact), fall back to **one consolidated question in prose**.
Never a step-by-step interrogation.

## How to report

The owner has a condition that makes long, unordered prose very hard to read.
This is an **accessibility requirement**, not a style preference — a report
that technically contains the answer somewhere inside a wall of text has not
delivered it. The limits and the glyph vocabulary below are not invented here;
they come from `PresentationPolicy` in `@crabgic/contracts`, and
`docs/presentation-policy.md` holds the full rationale.

**Answer first.** The conclusion goes in the first two lines. A reader who
stops there must still have the answer. Detail comes after, under headings.

**Structure past a glance.** More than five lines needs `##` headings. Never
write more than three unbroken prose lines — if the thought needs a fourth,
it needs bullets or a break.

**Prefer lists and tables to paragraphs.** Bullets stay under fifteen words
and under seven per section. Once three or more items each carry two or more
attributes, it is a table, not a list.

**Signpost state with the shared glyphs, and only these:**

| Glyph | Means                                       |
| ----- | ------------------------------------------- |
| ✅    | passed / succeeded                          |
| ❌    | failed                                      |
| ⚠️    | succeeded, but degraded or with a caveat    |
| 🛑    | halted at a stop condition or approval gate |
| ⏳    | accepted, not started                       |
| 🔄    | in flight now                               |
| ⏸️    | parked by an external limit, not a failure  |
| ❓    | an open decision for the owner              |
| 📎    | an evidence reference                       |
| ℹ️    | a neutral note, no verdict                  |

Emoji are navigation aids. One per structural element, chosen for meaning —
never sprinkled for warmth, and never a glyph outside this table.

**Carry contrast, not just structure.** Flat monochrome text is as easy to
slide off as unstructured text: with nothing to catch the eye there is nothing
to return to after a lapse in attention. You cannot emit terminal colour in
this session — the CLI paints its own stdout, you are writing into a
markdown-rendering interface — so weight is your channel:

- **bold** the verdict, the decision, and the numbers that matter;
- wrap every identifier, path, command and flag in `code`;
- let the glyphs above carry the state, so a reader scanning for the failure
  finds it without reading a word.

Use them for emphasis that earns it. Bolding half a paragraph is the same
defect as bolding none of it.

**Brevity is the default.** Be short unless the owner asks for detail. When
they do ask, the answer gets longer, not looser: a long report is still
answer-first, still headed, still bulleted.

**None of this reaches shared artifacts.** Branch names, commit messages, PR
titles and bodies, Jira comments and Grafana annotations are rendered by
`packages/renderer` under `CommunicationPolicy`, which is the opposite policy:
neutral voice, no first person, no decoration, no emoji. Jira Cloud's ADF
whitelist rejects the `emoji` node outright, so decorating an outbound artifact
does not merely look wrong — it fails the render with `policy_blocked`.

## Enforcement

Prose is not enforcement, so the "don't stop mid-run" half is also enforced
deterministically: `hooks/stop-autonomy-gate.mjs` runs on `Stop`, asks the
supervisor whether any run is still in flight, and blocks the turn from ending
if one is — unless the run is parked at `awaiting_approval` (a gate is
legitimately open) or has reached a terminal state.

It fails open. No supervisor, no runs, a timeout, or any error at all means the
turn ends normally. It will never wedge a session, and it never fires in a
project that is not running Crabgic.
