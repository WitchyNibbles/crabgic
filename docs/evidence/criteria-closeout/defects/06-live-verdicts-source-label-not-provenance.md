# Defect 06-live-verdicts-source-label-not-provenance

**Phase:** 06 — Claude engine adapter (`roadmap/06-claude-engine-adapter.md`, exit criterion 7)

**Criterion (verbatim):**

> Fake-vs-live parity: identical fixture verdicts across `packages/testkit`'s fake engine and the real engine — `fake-live-parity.test`.

**Found:** 2026-08-05, criteria-closeout pass (phases 00 and 06), at
`9abc3fd911186cd83bbd02b2d905f613da2ca8e3`, while producing the parity proof this criterion needed.

**Severity:** honesty mechanism defeated; **no product defect, and the underlying claim is now
true.** This pass's green live run regenerated the fixture from real-engine observations and the
`git diff` came back clean, so c7 is closed on measured evidence
(`docs/evidence/phase-06/closeout/closeout-live-batch.txt` §4). What this record is about is the
interval before that, during which the repository asserted a provenance it did not have — and about
the fact that the mechanism designed to prevent exactly that is dead code.

## Gap

`packages/engine-claude/src/live/live-harness.ts:969` declares a two-member provenance label:

```
export type LiveVerdictsSource = "live" | "offline-baseline";
```

and the writer's doc comment at `live-harness.ts:970-977` states its purpose:

> `source` records this payload's provenance: `"live"` from a green `@live` conformance run,
> `"offline-baseline"` from `deriveOfflineBaselineVerdicts` — machine-checkable so the committed
> file's honesty never has to be taken on faith.

Three things are wrong with that in practice.

### 1. An unrelated commit silently flipped the label from honest to false

Measured with `git show <rev>:packages/engine-claude/src/live/fixtures/live-verdicts.json`:

| revision  | subject                                                        | `engineVersion` | `source`             | md5                                |
| --------- | -------------------------------------------------------------- | --------------- | -------------------- | ---------------------------------- |
| `55874d8` | `feat: phase 06 Claude Code worker runtime (SDK transport)`    | `2.1.210`       | `"offline-baseline"` | `972366565ec879a4314597cf4c045f50` |
| `29b3c46` | `feat: wire learn-* by binding promotion to an ongoing intake` | `2.1.218`       | **`"live"`**         | `ada6ddd1cc98cf10146a8c9629b6c95c` |
| `HEAD`    | —                                                              | `2.1.218`       | `"live"`             | `ada6ddd1cc98cf10146a8c9629b6c95c` |

Phase 06 landed the file **honestly labelled** `"offline-baseline"`. The flip to `"live"` came in
`29b3c46`, a commit about wiring `learn-*` promotion to an ongoing intake — nothing to do with the
live conformance suite, and at a time when no green `@live` run had ever happened. The
`engineVersion` bump in the same commit (2.1.210 → 2.1.218) was correct and tracks the re-baseline;
the `source` flip was not.

From `29b3c46` until this pass's run, the repository claimed a real-engine provenance for
fake-derived bytes.

### 2. Nothing checks the label, so "machine-checkable" was not true

The comment calls the label machine-checkable. No check exists. `fake-live-parity.test.ts:100-103`
deliberately declines to look at it:

> Corruption/regression guard (F4): the committed mechanism must match the shared static
> classifier — holds whether `source` is "offline-baseline" or "live"-confirmed, since both are
> all-deny with the same classification.

That is a reasonable choice for _that_ assertion, but it means the field is written by hand,
consumed by nobody, and can say anything.

### 3. The honest branch is dead code

`deriveOfflineBaselineVerdicts` (`live-harness.ts:951`) is the function the doc comment names as the
source of an `"offline-baseline"` payload. It has **zero call sites**:
`git grep -n 'deriveOfflineBaselineVerdicts(' -- packages e2e scripts` returns only its own
definition line. The only caller of `writeLiveVerdicts` anywhere is
`envelope-conformance.live.test.ts:147`, which passes the literal `"live"`. So the writer can only
ever emit `"live"`, and the branch that would have kept a fake-derived file labelled honestly is
unreachable.

### 4. A stale doc comment now states the opposite of the committed value

`packages/engine-claude/src/fake-live-parity.test.ts:9-10` reads:

> HONEST CURRENT STATE: the committed file's `source` is presently `"offline-baseline"` — it was
> generated deterministically OFFLINE by `live-harness.ts`'s `deriveOfflineBaselineVerdicts`

That has been untrue since `29b3c46`. The same comment block, at `:16-19`, sets the criterion's
closing condition:

> the parity claim is genuinely circular until a green `@live` run ... replaces the file with
> `source: "live"` real-engine observations. Only at that point does this test become fake-vs-live in
> truth. The roadmap/06 "fake-vs-live parity" exit criterion therefore stays OPEN even though this
> test is green — closing it requires a `source: "live"` committed file.

Read against finding 1, that condition was **satisfiable by editing one string** — and had in fact
already been "satisfied" that way, by an unrelated commit, without any live run. The stated gate was
not a gate.

## Why c7 is nonetheless ticked

Because the substance was measured, not inferred from the label. This pass ran
`envelope-conformance.live.test` green against the pinned 2.1.218 engine;
`envelope-conformance.live.test.ts:147` rewrote the committed file from real-engine observations
(guarded at `:144` so only a genuinely green run persists); the file's mtime moved into the run's
window, proving it was actually rewritten; and `git status --porcelain` on it came back **empty**,
with the digest still `ada6ddd1cc98cf10146a8c9629b6c95c`.

So the fake-derived bytes and the real-engine-derived bytes are byte-identical. That is the parity
proof, and it is independent of the label — which is the point: **the mtime, the green run and the
clean diff are the provenance; the `source` string is not.**

wi5 §6 predicted exactly this proof — "running `envelope-conformance.live.test` regenerates this file
byte-identically from real observations — `git` will show no diff on a green run, confirming the two
engines agree" — and it held.

## Remedy

**Effort: S.** None of it is urgent, since the label is now accurate and the underlying claim is
proved. Item 1 is a signature change on one function with one call site; items 2–4 are a deletion and
two comment corrections. But the mechanism should either work or be removed.

1. **Make the label machine-checkable, or delete it.** The cheapest honest version: have
   `writeLiveVerdicts` refuse to write `"live"` unless it is called from a context that observed a
   real engine — e.g. require the canary's `CanaryResult` as an argument, so the type system prevents
   an offline caller from claiming live provenance. A hand-passed string literal cannot carry
   provenance and should not pretend to.
2. **Wire or remove `deriveOfflineBaselineVerdicts`.** Dead code cited in a doc comment as the
   source of a provenance value is worse than no function at all: it makes the mechanism look
   implemented.
3. **Correct `fake-live-parity.test.ts:9-19`** — annotate rather than rewrite, per the repository's
   convention: the committed source has read `"live"` since `29b3c46`, and the criterion's real
   closing evidence is the clean-diff regeneration recorded in
   `docs/evidence/phase-06/closeout/closeout-live-batch.txt` §4, not the string itself.
4. **Consider a repository-wide lesson.** A fixture whose provenance field can be edited by any
   commit touching the file is the same shape as the cassette-parity tautology this criterion was
   already vulnerable to. Provenance that is not derived is decoration.

## Note on scope

This record deliberately does not fix anything: a closeout pass files defects. The one change this
pass made to the file was to run the sanctioned live suite, which rewrote it with identical bytes —
so the committed content is unchanged from `origin/main` and appears in no diff.

## Addendum 2026-08-07 — items 1-3 remedied; item 4 stays open with an S-sized remedy attached

PR #123 closed the first three items. Item 2 was resolved as **wire, not delete**, and the reason is
worth keeping: deleting the label would rewrite the very artifact the parity criterion rests on, so
the writer was gated instead. The only caller of the verdict writer must now present a real canary
result, and a fabricated one is refused at runtime as well as by the type system — the type-level
half was falsified rather than asserted, with a `@ts-expect-error` directive going unused (TS2578)
under the widening and the runtime guard's own discriminant dependence (TS2339) as a second,
independent tripwire. Evidence:
`docs/evidence/phase-06/live-verdicts-provenance-probes-batchL.txt`, which also records a line-number
note so nobody "corrects" a correct transcript: a later comment-only block shifted the directive from
`:110` to `:121`, and the re-run at the tree the branch lands as is quoted rather than assumed.

**Item 4 stays open.** The gate binds the **writer**, not the committed artifact: nothing reads the
committed `source` field, so a hand-edit of that string is still undetectable — which is exactly what
one earlier commit did, and how the label came to claim a live provenance months before any green
`@live` run existed. What changed is that no **code path** can mint the label any more. What did not
change, and should not be oversold, is that the criterion's provenance evidence is still the green
run, the moved mtime and the clean `git diff` recorded in the phase-06 closeout transcript — never
the `source` string.

**S-sized remedy now attached**, since this record previously named the gap without one: a single
`expect(committed.source).toBe("live")` in the fake/live parity test. That does not derive provenance
from the artifact — it converts a silent hand-edit into a CI-visible one, which is a strictly smaller
and honest claim. It was deliberately **not** built by the batch that closed items 1-3, because a
closeout pass files defects rather than fixing them and this one was outside that batch's own remedy
list. Deriving provenance from the artifact itself would need the file to carry something a fake
cannot reproduce, which is a larger design change than this record proposes.

Status stays **open**.
