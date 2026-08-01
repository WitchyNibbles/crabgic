---
"crabgic": minor
---

Intake validates its two unvalidated inputs, and the upgrade boundary is documented where operators read.

`IntakeRequest.ecosystem` arrived straight from `JSON.parse` and was used to index a plain object literal, so `{"ecosystem": "constructor"}` on stdin crashed `runIntake` with a `TypeError` from inside `@crabgic/contracts`. The table now answers only for its own rows, and intake refuses an ecosystem the pinned table has no row for instead of silently falling through to base-revision measurement.

A performance acceptance criterion whose comparison operator contradicts its metric's canonical direction — `throughput <= 1000 ops/sec`, where a throughput budget is a floor — was silently reinterpreted as its opposite, because a budget entry carries no direction and the gate takes it from the metric. Such a criterion is now refused with a diagnostic naming the operator to use. Direction-consistent criteria parse exactly as before; no derived budget value moves.

**Before upgrading:** finish or cancel in-flight runs, and expect a replayed `requestKey` across this upgrade to report `conflict` by design — `IntakeRequest`'s field set changed in 1.5.0's successor, so the same document hashes differently on either side. Use a fresh `requestKey` or the amendment flow. Both rulings existed only in design documents until now; see `docs/upgrade-guide.md`, "Before upgrading".
