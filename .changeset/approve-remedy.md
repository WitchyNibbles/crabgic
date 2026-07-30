---
"crabgic": patch
---

Stop offering `crabgic approve` as the remedy for an authority escalation, because it cannot be one.

Adversarial review traced the full ceremony: the escalation message led with
`crabgic approve <digest>`, approval verified the token and flipped the
ChangeSet `ready` — and the daemon's dispatch gate then re-ran the identical
containment check, with no token input, and refused the same envelope again.
That is not a bug in the gate: the ledger's Gap 18 ruling makes dispatch
containment-only ("no prompt and no token … there is no third outcome"), and
the token machinery it kept gates exactly one thing — the
`awaiting_approval → ready` transition, i.e. owner consent to the PLAN (a
material amendment, an intake whose prompt declined at EOF). The command's
own header claimed otherwise ("its envelope outside the standing policy"),
which made a ceremony that can never succeed the advertised first remedy of
every escalation.

Now the words match the mechanism:

- The escalation message leads with the edit that works — the standing
  policy file, named by path — and states that an in-policy envelope
  proceeds with no further ceremony on the next `crabgic run`. `approve` is
  mentioned only to say what it actually does.
- `approve`'s post-dispatch refusal explains itself: consent to the plan,
  never a grant of authority; if the refusal names an escaping dimension,
  only a policy edit changes the outcome.
- The `/eo:approve` skill and the command header state the same scope.

No behavior changed at any gate — this is the honest-words half. Making the
dispatch gate read tokens was considered and rejected: it would contradict
the ledger's ruling, and the token is already consumed (single-use, durably)
before dispatch happens.
