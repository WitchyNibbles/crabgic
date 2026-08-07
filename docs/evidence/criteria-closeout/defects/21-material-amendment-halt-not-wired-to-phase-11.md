# 21 — the material-amendment halt never reaches phase 11's stop condition, and no halted-run journal excerpt exists

**Phase:** 21 — Connector evidence integration & drift CI (`roadmap/21-connector-evidence-integration.md`), exit criterion 1

**Criterion (verbatim):**

> E2E on fakes: a run completes only when every requirement's `EvidenceRecord` carries a confirmed remote revision; a seeded mid-run tracked-field edit halts the run via 11's `material amendment` stop condition before `final_verifying`. Evidence: integration suite in `packages/gates` + the halted run's journal excerpt.

**Found:** 2026-08-02, criteria-closeout pass batch 4, against `main` @ `30f931eab97b8360102498d4b766513be67241d0`.

## Gap

The criterion has two clauses and two named artifacts. One clause and one artifact are missing.

**What exists.** Clause one is fully evidenced. `packages/gates/src/remote-verification-e2e.test.ts:94-146` fires the `remote_verification` gate through a real `createGateRegistry()` against a real `@crabgic/journal` store for a three-requirement fixture, and asserts the run is not complete while one requirement is unbound (`expect(allGatesPassed(firstResults)).toBe(false);`) and complete once it is bound and confirmed (`expect(allGatesPassed(secondResults)).toBe(true);`), with the emitted evidence literally carrying `confirmed-revision:<id>:<revision>`. That half is not in dispute.

**What is missing — clause two.** The criterion says the seeded edit "halts the run via 11's `material amendment` stop condition". What the suite proves is narrower and different in kind:

```
packages/gates/src/remote-verification-e2e.test.ts:240-249
    const runToFinalVerifying = async (): Promise<void> => {
      throwIfMaterialAmendment(signal);
      finalVerifyingGateFired = true;
      await registry.fireByTag("security", finalVerifyingContext(requirementId, "object-f4"));
    };
```

The halt is produced by the test's own three-line helper, calling `throwIfMaterialAmendment` — a phase-21 function (`packages/gates/src/material-amendment-guard.ts:26`) whose entire body is `if (signal.material) throw new MaterialAmendmentDetectedError(signal);`. Phase 11's actual `material amendment` stop condition is `haltOnStopCondition` (`packages/supervisor/src/intake/stop-conditions.ts:73`), which transitions the run to `blocked` through `transitionRun` and journals an `adjudication_decision` entry recording the kind and reason. Nothing connects the two:

- `MaterialAmendmentSignal`, `buildMaterialAmendmentSignal` and `throwIfMaterialAmendment` have no callers outside `packages/gates`' own barrel and its own tests.
- `haltOnStopCondition` has **no production caller**. It is defined and exported in `packages/supervisor`, called from exactly two test files — `packages/supervisor/src/intake/stop-conditions.test.ts:40,63,73` and `packages/cli/src/intake/intake.e2e.test.ts:232` — and mentioned in two prose comments (`create-run.ts:7`, `create-run.test.ts:6`). None of those call sites is in, or reachable from, `packages/gates`.
- `@crabgic/gates` does not depend on `@crabgic/supervisor`, so the "reached transitively via 14→13→11" path the roadmap's own §In scope predicts does not exist in the dependency graph either.

> **Correction, 2026-08-02 (review of PR #76).** This section first read "`haltOnStopCondition` has no callers at all … invoked nowhere", and the search trail below reported "zero call sites". Both were false: the grep behind them excluded `*.test.*`, so the trail did not reproduce. The corrected statement is above. The verdict is unchanged — the reviewer confirmed as much — because what this defect turns on is the absence of a _wiring_ from 21's signal to 11's condition, not the absence of 11's condition.
>
> The correction also cuts in a useful direction, so it is not merely bookkeeping. `packages/cli/src/intake/intake.e2e.test.ts:221-244` is an `it.each` over all seven `STOP_CONDITION_KINDS` — `material_amendment` among them — that walks a run to `running` and then asserts `expect(record.runState).toBe("blocked")` and `expect(runs.get(runId)?.runState).toBe("blocked")`. **11's halt is not dead code; it is exercised end to end.** The remedy below is therefore genuinely a wiring task against a working mechanism, which is what sizes it M rather than L.

`packages/gates/src/material-amendment-guard.ts`'s own doc comment is honest about this ("this phase's own minimal, testable proof that the signal WOULD halt a run"). The criterion, however, asserts that it _does_, via 11.

**What is missing — the second named artifact.** The criterion also names "the halted run's journal excerpt". The halt path journals nothing: `throwIfMaterialAmendment` throws before `registry.fireByTag` is reached, and `fireByTag` is the only thing on that path that writes an `EvidenceRecord`. The suite's only journal-query assertions (`:148-166`) belong to the run that **completes**, not to a halted one. `docs/evidence/phase-21/README.md` presents those same entries under the heading "Journal excerpt (MAJOR-1's named evidence artifact)", which reads as the halted run's excerpt and is not.

### Search trail

- `docs/evidence/phase-21/README.md` §"Exit criterion → evidence mapping", first bullet — names `remote-verification-e2e.test.ts` and the journal excerpt.
- Read `packages/gates/src/remote-verification-e2e.test.ts` in full (304 lines); the halt scenario is `:203-263`, the control at `:265-302`.
- `grep -rn "throwIfMaterialAmendment\|buildMaterialAmendmentSignal\|MaterialAmendmentSignal" packages e2e` (excluding `dist/`) — hits only in `packages/gates` and its tests.
- `grep -rn "haltOnStopCondition" packages e2e --include=*.ts | grep -v /dist/` — **unfiltered, reproducible verbatim**: the definition, four call sites (`stop-conditions.test.ts:9,33,40,63,73` and `packages/cli/src/intake/intake.e2e.test.ts:29,232`) and two prose comments (`create-run.ts:7`, `create-run.test.ts:6`). An earlier version of this line excluded `*.test.*` and reported "zero call sites"; that exclusion is what produced the false absolute corrected above, and it is spelled out here so the next reader runs the grep that reproduces rather than the one that did not.
- Read `packages/cli/src/intake/intake.e2e.test.ts:218-245` to characterise that call site rather than counting it.
- `packages/gates/package.json` dependency list — no `@crabgic/supervisor`.
- `packages/supervisor/src/intake/stop-conditions.ts:36-45` — the seven-member `STOP_CONDITION_KINDS`, including `"material_amendment"`.

## Severity

**blocking-guarantee** for clause two. The criterion's purpose is that a material remote-side edit mid-run "reliably reaches phase 11's approval gate instead of being overwritten" (roadmap §Goal). At `30f931e` the classifier and the signal exist and are well tested, but nothing consumes the signal, so a real mid-run Jira edit reaches no stop condition at all. The missing journal excerpt is **evidence-channel-only** on its own, but it is a symptom of the same gap: there is no halted run to excerpt because no halt mechanism is wired.

Clause one is unaffected and is separately evidenced in `docs/evidence/criteria-closeout/phase-21.json` criterion 1's citations.

## Proposed remedy

Smallest honest fix, in the order that keeps each step verifiable:

1. **Wire the signal to 11's stop condition.** Add a consumer that takes a `MaterialAmendmentSignal` and calls `haltOnStopCondition({ kind: "material_amendment", … })`. It must not live in `packages/gates` (that would invert 21→14→13→11 into a `gates → supervisor` edge and would fail `scripts/check-package-graph-acyclic.mjs`); the natural home is the same place that will own 18's milestone-revision polling loop, in or above `packages/supervisor`, with `@crabgic/gates` supplying only the pure classifier it already exports. Failing-first test: a material signal drives a run to `blocked`; a non-material one leaves it in `final_verifying`. `packages/cli/src/intake/intake.e2e.test.ts:221-244` is the closest existing shape to copy — it already drives `haltOnStopCondition` for `material_amendment` against a run walked to `running` — so the new test differs from it only in what supplies the trigger.
2. **Capture the halted run's journal excerpt from that path** — after the halt, `queryEntries({ type: "adjudication_decision" })` must yield the `material_amendment` decision for the run, and the run record must read `blocked`. That assertion _is_ the criterion's second named artifact; commit its output under `docs/evidence/phase-21/`.
3. **Annotate — do not rewrite — `docs/evidence/phase-21/README.md`'s "Journal excerpt (MAJOR-1's named evidence artifact)" heading**, recording that the entries beneath it are the _completing_ run's `evidence_pointer` entries rather than a halted run's. Annotation rather than correction-in-place is the convention that file already carries: `d0a6520` added a dated pre-rename header to this very file on the stated principle that "this is an evidence file: the original text stays verbatim and the mapping lives here." Fold the §Deviations item 4 correction (from the sibling tenant-boundary defect) into the same annotation. **The `@eo/` naming in that file needs nothing** — `d0a6520`'s sweep already annotated it deliberately, and rewriting the names would violate the rule it just established.

Steps 1 and 2 are the criterion; step 3 is bookkeeping and can ride along.

**Effort sizing: M.** No new contract, no schema change, no live system — one wiring module, one integration test, one evidence capture. It needs CI only (no owner subscription, no live engine). The one design question a reviewer must settle first is which package owns the polling→classify→halt loop, because this would be the **first production caller** of `haltOnStopCondition` anyone has had to place. The halt mechanism itself is already exercised end to end, which is what keeps this M rather than L.

**Ticket-ready:** yes.

## Remedied 2026-08-07 — the first production caller, and the excerpt that did not exist

PR #113 wired 21's signal to 11's stop condition:
`packages/supervisor/src/intake/material-amendment-halt.ts:102` is the first and only production
caller of `haltOnStopCondition`, which had zero repository-wide before. The criterion's second named
evidence channel — the halted run's journal excerpt — is now a committed artifact at
`docs/evidence/phase-21/halt-wiring-journal-excerpt-batchB.txt`, produced over a real temp-dir
journal, a real runs registry, 02's real run-lifecycle state machine and 21's real classifier. In it,
the `running → blocked` transition precedes the `adjudication_decision`, whose rationale names the
stop-condition kind verbatim; and "before `final_verifying`" is proven against the state machine
rather than a flag, by an `IllegalTransitionError` on the attempt to resume, with `blocked` absorbing.
The mandatory does-not-halt control runs on a second run, stays `running`, journals zero decisions and
walks on cleanly to `final_verifying`.

Probes M3 and M4 are what make it non-vacuous: M3 reddens three with both does-not-halt controls
green, and M4 pins the kind rather than the mere existence of a decision
(`docs/evidence/phase-21/halt-wiring-probes-batchB.txt`).

**Remedy step 3 verified, not assumed.** The phase-21 evidence README's "Journal excerpt" section now
carries a dated annotation stating plainly that it is **not** the halted run's excerpt and pointing
at the one that is. `git log` on that path shows PR #113 (`b3bf737`) as the commit that added it, so
the step landed in the same change as the wiring.

**Kept open:** daemon wiring of the halt. The composed daemon does not invoke
`haltRunOnMaterialAmendment` today, and no production milestone-polling loop exists to feed it —
sized L, and named in the module's own doc comment so a maintainer meets it at the point of edit
rather than here.
