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
