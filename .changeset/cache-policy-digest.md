---
"crabgic": patch
---

Include the authorizing policy digest in the attempt-cache key.

Adversarial review of the attempt cache (PR #17, F3) found the two
authority-relevant policy fields the containment gate cannot see:
`allowedWriteScratchPaths` and `allowUnixSockets` narrow the compiled
sandbox but appear in neither `isContained`'s dimensions nor the
`TaskPacket`. So an owner who narrowed the worker's writable scratch set or
revoked unix-socket access between a dispatch and a same-daemon resume would
have had the earlier attempt — produced under the wider sandbox — reused
under the narrower policy.

The attempt-cache fingerprint now carries the authorizing policy digest
(`engine:<range>;policy:<digest>`) alongside the engine range. Any policy
edit is a different digest, so the cached attempt misses and the unit
re-executes under the freshly compiled sandbox. Coarse by design — any edit
invalidates reuse, not only the two invisible fields — because reuse under
stale authority is the failure mode and a spurious re-execution is only
cost. The digest is threaded per drive from the same policy gate that
authorized the dispatch, so the cache can never key on an authority
different from the one it ran under.
