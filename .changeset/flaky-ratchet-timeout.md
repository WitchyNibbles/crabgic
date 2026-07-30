---
"crabgic": patch
---

Stop the coverage-ratchet property tests from flaking under host load.

The three `fast-check` property tests in `ratchet.property.test.ts` build
their histories on a REAL on-disk journal, so each run is I/O-bound, not
CPU-bound. Under host load the 25–40 runs can exceed the global 20s
`testTimeout` while the assertions themselves are perfectly correct — a
timing artifact, not a defect, that surfaced as an intermittent
`test failed` in local pre-push runs and risked flaking CI.

Each of the three now carries an explicit 60s per-test timeout, with
`numRuns` unchanged (coverage is not weakened). This matches the fix already
applied to engine-claude's own journal-backed property flake.
