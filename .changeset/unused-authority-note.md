---
"crabgic": minor
---

Say when a run has more authority than its plan needs.

The standing approval's explicit trade is that in-policy work is approved with
nobody reading it. That is a good trade, and ledger Gap 18 records what it gives
up: per-change-set human review. So the thing a reviewer used to catch for free
now goes uncaught — a change set that asks for `src` when it only ever touches
`src/login` is approved, dispatched, and runs wider than its plan.

`run` now says so, after dispatching:

```
ChangeSet 1111… approved (covered by the standing approval policy sha256:…) and dispatched as run d1b0…
  note: the envelope grants 1 path(s) no work unit uses (infra/terraform) — inside
  your standing policy, so nothing is blocked, but the run has more authority than
  its plan needs
```

**It reports and refuses nothing**, deliberately. The policy said that path was
fine and it is; this is a wider grant than necessary, which is worth mentioning
and never worth halting a run over. The wording says "nothing is blocked" out
loud, because the reader's first question is whether something went wrong.

**And it is deterministic.** The obvious version of a critic on auto-approved
plans is another model pass; this is a set difference over paths the plan already
declares, so it costs nothing, cannot hallucinate, and gives the same answer every
time. Containment is segment-aware and matches the policy check's own shape — a
grant of `src` counts as _used_ by a work unit claiming `src/login`, because it
genuinely is, and flagging that would train the reader to ignore the note
entirely. A model-based critic can come later for judgements this cannot make; it
did not need to come first.
