# Defect 00-unresolved-hedge-nits

**Phase:** 00 — Engine spikes (`roadmap/00-engine-spikes.md`, exit criterion 5)

**Criterion (verbatim):**

> Every `UNRESOLVED:` entry in the baseline doc carries an explicit mitigation note; no downstream phase may cite an UNRESOLVED item as settled fact (Hard Rule 1).

**Found:** 2026-08-05, criteria-closeout pass (phases 00 and 06), at
`9abc3fd911186cd83bbd02b2d905f613da2ca8e3`, during the notation-aware census of the criterion's
second conjunct.

**Severity:** documentation/annotation only. **Neither item is a Hard Rule 1 violation**, and c5 is
ticked. Both are recorded because a census that reports "clean" must not quietly hold anything back —
a bucket labelled clean is a promise, and the repository has been bitten before by a
"hand-check" bucket nobody hand-checked.

**Effort: S** — one comment line in one test file, and one dated correction beside one line of a
work-item record. Neither touches product code or any assertion.

## Context — what the census found

Conjunct 2 is a repo-wide negative claim, so it was censused by **notation** rather than by one
pattern: 20 notations swept over the whole tracked tree, 46 candidate files intersected and read, 44
code-side `'rejected'`-shape lines classified individually, plus every site touching
`AskUserQuestion`'s interactive presence and `error_max_structured_output_retries`. Full census:
`docs/evidence/phase-00/closeout/closeout-committed-and-census.txt` §5.

Result: **zero violations.** Every site is explicitly hedged as SDK-typed, hand-built,
unobserved-live, fake-engine-only, or not-probe-verified. Two sites do better than prose hedging —
`packages/testkit/src/fake-engine/rate-limit-fixtures.test.ts:21` makes the prohibition an executable
assertion, and `packages/engine-claude/src/live/live-harness.ts:623` inverts the polarity by aborting
the live suite when a `rejected` status appears rather than recording it as an observation.

The two items below are the residue.

## Nit 1 — the weakest hedge in the tree, structural rather than verbal

`e2e/matrix/orchestration/test/limit-parked-resume-restart.test.ts:194` builds a
`{ ...RATE_LIMIT_ALLOWED_WARNING_96, status: "rejected" }` payload and drives it through
`FakeEngineAdapter`.

**This is compliant.** `docs/engine-baseline.md:378`'s mitigation says the `'rejected'`-transition
handling must be "exercised only against fake-engine fixtures", and a fake-engine fixture is exactly
what this is. The file also hedges its clock carefully at `:49-52`, noting that the scenario never
real-sleeps and compares against the verbatim recorded `resetsAt`.

What it lacks is a one-line in-file sentence naming the `'rejected'` status itself as
unobserved-live. Its sibling does carry one — `packages/scheduler/src/run-driver.test.ts:456-459`:

> Established the way `executor.test.ts` does — via parkWorkUnit's own accountWide flag on an
> unrelated unit, never by inventing an unobserved engine payload (docs/engine-baseline.md §8 records
> the "rejected" status as UNRESOLVED).

**Remedy:** add the equivalent comment beside `:194`. One line. The value is that the next reader
editing that scenario meets the constraint at the point of edit rather than having to know §8.

## Nit 2 — a stale injection-scope sentence in a phase-06 work-item record

`docs/evidence/phase-06/wi2-event-normalizer.md:141-142` still describes the **pre-Finding-6**
behaviour of the error-string fallback detector:

> `normalizeSdkStream` runs `detectLimitErrorString` over assistant text and non-success
> `result.errors[]`/success `result.result` strings

That was reversed. `packages/engine-claude/src/event-normalizer.ts:75-79` now excludes
model-authored, prompt-injectable text deliberately, and
`docs/evidence/phase-06/wi6-security-hardening.md:222-225` records the change as a
prompt-injection-resistance fix. `packages/engine-claude/src/event-normalizer.test.ts:194` pins the
new behaviour with a comment saying so, and `:192` asserts no `limitSignal` is synthesized from
assistant prose.

**This misstates the injection scope, not any UNRESOLVED status** — which is why it is a nit here and
not a conjunct-2 violation. wi2's own carry-forward at `:176-180` is correctly hedged about the
UNRESOLVED `'rejected'` sample.

**Remedy:** add a dated correction beside `wi2-event-normalizer.md:141-142` pointing at
`event-normalizer.ts:75-79` and wi6 `:222-225`. Annotate, never rewrite — the convention for a wrong
claim already in the repository is a correction beside it.

## Why c5 is ticked

Conjunct 1 holds on both readings of "every `UNRESOLVED:` entry": the literal colon form occurs once
(`docs/engine-baseline.md:372`, mitigation at `:378`), and on the broad reading there are four
UNRESOLVED items in the document (`:268`, `:372`, §9's `ratelimit.trigger-safety-and-simulation-strategy`
id at `:404`, and `:685`) against four mitigation notes (`:270`, `:378`, `:343` plus `:378`, `:694`).

Conjunct 2 is clean. Had either item above been a genuine reliance on an UNRESOLVED fact as settled,
conjunct 2 would have been UNMET and the box would have stayed unticked — that was the pre-agreed
handling, and it did not have to be used.

## Remedied 2026-08-07 — both nits closed at the point of edit

PR #123 closed both. The `rejected`-status hedge is now recorded where a maintainer meets it rather
than only in the baseline: `e2e/matrix/orchestration/test/limit-parked-resume-restart.test.ts`
carries a comment stating that the status is unobserved live, that `docs/engine-baseline.md` §8
records it as UNRESOLVED, that this fixture is a recorded payload spread into a fake-engine script
and never a claim about engine behaviour, and that the shape must not be promoted into a live-facing
assertion or cited as observed — with a pointer to the sibling constraint in the scheduler's own run
driver test so the two cannot drift apart silently. The event-normalizer nit is closed by a dated
correction block inside `docs/evidence/phase-06/wi2-event-normalizer.md`, which withdraws the stale
injection-scope sentence in place rather than editing it away.

Both are documentation-of-a-constraint changes; neither moves a test count, and neither is claimed
to. **Residual: none.**
