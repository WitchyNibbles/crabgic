# 25 — a blocking finding without `violates` is refused at the wire, and the whole lens verdict is lost

**Phase:** 25. Surface: `packages/plugin/workflows/stage-round.mjs`.

**Found:** 2026-08-17, owner ruling **R7**'s staged run, round 4.

**Severity: blocking.** A reviewer that raises a blocking finding has its ENTIRE verdict
refused — the finding is not journaled, the lens counts as unrun, and the round is
incompletely recorded.

**Effort: XS.** One schema member moved from optional to required, plus the prompt line
that tells the reviewer why.

## What happens

```
review.submit -> {"ok":false,"error":"invalid review verdict: a blocking finding must
name the exit criterion it violates; one that violates no stated criterion is advisory"}
```

`VERDICT_SCHEMA` declared `violates` as an optional finding member, so a reviewer could
omit it — and did. The server is right to refuse: a blocking finding that names no
criterion is exactly the taste-as-blocker shape ledger Gap 19 excludes. The schema simply
did not ask for what the server requires.

⚠️ **The loop lost more than the finding.** `review.submit` validates the whole verdict, so
the refusal discarded that lens's attestations too — the round recorded 2 of 3 lenses and
the third's real, correct finding never reached the store.

## Remedy

`violates` becomes REQUIRED on every finding, not only on blocking ones: an advisory that
names its criterion costs nothing, and a conditionally-required field is one a reviewer
omits on precisely the branch that matters. The reviewer prompt now states that the server
refuses a blocking finding without it and that the whole verdict is lost with it.

**Ticket-ready:** yes.

## Not claimed

- **Not claimed** that the server's rule is wrong. "A blocking finding must name the exit
  criterion it violates" is the rule that keeps taste out of the blocking channel.

## Remediated 2026-08-17 — PR #146

`violates` is required on EVERY finding, not only on blocking ones, and the reviewer prompt
states that the server refuses a blocking finding without it and that the whole verdict is
lost with it.

**Pinned by** `packages/plugin/src/stage-round-workflow.test.ts`, under
`describe("every finding must name the criterion it violates")`:
`it("requires \`violates\` on a finding")` and
`it("tells the reviewer the server refuses a blocking finding without it")`.
