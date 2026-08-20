# Design — a build-output staleness check for this repository

**Change set:** `cbd21c01-0588-41e4-b297-a34794b3a8b6`
**Stage:** `design` · **Inputs:** `./stale-dist-research-record.md` (research closed
round 15), the owner's `clarify` rulings of 2026-08-20 (full per-unit walk; wired
into `check:all`).

Every count below states the command that produced it, per the research record's
third standing rule. All measured 2026-08-20 at a clean working tree.

## 0. Requirement traceability

| #   | requirement                                                                          | discharged by                                                                                         |
| --- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| 1   | `dist` side scoped to compiler outputs, excluding the `bundle:cli` asset copy        | §3 output set; `dist/plugin/**` + `dist/index.d.ts` excluded for `packages/cli`. Fixture row 7, §6    |
| 2   | orphan check                                                                         | §3.1 `checkOrphans`                                                                                   |
| 3   | `packages/cli/dist/bin.js` vs newest `dist` of every inlined `@crabgic/*`            | §3.2 `checkBundleFreshness`, over the 16-unit transitive closure                                      |
| 4   | STATE the bootstrap limit                                                            | **residual** — §8(a). Partly sidestepped: the check lives in `scripts/`, which no tsconfig compiles   |
| 5   | enumerate from root `references` (19), never `workspaces` (18)                       | §3, via `enumerateRootReferences`                                                                     |
| 6   | each unit's `tsconfig.json` + its `extends` chain on the input side                  | §3 input rule 3. Fixture row 2, §6                                                                    |
| 7   | STATE the build-program/toolchain limit                                              | **residual** — §8(b). Partly closed: each producer script is an input to the one artifact it produces |
| 8   | account for `packages/cli/.dts-cache/`                                               | §3.3 `checkDeclarationCache`                                                                          |
| 9   | every `tsconfig*.json` a build program hands to a compiler, incl. downward `extends` | §3 input rule 4 + §3.3. Fixture row 3, §6                                                             |
| 10  | wire into `check:all`                                                                | §5 — 15th member, first in the chain; trigger's real reach stated                                     |
| 11  | call `scripts/repo-census.mjs` rather than re-deriving                               | §2 — imports `enumerateRootReferences` + `enumerateTsconfigs`                                         |

## 1. Shape and placement

`scripts/`, not the doctor registry. Three consequences, all verified:

- **It dissolves blind spot 4 for itself.** `scripts/` is compiled by no
  `tsconfig.json` (root `tsconfig.json:2` is `"files": []`), so this check is not
  a compiled artifact and cannot be disabled by the staleness it detects. The
  limit is still STATED in §8(a) because it remains true of `crabgic doctor`.
- It is covered by `packages/testkit/src/git-spawn-hygiene.test.ts` —
  `SCANNED_ROOTS` includes `"scripts"` and `SCANNED_EXTENSIONS` includes `".mjs"`
  (`:114,116`).
- Its colocated tests run under `npm test` via the `scripts` vitest project
  (`vitest.config.ts:84`, `test: { root: "scripts", name: "scripts" }`).

Dependency-free, node builtins only — `meta-checks` runs `npm ci` with no build
step, the constraint `scripts/citation-content/file-index.mjs` documents in its
header and `scripts/repo-census.mjs` restates at `:39-41`.

| file                                | lines (est.) | purpose                                                 |
| ----------------------------------- | ------------ | ------------------------------------------------------- |
| `scripts/check-stale-dist.mjs`      | ~90          | `#!/usr/bin/env node`, the WHY header, arg parsing, CLI |
| `scripts/stale-dist/units.mjs`      | ~150         | build-unit enumeration and per-unit input/output sets   |
| `scripts/stale-dist/walk.mjs`       | ~80          | mtime walk primitives and the output/input classifiers  |
| `scripts/stale-dist/compare.mjs`    | ~220         | the FIVE comparisons, each returning `Finding[]`        |
| `scripts/stale-dist/report.mjs`     | ~80          | findings → text/JSON, and the exit code                 |
| `scripts/check-stale-dist.test.mjs` | ~450         | colocated suite (§6)                                    |

The subdirectory follows `scripts/check-citation-content.mjs` +
`scripts/citation-content/*.mjs`; the colocated `*.test.mjs` follows
`scripts/repo-census.test.mjs`.

## 2. Elements

```
// units.mjs
export function buildUnits(cwd)                      -> Unit[]
export function configChain(tsconfigPath, cwd)       -> string[]   // upward `extends`, cycle-guarded
export function descendantConfigs(unitDir, allConfigs) -> string[] // configs extending DOWNWARD into the unit
export const PRODUCER_INPUTS                                       // build programs, per artifact

// Unit = { dir, srcDir, distDir, tsconfigPath, configs: string[],
//          references: string[], kind: "tsc" | "bundled", built: boolean }

// walk.mjs
export function newestUnder(dir, accept)             -> { path, mtimeMs } | undefined
export function stemsUnder(dir, accept)              -> string[]   // extension-stripped, sorted
export function isCompilerOutput(unit, relPath)      -> boolean    // requirement 1
export function isCompilerInput(relPath)             -> boolean

// compare.mjs
export function checkUnitFreshness(unit)             -> Finding[]  // reqs 1, 5, 6, 9
export function checkOrphans(unit)                   -> Finding[]  // req 2
export function checkBundleFreshness(units, inlined) -> Finding[]  // req 3
export function checkDeclarationCache(units)         -> Finding[]  // req 8
export function checkPluginAssets(cwd)               -> Finding[]  // §3.4
export function inlinedUnitsFromMetafile(metafile)   -> string[]   // req 3's ground truth
export function checkStaleDist(cwd)                  -> { findings, units, skipped }

// Finding = { kind, unit, newerInput, olderOutput, deltaMs, remedy }
// kind ∈ "stale-unit" | "orphan-output" | "stale-bundle" | "stale-declarations"
//       | "stale-plugin-assets" | "unbuilt" | "bundle-provenance-missing"

// report.mjs
export function formatFindings(result, { json })     -> string
export function exitCodeFor(result, { strict })      -> 0 | 1 | 2
```

Everything is pure over its arguments except `newestUnder`/`stemsUnder`, which read
the filesystem — the split `repo-census.mjs` uses between `computeDisagreements`
(pure, unit-tested) and `enumerate*` (I/O).

**No `git` spawn.** `units.mjs` imports only `enumerateRootReferences` and
`enumerateTsconfigs` from `scripts/repo-census.mjs`; `enumerateGit` is the one that
spawns and is not imported. A future revision that needs git must go through the same
module's `censusGitEnv()`, which already scrubs `GIT_LOCATION_ENV_VARS`.

## 3. The enumeration algorithm

**Units.** `enumerateRootReferences(cwd)` → **19** entries. Requirement 5 and 11 in
one call — the census already owns this set and disagrees with `workspaces` (18) by
exactly `e2e/report`.

```
node -e "const j=JSON.parse(require('fs').readFileSync('tsconfig.json','utf8').replace(/^\s*\/\/.*$/gm,''));console.log(j.references.length)"   # 19
node scripts/repo-census.mjs | grep -A2 'NOT an npm workspace'                                                                                  # 1 — e2e/report
```

All 19 are uniform today — `extends: ../../tsconfig.base.json`, `rootDir: ./src`,
`outDir: ./dist`, `include: ["src"]`, `composite: true` — but the design READS these
per unit rather than assuming them.

**Skip rule.** A unit whose `dist/` does not exist is `skipped`, never stale (research
Q5: a fresh clone must not be noisy).

**Per-unit input set** — newest mtime over:

1. every `*.ts` under `<unit>/src`, recursively;
2. every `*.json` under `<unit>/src` (`resolveJsonModule: true`, `tsconfig.base.json`);
3. `<unit>/tsconfig.json` **and its full upward `extends` chain** — requirement 6.
   Chain length is 2 for all 19 today (`<unit>/tsconfig.json` → `tsconfig.base.json`);
4. every `tsconfig*.json` whose own `extends` chain resolves **into** this unit —
   requirement 9. Computed from `enumerateTsconfigs(cwd)`, which returns 27 project
   dirs plus **2** variants (`packages/cli/tsconfig.dts.json`, `tsconfig.base.json`).
   `packages/cli/tsconfig.dts.json` declares `"extends": "./tsconfig.json"`, so it
   attaches to `packages/cli` — the config an upward walk provably never reaches.

Everything else under `src` is excluded: **18** non-`.ts` files exist across all 19
`src/` trees — 12 `.mjs`, 3 `.json`, 2 `.snap`, 1 `.info` — so the 3 `.json` are inputs
and the other **15** are fixtures no compiler reads.

```
for d in packages/*/src e2e/report/src; do find $d -type f; done | grep -v '\.ts$' | sed 's/.*\.//' | sort | uniq -c   # 12 mjs, 3 json, 2 snap, 1 info
git ls-files | grep -E 'tsconfig.*\.json$' | wc -l                                            # 30
```

**Per-unit output set** — newest mtime over `<unit>/dist/**` filtered to `.js`,
`.d.ts`, `.js.map`, `.d.ts.map`, minus:

- `.tsbuildinfo` — incremental state, not emitted output; `bundle-cli.mjs:113`
  preserves it across the wipe;
- for `packages/cli` only, `dist/plugin/**` — **requirement 1**. `bundle-cli.mjs:178`
  copies the six `PLUGIN_ASSET_ENTRIES` with `cp(..., { recursive: true })` and no
  `preserveTimestamps`, so those mtimes are copy time and say nothing about a compile;
- for `packages/cli` only, `dist/index.d.ts` — a `copyFile` of the declaration cache
  (`bundle-cli.mjs:153`), handled as its own artifact in §3.3.

**Verdict:** `newest(inputs) > newest(outputs)`, strictly. Equal timestamps are clean —
the safe direction under second-granularity filesystems.

### 3.1 Orphan check — requirement 2

For the 18 `kind: "tsc"` units, compare extension-stripped stems: `dist/X.js` must
have `src/X.ts`. Measured today across all 18: **0** orphaned outputs and **0**
un-emitted sources, a clean bijection — so the rule is exact, not approximate.

⚠️ **THAT COUNT IS UNSTABLE, BECAUSE THE TEST SUITE WRITES INTO A `dist` (round 5).**
`packages/journal/src/crash-fixtures/prepare-runtime.ts:25` sets
`SCRATCH_ROOT = <journal>/dist` and `:110` `mkdtemp`s `eo-crash-fixture-*` there,
transpiling `.ts` sources to `.js` inside it. Those `.js` have no `src` counterpart, so
they ARE orphans by this rule — round 5 measured **40** of them, and observed two
fixture directories being reaped mid-review. The suite's job is to SIGKILL its children,
so `cleanup()` cannot run when the harness dies.

Three ways this bites precisely this design:

- `pretest` is the primary trigger, so the check runs at the START of the very
  `npm test` whose interrupted predecessor left the residue;
- the printed remedy would be `rm -rf packages/journal/dist`, telling the operator to
  delete a directory a concurrent run may be writing into;
- §6's live smoke test calls `checkStaleDist(REPO_ROOT)` from inside vitest, so it can
  observe the orphans or `ENOENT` on a directory reaped between `readdirSync` and
  `statSync`.

**So the output and stem sets exclude test-written scratch**: `dist/eo-crash-fixture-*/**`
by name, stated rather than inferred. And §3.1's bijection is restated as _0 orphans on a
tree with no test run in flight_ — a measurement whose subject a test run mutates.

```
# per unit: comm -23 <(dist .js stems) <(src .ts stems)  -> 0 for all 18
```

`packages/cli` is exempt, structurally rather than by fudge: `bundle-cli.mjs:113-119`
wipes `dist` except `.tsbuildinfo` before every bundle, so a completed `bundle:cli`
cannot leave an orphan; and esbuild's outputs are content-hashed chunks
(`chunk-DVV3SNQ3.js`, `run-dispatcher-POLZZ2DH.js` on disk now) that map to no single
source. Its 10 non-plugin `dist` files are covered by §3.2 instead.

### 3.2 Bundle freshness — requirement 3

The comparison the record says a design omitting it "does not address the incident it
is named for".

**Consumer set:** the transitive closure of `packages/cli/tsconfig.json`'s
`references` — **16** units. `packages/perf` and `e2e/report` are unreachable and
correctly excluded.

ℹ️ **Round 4 measured the two sets and they are EQUAL today** — the metafile filter
yields 16 units, member for member identical to the reference closure, and `cli` never
matches `^packages/([^/]+)/dist/` because it enters only via `src/`. So "superset"
overstates it and the "minus `cli`" step is a no-op. The metafile remains the rule
anyway: the closure's agreement is a fact about today's import graph, not a property of
it, and the reasoning below is why the closure cannot be trusted to keep agreeing.

⚠️ **Calling the closure "the inlined set" was a round-1 finding.** `@crabgic/testkit` is in the closure but is not inlined: it is a
`devDependency` of `packages/cli`, not a dependency, and **zero** testkit runtime
symbols appear anywhere in `packages/cli/dist/*.js`. So editing `packages/testkit/src`
and running `npm run typecheck` fires `stale-bundle` against a bundle containing none
of that code — and under `--strict` that blocks a push.

⚠️ **THE ROUND-1 FIX FOR THAT WAS REFUTED IN ROUND 2.** The "zero testkit symbols"
premise was wrong: it grepped `packages/cli/dist/*.js` for the specifier
`@crabgic/testkit`, and **esbuild ERASES specifiers when it inlines**, so that search
could only ever return nothing. It was narrower than the claim it evidenced — standing
rule 1, on this design's own fix. Re-measured by symbol DEFINITION,
`packages/cli/dist/chunk-I6JBP7DT.js` carries **11** occurrences of testkit identifiers
(`GIT_FIXTURE_IDENTITY`, `ALL_FIXTURES`, `buildIntentContract`, …). Testkit **is**
inlined, reached through `@crabgic/engine-claude`'s re-export of
`./adjudication-policy.js`.

Worse, the rule generalises catastrophically. `packages/cli/package.json` declares
**zero** `@crabgic/*` `dependencies`; its only two `@crabgic` edges are
`devDependencies` — `renderer` and `testkit` — and **renderer is inlined too**. So
"minus dev-only edges" either drops both inlined units, or read transitively drops all
16 and makes the comparison **vacuous**.

**The inlined set is therefore derived from esbuild's own metafile, never from the
package.json graph.** `result.metafile.inputs` is exactly the set of files that entered the
bundle.

**The derivation is stated rather than left to the implementer**, because `inputs` is
not a unit list: measured with esbuild 0.28.1 under `bundle-cli.mjs`'s own options it
holds **758** entries spanning **17** `packages/*` plus a large `node_modules/**` tail.
`inlinedUnitsFromMetafile` therefore keeps keys matching `^packages/([^/]+)/dist/`,
takes the capture, and drops `cli` itself — `packages/cli` appears via its own `src/`
and is the consumer, not an inlined dependency. The declared dependency graph is not that set and never was — the bundle is
built from the ESM import graph.

⚠️ **BUT THAT RULE WAS UNIMPLEMENTABLE AS FIRST WRITTEN, AND THE DESIGN CAUGHT IT
BEFORE THE NEXT ROUND DID.** `bundle-cli.mjs:140` sets `metafile: true` and `:181`
reads `result.metafile.outputs` **in memory**, then discards it. Measured:
`find packages/cli/dist -name "*meta*"` returns nothing. The check runs at a different
time from the bundle, so there is no metafile for it to read.

**So the design requires one change to the build program**: `bundle-cli.mjs` writes
`result.metafile` to **`packages/cli/.bundle-meta/metafile.json`** — gitignored, and
deliberately OUTSIDE `dist`.

⚠️ **`packages/cli/dist/.bundle-meta.json` was the first proposal and it would have
SHIPPED.** `packages/cli/package.json`'s `files` is
`["dist", "!dist/**/*.test.*", "!dist/**/test-support/**", "!dist/.tsbuildinfo"]`, so
anything new under `dist` is published by default — and the metafile is **404,198 bytes
over 758 inputs**, including a `node_modules/**` tail. This repository already fought
exactly this battle: `check-published-tarball.mjs:41-45` bans `.tsbuildinfo` because it
is "the one file that differs between two builds of identical sources in different
environments, so shipping it makes the published artifact non-reproducible — directly
undermining roadmap/23's reproducible-build criterion. Shipped in 1.0.0 through 1.1.1."
The metafile is twice that size with the same defect, and **no `files` negation and no
`FORBIDDEN_PATTERNS` rule would have caught it** — `check:tarball` would have passed it
straight into the published package.

Beside `.dts-cache` is the shape this repository already uses for a build artifact that
must not ship.

⚠️ **And the entry has to be copied, not just the shape.** `.dts-cache/` is gitignored at
`.gitignore:47`; `packages/cli/.bundle-meta/` is **not** — measured with
`git check-ignore -v`, which reports nothing for it. Without that line the design creates
an untracked file on every build, which `repo-census.mjs` reports in its "on disk,
neither tracked nor ignored" bucket and which sits in `git status` forever. So the change
to the build program comes with a second, one-line change: add
`packages/cli/.bundle-meta/` to `.gitignore`.

This was caught by pre-checking the fix rather than by a review round — the fourth
consecutive round in which a fix in this design carried a defect, and the third caught
before a reviewer saw it. The pattern is worth more than any single instance: **a fix
that copies an existing shape must copy the whole of it**, and the only reliable way to
find out is to run the check the shape implies. Three properties then make it the right oracle rather than a workaround:

- it is the **only** ground truth for "what went into this bundle" — every alternative
  (the package.json graph, the tsconfig closure, grepping for specifiers) has already
  been measured wrong in this design;
- when it is absent the bundle comparison does not throw — but **absence is reported,
  not silently skipped**. "No bundle at all" and "a bundle exists whose provenance is
  missing" are different states, and the second is reachable on a fully built tree:
  every tree built by today's `bundle-cli.mjs`, and any build interrupted between
  esbuild and the metafile write. Silently skipping there would mute requirement 3's
  comparison on exactly the founding incident, so it reports
  `bundle-provenance-missing` with the reduced-confidence wording §3.2 already uses for
  the chunk-predicate fallback;
- it is **excluded from the output set** for the same reason `.tsbuildinfo` is — it is
  bundler bookkeeping, not compiler output, and including it would let the bundle
  comparison clear itself.

This is the third round in a row where a fix in this design carried the defect it was
fixing. It is recorded rather than smoothed over because the pattern is the finding:
**every one was caught by running the fix instead of reasoning about it**, and the two
caught before a review round were caught by pre-checking rather than by a reviewer.

**Why `dist`, not `src`, is the inlined side:** every workspace package resolves to
its build output (`exports["."].default === "./dist/index.js"`; `main` is
`./dist/index.js` for all 18) and `bundle-cli.mjs:129` sets `bundle: true`.

⚠️ **The three entry outputs are NOT an esbuild-only oracle, which was a round-1
finding and a false NEGATIVE in the one comparison requirement 3 exists for.**
`packages/cli/src/{bin.ts,index.ts,bin/supervisord.ts}` all exist, and with
`rootDir: ./src` / `outDir: ./dist` a plain `tsc -b` writes exactly those same three
paths — the repo documents this itself at `bundle-cli.mjs:108-112`. So
`npm run typecheck` alone refreshes them, `bundleAt` resets, and the check reports
clean although `bundle:cli` never ran.

**Rule:** let `bundleAt` be the mtime of an artifact **only esbuild produces** — a
hashed chunk under `packages/cli/dist/` (esbuild emits chunk files that `tsc` has no
notion of), falling back to `min(mtime)` over the three entry outputs only when no such
artifact exists, with that fallback reported as a reduced-confidence result rather than
silently. The minimum is still used across whichever set is chosen, so a partial
refresh cannot mask a stale sibling. Report `stale-bundle` when any of

- newest `dist` compiler output across the 16 units,
- newest compiler input under `packages/cli/src` (§3 rules 1-2),
- `scripts/bundle-cli.mjs`

is newer than `bundleAt`. Including the build program here is precise rather than noisy: `bundle-cli.mjs`
produces exactly this artifact and nothing else.

### 3.3 Declaration cache — requirement 8

`packages/cli/.dts-cache/index.d.ts` is gitignored (`.gitignore:47`), is neither
`src` nor `dist`, and survives the `rm -rf packages/cli/dist` a reader performs when
the check fires.

⚠️ **SKIP RULE, RE-KEYED IN ROUND 3 — directory existence is the wrong predicate.**
`tsc -b --clean` leaves `dist` **existing and empty**, measured, and `build:clean` is a
published root script. A rule keyed on absence does not fire there, so the comparison
runs with nothing to compare and its verdict is undefined. Reporting `clean` would print
PASS on a tree with **zero build output** — the worst available answer for the incident
this check is named for.

**The rule is keyed on qualifying COMPILER OUTPUTS, not on the directory**, and the
empty state gets its own name:

| unit state                                     | verdict                                           |
| ---------------------------------------------- | ------------------------------------------------- |
| no `dist/` at all                              | `skipped`                                         |
| `dist/` exists, no qualifying compiler outputs | **`unbuilt`** — a finding, remedy `npm run build` |
| `dist/` exists with outputs                    | compared normally                                 |

⚠️ **AND FOR `packages/cli`, PRESENCE OF OUTPUTS IS NOT ENOUGH — round 4.** `tsc -b --clean` removes only tsc's own outputs; the **five hashed esbuild chunks survive**, measured with `tsc -b packages/cli --clean --dry`. So after `npm run build:clean` the unit holds fresh qualifying outputs, is not `unbuilt`, compares **clean**, and `bundleAt` reads a chunk that is still there — while `packages/cli/dist/bin.js`, the published `bin.crabgic` entry point, **does not exist**. The check would print PASS on a tree with no CLI.

**So `packages/cli` additionally requires its three entry outputs to EXIST** — `dist/bin.js`, `dist/index.js`, `dist/bin/supervisord.js`, which §3.2 already names for `bundleAt`. Any one missing is `unbuilt`, whatever the chunks say. This is the third appearance of one failure — a verdict of `clean` on a tree with no usable build output — and each time it survived because the previous fix keyed on a proxy (directory existence, then output presence) rather than on the artifact anyone actually runs.

`unbuilt` is never folded into `clean`. Round 2's exclusion of `.tsbuildinfo` makes this
state reachable a second way: `bundle-cli.mjs:113-119` deletes outputs while keeping
`.tsbuildinfo`, and a following `tsc -b` re-emits nothing.

⚠️ **SKIP RULE — ALL THREE cli-SCOPED COMPARISONS, extended again in round 4.**
`checkPluginAssets` was outside it: on a fresh clone, or after the design's own
`rm -rf packages/cli/dist`, `newestUnder("packages/cli/dist/plugin")` is `undefined`, so
it would throw or emit `stale-plugin-assets` against a tree that was never built — round
1's C-1 recurring on the comparison round 1's own fix introduced. All three report
`skipped` when their target is absent.

⚠️ **SKIP RULE, EXTENDED IN ROUND 1.** §3's skip rule was per-unit and covered only
`checkUnitFreshness`; `checkBundleFreshness` and `checkDeclarationCache` stat their
targets unconditionally. On a fresh clone neither exists — `dist` is unbuilt and
`.dts-cache` is gitignored, so `npm ci` does not create it — and the check would throw.
**This design's own documented remedy reaches that state**: `rm -rf packages/cli/dist`,
then `npm test`, and the operator cannot run the suite at all (see §4's internal-error
row). Both comparisons now report `skipped` when their target is absent, exactly as a
unit with no `dist` does. Report `stale-declarations` when the newest of

- every `*.ts` under every `packages/*/src` (the set `bundle-types.mjs:43-61` walks),
- `packages/cli/tsconfig.dts.json` and its chain,
- `scripts/bundle-types.mjs`

exceeds the cache's mtime. The last two are the hole the record names in blind spot 9:
`newestSourceMtime()` (`bundle-types.mjs:43-61`) stats no `.json` at all, so touching
`tsconfig.dts.json` — which `bundle-types.mjs:84` hands to the generator — does not
invalidate its own cache. This closes that from outside, without editing that file.

### 3.4 Plugin assets — the hole excluding `dist/plugin/**` opened (round 1)

Excluding `dist/plugin/**` from the output set is what closes blind spot 1: those files
are refreshed by `bundle-cli.mjs:178`'s `cp` on every build regardless of whether `tsc`
recompiled anything, so leaving them in makes `packages/cli` look permanently fresh.

⚠️ **But nothing then covers them.** `packages/plugin/{agents,hooks,skills,statusline,.mcp.json,.claude-plugin}`
are in no input set, and `check:marketplace-pin` digests `packages/plugin` (the source),
never the shipped copy. Edit a skill file, do not rebuild, and the copy inside
`packages/cli/dist/plugin` is stale with every check silent.

**Rule (fifth comparison):** the remedy is `npm run build` — §4's table is
authoritative, and `npm run bundle:cli` is banned there for the reason the
`stale-bundle` row gives. Report `stale-plugin-assets` when the newest mtime beneath
the plugin asset SOURCES exceeds the newest beneath `packages/cli/dist/plugin`.

⚠️ This paragraph carried a trailing `Remedy: npm run bundle:cli` for three rounds after
that command was banned four lines above it, and it survived two dispositions claiming
otherwise — the second time because a verification grep was single-line and the sentence
wrapped. §4's table is the only remedy source.

This is the one place the design deliberately compares a copied tree rather than
compiler output, and it is safe here precisely because the comparison runs the other
way round: the asset copy refreshes the OUTPUT side, so it can only ever mask staleness
in the direction blind spot 1 names — never manufacture a false positive.

## 4. Output and exit code

Human text on stdout by default; `--json` for machine use (the `repo-census.mjs`
convention). One line per finding naming the unit, the newest input, the older output
and the delta.

⚠️ **Two kinds have no delta to print, and the line shape predates them (round 4).**
`Finding = { kind, unit, newerInput, olderOutput, deltaMs, remedy }` assumes a
comparison. `unbuilt`'s finding IS the absence of an output, and
`bundle-provenance-missing` has neither side. Printing the common shape gives
`unbuilt packages/contracts undefined undefined NaN`, eighteen times over, after
`npm run build:clean`. So those three fields are optional and each kind states its own
line:

- `unbuilt <unit> — dist/ exists but holds no compiler output`
- `bundle-provenance-missing packages/cli — .bundle-meta/metafile.json absent; the bundle comparison did not run`

**Findings of the same `kind` are grouped, and the remedy is PER KIND.** Both were
round-1 findings and both are load-bearing:

| `kind`                      | remedy printed                                                                                                                                                                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stale-unit`                | **`rm -rf <unit>/dist` then `npm run build`** — `npm run build` alone often CANNOT clear this                                                                                                                                                                   |
| `stale-bundle`              | **`npm run build`** — NOT `npm run bundle:cli`, which throws when `.dts-cache` is absent (`bundle-cli.mjs:146-151`), precisely the standalone invocation its own error text warns about                                                                         |
| `orphan-output`             | **`rm -rf <unit>/dist` then `npm run build`** — neither `npm run build` NOR `tsc -b --clean` clears this                                                                                                                                                        |
| `stale-declarations`        | **`npm run bundle:types -- --force`** — `npm run build` alone CANNOT clear this. ⚠️ **~5 minutes**; `bundle-types.mjs:76` says so itself, and under `check:all --strict` that is a five-minute wait to unblock a push                                           |
| `stale-plugin-assets`       | **`npm run build`** — NOT `npm run bundle:cli`, for the reason the `stale-bundle` row gives                                                                                                                                                                     |
| `unbuilt`                   | **`rm -rf <unit>/dist` then `npm run build`** — plain `npm run build` clears it only when `.tsbuildinfo` went with the outputs. Measured: delete outputs but KEEP `.tsbuildinfo` (what `bundle-cli.mjs:113-119` does) and `tsc -b` re-emits nothing, twice over |
| `bundle-provenance-missing` | `npm run build` — reduced-confidence, see §3.2                                                                                                                                                                                                                  |

⚠️ **`npm run build` was the single printed remedy and it is wrong for two of the four
kinds.** Measured with the repo's pinned `typescript@6.0.3` on a composite fixture:
delete a source file, run `tsc -b`, and the orphaned `a.js` and `a.d.ts` **survive** —
`tsc` never removes outputs whose source is gone. And `bundle-types.mjs:70` skips
regeneration whenever the cache is newer than `newestSourceMtime()`, a predicate that
stats no `.json` and not itself — so the two inputs §3.3 adds specifically to catch
staleness yield a finding `npm run build` will never clear. An operator running the
printed remedy at 3am would see the check fire again, identically, forever, and under
`--strict` the push stays blocked with no path stated.

⚠️ **`npm run build` cannot clear a `stale-unit` finding either — the kind that fires
most — and this design printed it as the remedy for two rounds.** Measured on a fixture
extending this repo's own `tsconfig.base.json` with the pinned `typescript@6.0.3`,
touching a source without changing its content:

```
after touch src/a.ts + tsc -b:
  dist/a.js          1787210164   <- NOT re-emitted
  dist/.tsbuildinfo  1787210184   <- only this moved
  src/a.ts           1787210184
```

`tsc -b` decides re-emission from `.tsbuildinfo`'s content versions, so a source that is
newer but unchanged produces **no compiler output at all** — exactly §7 row 1's top
false-positive scenario (format-on-save, `git checkout`), on the most common kind, with
the push blocked under `--strict` and no path stated.

⚠️ **This settles a question the design had left open, and the answer flips the
behaviour.** A first measurement said the remedy DID clear it — because `.tsbuildinfo`
lives inside `dist` and its mtime moves even when nothing is emitted. Per-file
measurement showed the compiler output untouched. **So `.tsbuildinfo` is EXCLUDED from
the output set.** Including it would let every `stale-unit` self-clear on the next
`tsc -b` with nothing rebuilt — a check reporting clean because its own oracle moved.
`rm -rf <unit>/dist` then `npm run build` does clear it, verified: every unit's
`tsBuildInfoFile` is inside `dist`, so deleting it forces a full re-emit.

⚠️ **`tsc -b --clean` does not clear an orphan either, and this design said it did for
one round.** Measured on the same fixture: after `--clean`, `b.d.ts`/`b.js` were removed
and the orphaned `a.d.ts`/`a.js` **survived** — `--clean` removes only what the current
build info knows about, and an orphan from a deleted source is precisely what it does
not know about. `rm -rf <unit>/dist` then `npm run build` does clear it, verified.

Recorded rather than quietly swapped, because of how it was found: this design
prescribed `tsc -b --clean` as the fix for O-1 **without running it**, which is the same
defect O-1 itself was. Caught by pre-checking the fix before the next review round —
one round after the standing rule was written down.

`stale-unit ×N` from a single `tsconfig.base.json` edit collapses to one grouped line
naming the count, not 19 near-identical lines printed above 83 vitest failures.

⚠️ **When more than one kind fires, the remedies have exactly one correct order and the
design must print it, not a list (round 4).** Run the per-kind advice as listed and
`npm run build` executes before `bundle:types --force`, so the declarations finding
survives and the second full rebuild is wasted; do the `rm -rf` after the build and you
undo it. The live tree already returns four `stale-unit` findings, so this is not
hypothetical. One ordered recipe:

1. every `rm -rf <unit>/dist` first;
2. `npm run build` — **before** the generator, not after;
3. `npm run bundle:types -- --force` if `stale-declarations` fired (**~5 minutes**);
4. `npm run bundle:cli`, so `bundle-cli.mjs:153` lifts the regenerated cache into
   `dist/index.d.ts` — step 3 alone leaves the pre-force copy shipped.

⚠️ **An earlier ordering put the generator at step 2 and it could not run there
(round 5).** `packages/cli/tsconfig.dts.json` declares `"references": []` and
`"composite": false`, and neither it nor `tsconfig.base.json` declares `paths` — so
`@crabgic/*` resolves through the workspace symlink to
`exports["."].types === "./dist/index.d.ts"`. **Step 1 deletes exactly those files.**
Measured on a fixture with the same generator and `--no-check`: dependency `dist`
present → inlines the type, exit 0; deleted → `TS2307: Cannot find module`, exit 1, no
output written. `bundle-types.mjs` uses `execFileSync`, so it throws outright. The recipe
was wrong precisely in the multi-kind case it was written for.

| condition                                                 | default                 | `--strict`          |
| --------------------------------------------------------- | ----------------------- | ------------------- |
| no findings                                               | `PASS` line, exit **0** | exit **0**          |
| findings                                                  | listed, exit **0**      | listed, exit **1**  |
| internal error — **ANY** throw, not only malformed config | `WARN` line, exit **0** | `ERROR`, exit **2** |

⚠️ **The `PASS` line NAMES SKIPPED UNITS, because otherwise the design's own remedy leads to a silent failure (round 5).** An operator gets `stale-unit` on `packages/cli`, runs the printed `rm -rf packages/cli/dist`, and `npm run build` then fails — tsc error, Ctrl-C, disk. Re-running the check finds no `dist` at all, which is `skipped`; the other 18 compare clean; it prints **PASS, exit 0** on a tree with no CLI. Two routes reach one operator-visible state — `tsc -b --clean` leaves `dist` present and yields `unbuilt`, a finding; the design's own `rm -rf` leaves it absent and yields silence — and the design was directing operators onto the silent one. The line reads `PASS — 18 units compared, 1 skipped (packages/cli: no dist/)`.

⚠️ **The internal-error row changed in round 1, and the reason is measured.** It was
exit **2** in both columns. On npm 11.16.0 a `pretest` exiting **2** blocks `npm test`
exactly as exit 1 does — verified: `TEST RAN` never prints. So the "`pretest` is
non-strict, therefore it cannot block testing" argument did **not** cover the check's
own errors, and §3's skip rule made that path reachable from this design's OWN advice:
`rm -rf packages/cli/dist` and the bundle comparison has nothing to stat. Following the
documented remedy would have left the operator unable to run the suite at all.
Non-strict now degrades an internal error to a warning and exits 0.

Report-by-default with `--strict` on the chained entry is `check-claim-scope.mjs`'s
shape verbatim (`:25-27`; `check:claim-scope` is `--strict` at `package.json:44`). It
matters here because a false positive now blocks a push: an ad-hoc local run stays
non-punitive, and only the chained invocation fails.

Exit **2** for the check's own failure is a NEW convention in this repository —
`grep -rn "exit(2)" scripts/` returns zero hits today. It is worth introducing:
"your dist is stale" and "the check broke" must not share an exit code when the check
gates a push.

## 5. Wiring — requirement 10

- `"check:stale-dist": "node scripts/check-stale-dist.mjs"` in `package.json`.
- Chained into `check:all` as the **first** member, making it the **15th**
  (`node -e 'console.log(require("./package.json").scripts["check:all"].split("&&").length)'` → 14 today).
  First, not last, because `check:tarball` and `check:install-smoke` already read local
  `dist` state and returned three different verdicts in one session for that reason
  (`docs/evidence/criteria-closeout/defects/25-install-smoke-depends-on-local-dist-state.md`);
  running this first turns their ambiguity into a named precondition.
- The chained form is `npm run check:stale-dist -- --strict`.

⚠️ **What this wiring does and does not buy, measured rather than assumed.**
`npm run check:all` is invoked by **no** workflow and **no** hook. Measured:

```
git ls-files -z | xargs -0 grep -n "run check:all"   # 6 hits (2026-08-20), ALL in docs/evidence prose
git ls-files -z | xargs -0 grep -ln "check:all" | grep -v ^docs/ | wc -l   # 9 files: the
   # definition at package.json:45, 4 prose comments, 4 test assertions — no invocation
```

CI runs the members as individual steps in two jobs (`ci.yml:246` `meta-checks`,
`ci.yml:403` `packaging`), and `core.hooksPath` here points at a `pre-push` that runs
`lint typecheck build test`. Consequences, stated so nobody re-derives them:

- in `meta-checks` (`npm ci`, no build) every unit would report `skipped` — no `dist` exists;
- in `packaging` (`npm run build` immediately before) it can only ever report clean;
- the `pre-push` hook rebuilds before testing, so it too can only see clean;
- **`ci.yml:129` (`run: npm test`) DOES run it** — the two-leg `test` matrix
  (`ubuntu-latest`, `ubuntu-24.04-arm`), on every push to `main` and every PR — so with
  §5.1's `pretest` the check fires **twice per push**. `ci.yml:86` builds immediately
  before, so it reports clean every time. This bullet was missing for two rounds while
  §8(c) asserted the check could not fire in CI at all.

**The check's discriminating power is local.** A smaller claim than "runs in CI and
in every pre-push", and the one the repository supports today. A dedicated CI step is
deliberately NOT proposed: it could only be permanently green, and a permanently green
step is a check muted in advance.

### 5.1 `pretest` — owner ruling 2026-08-20, amending requirement 10

⚠️ **The original ruling rested on a false premise, which this design measured and
which was taken back to the owner.** They were told that `check:all` "runs in CI and
in every pre-push". It runs in neither. Re-ruled with the corrected facts:

```json
"pretest": "node scripts/check-stale-dist.mjs",
"check:stale-dist": "node scripts/check-stale-dist.mjs"
```

⚠️ **`check:stale-dist` carries NO `--strict` in its own definition.** §5 chains it as
`npm run check:stale-dist -- --strict`, so declaring it strict here would contradict
§4's "an ad-hoc local run stays non-punitive, and only the chained invocation fails" AND
pass `--strict --strict` from `check:all`. An earlier draft declared it strict; that was
a round-3 finding.

`pretest` is the ONLY trigger in this repository that can fire on a stale tree. It runs
immediately before `npm test`, which is the exact moment the founding incident bit —

⚠️ **BUT IT DOES NOT PRINT "IMMEDIATELY ABOVE" THE FAILURES, AND AN EARLIER DRAFT
CLAIMED IT DID.** `pretest` completes before `vitest` starts, and `vitest run` prints
failure detail and its summary at the END. Measured with an 83-failure suite — the
founding incident's own count — and a one-line warning: **204 lines of output, the
warning at line 5**, so ~199 lines of scrollback separate the explanation from the place
an operator reads. Real failures carry diffs and stacks, so the true gap is larger. The
founding incident WAS two hours of misdiagnosis by someone reading the bottom of the
output.

The reliable form is a vitest reporter or `globalSetup` that re-emits at the end;
`posttest` does not run when `test` fails. Until that element exists, the limit is
stated here rather than in the round log: **the warning can scroll away.**

83 failures from a `dist` that predated its source, misdiagnosed for two hours because
nothing said so.

**It runs WITHOUT `--strict`, and that is load-bearing.** Measured on npm 11.16.0:

```
pretest exits 0  ->  PRETEST RAN / TEST RAN
pretest exits 1  ->  PRETEST FAILED, and `test` NEVER RUNS
```

So a strict `pretest` turns any false positive into a total block on local testing. The
check therefore reports and continues there: a loud warning printed immediately above
the failures it explains, which is all the founding incident needed. `--strict` is
reserved for `check:all`, where a wrong verdict costs a re-run rather than a working
session.

**Honest bound**: `npx vitest` directly bypasses `pretest` entirely. This catches
`npm test`, not every path to the suite.

## 6. Testing, and how non-vacuity is proven

Fixtures are synthetic trees under `mkdtempSync(tmpdir())`, for the reason
`repo-census.test.mjs:17-20` states: asserting against the real repository makes a
test restate today's file list and fail on every unrelated addition.

**Non-vacuity battery.** Per finding kind: one fixture reporting clean, then ONE
`utimesSync`/`rm` mutation that must flip it to stale.

| #   | clean fixture                                                | single mutation                                 | must become                            |
| --- | ------------------------------------------------------------ | ----------------------------------------------- | -------------------------------------- |
| 1   | dist newer than src                                          | touch one `src/**.ts` forward                   | `stale-unit`                           |
| 2   | dist newer than src                                          | touch `tsconfig.base.json` forward              | `stale-unit` ×N (req 6)                |
| 3   | cli unit, dist newest                                        | touch `tsconfig.dts.json` forward               | `stale-unit` (req 9)                   |
| 4   | 1:1 stems                                                    | delete one `src/x.ts`, keep `dist/x.js`         | `orphan-output` (req 2)                |
| 5   | bundle newest                                                | touch an inlined unit's `dist/index.js` forward | `stale-bundle` (req 3)                 |
| 6   | cache newest                                                 | touch any `packages/*/src/*.ts` forward         | `stale-declarations` (req 8)           |
| 7   | **stale src, then** touch `dist/plugin/.mcp.json` **to now** | —                                               | still `stale-unit` (req 1)             |
| 8   | plugin assets fresh                                          | touch `packages/plugin/skills/**` forward       | `stale-plugin-assets` (§3.4)           |
| 9   | unit built                                                   | `rm -rf <unit>/dist/*` keeping `.tsbuildinfo`   | `unbuilt` (round 3)                    |
| 10  | bundle built with provenance                                 | delete `.bundle-meta/metafile.json`             | `bundle-provenance-missing`            |
| 11  | cli built: 5 chunks + all 3 entry outputs                    | `rm dist/bin.js` only                           | `unbuilt` (round 4's entry rule)       |
| 12  | false-negative: `packages/cli/dist` absent                   | run `checkPluginAssets`                         | `skipped` — not a finding, not a throw |

Row 7 is the decisive one: the exact state in which the naively specified check
reports clean. The fixture asserts the plugin asset copy cannot mask a skipped compile.

**False-negative battery** (the check must stay quiet):

- a unit with no `dist` → `skipped`, not reported;
- `.tsbuildinfo` newer than every `.js` → clean;
- a `.info`/`.snap`/`.mjs` fixture under `src` newer than dist → clean;
- input mtime exactly equal to output mtime → clean.

**Wiring assertions**, matching the repo's existing shape at
`scripts/check-support-window-freshness.test.mjs:530` and
`scripts/check-marketplace-pin-digest.test.mjs:339`:
`expect(root.scripts["check:all"]).toContain("check:stale-dist")`.

**One live smoke test** runs `checkStaleDist(REPO_ROOT)` and asserts only that it
returns and that every reported unit is a member of `enumerateRootReferences()` — no
count, so it cannot rot as the repository grows. Run against the tree at design time
the algorithm above returns four `stale-unit` findings (`packages/contracts`,
`packages/engine-claude`, `packages/gates`, `packages/plugin`): a true report of this
working copy, and independent evidence the check is not vacuous against real inputs.

## 7. False-positive risks, each with its mitigation

| risk                                                                           | mitigation                                                                                                                                                                                                |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Touched-but-unchanged source (format-on-save, `git checkout` rewriting a file) | None available: a content oracle needs a persisted baseline, which is a twentieth build artifact with the same staleness problem (assumption 2). Remedy is one `npm run build`. Accepted by owner ruling. |
| Branch switch refreshing sources                                               | Firing here is CORRECT — it is the founding incident. Named so nobody mutes it as noise.                                                                                                                  |
| Test fixtures under `src`                                                      | Input set restricted to `.ts` + `.json`; the other 15 of 18 non-`.ts` files under `src` are ignored.                                                                                                      |
| Second-granularity mtimes                                                      | Compare strictly `>` on `mtimeMs`; equal is clean. Ordering itself is asserted by `./mtime-propagation-probe.mjs`'s `ordering:` rows.                                                                     |
| Fresh clone / restored tarball with no `dist`                                  | Skip rule — a unit that has never been built is not stale.                                                                                                                                                |
| Toolchain bump marking all 19 units stale                                      | Deliberately NOT implemented: putting `package-lock.json` in every unit's input set would make an unrelated `npm i` block a push. See §8 residual (b).                                                    |
| Check run while `npm run build` is mid-flight                                  | Not mitigable; a transient the operator caused. Documented in the header.                                                                                                                                 |
| Stale `.d.ts.map` lingering after `declarationMap: false`                      | Makes `dist` look _fresher_ — a false negative, not a false positive. Named for completeness.                                                                                                             |

## 8. What this design does NOT establish

- **(a) Bootstrap — requirement 4, residual.** `packages/cli/package.json:22` declares
  `"crabgic": "dist/bin.js"`, so `crabgic doctor` is a compiled artifact and a stale
  `packages/cli/dist` runs a doctor registry that predates any check added to it. This
  design does not solve that; it _sidesteps_ it by living in `scripts/` (§1). No check
  can solve it from inside the tool, and `crabgic doctor` remains subject to it.
- **(b) Build program and toolchain — requirement 7, residual.** `scripts/bundle-cli.mjs`
  and `scripts/bundle-types.mjs` are read for the two artifacts they each produce
  (§3.2, §3.3) and for nothing else. A `typescript` bump off `6.0.3` moves nothing the
  check reads, yet invalidates every `dist`. `.tsbuildinfo` is the only complete oracle
  and the research rejects it: no public interface describes its contents (three
  mentions in `typescript.d.ts`, all about the path) and it carries `version: "6.0.3"`,
  binding a parser to a compiler release.
- **(c) That the check DISCRIMINATES in CI.** It does FIRE there — `ci.yml:129` is
  `run: npm test` in the two-leg `test` matrix, so `pretest` runs **twice per push** —
  but `ci.yml:86` builds immediately before it, so it can only ever report clean. An
  earlier draft said the check "cannot fire in CI", which is the opposite of the truth
  and would have left a CI failure with no documented owner (round 5).
- **(d) Content correctness.** The check answers "was the build re-run since its inputs
  moved", never "is the output right". A rebuild producing byte-identical output still
  refreshes mtimes and still reports clean.
- **(e) Behaviour off WSL2/ext4.** Mtime ordering is asserted by a probe on this
  filesystem only. Where mtimes are coarse or absent the check under-reports; it does
  not over-report.
- **(f) Anything about the other 8 `e2e/*` tsconfigs.** All 8 set `noEmit: true`
  (`grep -l '"noEmit": true' e2e/*/tsconfig.json e2e/matrix/*/tsconfig.json | wc -l` → 8),
  emit no `dist`, and are outside the 19-unit enumeration by construction. `e2e/matrix`
  has no top-level `tsconfig.json` at all.
- **(g) That 1:1 stem mapping is permanent.** It holds for all 18 tsc units today. A
  future `allowJs`, a `.tsx` file, or an emitted `.json` would break it — which the
  orphan check would report as a finding rather than silently mis-handle, and which the
  fixtures in §6 do not cover.

## 9. Review rounds

**Round 1 (2026-08-20) — `contract-fit` / `correctness` / `operability`, three
`revise`, seven findings, all re-derived by the manager and all `fixed`.** The lens
verified every count and line anchor in the design and found them exact, then attacked
the algorithm — which is where all seven live.

**The three that mattered share one root cause: the design specified the happy path's
remedy and never the degraded tree's.**

- **C-1, high.** The skip rule was per-unit. `checkBundleFreshness` and
  `checkDeclarationCache` stat unconditionally, so on a fresh clone — or after **this
  design's own documented `rm -rf packages/cli/dist`** — the check throws.
- **O-2, medium-high.** That throw exits **2**, and on npm 11.16.0 a `pretest` exiting
  2 blocks `npm test` exactly as exit 1 does. Re-derived: `TEST RAN` never prints. So
  §5.1's "non-strict, therefore it cannot block testing" argument did not cover the
  check's own errors, and C-1 made that path reachable from the printed advice.
  **Following the design would have left an operator unable to run the suite.**
- **O-1, high.** `npm run build` was the single printed remedy and cannot clear two of
  the four kinds. Re-derived on a composite fixture with the pinned `typescript@6.0.3`:
  delete a source, run `tsc -b`, and the orphaned `.js` and `.d.ts` **survive** — tsc
  never removes them. And `bundle-types.mjs:70` skips regeneration whenever its cache
  is newer than a predicate that stats no `.json` and not itself, so the two inputs
  §3.3 adds _specifically_ to catch staleness produce a finding `npm run build` will
  never clear. At 3am the operator runs the remedy, the check fires again identically,
  and under `--strict` the push stays blocked with no path stated.

**C-2, medium — a false NEGATIVE in the one comparison requirement 3 exists for.**
`bundleAt` keyed on `dist/{bin,index,bin/supervisord}.js`, but `packages/cli/src` has
all three sources and `tsc -b` writes exactly those paths. Verified. So
`npm run typecheck` alone resets the oracle and the bundle reports clean although
`bundle:cli` never ran. Now keyed on an artifact only esbuild produces.

**CF-1 / C-3, medium — the closure is a superset of the inlined set.** Verified:
`@crabgic/testkit` is a `devDependency` of `packages/cli`, not a dependency, and
**zero** testkit runtime symbols appear in `packages/cli/dist/*.js`. Editing testkit
and running `typecheck` fired `stale-bundle` against a bundle containing none of that
code. Now the closure minus dev-only edges, with the remaining over-approximation
stated.

**CF-2, medium — excluding `dist/plugin/**` closed blind spot 1 and opened a new
hole.** Those assets are then in no input set, and `check:marketplace-pin` digests the
source rather than the shipped copy. A fifth comparison covers it.

**O-3, low** — `stale-unit ×19` from one `tsconfig.base.json` edit is now one grouped
line, not nineteen printed above 83 vitest failures.

**O-4, advisory** — the `check:all` hit count had drifted 5 → **6**. This change set's
own standing rule 3, caught on the design one day after the research stage closed on it.

ℹ️ **What the lens checked and could not break**, recorded so it is not re-run: `src`
`.json` emission, `.d.ts`/`.js.map` stem collisions, JSONC tsconfigs (8 carry comments;
all 30 parse under raw `JSON.parse` today), equal mtimes, and renames or deletes on the
source side. It also re-derived §6's live claim with the design's own algorithm and got
exactly the four `stale-unit` findings the design predicted, and timed the walk at
**0.23-0.24 s** across six warm runs — a spread of 0.01 s, reported per standing rule 3.

**Round 2 (2026-08-20) — three `revise`, nine findings. Two refute round 1's own
fixes, and one of those was refuted by the exact rule this change set keeps
re-learning.**

**C-A, high — the CF-1 fix rested on a search narrower than its claim.** Round 1
asserted "zero testkit runtime symbols appear anywhere in `packages/cli/dist/*.js`"
and built a rule on it. The search was for the SPECIFIER `@crabgic/testkit`, which
esbuild erases when it inlines — it could only ever return nothing. Re-measured by
definition: **11** testkit identifiers in `chunk-I6JBP7DT.js`. And
`packages/cli` declares **zero** `@crabgic/*` `dependencies`, so "minus dev-only edges"
drops `renderer` (also inlined) or, read transitively, all 16 — a **vacuous**
comparison, in the one place requirement 3 exists for. Re-keyed on
`result.metafile.inputs`, which `bundle-cli.mjs` already produces.

**C-B / O-B, high — `npm run build` does not clear the most common finding, and the
investigation changed a design decision.** `tsc -b` re-emits from `.tsbuildinfo` content
versions, so a touched-but-unchanged source produces no compiler output. A first
measurement said the remedy worked; per-file measurement showed only `.tsbuildinfo` had
moved, because it lives inside `dist`. **That decided a question the design had left
open: `.tsbuildinfo` is excluded from the output set**, since including it would let
every `stale-unit` self-clear on the next `tsc -b` with nothing rebuilt.

⚠️ Recorded because of the near-miss: the whole-directory measurement said "cleared" and
would have closed the finding. Only asking which FILE moved reversed it. **A measurement
at the wrong granularity is as wrong as no measurement.**

**O-C, medium — the printed remedy could fail with an unrelated error.**
`npm run bundle:cli` throws when `.dts-cache` is absent (`bundle-cli.mjs:146-151`), and
its own error text says that happens "only when `bundle:cli` is invoked on its own" —
precisely what the design prescribed. Now `npm run build`, which orders `bundle:types`
first.

**CF-A, medium — round 1's fifth comparison landed in prose only.**
`stale-plugin-assets` appeared once in 528 lines, absent from the `kind` union, the
exports, the file table, the remedy table, the non-vacuity battery and the traceability
matrix. An implementer building from §2 would have shipped four comparisons. And
`exitCodeFor` still declared `0 | 1` while §4 required exit 2. Both fixed — the same
"the fix landed in one place" fault the research record hit four times.

**Accepted as stated limits rather than closed** (§8): CF-B — the root `tsconfig.json`
is in no input set (it carries no `compilerOptions`, only `files: []` and
`references`, so the impact is bounded); C-C — deleting a plugin asset source leaves the
shipped copy until the next completed `bundle:cli`; C-D — the chunk predicate is named
as `/-[A-Z0-9]{8}\.js$/` with `metafile.outputs` as the exact form; O-A — the `pretest`
warning prints ~199 lines above vitest's summary, so a reporter re-emit is the reliable
form and the limit is stated.

ℹ️ **What round 2 attacked and could not break**, so it is not re-run: §3.4's
"can only mask, never manufacture a false positive" — verified, `cpSync` resets mtimes
and no repo script writes into the asset sources; the hashed chunk exists so the
fallback is not live; the 0-orphan bijection; §6's live four-`stale-unit` prediction,
re-derived with an independent implementation; §8(g); and the walk timed at 0.06 s over
six runs.

**Round 3 (2026-08-20) — three `revise`, nine findings, all re-derived and all
dispositioned. Two are blocking, and one of them would have shipped a defect this
repository already has a gate against.**

**CR-1, high — the round-2 metafile fix would have published a 404 kB file.** The fix
put `result.metafile` at `packages/cli/dist/.bundle-meta.json`. `packages/cli`'s `files`
is `["dist", "!dist/**/*.test.*", "!dist/**/test-support/**", "!dist/.tsbuildinfo"]`, so
anything new under `dist` ships by default. Measured: **404,198 bytes, 758 inputs**,
including a `node_modules/**` tail.

⚠️ **This repository already banned exactly this file class, for exactly this reason.**
`check-published-tarball.mjs:41-45` excludes `.tsbuildinfo` because it is "the one file
that differs between two builds of identical sources in different environments, so
shipping it makes the published artifact non-reproducible — directly undermining
roadmap/23's reproducible-build criterion. **Shipped in 1.0.0 through 1.1.1.**" The
metafile is twice the size with the same defect, and no `files` negation or
`FORBIDDEN_PATTERNS` rule would have caught it — `check:tarball` would have **passed**.
Moved to `packages/cli/.bundle-meta/`, beside `.dts-cache`, which is the shape this
repository already uses for a build artifact that must not ship.

**CR-2, high — the skip rule's predicate was directory existence, and the empty state is
reachable from a published script.** Measured: `tsc -b --clean` leaves `dist` existing
and **empty**, and `build:clean` is a root script. A rule keyed on absence does not fire,
so the comparison would run with nothing to compare. Reporting `clean` there prints PASS
on a tree with **zero build output** — the worst available answer for the incident this
check is named for. Re-keyed on qualifying compiler outputs, with `unbuilt` as its own
verdict, never folded into `clean`. Round 2's `.tsbuildinfo` exclusion makes the state
reachable a second way, via `bundle-cli.mjs:113-119`.

**CF-1, medium — "both fixed" was again only half true.** Round 2's entry claimed
`stale-plugin-assets` had been propagated to the kind union, the exports, the file table,
the remedy table, the battery and the traceability matrix. Measured: it reached the kind
union and nothing else, and only `exitCodeFor` of the "both" was done. **This is the
second consecutive round in which a completion claim in this record was overstated**, and
the rule the research stage wrote down for exactly this — _a disposition is complete only
when every site is re-measured_ — was not applied to the disposition itself.

**CR-3, CF-2, OP-1, OP-2, OP-3, OP-4** — a missing metafile silenced requirement 3's
comparison on a fully built tree, so it now reports `bundle-provenance-missing`; the
metafile filter is stated (**758** inputs across **17** `packages/*`, so `inputs` is not
a unit list); `check:stale-dist` had two contradictory definitions, one of which made an
ad-hoc run punitive and passed `--strict --strict`; the fifth kind had no remedy row and
its only stated remedy was the command round 2 had just banned; `stale-declarations`
prints a **~5 minute** rebuild and now says so; and §5.1's "immediately above the
failures" is corrected to the measured **~199 lines** with the reporter re-emit named.

ℹ️ **The reviewer disclosed that it mutated the working tree** — a probe imported
`bundle-cli.mjs`, whose top-level `await main()` rebuilt `packages/cli/dist`. It checked
and reported that all five content-hashed chunk names were unchanged, so only mtimes
moved, and re-derived §6's live claim afterwards to confirm it still holds. Recorded
because disclosing a side effect and re-deriving past it is what makes the rest of the
report usable.

**Round 4 (2026-08-20) — three `revise`, nine findings, all re-derived and
dispositioned. One is the same failure for the third time, and it survived twice
because each fix keyed on a proxy.**

**C-R4-1, high — after `npm run build:clean`, `packages/cli` reports CLEAN with no
`bin.js`.** Measured with `tsc -b packages/cli --clean --dry`: `--clean` removes tsc's
outputs and the **five hashed esbuild chunks survive**. So the unit holds fresh
qualifying outputs, is not `unbuilt`, compares clean, and `bundleAt` reads a chunk that
is still there — while `dist/bin.js`, the published `bin.crabgic` entry point, does not
exist.

⚠️ **This is the third appearance of one failure — `clean` on a tree with no usable
build output.** CR-2 keyed the rule on directory existence; round 3 re-keyed it on
output presence; both are proxies. It is now keyed on the artifact anyone actually runs:
`packages/cli` requires its three entry outputs to EXIST, whatever the chunks say.

**C-R4-2, medium-high — `checkPluginAssets` was outside the skip rule**, so a fresh
clone or the design's own `rm -rf packages/cli/dist` would throw or emit
`stale-plugin-assets` against a tree that was never built. Round 1's C-1 recurring on the
comparison round 1's own fix introduced. All three cli-scoped comparisons now skip.

**C-R4-3, medium — the `unbuilt` remedy was wrong on the path §3.3 itself names.**
Measured: delete outputs but keep `.tsbuildinfo` — exactly `bundle-cli.mjs:113-119` — and
`tsc -b` re-emits nothing, twice over. `npm run build` clears it for `packages/cli` only
by accident, because `bundle:cli` rewrites the chunks, which does not generalise to the
other 18 units.

**CF-R4-3 — and one of this design's own claims was overstated in the safe direction.**
§3.2 called the reference closure "a SUPERSET of the inlined set". Measured: the metafile
filter yields **16** units, member for member identical to the closure, and `cli` never
matches because it enters only via `src/`. The sets are EQUAL today and the "minus `cli`"
step is a no-op. The metafile remains the rule — the closure's agreement is a fact about
today's import graph, not a property of it — but the record now says so.

**CF-R4-1, CF-R4-2, OP-R4-1, OP-R4-2, OP-R4-3** — §3.4 still printed the remedy round 2
banned; three of seven kinds had no non-vacuity row, so an implementer could have shipped
`stale-plugin-assets` hardcoded never to fire (the exact defect class this change set
exists for); `unbuilt` and `bundle-provenance-missing` had no line shape and would have
printed `undefined undefined NaN` eighteen times after `build:clean`; seven remedies had
no ORDER, and running them as listed wastes a full rebuild or undoes itself; and §5's
consequence list omitted `ci.yml:129`, the only place CI runs `npm test` and therefore
`pretest`.

ℹ️ **The lens disclosed two things it could not control** — the design file changed
under it mid-review, and `packages/cli/dist` was rebuilt at 09:43 by something that was
not its own probes, which it verified by pinning the artifact's md5 and by keeping every
probe non-mutating (`--dry`, and `esbuild` with `write: false` rather than importing
`bundle-cli.mjs`, which is how round 3 caused a rebuild). Recorded because a review whose
own side effects are stated is the only kind whose negatives mean anything.

**Round 5 (2026-08-20) — three `revise`, seven findings, four of them high. Two of
round 4's five claimed fixes did not land, and round 4's own new element failed on
contact.**

**C-R5-1, high — the test suite writes `.js` into a `dist`, so §3.1's "clean bijection"
was conditionally false.** `packages/journal/src/crash-fixtures/prepare-runtime.ts:25`
sets `SCRATCH_ROOT` to `packages/journal/dist` and `:110` `mkdtemp`s
`eo-crash-fixture-*` there, transpiling sources into it. Those `.js` have no `src`
counterpart, so they are orphans by this design's own rule — **40** measured, with two
fixture directories observed being reaped mid-review. The suite SIGKILLs its children, so
`cleanup()` cannot run when the harness dies.

⚠️ **It bites this design three ways at once**: `pretest` runs at the START of the very
`npm test` whose interrupted predecessor left the residue; the printed remedy would tell
the operator to `rm -rf` a directory a concurrent run is writing into; and §6's live
smoke test calls the check from inside vitest, so it can observe the orphans or `ENOENT`
on a directory reaped between `readdirSync` and `statSync`. Scratch is excluded by name,
and §3.1's count is restated as a measurement whose subject a test run mutates.

**C-R5-2, high — round 4's ordered recipe could not run in its own order.** Step 1
deleted every `<unit>/dist`; step 2 was `bundle:types -- --force`, and
`packages/cli/tsconfig.dts.json` declares `"references": []`, `"composite": false`, with
no `paths` anywhere — so `@crabgic/*` resolves through the workspace symlink to
`exports["."].types === "./dist/index.d.ts"`, exactly what step 1 deleted. Measured on a
fixture with the same generator: dependency `dist` present → inlines the type, exit 0;
deleted → `TS2307`, exit 1, no output. `npm run build` now comes second, and a fourth
step lifts the regenerated cache into `dist/index.d.ts`.

**C-R5-3, medium — "no build output" reached two OPPOSITE verdicts, and the design
directed operators onto the silent one.** `tsc -b --clean` leaves `dist` present →
`unbuilt`, a finding. The design's own `rm -rf` remedy leaves it absent → `skipped` →
**PASS, exit 0** on a tree with no CLI. The `PASS` line now names skipped units.

**CF-R5-1, high — §8(c) asserted the opposite of the truth.** It said the check "cannot
fire in CI". `ci.yml:129` is `run: npm test` in the two-leg `test` matrix, so with
`pretest` it fires **twice per push**; `ci.yml:86` builds immediately before, so it
cannot DISCRIMINATE there. The distinction matters because an unclassified throw would
redden both legs with no documented owner. Both §5 and §8(c) corrected, and the
internal-error row now covers **any** throw rather than malformed config only.

**CF-R5-2, high — §3.4 still printed the banned remedy, four lines after banning it, for
the FOURTH consecutive round.**

⚠️ **And this time it survived a disposition because the verification grep was
single-line and the sentence wrapped.** The trailing `Remedy:` and
`` `npm run bundle:cli`. `` sat on consecutive lines; a one-line pattern reported it
gone. **Standing rule 1 — a search narrower than its claim — applied to the verification
of a finding rather than to the finding itself.** That is the fourth consecutive round
with a partly-true completion claim, and the first where the cause was the check on the
claim rather than the claim.

**CF-R5-3, medium — round 4's two behavioural fixes had no non-vacuity row**, because
the battery is keyed by KIND and both are refinements _within_ a kind. An implementer who
never wrote the `packages/cli` entry-output rule would have passed all ten rows. Two rows
added: rm one entry output from an otherwise-complete cli `dist` → `unbuilt`; and
`packages/cli/dist` absent → `checkPluginAssets` returns `skipped`, neither finding nor
throw.

ℹ️ **What round 5 attacked and could not break**: the `unbuilt` remedy on both paths
§3.3 names (`--clean` removes `.tsbuildinfo` too, so path (a) clears under plain
`npm run build`); the entry-output rule against a fresh clone (row 1 precedes, so a fresh
clone is silent); every other unit's `dist` for foreign files (`packages/journal` is the
only one); `--clean` on `packages/cli` (exactly five deletions, chunks and `plugin/**`
survive); §6's four-`stale-unit` live claim, re-derived independently; and every count and
anchor. Walk timing 0.20-0.28 s over six runs, spread 0.08 s — wider than round 2's 0.06,
and the lens noted its machine was concurrently running vitest.
