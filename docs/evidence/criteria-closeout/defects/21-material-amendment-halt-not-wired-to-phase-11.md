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
- `haltOnStopCondition` has no callers at all — it is defined, exported, mentioned in one prose comment in `create-run.ts:7`, and invoked nowhere.
- `@crabgic/gates` does not depend on `@crabgic/supervisor`, so the "reached transitively via 14→13→11" path the roadmap's own §In scope predicts does not exist in the dependency graph either.

`packages/gates/src/material-amendment-guard.ts`'s own doc comment is honest about this ("this phase's own minimal, testable proof that the signal WOULD halt a run"). The criterion, however, asserts that it _does_, via 11.

**What is missing — the second named artifact.** The criterion also names "the halted run's journal excerpt". The halt path journals nothing: `throwIfMaterialAmendment` throws before `registry.fireByTag` is reached, and `fireByTag` is the only thing on that path that writes an `EvidenceRecord`. The suite's only journal-query assertions (`:148-166`) belong to the run that **completes**, not to a halted one. `docs/evidence/phase-21/README.md` presents those same entries under the heading "Journal excerpt (MAJOR-1's named evidence artifact)", which reads as the halted run's excerpt and is not.

### Search trail

- `docs/evidence/phase-21/README.md` §"Exit criterion → evidence mapping", first bullet — names `remote-verification-e2e.test.ts` and the journal excerpt.
- Read `packages/gates/src/remote-verification-e2e.test.ts` in full (304 lines); the halt scenario is `:203-263`, the control at `:265-302`.
- `grep -rn "throwIfMaterialAmendment\|buildMaterialAmendmentSignal\|MaterialAmendmentSignal" packages e2e` (excluding `dist/`) — hits only in `packages/gates` and its tests.
- `grep -rn "haltOnStopCondition" packages e2e` (excluding `dist/`) — definition plus one comment; zero call sites.
- `packages/gates/package.json` dependency list — no `@crabgic/supervisor`.
- `packages/supervisor/src/intake/stop-conditions.ts:36-45` — the seven-member `STOP_CONDITION_KINDS`, including `"material_amendment"`.

## Severity

**blocking-guarantee** for clause two. The criterion's purpose is that a material remote-side edit mid-run "reliably reaches phase 11's approval gate instead of being overwritten" (roadmap §Goal). At `30f931e` the classifier and the signal exist and are well tested, but nothing consumes the signal, so a real mid-run Jira edit reaches no stop condition at all. The missing journal excerpt is **evidence-channel-only** on its own, but it is a symptom of the same gap: there is no halted run to excerpt because no halt mechanism is wired.

Clause one is unaffected and is separately evidenced in `docs/evidence/criteria-closeout/phase-21.json` criterion 1's citations.

## Proposed remedy

Smallest honest fix, in the order that keeps each step verifiable:

1. **Wire the signal to 11's stop condition.** Add a consumer that takes a `MaterialAmendmentSignal` and calls `haltOnStopCondition({ kind: "material_amendment", … })`. It must not live in `packages/gates` (that would invert 21→14→13→11 into a `gates → supervisor` edge and would fail `scripts/check-package-graph-acyclic.mjs`); the natural home is the same place that will own 18's milestone-revision polling loop, in or above `packages/supervisor`, with `@crabgic/gates` supplying only the pure classifier it already exports. Failing-first test: a material signal drives a run to `blocked`; a non-material one leaves it in `final_verifying`.
2. **Capture the halted run's journal excerpt from that path** — after the halt, `queryEntries({ type: "adjudication_decision" })` must yield the `material_amendment` decision for the run, and the run record must read `blocked`. That assertion _is_ the criterion's second named artifact; commit its output under `docs/evidence/phase-21/`.
3. **Correct `docs/evidence/phase-21/README.md`'s "Journal excerpt" heading** so it says what it is (the completing run's `evidence_pointer` entries), and stop presenting it as the halted run's excerpt.

Steps 1 and 2 are the criterion; step 3 is bookkeeping and can ride along.

**Effort sizing: M.** No new contract, no schema change, no live system — one wiring module, one integration test, one evidence capture. It needs CI only (no owner subscription, no live engine). The one design question a reviewer must settle first is which package owns the polling→classify→halt loop, because `haltOnStopCondition` currently having zero callers means this is the first caller anyone has had to place.

**Ticket-ready:** yes.
