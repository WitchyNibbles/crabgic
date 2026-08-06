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
