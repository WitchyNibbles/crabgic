# Gap 18 — implementation roast, rounds 10 and 11 (2026-07-28)

Two rounds in which **nothing behavioural broke** — a first — but the _evidence_ was wrong
in ways that would have let a later change go wrong quietly.

## Round 10

| #   | Sev       | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **MAJOR** | **The round-9 headline change shipped with no test.** `transient` exists for exactly one consumer decision, and two independent mutants (force the ternary false; delete it and restore the old string) both **survived** a green suite. The file sat at **81.3% branch coverage — above this repo's own 80% gate**, which is how it got through. The commit that added it had just criticised another branch for shipping untested, in those words. |
| 2   | MODERATE  | **The deriver could emit a policy its own doctor rejects, with an unfollowable remedy.** `[ ] { } * ? \` are legal Linux directory names, so a package called `old[1]` produced `packages/old[1]/dist`; `install`'s only refusal is vacuity, so it **wrote** it, and `doctor` then said "use literal directory names" — which the owner cannot do, because the directory _is_ named that.                                                            |
| 3   | MINOR     | **A scratch entry of `"."` granted the whole worktree** — the unnarrowed pre-Gap-18 grant — while the only check reporting on it said it granted nothing. 737 of 200,000 entries disagreed, all in that direction. Understating a grant is the unacceptable direction.                                                                                                                                                                               |

Round 10 also confirmed the `classifyOpenFailure` extraction was a **pure refactor**: 0
routing diffs across 27 errno codes and 10 real-filesystem scenarios.

## Round 11

| #   | Sev          | Finding                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3   | **MODERATE** | **The doctor passed a policy that refuses 100% of dispatches.** `allowedPathPrefixes: ["src", "dist/**"]` rendered as granted and passed, while `isContained` refused every dispatch for ever. `isVacuousPolicy` needs only _one_ usable prefix, so it structurally cannot catch a mixed list. Round 3's F3 in its **third** field.                                                                 |
| 1   | MINOR        | **A correctness comment's premise had rotted.** The normalizer's "segments are not trimmed" argument cited `narrowedAllowWrite` as emitting `validateOwnedPath`'s output; round 10 changed that. Measured: 11,650 of 13,061 shared paths now differ in string form, **0 in resolved directory**. Conclusion survives, premise false — and rounds 4–8 each went wrong reasoning from that paragraph. |
| 2   | MINOR        | **A guard implied a boundary it did not provide.** `validateOwnedPath` in `narrowedAllowWrite` is provably dead — 0 of 60,000 entries separate it from the normalizer, and deleting the try/catch survived the suite. Kept for the boundary it documents; the comment no longer overclaims.                                                                                                         |

## The measurements that mattered

Round 11 ran the full battery against the compiler change and found **nothing broken**:

- **Owned-path grants**: 12,233 rewritten, 583 dropped, **0 legitimate grants lost** — every
  dropped form also normalizes to `undefined` in the gate, so it was already unreachable.
  POSIX-resolved directory differences across all 12,233 rewrites: **0**.
- **Gate vs compiler**: FP **0**, FN **0** over 59,982 unique owned paths. Round 8/9
  agreement survived.
- **Deriver skip**: `/dist` and `/coverage` disagree **0 times** over 112,092 comparisons, so
  the dist-only check was equivalent; skipping does not consume a capped slot (verified in
  three shapes).
- **Mutation battery**, full suite per mutant: **7 killed, 2 survived** — both survivors
  provably non-defects (the dead guard, and an equivalence its own test says it pins).

## A test that encoded the defect

Round 11's finding 3 was guarded by a test asserting a mixed list **passes**. I wrote it in
the round-3 fix. It survived four rounds because vacuity and usability are different
questions and only one was being asked — a green assertion is not evidence that the
assertion is the right one.

## Eleven rounds

The gradient is real: rounds 4–8 found fixes that were outright wrong; rounds 9–10 found
fixes that were correct but under-tested or one consumer short; round 11 found no
behavioural defect at all in the code under review, only prose that had drifted from it and
one bug inherited from round 3. That is not convergence — the loop terminates on a round
with **nothing** novel and falsifiable — but it is a different failure mode each time, and
the rounds are getting cheaper to answer.
