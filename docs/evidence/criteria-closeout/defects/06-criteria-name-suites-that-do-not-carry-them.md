# Defect 06-criteria-name-suites-that-do-not-carry-them

**Phase:** 06 — Claude engine adapter (`roadmap/06-claude-engine-adapter.md`, exit criteria 6 and 9)

**Criteria (verbatim):**

> `limitSignal` fires against phase-00's captured (or an equivalently live-triggered) rate-limit shape — `limit-signal.test`.

> `spawn`/`resume` refuse to start outside `docs/engine-baseline.md`'s accepted version range — `version-gate.test`.

**Found:** 2026-08-05, criteria-closeout pass (phases 00 and 06), at
`9abc3fd911186cd83bbd02b2d905f613da2ca8e3`, by mutation probe rather than by reading.

**Severity:** pointer drift, **no missing guarantee**. Both criteria's substance is fully and
non-vacuously pinned in the default gate — which is why both boxes are ticked. What is wrong is
where each criterion points a reader to find it. That is worth a record because the repository's own
history shows coverage migrating between rules with no test failing; a criterion aimed at the wrong
suite is exactly how the next reader fails to notice when the real bearer is deleted.

Full probe transcript, with baseline → mutation → restore at one tree and every test count recorded:
`docs/evidence/phase-06/closeout/closeout-bearer-probes.txt`.

## Finding 1 — c9: `version-gate.test` does not test `spawn` or `resume`

`packages/engine-claude/src/version-gate.test.ts` tests the pure helper
`assertEngineVersionAccepted` (acceptance, refusal, malformed input, typed `reason`) plus a
baseline-document sync check. It never constructs an adapter and never calls `spawn` or `resume`.

**Probe A.** Deleted `assertEngineVersionAccepted(this.engineVersionResolver());` from
`ClaudeEngineAdapter.resume()` (`packages/engine-claude/src/adapter.ts:453`), rebuilt (`tsc -b` exit
0, so the measurement is of the new code and not a stale `dist`), and ran the package suite.

| probe                                       | result                    |
| ------------------------------------------- | ------------------------- |
| A0 baseline, unmutated                      | `Tests  314 passed (314)` |
| **A1 version gate deleted from `resume()`** | **`Tests 1 failed         | 313 passed (314)`** |

The single reddened test is `resume() also refuses synchronously outside the accepted range` — in
**`packages/engine-claude/src/adapter.test.ts:233`**. All 20 of `version-gate.test.ts`'s tests
stayed green.

Where the guarantee actually lives:

- `packages/engine-claude/src/adapter.test.ts:217` — `spawn()` refuses, **and** proves `expect(calls).toHaveLength(0)` plus
  `expect(orderLog).toHaveLength(0)`: zero `sdkQuery` invocations and zero journal appends, so the
  refusal precedes every side effect.
- `packages/engine-claude/src/adapter.test.ts:233` — `resume()` refuses, likewise with `expect(calls).toHaveLength(0)`.
- `packages/engine-claude/src/adapter.ts:429` / `:453` / `:481` — the three production call sites. `fork()` is gated too, which
  the criterion does not ask for.

What `version-gate.test` _does_ carry is the criterion's other half — "outside
`docs/engine-baseline.md`'s accepted version range". `version-gate.test.ts:109` reads the real
document off disk and `:113` asserts the shipped constants match its headline range, so the gate
cannot drift from the record it cites. That half is load-bearing and should not be dropped.

## Finding 2 — c6: `limit-signal.test` does not bind the _captured_ values

`packages/engine-claude/src/limit-signal.test.ts:52-56` asserts
`expect(event).toEqual({ type, sessionId, ...payload })` — a tautology over whatever the imported
constant happens to hold. It pins the normalizer's passthrough, which is real, but not the recorded
values.

**Probe B.** Changed the recorded `utilization` in
`packages/testkit/src/fake-engine/rate-limit-fixtures.ts` from the captured `0.96` to `0.97`. This
symbol crosses package boundaries into `packages/scheduler` and `e2e/matrix`, so the probe rebuilt
first; a src-only run would have under-reported.

| probe                                   | result                    |
| --------------------------------------- | ------------------------- |
| B0 baseline, unmutated                  | `Tests  724 passed (724)` |
| **B1 recorded utilization 0.96 → 0.97** | **`Tests 1 failed         | 723 passed (724)`** |

The single reddened test is `the allowed_warning payloads carry a monotonically distinct utilization
set {0.96, 0.98, 0.99}` — in `packages/testkit/src/fake-engine/rate-limit-fixtures.test.ts:33`.
`limit-signal.test.ts` stayed green.

Where the "against phase-00's captured shape" conjunct actually lives:
`packages/engine-claude/src/event-normalizer.test.ts:90-113`, which reads the committed phase-00
fixtures off disk — `event-normalizer.test.ts:18` resolves
``new URL(`../../../spikes/fixtures/${name}`, import.meta.url)`` — and asserts
`expect(rateLimitMessages).toHaveLength(16)` with every sample normalizing to a `limitSignal`.
`docs/engine-baseline.md:364` independently names that file as the intended consumer of this fixture
set, so this is the wiring phase 00 asked for rather than a substitute found after the fact.

`event-normalizer.test.ts` staying green under probe B is **not** a gap — it is the proof of
independence. The fixture-backed suite and the hand-typed constants are two genuinely separate
sources, so perturbing one does not move the other.

### Finding 2b — a tautology inside the fixture-pinning file

`packages/testkit/src/fake-engine/rate-limit-fixtures.test.ts:11-19`'s first case asserts
`RECORDED_RATE_LIMIT_PAYLOADS` equals an array of its own four members. That is a tautology over a
literal: the array is defined as exactly those four constants one file over, so the assertion cannot
fail. The file's doc comment at `:10` calls itself a
"docs/engine-baseline.md §8 verbatim schema check", which oversells that case.

Its sibling cases are the non-vacuous ones and are what probe B reddened: `:29` pins every payload's
`resetsAt` to the verbatim recorded epoch, and `:39` pins the distinct utilization set.

## Remedy

**Effort: S.** Cheap, and none of it is urgent since no guarantee is missing — each item
below is a few lines in one test file, or a criterion-wording amendment needing owner sight rather
than engineering time. (The optional structural option at the end is **L** and is noted, not
proposed.)

1. **c9** — either add a spawn/resume refusal case to `version-gate.test.ts` (importing the adapter,
   duplicating what `packages/engine-claude/src/adapter.test.ts:217`/`:233` already prove), **or** amend the criterion's
   suite pointer to name `adapter.test` alongside `version-gate.test`. The second is more honest:
   `adapter.test.ts` is where an adapter-level guarantee belongs, and the existing tests there are
   stronger than a duplicate would be. Amending an approved criterion's wording needs the
   `WORDING-MISMATCH` route and owner sight, so it is proposed here rather than done.
2. **c6** — same choice. Either have `limit-signal.test.ts` read the committed
   `spikes/fixtures/` transcripts directly (duplicating `event-normalizer.test.ts:90-113`), or amend
   the pointer to name both suites.
3. **Finding 2b** — replace `rate-limit-fixtures.test.ts:12-19`'s tautological case with one that
   compares the constants against the committed fixture bytes, or delete it and let `:29`/`:39`
   stand. Also soften the `:10` doc comment, which currently claims more than the file's first case
   delivers.

A cheaper structural option covering all three: have the criterion-closeout tooling resolve each
criterion's named suite and warn when a mutation to the criterion's subject does not redden that
suite. That is a larger piece of work and is noted rather than proposed.

## Why both boxes are still ticked

Both criteria's substance is fully evidenced and runs per push. c9's two conjuncts (`spawn` and
`resume`) are each pinned, with zero-side-effect proofs, and the range is pinned to the baseline
document. c6's two conjuncts are each pinned, one in the named suite and one in a fixture-backed
sibling. Nothing is unguarded; a pointer is aimed slightly off. Ticking on measured substance and
recording the drift here is the honest handling — leaving the boxes unticked would misreport a real,
working guarantee as absent.

## Remedied 2026-08-07 — the add-tests route, with a counterfactual

PR #123 took this record's add-tests route rather than the criterion-wording alternative, so the
wording question this record raised is retired: nothing is reworded, and a reader who follows either
criterion's own pointer now lands where the guarantee is.

Criterion 9: `version-gate.test.ts` now constructs a real engine adapter and asserts that `spawn()`
and `resume()` refuse out of range with a typed kind and reason, with zero engine calls and zero
journal appends, plus a does-not-refuse control at the tested version. Criterion 6: `limit-signal.test.ts`
now reads the committed spike fixture transcripts off disk and drives the criterion's subject against
those bytes.

The measurement that makes this a delta rather than something already true is the **counterfactual**:
`docs/evidence/phase-06/criteria-suite-pointer-probes-batchL.txt` runs the record's own two mutations
against the **pre-batch** versions of those files and reproduces this record's original result
exactly — deleting the version gate from `resume()` reddened one test, in `adapter.test.ts`, with the
whole of the criterion's named suite green. After the change the same mutation reddens two, and one
of them is in the suite the criterion names. Probes A and B are the after; probe C is the before.

**No box moved.** Both criteria were already ticked on measured substance; what changed is where the
pointer lands. **Residual: none.**
