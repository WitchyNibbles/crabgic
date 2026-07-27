---
"crabgic": patch
---

Stop publishing `dist/.tsbuildinfo`, which was 15% of the package.

`files: ["dist"]` swept in `tsc -b`'s incremental build state — 199 kB of the
1299 kB unpacked package, of no use to a consumer. It is also the only file
that differs between two builds of identical sources in different
environments, so shipping it made the published artifact non-reproducible,
directly undermining the reproducible-build criterion the release gate exists
to enforce. Shipped in 1.0.0 through 1.1.1.

The published package is now 1099 kB across 28 files; every other file is
byte-identical to 1.1.1. `scripts/check-published-tarball.mjs` now fails on
any `.tsbuildinfo` in the tarball, so it cannot come back silently.
