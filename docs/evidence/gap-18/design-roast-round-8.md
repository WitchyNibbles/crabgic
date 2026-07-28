# Gap 18 — implementation roast, round 8 (2026-07-28)

Round 8 measured the round-7 fixes. The headline: **the single-normalizer fix introduced
1791 containment false positives.** Round 6 had zero. All 155 tests in the five affected
suites passed while that was true.

## The regression, and why no test saw it

The compiler is the authority on which directory a path names. `emitPermissionProfile` and
`narrowedAllowWrite` both emit `validateOwnedPath`'s output, which trims the **whole string**
and nothing else. Round 6's `normalizePath` fed on that output, so gate and compiler agreed
by construction. Round 7 replaced it with a shared normalizer that trims each **segment**,
run on the raw string:

```
ownedPaths: ["src /"]   policy: ["src"]
  GATE      contained = true, reasons = []
  COMPILER  Edit(//<worktree>/src /**)      <-- directory "src ", never approved
```

Brute force, 118,611 owned paths × 4 policy prefixes, comparing `isContained` against the
directory the compiled grant literally names:

|                                               | false positives |
| --------------------------------------------- | --------------- |
| round 7 (HEAD)                                | **1791**        |
| round 6 (`865f1b2^`, run verbatim in-process) | **0**           |

**Bounded honestly:** `validateOwnedPath` still forbids a leading `/` and `..`, so this could
not escape the worktree — the reachable set was whitespace-padded variants of already-approved
names. An authority-divergence regression, not an exploit. But it reverses the exact direction
`is-contained.ts`'s own header calls unacceptable: _"a false positive is an unreviewed run
with authority nobody granted."_

**The fix, and what it also settles.** Segments are no longer trimmed. That resolves the tilde
question properly rather than by accident: `"./~"` collapses to `"~"` and is refused, while
`"./ ~"` names a directory beginning with a space — odd but real, and exactly what the
compiler grants. Three assertions from rounds 6 and 7 claimed otherwise and are retired.

**The missing guard is now present.** Containment is asserted directly against
`validateOwnedPath`'s output rather than against the normalizer's internals — the comparison
whose absence let 1791 false positives sit behind a green suite.

## Also fixed

- **`EMFILE`/`ENFILE`/`ENOMEM` reported a valid policy as `invalid`.** Those describe the
  process, not the file; the message now says so instead of sending an owner to inspect
  something that is fine.

## Attacked and could not break

- **`isUsablePathPrefix` vs `normalizePath`** — 60,000 unique generated prefixes: **0
  mismatches in each direction**. Equivalence holds by construction. (The reviewer noted its
  first two corpora had silently degenerated — an LCG overflowing float precision plateaued
  them at ~14k unique — and re-ran with mulberry32. Worth recording: a silently-degenerate
  corpus is exactly how a round misses things.)
- **`linkBinEntry`, all shapes** — workspace relative → worktree, external relative → source,
  absolute-inside → re-anchored, absolute-outside → shared, real shim file → shared via the
  `EINVAL` branch, **not dropped**. The round-7 `.bin` fix is correct and nothing is lost.
- **`list-directories` exclusion, 8 scenarios** including `node_modules` as a symlink to a
  shared store, `.git` as a _file_ (git-worktree layout), dangling links and two-hop chains.
  **No legitimate source dir dropped in any scenario** — the twice-repeated regression did not
  recur.
- **`policy-store` errno space** — `ENOENT` → `absent` and nothing else; `ENOTDIR`, `EACCES`
  (file and parent), `EISDIR`, `ELOOP` (link and true cycle), `ENAMETOOLONG` all → `invalid`
  with distinct, defensible remedies.
- **Dependency direction** — `contracts` imports no sibling package; no cycle introduced;
  `check-package-graph-acyclic` PASS.

## Carried forward, not fixed

- **`ProvisionWorktreeDependenciesResult.skipped` is inert.** Its only caller discards the
  result, and `linkEntry` collapses the whole `.bin` loop to one boolean, so per-bin failures
  remain invisible. The round-7 claim to have fixed this holds for the `EINVAL`/shim case
  only.
- **A dangling relative `.bin` link is copied verbatim and counted as linked** — arguably
  intended, since build-state independence is the point of the verbatim copy.
