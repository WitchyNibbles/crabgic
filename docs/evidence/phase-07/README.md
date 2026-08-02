# Phase 07 evidence

**Pre-rename names — annotated 2026-08-02, not rewritten.** This file was written before
`3e74cc7` (2026-07-26) renamed the project from `engineering-orchestrator` to `crabgic`, so
the names in it were the real ones when it was captured. This is an evidence file: the
original text stays verbatim and the mapping lives here. Read `@eo/x` as `@crabgic/x`; read
the product / binary / cache-path segment `engineering-orchestrator` as `crabgic`; and read
the gateway MCP server literal `eo_gateway` as `crabgic_gateway`, which is what
`GATEWAY_MCP_SERVER_NAME` holds today (`packages/contracts/src/gateway/server-name.ts:26`).
Nothing else about the citations changed — the modules, paths and tests they name are the
same ones. Two reading rules follow. Quotations keep their old names verbatim, because a
quotation records what its source said, not what is true now. And where this file asserts the
_absence_ of a hand-typed server literal (interface-ledger Gap 11), it asserts it about the
constant's value at the time; that rule is unchanged and the scan targets `"crabgic_gateway"`
today (`docs/evidence/phase-02/closeout-c8-gateway-literal-scan.txt`).

**Additionally — here a VALUE moved, not just a name, so the mapping above is not enough.**
Two lines need more than a scope substitution. (Line numbers are as of this annotated file;
inserting this note shifted every original line down by 30.) §"Exported surface for
downstream 08/13/23", the "Git identity (WI8)" bullet (`:157`), cites
`ENGINEERING_ORCHESTRATOR_GIT_IDENTITY_NAME` (`"Engineering Orchestrator"`); both halves
changed — the constant is `CRABGIC_GIT_IDENTITY_NAME` and its value is `"Crabgic"`
(`packages/git-engine/src/git-identity.ts:33`), so a reader applying only the name mapping
would still have the wrong string. The §"Exit-criteria → evidence map" control-clone row
(`:62`) spells the path `$XDG_CACHE_HOME/engineering-orchestrator/<project-hash>/git-control/`; `resolveGitControlDir`
returns `$XDG_CACHE_HOME/crabgic/<project-hash>/git-control/`
(`packages/git-engine/src/layout.ts:23-26`), which is also what interface-ledger Gap 14 pins.
Both were already filed — as a stale-evidence flag, explicitly *not* a criterion defect — at
`docs/evidence/criteria-closeout/phase-07.json:416`, which deferred the edit under the rule
against fixing a finding in the same pass that reports it. This annotation is that deferred
edit. The finding is discharged; that record is left untouched.

This directory is the evidence trail for `roadmap/07-git-control-repo-worktrees.md`'s
work items and exit criteria, following the same convention `docs/evidence/phase-02/
README.md` established: each file name is prefixed `wiN-` (work item N) or
`exit-criteria-`, describes what it captures, and — where the phase's own choreography
calls for "failing-first" — a `*-failing.txt` file captured **before** the real
implementation landed, paired with a `*-passing.txt` file captured **after**.

One worker built this entire phase (`packages/git-engine`): plumbing wrapper, invariance
harness, repository validation, porcelain-v2 parser, control clone, intake freeze,
worktree lifecycle (create/destroy/quarantine/crash-orphan sweep), rename-aware overlap
analyzer, and per-worktree git identity. Real `git` (2.43.0) was used throughout — no
mocked git anywhere in this suite; every integration/crash test operates on real,
on-disk fixture repositories built via `src/test-support/fixture-repo.ts`.

## Exit-criteria → evidence map

(All 9 checkboxes actually present in `roadmap/07-git-control-repo-worktrees.md`'s Exit
criteria section — the worker brief said "8"; the roadmap file itself lists 9. Mapped
faithfully to the source file, not the summarized count.)

| Exit criterion (roadmap/07-git-control-repo-worktrees.md) | Evidence file(s) |
| --- | --- |
| Invariance harness: user checkout tree-hash identical before/after every engine operation across the suite | `wi2-invariance-{failing,passing}.txt`. **Corrected 2026-07-18** (see "Validation round" section below — the original wording here was overstated): the harness is exercised directly and thoroughly in its OWN dedicated test file (`invariance.test.ts`'s `computeWorkingTreeHash`/`withTreeInvariance`/`computeGitStateHash`/`withUserCheckoutInvariance` describe blocks), and is APPLIED (not just tested) specifically around `freezeIntake` in `intake-freeze.test.ts` — the one operation in this package's own suite that reads a real USER checkout. It is NOT literally wrapped around every other test in this suite: worktree-lifecycle/control-clone/overlap-analyzer's own tests operate on control-owned dirs (fixture "source" repos treated as the control clone's origin, worktrees, quarantine dirs), not a user checkout, so wrapping every one of THOSE tests in the user-checkout invariance harness would assert a property those tests were never about. |
| SHA-256, submodule, LFS, unborn-HEAD, filters/hooks fixtures pass repository validation | `wi3-repo-validation-{failing,passing}.txt` (all five fixture shapes: unborn HEAD, SHA-1 vs SHA-256 object format, `.gitmodules` presence, LFS-pointer-signature detection, `core.hooksPath` neutralization incl. a real hook-firing-prevention test) |
| Dirty-overlap block fires exactly on intersection with the porcelain snapshot; a disjoint dirty path never blocks | `wi5-intake-freeze-{failing,passing}.txt` ("a disjoint dirty path never blocks the freeze" / "an intersecting planned write blocks, naming the exact offending path" / "leaves unrelated dirt completely untouched on disk") |
| Quarantine journaled and recoverable; crash-orphan sweep completes or quarantines every orphaned worktree after a kill -9, never silently drops one | `wi6-worktree-lifecycle-{failing,passing}.txt` (ordinary-path quarantine/sweep); `wi6-crash-failing.txt` + `wi5-wi6-crash-passing.txt` (real `runKillHarness` kill -9 mid-worktree-creation AND mid-quarantine, both fault-point sweeps) |
| Every worktree carries the configured neutral git identity (`user.name`/`user.email`) immediately after creation, with no explicit identity call from the caller | `wi8-git-identity-{failing,passing}.txt` (direct unit test); `wi6-worktree-lifecycle-passing.txt`'s "configures the neutral git identity automatically at creation time (WI8 integration)" test (via `createWorktree`, no caller-side identity call) |
| Overlap analyzer catches rename collisions (moved-in-one/edited-in-other fixture) and clears disjoint-path fixtures, exercised by the fast-check property suite | `wi7-overlap-analyzer-{failing,passing}.txt` (unit "moved-in-one/edited-in-other" + real-git `--find-renames` integration test, plus 3 fast-check properties at 1000 runs each: reference-model equivalence, "never misses a true collision," "never flags a disjoint pair") |
| Every entry this package journals matches the `git_freeze` or `worktree_quarantine` member of `JournalEntryType` and passes 02's discriminated-union exhaustiveness harness | `journal-entry-type-compliance.test.ts` (run as part of `exit-criteria-package-gate.txt`'s full-suite pass — compile-time member-validity assertion + runtime `JOURNAL_ENTRY_TYPES` membership check + both payload shapes round-tripping through `@eo/journal`'s real `JournalEntrySchema`); also exercised end-to-end via real `appendEntry` calls in `wi5-intake-freeze-passing.txt` and `wi6-worktree-lifecycle-passing.txt` |
| Control clone resolves at `$XDG_CACHE_HOME/engineering-orchestrator/<project-hash>/git-control/` — a path-convention test, not just documentation | `wi5-control-clone-{failing,passing}.txt` ("resolveGitControlDir — path convention (Gap 14, WI5 exit criterion)") |
| Command-injection corpus: zero fixtures reach a shell; a static check confirms no `shell: true` / string-concatenated command line exists anywhere on this package's spawn surface | `wi1-plumbing-{failing,passing}.txt` (9-fixture metacharacter/backtick/newline/path-traversal corpus, all asserted via a spawn-capture shim, plus a real-git non-shell-expansion integration test) — the static structural check (`spawn-surface-scan.test.ts`) is included in the same capture and re-confirmed clean in `exit-criteria-package-gate.txt` |

## Additional evidence

| What | Evidence file |
| --- | --- |
| Full package gate (`tsc -b`, `vitest run` w/o coverage, eslint, prettier --check, and this package's own coverage row) | `exit-criteria-package-gate.txt` |

## Work items → evidence (all 8, roadmap's own numbering)

1. Plumbing wrapper + version probe — `wi1-plumbing-{failing,passing}.txt`
2. Invariance harness — `wi2-invariance-{failing,passing}.txt`
3. Repository-validation checks — `wi3-repo-validation-{failing,passing}.txt`
4. Porcelain-v2 parser + dirty-snapshot capture — `wi4-porcelain-parser-{failing,passing}.txt` (unit + fast-check determinism property, 1000 runs)
5. Control clone + fetch-refresh + intake freeze — `wi5-control-clone-{failing,passing}.txt`, `wi5-intake-freeze-{failing,passing}.txt`, crash test in `wi6-crash-failing.txt`/`wi5-wi6-crash-passing.txt` (mid-clone case)
6. Worktree lifecycle (create/destroy/quarantine) + crash-orphan sweep — `wi6-worktree-lifecycle-{failing,passing}.txt`, `wi6-crash-failing.txt`/`wi5-wi6-crash-passing.txt` (mid-worktree-creation and mid-quarantine cases)
7. Rename-aware overlap analyzer + non-Git resource registry — `wi7-overlap-analyzer-{failing,passing}.txt`
8. Git identity configuration per worktree — `wi8-git-identity-{failing,passing}.txt`

## Test counts + coverage

Original phase build: **19 test files / 116 tests, all green.** Updated by the
**2026-07-18 validation round** (see that section below) to **21 test files / 147 tests,
all green** — see `exit-criteria-package-gate.txt`, which keeps both captures (the
recaptured one first, the original kept below it for history).

This package's own coverage row (`vitest run --coverage packages/git-engine`, read
directly off the per-file table — the blended/global number in the same run is
meaningless here since it also counts every OTHER untested package's source under the
repo-wide `coverage.include` glob), as of the 2026-07-18 recapture:

```
git-engine/src    |   95.88 |    86.32 |   98.82 |   97.66
```

(statements / branches / functions / lines — all four ≥80%, branches the tightest at
86.32%; original phase-build figures were 95.25 / 85.56 / 98.59 / 97.41.)

## The `<attempt>` ref-token format chosen

`att-<epochMillisBase36>-<8-hex-random>` (e.g. `att-mrqkkw7p-3225d168`) —
`src/attempt-token.ts`. Lowercase alphanumerics and hyphens only (a valid single git ref
path segment: no `/`, `~`, `^`, `:`, `?`, `*`, `[`, no leading/trailing `.`, no `..`).
Uniqueness is timestamp + 32 bits of randomness, not a registry-backed hard guarantee —
the same standard this repo's UUID-based `IdSchema` already relies on elsewhere. Proven
collision-free under both a fixed-clock stress test (200 calls, same millisecond) and a
real 12-way concurrent `createWorktree` burst on the identical task
(`worktree-lifecycle.test.ts`'s "ref-collision resistance" test). This token format is
this phase's own choice per roadmap's explicit delegation ("13 supplies the value, this
phase only guarantees uniqueness") — not itself a cross-phase contract.

## Exported surface for downstream 08/13/23 (packages/git-engine/src/index.ts)

- **Plumbing (WI1):** `createGitPlumbing(options?)`, `createNodeGitSpawn()`,
  `GitCommandError`; types `GitPlumbing`, `GitPlumbingOptions`, `GitRunOptions`,
  `GitSpawnFn`, `GitSpawnRequest`, `GitSpawnResult`.
- **Invariance harness (WI2):** `computeWorkingTreeHash(rootPath, options?)`,
  `assertTreeInvariant(rootPath, beforeHash, options?)`,
  `withTreeInvariance(rootPath, fn, options?)`, `TreeMutatedError`; type `TreeHashOptions`.
  **08 and 23 reuse `withTreeInvariance`/`computeWorkingTreeHash` directly.**
- **Repository validation (WI3):** `validateRepository(plumbing, repoPath)`,
  `neutralizeHooksPath(plumbing, repoPath)`; type `RepositoryValidationReport`.
- **Porcelain-v2 parser (WI4):** `parsePorcelainV2(text)`, `dirtyPaths(snapshot)`; types
  `PorcelainV2Snapshot`, `OrdinaryEntry`, `RenamedOrCopiedEntry`, `UntrackedEntry`,
  `IgnoredEntry`, `ConflictedEntry`.
- **Layout (WI5/WI6):** `resolveGitControlDir(env, projectHash)`,
  `resolveWorktreesRootDir(env, projectHash)`, `resolveWorktreeQuarantineDir(env, projectHash)`,
  plus subdir-name constants `GIT_CONTROL_SUBDIR`/`WORKTREES_SUBDIR`/`WORKTREE_QUARANTINE_SUBDIR`.
- **Control clone (WI5):** `ensureControlClone(plumbing, options)`,
  `fetchRefresh(plumbing, controlDir, ref)`; types `ControlCloneOptions`, `ControlCloneResult`.
  **08 fetches from this exact `git-control/` path; 23 reuses it directly.**
- **Intake freeze (WI5):** `freezeIntake(options)`; types `FreezeIntakeOptions`,
  `IntakeFreezeRecord`, `IntakeFreezeResult` (`{status:"frozen"|"blocked", freeze, offendingPaths?}`).
  `IntakeFreezeRecord.baseObjectId` is what **13 threads into `TaskPacket.baseObjectId`**
  and **08 uses as its CAS expected-old-value baseline**.
- **Journal appender shape (WI5/WI6):** `JournalAppender`, `GitEngineJournalEntryInput`
  (`src/journal-appender.ts`) — the minimal `{appendEntry}` shape both `freezeIntake` and
  the worktree-lifecycle quarantine path accept; any `@eo/journal` `JournalStore` (or
  free-function-bound config) satisfies it structurally.
- **Attempt token (WI6):** `generateAttemptToken(clock?, randomHex?)`; types `ClockFn`, `RandomHexFn`.
- **Worktree ref + path boundary (WI6):** `buildWorktreeRef(parts)`,
  `resolveWorktreePath(rootDir, segments)`, `InvalidRefSegmentError`, `WorktreePathEscapeError`;
  type `WorktreeRefParts`.
- **Worktree lifecycle (WI6):** `createWorktree(plumbing, options)`,
  `destroyWorktree(plumbing, repoDir, worktreePath)`, `quarantineWorktree(plumbing, options)`,
  `sweepOrphanWorktrees(plumbing, options)`, `isWorktreeDirty(plumbing, worktreePath)`; types
  `CreateWorktreeOptions`, `WorktreeRecord`, `QuarantineWorktreeOptions`, `QuarantineResult`,
  `SweepOptions`, `SweepReport`. **13 hands the returned `worktreePath` to 06's engine spawn
  `cwd`; 23 reuses the quarantine/sweep path directly.**
- **Overlap analyzer (WI7):** `analyzeOverlap(sets, nonGitResources?)`,
  `detectRenamesFromWorktree(plumbing, repoDir, baseRef, headRef)`; types `PlannedWriteSet`,
  `RenamePair`, `NonGitResource`, `CollisionVerdict`, `DetectedChanges`. **This IS 13's
  readiness-engine serialization input.**
- **Git identity (WI8):** `configureGitIdentity(plumbing, worktreePath, serviceEmail)`,
  `ENGINEERING_ORCHESTRATOR_GIT_IDENTITY_NAME` (`"Engineering Orchestrator"`); type `GitIdentity`.
  Called internally by `createWorktree` — **08's commit rendering depends on this already
  being true and never re-configures identity itself.**

No export-name collisions across the barrel (verified by `npx tsc -b packages/git-engine`
succeeding with every module re-exported from `src/index.ts`).

## Deviations

1. **TypeScript `@types/node` global-inclusion workaround, matching an existing repo
   precedent.** `npx tsc -b packages/git-engine` initially failed on every `node:*` import
   across the whole package with `TS2591: Cannot find name 'node:fs'...`. Root-caused via
   a systematic bisection (isolated single-file compiles at the real repo root, ruling out
   project references/tsconfig-location/package.json `"type"` as causes) to TypeScript's
   automatic global `@types` inclusion simply not firing in this repo's setup — confirmed
   NOT specific to this package by reproducing the identical failure with a trivial
   throwaway package. `packages/journal/src/store/fs-port.ts` and
   `packages/contracts/src/gateway/server-name.test.ts` each already carry an explicit
   `/// <reference types="node" />` directive as a prior-phase workaround for the exact
   same issue. Applied the identical fix: one `/// <reference types="node" />` line at the
   top of `src/plumbing.ts` (the package's own lowest-level node-API user, mirroring
   `fs-port.ts`'s role in `@eo/journal`) — this single directive makes `@types/node`
   available across the whole compilation unit. All throwaway diagnostic files/packages
   created during bisection were deleted before finishing; nothing from that process
   remains in the tree.
2. **Concurrency fix: `configureGitIdentity` retries on git config-file lock contention.**
   Found by this phase's own "many concurrent attempts on the same task never collide"
   test (WI6): every LINKED worktree of one repository shares that repository's single
   `.git/config` file unless `extensions.worktreeConfig` is separately enabled (not
   adopted — this package never needs a per-worktree DIFFERENT identity, only the one
   neutral identity every worktree carries identically, so there is no correctness reason
   to add that extra mechanism). Concurrent `createWorktree` calls therefore raced on
   git's own `config.lock` file, intermittently failing with "could not lock config file."
   Fixed with a small jittered-backoff retry in `git-identity.ts`, safe specifically
   because every concurrent writer writes the IDENTICAL value (`git-identity.retry.test.ts`
   proves the retry path deterministically via a fake `GitPlumbing`, and
   `worktree-lifecycle.test.ts`'s 12-way concurrent-creation test proves it holds for real
   git). Re-ran the full suite 5× after the fix with zero further flakes.
3. **Real-implementation bug caught by RED-phase testing: `resolveWorktreePath`'s
   symlink-escape check misfired on a never-yet-created root.** The first implementation's
   symlink guard walked from the DEEPEST existing ancestor of the candidate path and
   compared it against the (lexically-computed, since it didn't exist yet) root — which is
   always "not a prefix" the very first time a fresh `worktreesRootDir` is used, throwing
   `WorktreePathEscapeError` on every legitimate first-ever worktree creation. Caught
   immediately by WI6's own RED-phase run (not a fixture-authored RED — a genuine
   pre-GREEN implementation defect), fixed by walking the JOINED segments incrementally
   instead and only realpath-checking a prefix that already exists on disk (see
   `worktree-ref.ts`'s doc comment for the corrected algorithm). `worktree-ref.test.ts`'s
   symlink-escape fixture (a real planted symlink pointing outside the root) still catches
   the attack; the fresh-root case no longer false-positives.
4. **`quarantineWorktree`'s step boundaries were deliberately tightened during crash-test
   authoring** to remove an unrecoverable gap: an earlier draft had a fault-point
   checkpoint BETWEEN the `git worktree move` completing and the quarantine marker file
   being written, which — had a real crash landed exactly there — would have left a
   moved-but-untracked quarantine invisible to `sweepOrphanWorktrees`'s pass-2 (marker-driven)
   reconciliation. Removed that intermediate checkpoint so the move and the marker write
   are never separated by an interruptible boundary; see `worktree-lifecycle.ts`'s doc
   comment at the call site. The "kill -9 mid-quarantine" crash test (`wi6-crash-failing.txt`
   / `wi5-wi6-crash-passing.txt`) exercises exactly the checkpoints that remain.
5. **The non-Git resource registry's declarer is left an explicit open question, per the
   roadmap's own framing.** `analyzeOverlap`'s `nonGitResources` parameter is accepted as
   opaque caller-supplied config and matched directly (exact path equality against a
   unit's own `paths`) — no normalization, glob-matching, or discovery logic invented
   beyond that, since no phase text specifies one. **Flagging for the reconciler** (as the
   roadmap's own Risks section anticipates): no phase currently owns PRODUCING this
   registry's contents; 11's contract assembly is the roadmap's own suggested natural
   candidate, but this phase does not decide that unilaterally.
6. **Genuine, stub-backed RED was captured for all 8 work items plus both crash
   scenarios** — never a bare "module not found." Each `wiN-*-failing.txt` was captured
   against a deliberately-wrong-but-present stub implementation (e.g. WI1's stub routed
   `git` through `sh -c` — the exact insecure shape the phase exists to prevent; WI2's
   stub returned a constant hash; WI7's stub always reported "no collision," which
   genuinely failed BOTH its unit tests and its fast-check property's "never misses a true
   collision" invariant). For the crash tests specifically (`wi6-crash-failing.txt`),
   `sweepOrphanWorktrees` was temporarily reverted to its original "finds nothing" stub,
   the real `runKillHarness` kill -9 was run against it (genuinely failing both the
   mid-worktree-creation and mid-quarantine scenarios), then restored — see that file's
   own captured verdict detail showing `hasMarker=false`/`recovered=false` at the
   interrupted fault points.
7. **`packages/git-engine/package.json`/`tsconfig.json` updated** per the roadmap's own
   instruction: added `dependencies` on `@eo/contracts`, `@eo/journal`, `zod`; added
   `devDependencies.fast-check`; added `references` to `../contracts` and `../journal` in
   `tsconfig.json`, mirroring `packages/journal/tsconfig.json`'s own project-reference
   pattern. No `npm install` was run — all three dependencies already resolve via the
   existing workspace `node_modules` (verified before editing).

## Validation round (2026-07-18)

An adversarial (Opus) validator reproduced 1 CRITICAL + 2 MAJOR + 4 MINOR/NOTE defects
against this phase's otherwise-green build (the 116-test suite above). All seven were
fixed with TDD (genuine RED reproducing the validator's exact attack against the unfixed
code, captured, then GREEN after the fix); the suite is now **21 test files / 147 tests,
all green**. Real git 2.43.0 was used throughout, including for every exploit
reproduction — no mocked git anywhere in this fix pass either.

### CRITICAL 1 — argument injection / option smuggling

`plumbing.ts`'s argv-array + `shell:false` invocation defeats SHELL injection (proven by
`wi1-plumbing-*` and re-verified unaffected by this pass — no changes to `plumbing.ts`
itself), but no call site inserted an option-terminator before a caller-influenced
POSITIONAL, so `git` itself parsed a leading-dash value as a FLAG — a structurally
different attack shell-safety alone cannot prevent. Proven exploits, both reproduced and
then blocked, sandboxed inside `fs.mkdtempSync(os.tmpdir())`, never touching the repo or
`$HOME`:

- **RCE** — `control-clone.ts`'s `fetchRefresh` (`git fetch origin <ref>`) with
  `ref="--upload-pack=touch <marker>;git-upload-pack"` executed the smuggled `touch`
  against real git (git spawns the override as the transport helper on this
  local-filesystem fetch).
- **Arbitrary file overwrite** — `overlap-analyzer.ts`'s `detectRenamesFromWorktree`
  (`git diff --find-renames --name-status <baseRef> <headRef>`) with
  `baseRef="--output=<victim>"` truncated a file OUTSIDE the repo to empty.

Fixed with BOTH defense axes at every named call site:

| Call site | Option-terminator token | Boundary validation |
| --- | --- | --- |
| `control-clone.ts` `ensureControlClone` (`clone`) | `--end-of-options` (confirmed accepted by `clone` against real git 2.43.0) | n/a (source/dest are paths, not refs) |
| `control-clone.ts` `fetchRefresh` (`fetch` + the `rev-parse FETCH_HEAD` that follows it) | `--end-of-options` (confirmed accepted by `fetch`) | `assertSafeRefPositional("ref", ref)` — rejects a leading-`-` ref before ever spawning git |
| `overlap-analyzer.ts` `detectRenamesFromWorktree` (`diff`) | `--end-of-options` (confirmed accepted by `diff`) | `assertSafeRefPositional` on both `baseRef` and `headRef` |
| `intake-freeze.ts` `freezeIntake` (`rev-parse`) | `--verify --end-of-options` — **`rev-parse` alone does NOT honor a bare `--end-of-options`**: empirically, `git rev-parse --end-of-options <ref>` ECHOES the literal token to stdout instead of treating it as a terminator (its own hand-rolled parser, unlike `clone`/`fetch`/`diff`/`worktree add`'s shared `parse_options()`); pairing it with `--verify` is git's own documented pattern (`git rev-parse --help`'s example) and was verified to produce clean single-hash output | `assertSafeRefPositional("targetRef", targetRef)` |
| `worktree-lifecycle.ts` `createWorktree` (`worktree add`) | `--end-of-options` (confirmed accepted by `worktree add`) | `assertObjectId("baseObjectId", ...)` — `ref`/`worktreePath` are already boundary-safe by construction (`buildWorktreeRef`'s literal `work/...` prefix; `resolveWorktreePath`'s always-absolute output), so `baseObjectId` was the one unguarded positional; rejects anything not matching `^(?:[0-9a-f]{40}|[0-9a-f]{64})$` |

New shared module `git-arg-guard.ts` (`OPTION_TERMINATOR`, `assertSafeRefPositional`,
`assertObjectId`, `UnsafeGitRefError`, `InvalidObjectIdError`) — exported from the barrel
so 08 can reuse it for its own `merge-tree`/`update-ref` calls rather than re-deriving the
same defense. `plumbing.test.ts`'s `INJECTION_CORPUS` extended with three leading-dash
fixtures. `control-clone.ts`'s own `sourceRepoPath` positional (also named "same class,
unguarded" by the validator) got the terminator too, but could NOT be independently
proven as a live RCE: `ensureControlClone` only ever calls `clone` against a `controlDir`
that — by the function's own idempotency check — never pre-exists as a real repo, so the
single-remaining-positional confusion this exploit class relies on always hits git's
"repository does not exist" failure before any transport helper would run; fixed anyway
for defense-in-depth (matches the same option-smuggling shape), verified via a
spawn-capture-level regression test instead of a live RCE reproduction.

Evidence: `fix-crit1-argument-injection-{failing,passing}.txt`. Regression tests:
`argument-injection.regression.test.ts` (new file — the RCE and overwrite reproductions,
plus one rejection test per named call site) + `spawn-surface-scan.test.ts`'s new
structural check (below, doubles as the NOTE 7 fix).

### MAJOR 2 — hooks/filters not neutralized in control context

`repo-validation.ts`'s `neutralizeHooksPath` only ever set REPO-LOCAL `core.hooksPath`,
and only AFTER `ensureControlClone`'s own clone step — so (a) an AMBIENT global/system
`core.hooksPath` fired during the clone's own initial checkout, before the repo-local
neutralization could take effect, and (b) ambient `filter.<x>.smudge` (e.g. what
`git-lfs install` registers globally) was NEVER neutralized at all, firing during both
`ensureControlClone`'s clone AND `createWorktree`'s `worktree add`.

Fixed with a new `CONTROL_CONTEXT_ENV` constant (`git-arg-guard.ts`) —
`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_SYSTEM=/dev/null`, `GIT_TERMINAL_PROMPT=0` —
applied to every control-context spawn: `ensureControlClone`'s `clone`, `fetchRefresh`'s
`fetch` + its `rev-parse FETCH_HEAD`, `intake-freeze.ts`'s `rev-parse` against the control
clone, and `createWorktree`'s `worktree add`. Repo-local `neutralizeHooksPath` is kept
as belt-and-suspenders (unchanged). Deliberately NOT applied to reads against the USER's
own checkout (`intake-freeze.ts`'s `status` call, `repo-validation.ts`'s `ls-files`
call) — this package never owns or overrides the user's own git config, only the control
clone's; those two use `USER_CHECKOUT_READ_ENV` instead (MINOR 4, below).

Evidence: `fix-major2-control-context-filters-{failing,passing}.txt`. Regression test:
`control-context-isolation.test.ts` (new file) — builds a fixture "ambient global config"
(via `GIT_CONFIG_GLOBAL`, the same env var git itself honors, pointed at a fixture file
for the duration of one spawn) declaring a `post-checkout` hook AND a
`filter.eo-test-filter.smudge`, each writing a distinguishable marker; proves neither
fires during `ensureControlClone` or `createWorktree`.

**Residual caught by the fix re-audit (2026-07-18), then closed.** A fresh, context-free
adversarial Opus re-audit confirmed the CRITICAL, the overlap MAJOR, and every MINOR
closed with no over-fix — but found the first MAJOR-2 pass had missed ONE control-context
call: `isWorktreeDirty`'s `git status --porcelain=v2`
(`worktree-lifecycle.ts`), which `sweepOrphanWorktrees` runs on every registered control
worktree at startup, still inherited `process.env` and so ran an ambient `clean`/`process`
filter (e.g. git-lfs) in the control context when re-hashing a stat-mismatched file. The
re-auditor exhaustively enumerated the remaining control-context git calls (`worktree
move`/`remove`/`list`/`prune`, `rev-parse --git-dir`, `config --local`) and confirmed none
of them run a checkout/hook/filter, so `isWorktreeDirty` was the only leak. Closed by
passing `CONTROL_CONTEXT_ENV` to that one `status` call (it scans a CONTROL-owned worktree,
so control-context isolation is correct — distinct from `intake-freeze.ts`'s USER-checkout
`status`, which keeps `USER_CHECKOUT_READ_ENV`). Regression test added to
`control-context-isolation.test.ts` ("isWorktreeDirty: the ambient clean filter never
fires…"): the shared ambient-config fixture gained a `clean` filter marker; the test edits
a filter-attributed file to force a stat mismatch, calls `isWorktreeDirty` under an ambient
`GIT_CONFIG_GLOBAL`, and asserts the file is detected dirty (`true`) while the clean-filter
marker is NEVER written. Captured RED (marker fired: `expected true to be false`) against
the unfixed code, GREEN after — see `p07-residual-*.txt` in the session evidence and the
recaptured package gate. This one-line fix applies the already-adversarially-verified
`CONTROL_CONTEXT_ENV` pattern; given the re-auditor's exhaustive enumeration plus this
dedicated RED→GREEN regression, it was closed at integration without a third full re-audit
round (proportionate to a one-call env addition).

### MAJOR 3 — overlap analyzer false-negatives

`overlap-analyzer.ts` compared paths by EXACT string equality, zero normalization —
`src/a.txt` vs `./src/a.txt`; `pkg/` vs `pkg`; `a//b` vs `a/b`; and a non-Git registry
entry spelled `./package-lock.json` against a unit's own `package-lock.json`, all cleared
as `collides:false`. The property test's own reference model (`overlap-analyzer.property.test.ts`)
shared the identical exact-equality flaw and only ever generated already-canonical
single-char paths, so it structurally could not have caught this.

Fixed with a new exported `normalizePlannedPath` (collapses `.` segments, `//` → `/`, a
trailing slash) applied to both a unit's own `paths`/`renames` AND the non-Git resource
registry's `path` before any comparison. Deliberately does NOT case-fold or unicode-fold
— documented scoping decision (this package targets case-sensitive filesystems; folding
case would make genuinely DIFFERENT files collide, a worse failure mode than the
false-negative this fix targets) — and deliberately does NOT resolve `..` segments (no
filesystem root context available to this pure function). The property test's reference
model was rewritten to normalize INDEPENDENTLY — built on `node:path`'s own
`posix.normalize`, a different mechanism from the source module's hand-rolled segment
filter, not a copy of it — and its path arbitrary (`pathArb`) now draws from several
equivalent spellings of the same canonical letter, plus a dedicated new property test
("never misses a collision even when the two units spell the SAME canonical path
differently").

Evidence: `fix-major3-overlap-normalization-{failing,passing}.txt`. Regression tests: a
new `describe` block in `overlap-analyzer.test.ts` encoding the validator's exact four
pairs as explicit fixtures (plus a documented case-sensitivity non-collision fixture),
and the rewritten/extended property suite in `overlap-analyzer.property.test.ts`.

### MINOR 4 — freeze mutates the user's `.git/index`

`intake-freeze.ts`'s `status --porcelain=v2` and `repo-validation.ts`'s `ls-files` (called
against the USER checkout by `validateRepository`) can rewrite `.git/index` bytes as a
side effect of git's own "racy git" stat-cache optimization — empirically confirmed
against real git 2.43.0: a tracked file's mtime bumped to the future with UNCHANGED
content (`fs.utimesSync`), followed by a plain `git status`, measurably changed
`.git/index`'s bytes. (An ordinary content-only edit did not reliably reproduce this on
every filesystem/mtime-granularity — the racy-mtime shape is the deterministic
repro used in the regression test.) This is a real mutation of the user's checkout this
package promises never to cause ("`freezeIntake` never mutates the user checkout").

Fixed with `--no-optional-locks` (a global git flag, placed before the subcommand) AND
`GIT_OPTIONAL_LOCKS=0` (env) — two independent mechanisms for the identical switch,
belt-and-suspenders — on both `intake-freeze.ts`'s `status` call and
`repo-validation.ts`'s `ls-files` call.

Regression test: folded into MINOR 5's combined test (below) — `.git/index` bytes proven
byte-identical before/after `freezeIntake`, wrapped in the strengthened invariance
harness.

### MINOR 5 — invariance harness blind to `.git` and symlinks

`invariance.ts`'s `computeWorkingTreeHash` (a) deliberately excludes `.git` from its
digest (by design — see the file's own top-of-file doc comment on why it's a
git-independent, `.git`-blind content hash), which meant it could never detect a
refs/config/index mutation — exactly why MINOR 4 went undetected even though an
invariance harness already existed; and (b) skipped symlinks entirely (neither followed
nor hashed), so a symlink swap (a tracked file replaced by a symlink, or a symlink
retargeted) was invisible to both the "before" and "after" hash.

Fixed:
- **(a) Symlinks**: `computeWorkingTreeHash` now collects symlinks as their own entry
  kind (never followed/traversed into) and hashes each one's relative path + its
  `readlinkSync` target.
- **(b) `.git` state**: a new `computeGitStateHash(repoPath)` hashes `HEAD`, `config`,
  `index` (when present), `packed-refs` (when present), and every loose ref file under
  `refs/` — and a new `withUserCheckoutInvariance` wraps BOTH `computeWorkingTreeHash`
  and `computeGitStateHash` into one before/after assertion. Applied specifically around
  `freezeIntake` in `intake-freeze.test.ts` (the ONE operation in this package's own
  suite that reads a real user checkout), proving MINOR 4's fix: the user's `.git/index`
  is now provably byte-identical before/after, not just "probably fine."
- **(c) Evidence correction**: the exit-criteria table's invariance row previously
  overstated coverage ("every integration test... wraps its own fixture in a before/after
  hash comparison"). Corrected above (see the table) to say honestly where the harness is
  APPLIED (`freezeIntake`, the one user-checkout-touching operation) versus where it is
  merely TESTED (its own dedicated `invariance.test.ts` file) — the harness is not
  literally wrapped around every worktree-mutation test in this suite, because those
  operate on control-owned dirs, not the user checkout, so wrapping them would assert a
  property those tests were never about.

Regression tests: `invariance.test.ts` gained symlink-hashing and
`computeGitStateHash`/`withUserCheckoutInvariance` describe blocks;
`intake-freeze.test.ts` gained the combined MINOR 4/5 regression test (racy-mtime trigger
+ `withUserCheckoutInvariance` wrapping `freezeIntake`, asserting no `TreeMutatedError`
AND identical raw `.git/index` bytes).

### MINOR 6 — crash sweep re-journals every quarantine on every startup

`worktree-lifecycle.ts`'s `sweepOrphanWorktrees` pass 2 appended a `worktree_quarantine`
journal entry for EVERY marker-having dir in the quarantine directory on EVERY sweep
call, unconditionally — duplicate/accumulating entries across repeated sweeps over one
persistent quarantine dir (pass 1's `quarantineWorktree` already journals once at
creation time; pass 2 never checked whether that had already happened).

Fixed with a new sentinel file (`QUARANTINE_JOURNALED_MARKER_NAME`,
`.eo-quarantine-journaled`) written immediately after ANY successful
`worktree_quarantine` journal append — by pass 1's `quarantineWorktree` itself, or by
pass 2 when it reconciles an interrupted-mid-quarantine dir. Pass 2 now checks for this
sentinel first and skips (never re-journals) a dir that already carries it. Crash-test
compatibility verified: the "kill -9 mid-quarantine" fault points (`before-quarantine-move`,
`after-marker-before-journal`, `done`) still recover exactly as before — the sentinel
logic only ever SKIPS a re-journal that duplicated an already-successful one, never skips
the one genuine journal a fault point actually needs.

Regression test: a new test in `worktree-lifecycle.test.ts` — 5 repeated
`sweepOrphanWorktrees` calls over one persistent quarantine dir yield exactly ONE
`worktree_quarantine` journal entry total.

### NOTE 7 — sweep ownership prefix check; spawn-surface-scan blind to option smuggling

Two related findings:

- Sweep ownership (`sweepOrphanWorktrees`'s `worktreesRootDir` prefix check) compared
  `wt.path` (as `git worktree list` reports it) against the lexical
  `options.worktreesRootDir` string — a symlinked root, or a WSL2/9p-mount realpath
  mismatch, could make a genuinely-owned, registered worktree fail the textual prefix
  check and be silently skipped as "not ours" (never quarantined even if orphaned/dirty).
  Fixed with a new `realpathOrSelf` helper (falls back to the lexical path if the target
  doesn't exist, so a not-yet-existing path is still handled correctly by the caller's
  subsequent `existsSync` check) applied to BOTH sides of the comparison.
- `spawn-surface-scan.test.ts` only ever modeled injection as SHELL-only (`shell:true`,
  `exec`/`execSync`, a shell binary as the spawned command) — none of that detects
  CRITICAL 1's option-smuggling class. Added a new structural check asserting
  `OPTION_TERMINATOR` (from `git-arg-guard.ts`) is textually referenced at every call site
  CRITICAL 1 names as vulnerable — proving the option-smuggling class is now
  STRUCTURALLY covered by this scan, not merely absent-of-evidence.

Regression tests: a new symlinked-root test in `worktree-lifecycle.test.ts` (a worktree
created directly under a real root is still recognized and quarantined when swept via a
symlink pointing at that root); the new `spawn-surface-scan.test.ts` structural check
described above.

### Downstream impact (08/13/23)

Purely additive to the exported barrel — no existing exported signature changed shape.
New exports: `OPTION_TERMINATOR`, `CONTROL_CONTEXT_ENV`, `USER_CHECKOUT_READ_ENV`,
`assertSafeRefPositional`, `assertObjectId`, `UnsafeGitRefError`, `InvalidObjectIdError`
(`git-arg-guard.ts`); `computeGitStateHash`, `withUserCheckoutInvariance` (`invariance.ts`);
`normalizePlannedPath` (`overlap-analyzer.ts`). Two NEW ways existing functions can now
throw, both unreachable for any caller already passing well-formed values (which every
existing caller in this codebase does): `createWorktree` throws `InvalidObjectIdError` if
`baseObjectId` isn't a 40/64-char hex string (13's `TaskPacket.baseObjectId`, sourced from
`IntakeFreezeRecord.baseObjectId`, is always a real `rev-parse` output — never trips this);
`fetchRefresh`/`freezeIntake` throw `UnsafeGitRefError` if a ref positional starts with
`-` (a real git ref never does). 08, when it adds its own `merge-tree`/`update-ref` calls
to this package, should reuse `OPTION_TERMINATOR`/`assertSafeRefPositional`/
`assertObjectId`/`CONTROL_CONTEXT_ENV` rather than re-deriving the same defense — flagging
this explicitly since 08 wasn't built yet as of this validation round.

## Worker provenance

Single worker, this phase only (`packages/git-engine`, phase 07). No other package was
edited. `packages/supervisor/**` changes visible in `git status` during this work belong
to a concurrent worker on a different phase (per this phase's own brief: "a concurrent
worker owns it") and are untouched here. `docs/evidence/phase-05/**` similarly belongs to
that concurrent worker's own evidence trail. The 2026-07-18 validation round fix pass
above was likewise scoped to `packages/git-engine` and its own evidence directory only.
