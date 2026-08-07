# Citation-content resolver — evidence

Transcripts for `scripts/check-citation-content.mjs` and the `meta-checks` step that runs it.
Everything here is outside `docs/evidence/criteria-closeout/`, so it is citable; the resolver's
**baseline** (`docs/evidence/criteria-closeout/citation-content-baseline.json`) is inside the
claim-space and is bookkeeping, never evidence.

| File                        | What it proves                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `red-corpus-batchN.txt`      | The resolver catches the real historical drifts, pinned at the shas that caused them — including a clean/red pair straddling PR #95 with the record already merged at both. |
| `mutation-tests-batchN.txt`  | The resolver, the ratchet and the prose lane can each be made to FAIL, and each returns to green on restore. Rule mutations **and** association-grammar mutations. |
| `seed-census-batchN.txt`     | The burn-down's pinned starting line, re-derived by the production tool.                                                       |

## What the check does and does not catch

**Catches, blocking:**

- a PR that moves lines under any merged citation (`regressed`/`drifted`), which is the measured
  failure mode — PRs #95, #100, #108, #118 and #119 all did it and nothing noticed;
- a new or edited citation whose quoted text is absent, on a different line, or outside the span its
  `ref` declares — and `--update-baseline` refuses to bless it;
- byte-drift in a cited `docs/evidence/**` transcript (reported as its own class: committed evidence
  is frozen by the annotate-never-rewrite discipline);
- a `path:NN` in `roadmap/*.md` or a defect record naming a missing file or a line past its end.

**Does not catch, stated rather than implied:**

- whether a citation is *relevant* to the criterion it discharges. No hash judges relevance;
- quoted CI job-log lines. The normalization for those (ANSI strip, timestamp, one-space, with the
  two-space form twelve merged records use grandfathered) is implemented and unit-tested in
  `scripts/citation-content/job-log.mjs` and driven by `--report --job-logs <dir>` over logs a pass
  has already downloaded — it needs the network and a token, and `meta-checks` has neither;
- legacy drift already present when the baseline was seeded. That is deliberate: a check that reds
  129 ticked criteria on the day it lands gets muted, and a muted check is worse than none. The
  seeded entries are the burn-down list, not an amnesty;
- a cross-file quote written with a bare filename and **no** line number. It resolves against the
  citation's own `ref` file, because letting a bare filename switch files re-pointed seven phase-00
  fragments at a deleted path during development. Such a quote is reported, not silently accepted;
- rules 3 (group consecutiveness) and 4 (repeat text) are reported, never blocking — the merged
  corpus violates both by convention.

## Repairing a red

```
npm run check:citation-content -- --report          # where every quote actually is
npm run check:citation-content -- --update-baseline # re-pin; the diff IS the drift record
```

If the citation that moved is in a **merged** record, paste the dated correction `--report` prints
**beside** the existing text. Do not rewrite it, and do not use `--fix` — that mode refuses to touch
any record this branch has not itself modified.

## The correction recipe (owner ruling, 2026-08-06)

A dated correction written in the obvious house style — appending a second `'…'` file quote naming
the old line — makes the corrected citation report `unanchored`, and `--update-baseline` then
**refuses** it. That is the gate working: the appended quote genuinely does not resolve where it
claims, because it is quoting a line number that is no longer true.

The ruling is to amend the convention rather than weaken the gate, because the alternative is every
one of the ~180 owed corrections carrying `--allow-unanchored`, and a bypass everyone uses is a
bypass that has replaced the check.

**Two rules, and a correction passes:**

1. **Widen the `ref` to cover the fragments it walks.** If the assertion quotes `:28-30` and `:137`,
   the `ref` is `:28-137`, not `:137`. This is not a concession to the tool — it is what defect 17's
   own Finding 2 already prescribes ("the `ref` understates its own citation's reach, so a reader who
   opens only `:11-21` sees a third of what is being claimed"). The tool simply makes it checkable.
2. **Write stale line numbers in backticks, not in the `'…'` file-quote notation.** `'…'` means
   "this text is in the cited file, at the marker beside it" — which is exactly what a stale pointer
   is not. So:

   ```
   Corrected 2026-08-06: was `adf-guard.ts:80`, now :137 — PR #95 inserted above it.
   ```

   and **not** `:80 'const findings = validateAdfSafeSubset(candidate);'`, which asserts the quote is
   at :80 and reddens the check, correctly.

For a genuinely **new** citation the in-span rule stands with no exception, and the phase-04 "anchor
the `ref` at one representative line and walk the surrounding evidence" convention is the thing that
gives. Widening a `ref` costs one edit and makes the citation say what it actually claims.

`--allow-unanchored` is for neither case. It is recorded in the baseline itself (`allowUnanchored`,
`unanchoredAccepted`), so using it puts a confession in the diff.
