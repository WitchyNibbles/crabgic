# 17 — two merged citations in `phase-17.json` no longer resolve against the tree

**Filed 2026-08-06** by the pass that closed criterion 5. Neither finding is caused by that pass's
own change, and neither record was edited — per the verification playbook's rule that a merged
record whose defect you did not cause is reported, not silently rewritten.

Both were found by a four-rule citation resolver (content, line anchoring + span containment, group
consecutiveness, repeat-text detection) run over `phase-17.json` and `phase-19.json`. The resolver
was mutation-tested three ways — falsified quote text, a marker moved by one line, and a marker
past EOF — and caught all three, so its silence on the remaining citations is meaningful.

Neither `check:criteria-closeout` nor `check:citation-runs` checks quoted content or line
anchoring, which is why both survived merge.

## Finding 1 — `adf-guard.ts:80` is stale by 57 lines (criterion 4, ticked)

`phase-17.json` criterion 4 cites:

- ref `packages/connectors-jira/src/resource-client/adf-guard.ts:80`
- quote `const findings = validateAdfSafeSubset(candidate);`

At `HEAD` that line reads ` * unchanged; only a caller that explicitly passes a different provider`
— a doc-comment line. The quoted statement is real and still present, at **`:137`**.

**Cause, measured.** The citation was correct when written: at `3e74cc7` the statement was on
`:80`. PR **#95** (`e02956f`, "fix(connectors-jira): scan the whole ADF document serialization for
secrets") inserted ahead of it and did not revisit the merged record that cited it.

```
git show 3e74cc7:packages/connectors-jira/src/resource-client/adf-guard.ts | sed -n '80p'
  const findings = validateAdfSafeSubset(candidate);
git show e02956f:packages/connectors-jira/src/resource-client/adf-guard.ts | sed -n '80p'
 * unchanged; only a caller that explicitly passes a different provider
```

**Severity: low, and specifically not a classification error.** The criterion's substance is
untouched — 18 really does call `@crabgic/renderer`'s `validateAdfSafeSubset` rather than
maintaining a second whitelist, which is what the citation was quoted to show. What is wrong is
where a reader is sent. This is exactly the failure the discipline exists to prevent: it resolves,
it validates, and it points at the wrong place forever.

## Finding 2 — criterion 1's `attribution-neutral` fragments fall outside their own span

`phase-17.json` criterion 1 declares ref
`packages/renderer/src/attribution-neutral.test.ts:11-21`, then quotes fragments at `:37`, `:53`
and `:62-70`. The fragments are real and on the lines they claim; the declared **span** is simply
narrower than the evidence cited inside it.

**Severity: very low.** Nothing is misattributed and no line number is wrong. The `ref` understates
its own citation's reach, so a reader who opens only `:11-21` sees a third of what is being
claimed.

## Not a finding — recorded so it is not re-derived

The same resolver initially flagged criterion 1's `attribution-neutral.test.ts:53` negative control
as absent from the file. It is present; the record quotes an assertion that **spans lines 52-54**
and joins it onto one line, which a line-oriented resolver cannot match. That is a limitation of
the instrument, not a defect in the record. Any future resolver over these records needs to join
wrapped assertions before matching, or it will report this same phantom.

## Remedy

**S.** Correct `adf-guard.ts:80` to `:137` and widen criterion 1's `attribution-neutral` ref to the
range its fragments actually occupy — both as dated corrections beside the existing text, per the
annotate-never-rewrite convention, since these are merged records.

Worth more than the two edits: the structural fix. A resolver of this shape run in CI over every
closeout record would have caught both at the moment PR #95 landed. Both validators are blind here
by construction — one reads only the record JSON's shape, the other only run URLs.

**Needs:** nothing live, no Docker, no credentials, no engine.

**Ticket-ready:** yes.

## Addendum 2026-08-07 — three parts: the two filed corrections, the structural remedy, and what stays open

### (a) The two filed findings were corrected, and the census that found them is a LOWER BOUND

PR #123 applied both corrections this record authorized, as dated corrections beside the existing
text: the stale `adf-guard.ts` location, and the `attribution-neutral.test.ts` ref that understated
its own reach. `check:criteria-closeout` and `check:criteria-baseline` passed on both sides, so Hard
Rule 5 never fired — and neither validator could have caught either defect, which is this record's
whole point.

`docs/evidence/phase-17/merged-citation-corrections-batchL.txt` §4 carries three further findings of
the same two classes, reported and deliberately not fixed. One of them is the **second** stale
citation, `adf.test.ts:251-267`, which was introduced by PR #108 — the very PR whose pass filed this
record — and now sits at `:279-295`, a shift of 28 lines caused by an inserted test above it. The
substance is untouched: the whitelist assertion still exists and still pins the exact list; only the
pointer is wrong.

**§4b is an append-corrected LOWER BOUND of hand-read citation rows, NOT a census, and that framing
is load-bearing.** It was first published with a hard count and the word "census", which overstates
it; an independent span-check then found four more of the same class, and three further ones turned
up while checking those. The root cause is a **grammar** gap, not a rule gap, which is why three
passing mutation tests did not expose it: the instrument required a quote to follow its marker
immediately, so (a) any prose or punctuation between marker and quote defeated the pairing — the
**association gap** — and (b) **bare markers** carrying no quote at all were never span-checked. All
three mutations happened to land on markers in the adjacent form, so the battery tested the four
rules and never the grammar that feeds them.

**One row that pass's list missed, verified 2026-08-07 and added here so the bound moves in the right
direction:** `phase-17.json` criterion 6 cites `packages/renderer/src/length-limits.test.ts:12-25`
and its assertion also walks the **bare range** `:48-57` and the marker `:50`, both outside the
declared span — the same class as the rows already listed. So the bound is **at least 11 rows**, and
it must be written as "≥", never as a completed count. Enshrining any total here would make the next
pass trust a number that was never a census.

### (b) The structural remedy landed

PR #126 built the CI-resident resolver this record's remedy proposed:
`scripts/check-citation-content.mjs`, wired as a **blocking** step in `meta-checks`, with a prose lane
that resolves every `path:NN` written in `roadmap/*.md` and in these defect records outside fenced
blocks. `docs/evidence/citation-resolver/red-corpus-batchN.txt` is the "would it have caught this on
the PR?" question executed rather than asserted — the corpus is clean at one sha and reports the
`adf-guard.ts` drift at the sha that caused it, with the record already merged at both. The battery
in `docs/evidence/citation-resolver/mutation-tests-batchN.txt` mutates the **notation** as well as the
values, which is the lesson §4b earned.

### (c) Phase 18's drift, attributed — and why it is still open

The phase-18 stale citations are attributed to **PR #100 and PR #119**, not to #119 alone; the
resolver's own measurement over the corpus names five separate PRs. The #119 half has a committed
old-to-new table at `docs/evidence/phase-18/cassette-flow-replay-batchJ.txt` §R9.

The repair was **attempted with the production tool and then reverted**, and the measurement is
recorded in `phase-18.json` itself rather than here: `--fix` re-anchored 20 citations and left 18 of
them not resolving where they claim, in three classes — fragments now correct but outside the span
their `ref` declares (mechanical, the `ref` has to be widened too), fragments whose text is **absent**
because the code was rewritten rather than moved, and fragments whose text repeats so their position
is not verifiable by content at all. Landing that would have needed `--allow-unanchored`, which is a
confession written into the baseline and the way a ratchet becomes paper.

**This record stays open.** The burn-down's pinned starting line is
`docs/evidence/citation-resolver/seed-census-batchN.txt`, and the great majority of it is still owed.
