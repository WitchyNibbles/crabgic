# Gap 18 — implementation roast, round 9 (2026-07-28)

Round 9 re-ran round 8's exact experiment and **confirmed the regression is gone**, then
found three smaller things — two of them consequences of the round-8 fix stopping one field
short of its consumer.

## The confirmation, with a harness proven non-vacuous

| Measurement                                   | Result                                                              |
| --------------------------------------------- | ------------------------------------------------------------------- |
| Gate vs compiler at HEAD                      | **0 false positives, 0 false negatives** over 240,000 comparisons   |
| Same probe with the round-7 mutant re-applied | **1651 FPs / 296 FNs**                                              |
| `isUsablePathPrefix` vs `normalizePath`       | **0 mismatches in each direction**, 60,000 verified-unique prefixes |
| The round-8 guard, with the mutant in place   | **6 failed** — it catches what it was written for                   |

Truth was defined as the directory `emitPermissionProfile`/`narrowedAllowWrite` literally
emit, confirmed by inspecting a real compiled grant. The corpus used mulberry32 over an
integer domain — 60,000 uniques verified by `Set.size` from 86,837 draws, no plateau — with
a segment pool including NBSP, EM SPACE, ZWNBSP/BOM, VT, LS, tab, newline, NUL, `~`, `..`,
every glob metacharacter, and `//`/`///` separators. **This matters because round 8's
reviewer caught its own first corpora silently degenerating**, and a non-vacuous harness is
the only thing that makes a "0 findings" measurement mean anything.

## Fixed

| #   | Sev        | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **MEDIUM** | **The round-8 EMFILE fix was contradicted by its own consumer, one field over.** The loader said "the policy itself is probably fine"; the doctor paired it with a static `repairStep` of "edit it, or re-run `crabgic install`" — and `install` renames a machine-derived policy over a hand-tuned one. Following the remedy destroys a standing approval because a descriptor table filled up. The classification now travels with the result as `transient` instead of being re-derived from prose by each consumer. |
| 2   | **MEDIUM** | **That branch shipped with no test.** `grep` found `EMFILE`/`ENFILE` nowhere else in the repo; v8 named the `return` uncovered; `policy-store.ts` branch coverage 71.4%. Against this repo's own TDD ground rule, and the same pattern round 8 exists to punish. The errno routing is extracted so it is testable without exhausting the real descriptor table.                                                                                                                                                         |
| 3   | **LOW**    | **`allowedWriteScratchPaths` had no usability filter.** `dist/**` rendered as granted, kept the policy non-vacuous, passed every check, and was silently dropped at compile time — leaving the build denied at runtime with nothing pointing at the policy. Round 3's F3, fixed for path prefixes and never carried across.                                                                                                                                                                                             |

## Attacked and could not break

- **Whole-string trim asymmetry does not exist and cannot.** Zero cases where both sides
  accept and name different directories. Both call `String.prototype.trim`, both glob regexes
  are the identical `[*?[\]{}\\]` with no whitespace class, and `NonEmptyStringSchema` is
  `z.string().trim()`. Verified empirically against NBSP, EM SPACE, BOM, VT, LS, tab and
  newline. The 298 asymmetric cases all fail **closed**.
- **`policy-store` routing is unchanged by the new branch.** It intercepts only three codes,
  after the `ENOENT` test, returning the same `status` the generic branch did; no consumer
  parses `reason`. `ENOENT`→absent and `ENOTDIR`/`EACCES`/`EISDIR`/`ELOOP`→invalid all still
  route as rounds 5–7 fixed them.
- **No round-1..7 fix regressed.** 15/15 explicit assertions pass, plus full suites for
  contracts, engine-core and cli: 130 files / 1333 tests.

## Nine rounds

The loop has still not produced an empty round. What changed at round 9 is the _kind_ of
finding: no regression in the code under review, and the three findings are a fix that
stopped one field short, an untested branch, and a filter never carried to a sibling field.
That is a different failure mode from rounds 4–8, where the fixes themselves were wrong.
