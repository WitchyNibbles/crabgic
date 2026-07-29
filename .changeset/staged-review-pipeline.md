---
"crabgic": minor
---

Replace the unbounded adversarial review loop with a staged pipeline that terminates, and harden every hardened-open site in the product.

**The review loop can now end.** The previous design closed a round only when a reviewer produced no finding that was both novel and falsifiable, with no severity floor and no cap. Twelve rounds against one subsystem measured what that costs: every round produced a genuine, reproducible finding, severity fell the whole way, and it never converged. Novelty and falsifiability exclude _manufactured_ findings, which is what they were for — they do not bound the supply of genuine ones, so the criterion measured reviewer exhaustion rather than artifact quality. The reviewer charter also said "do not approve it", leaving it no way to say _done_.

Termination is now the artifact against written per-stage exit criteria, carried as data with stable ids. A finding blocks only by naming the criterion it violates; one that violates none is advisory. Every finding at any severity carries a disposition that can never be empty, so a stage cannot advance holding an unanswered finding — `advisory` defers a finding and never disposes of one, and debt deferred that way becomes blocking again the moment a later change set touches the code it concerns. Rounds continue only while each closes a blocking finding, then escalate to the owner rather than looping.

**Closure is computed, not asserted.** The new `review.submit` gateway tool takes a reviewer's findings and decides whether the stage may close. Planned writes come from the change set's own envelope and prior findings from a durable store, so a reviewer cannot understate what it touches to dodge deferred debt, and a clean round cannot erase somebody else's open blocker. The gate-decidable criterion is derived from journaled evidence and subtracted from whatever the caller claimed — gates that never ran are not gates that passed.

**The classifier says whether it has ever been checked.** The blocking/advisory split is a judgement, and an uncalibrated judge is decorative. Every review result now reports Cohen's kappa against the owner's own recorded judgements, with a corpus store to record them in and a refusal to call anything calibrated on fewer than twenty samples. A fresh project scores zero, which is honest; what would not be honest is returning verdicts without saying nobody has looked.

**Security fixes, each proven against the built binary.** `doctor` could be made to overwrite an arbitrary file while reporting the sandbox healthy, and a FIFO at the standing-policy path froze it for thirty-six seconds — ignoring SIGTERM, needing SIGKILL, printing nothing — on the code path the dispatch daemon uses. A symlink one directory above the approval signing key put that key in an attacker's directory. Five separate hardened-open implementations had drifted into two behaviours; there is now one, refusing a symlink, a hardlink, a FIFO and a foreign owner, and verifying every directory component below the state root.

New agents ship for the pipeline's design and plan stages, and the reviewer takes a lens per round rather than repeating one hostile pass.
