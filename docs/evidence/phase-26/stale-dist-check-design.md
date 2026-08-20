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
| `scripts/stale-dist/compare.mjs`    | ~180         | the four comparisons, each returning `Finding[]`        |
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
export function checkBundleFreshness(units)          -> Finding[]  // req 3
export function checkDeclarationCache(units)         -> Finding[]  // req 8
export function checkStaleDist(cwd)                  -> { findings, units, skipped }

// Finding = { kind, unit, newerInput, olderOutput, deltaMs, remedy }
// kind ∈ "stale-unit" | "orphan-output" | "stale-bundle" | "stale-declarations"

// report.mjs
export function formatFindings(result, { json })     -> string
export function exitCodeFor(result, { strict })      -> 0 | 1
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

⚠️ **This is a SUPERSET of the inlined set, and calling it "the inlined set" was a
round-1 finding.** `@crabgic/testkit` is in the closure but is not inlined: it is a
`devDependency` of `packages/cli`, not a dependency, and **zero** testkit runtime
symbols appear anywhere in `packages/cli/dist/*.js`. So editing `packages/testkit/src`
and running `npm run typecheck` fires `stale-bundle` against a bundle containing none
of that code — and under `--strict` that blocks a push.

The implementation therefore takes the closure **minus units that reach `packages/cli`
only as a `devDependency`**, and states the residual: the closure is still an
over-approximation wherever a runtime dependency is declared but unimported.

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

**Rule (fifth comparison):** report `stale-plugin-assets` when the newest mtime beneath
the plugin asset SOURCES exceeds the newest beneath `packages/cli/dist/plugin`. Remedy:
`npm run bundle:cli`.

This is the one place the design deliberately compares a copied tree rather than
compiler output, and it is safe here precisely because the comparison runs the other
way round: the asset copy refreshes the OUTPUT side, so it can only ever mask staleness
in the direction blind spot 1 names — never manufacture a false positive.

## 4. Output and exit code

Human text on stdout by default; `--json` for machine use (the `repo-census.mjs`
convention). One line per finding naming the unit, the newest input, the older output
and the delta.

**Findings of the same `kind` are grouped, and the remedy is PER KIND.** Both were
round-1 findings and both are load-bearing:

| `kind`               | remedy printed                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| `stale-unit`         | `npm run build`                                                                                          |
| `stale-bundle`       | `npm run bundle:cli`                                                                                     |
| `orphan-output`      | **`rm -rf <unit>/dist` then `npm run build`** — neither `npm run build` NOR `tsc -b --clean` clears this |
| `stale-declarations` | **`npm run bundle:types -- --force`** — `npm run build` alone CANNOT clear this                          |

⚠️ **`npm run build` was the single printed remedy and it is wrong for two of the four
kinds.** Measured with the repo's pinned `typescript@6.0.3` on a composite fixture:
delete a source file, run `tsc -b`, and the orphaned `a.js` and `a.d.ts` **survive** —
`tsc` never removes outputs whose source is gone. And `bundle-types.mjs:70` skips
regeneration whenever the cache is newer than `newestSourceMtime()`, a predicate that
stats no `.json` and not itself — so the two inputs §3.3 adds specifically to catch
staleness yield a finding `npm run build` will never clear. An operator running the
printed remedy at 3am would see the check fire again, identically, forever, and under
`--strict` the push stays blocked with no path stated.

⚠️ **`tsc -b --clean` does not clear it either, and this design said it did for one
round.** Measured on the same fixture: after `--clean`, `b.d.ts`/`b.js` were removed
and the orphaned `a.d.ts`/`a.js` **survived** — `--clean` removes only what the current
build info knows about, and an orphan from a deleted source is precisely what it does
not know about. `rm -rf <unit>/dist` then `npm run build` does clear it, verified.

Recorded rather than quietly swapped, because of how it was found: this design
prescribed `tsc -b --clean` as the fix for O-1 **without running it**, which is the same
defect O-1 itself was. Caught by pre-checking the fix before the next review round —
one round after the standing rule was written down.

`stale-unit ×N` from a single `tsconfig.base.json` edit collapses to one grouped line
naming the count, not 19 near-identical lines printed above 83 vitest failures.

| condition                                    | default                 | `--strict`          |
| -------------------------------------------- | ----------------------- | ------------------- |
| no findings                                  | `PASS` line, exit **0** | exit **0**          |
| findings                                     | listed, exit **0**      | listed, exit **1**  |
| internal error (unreadable/malformed config) | `WARN` line, exit **0** | `ERROR`, exit **2** |

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
- the `pre-push` hook rebuilds before testing, so it too can only see clean.

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
"check:stale-dist": "node scripts/check-stale-dist.mjs --strict"
```

`pretest` is the ONLY trigger in this repository that can fire on a stale tree. It runs
immediately before `npm test`, which is the exact moment the founding incident bit —
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

| #   | clean fixture                                                | single mutation                                 | must become                  |
| --- | ------------------------------------------------------------ | ----------------------------------------------- | ---------------------------- |
| 1   | dist newer than src                                          | touch one `src/**.ts` forward                   | `stale-unit`                 |
| 2   | dist newer than src                                          | touch `tsconfig.base.json` forward              | `stale-unit` ×N (req 6)      |
| 3   | cli unit, dist newest                                        | touch `tsconfig.dts.json` forward               | `stale-unit` (req 9)         |
| 4   | 1:1 stems                                                    | delete one `src/x.ts`, keep `dist/x.js`         | `orphan-output` (req 2)      |
| 5   | bundle newest                                                | touch an inlined unit's `dist/index.js` forward | `stale-bundle` (req 3)       |
| 6   | cache newest                                                 | touch any `packages/*/src/*.ts` forward         | `stale-declarations` (req 8) |
| 7   | **stale src, then** touch `dist/plugin/.mcp.json` **to now** | —                                               | still `stale-unit` (req 1)   |

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
- **(c) That the check fires in CI.** Measured in §5: it cannot. Local and manual only.
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
