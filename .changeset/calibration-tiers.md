---
"crabgic": minor
---

Make the calibration gate reachable, and certify on a number that transfers.

Two findings forced this, both arithmetic rather than opinion.

**The old gate was a lottery.** An exhaustive enumeration of it — twenty samples,
Cohen's kappa lower bound at 0.6 — found that exactly **three of 117 reachable
tables pass**, all at 19/20 agreement or better. It was "at least 95% raw
agreement" wearing a confidence interval's clothes: a genuinely good classifier
(true kappa ≈ 0.79) passed 39% of the time and a mediocre one 7%, so the verdict
mostly measured sampling luck. Published sample-size tables want n ≈ 93–119 to
separate kappa 0.4 from 0.6 at 80% power — an order of magnitude more than the
gate asked for. One threshold was being asked to both screen out a decorative
judge and certify one fit to close a stage, and the threshold that does the second
makes the first unreachable.

**And kappa does not transfer across prevalence.** The same classifier scores
kappa 0.79 on a 40%-blocking corpus and 0.59 at a 10% production blocking rate,
with nothing about the classifier changed, because the corpus is deliberately
stratified and kappa is prevalence-dependent. Certifying on it means certifying a
number that stops holding the moment it is used.

So the verdict is four tiers instead of a boolean, and certification rests on
**per-class recall** — sensitivity and specificity are prevalence-invariant, so a
bound measured on the corpus still means something in production:

| tier                  | needs                                                                         |
| --------------------- | ----------------------------------------------------------------------------- |
| `provisional`         | 20 random samples, ≥8 per class, kappa ≥ 0.6 with a lower bound ≥ 0.4         |
| `calibrated`          | 50 samples, ≥20 blocking labels, per-class recall lower bound ≥ 0.7 both ways |
| `strongly-calibrated` | 100 samples, recall bounds ≥ 0.75, kappa lower bound ≥ 0.6                    |

`provisional` closes no stage — it says "not a decorative judge", which is the job
the original threshold could not do while also certifying. The recall bounds are
**exact** (Clopper–Pearson), not normal-approximation: the approximation the kappa
interval uses understates variance at small n, which is optimistic exactly where
optimism is least warranted, and the routine is validated against six published
reference values rather than against itself. Kappa is kept as the secondary drift
diagnostic it is genuinely good at — detecting the classifier's positive rate
drifting away from the owner's. The report also projects production precision at a
supplied blocking rate, because that is the number an owner feels: a classifier at
0.9 sensitivity and 0.9 specificity looks strong on a balanced corpus and produces
one false alarm per real blocker at a 10% production rate.

**Only uniformly-drawn samples score.** `review.calibrate` asks first about the
findings a misclassification already marked — an advisory fixed anyway, a blocking
refuted — which is excellent triage and a biased sample: kappa over an
error-enriched pool is biased _down_, so a diligent owner was making an already
unpassable gate harder. Samples now carry their provenance, absent reads as
targeted rather than random (the fail-closed direction), and the report says how
many it held out so "twenty labels and still uncalibrated" reads as an explanation
rather than a puzzle.

One deliberate non-change: the minority-class floor stays at 8 rather than rising
to 15. Fifteen is what a recall claim needs, and that requirement lives in the
`calibrated` tier's twenty blocking labels; raising this floor too would have made
`provisional` cost thirty samples instead of the twenty it advertises, moving a
certification's price onto a screen.

`sampleSize` keeps its original meaning — how many labels exist — with the scored
slice reported separately as `randomSampleSize`, so no existing reader silently
starts reading a different number.
