# Design — a build-output staleness check for this repository

**Change set:** `cbd21c01-0588-41e4-b297-a34794b3a8b6`
**Stage:** `design` · **Inputs:** `./stale-dist-research-record.md` (research closed
round 15), the owner's `clarify` rulings of 2026-08-20 (full per-unit walk; wired
into `check:all`).

Every count below states the command that produced it, per the research record's
third standing rule. All measured 2026-08-20 at a clean working tree.

⚠️ **NO RULE IN THIS DOCUMENT IS CITED BY LINE NUMBER INTO THIS DOCUMENT (round 11).**
Intra-document references name the section and the rule's own name — "§3.3's **SKIP RULE —
ALL FOUR cli-SCOPED COMPARISONS**", "§4's **The `PASS` line NAMES SKIPPED UNITS**" — because a file every round
rewrites reflows underneath its own anchors, and a named rule survives the reflow.
Re-derived 2026-08-20 at a clean tree: `grep -on '§[0-9][0-9.]*:[0-9]'` over this file
returned **six** such anchors and **all six resolved to the wrong text**. `§4:667` (twice)
lands inside §3.3 — round 9 moved §4's **The `PASS` line NAMES SKIPPED UNITS** rule 548 lines and the anchor was carried
forward unchanged — and round 10's three `§3.3:71x` anchors were wrong at the commit that
wrote them (`:710` is the chunk-collision bound, `:724` is "when there is one — answers
freshness"). All six are repointed by NAME in this round. The check is that command run over the
document **below this guard** — `awk '/^## 0\./,0' <file> | grep -on '§[0-9][0-9.]*:[0-9]'`
— which returns **nothing**, measured 2026-08-20. Run over the WHOLE file it returns
**two**: the anchors quoted above as counterexamples. Round 11 wrote the unscoped form
first and it failed on its own illustration — a check a counterexample falsifies is not a
check, and the scope is part of the check.

⚠️ **A NAME THAT RESOLVES TO NOTHING IS INVISIBLE TO THAT GREP, so the check has TWO MORE
PASSES (round 12).** The anchor grep guards WHERE a citation points; these guard WHAT it
names. **Both are scoped below the `## 0.` heading for the reason the anchor grep is** —
this guard must quote the failing forms to teach them, and an unscoped pass would then
report its own illustrations forever, which is the trap round 11 recorded one paragraph
above. Measured 2026-08-20 before this round, both failed:

```
# (1) every finding ID cited anywhere must have a §9 entry
awk '/^## 0\./,0' <file> | grep -oE '\b(C|CF|CR|O|OP)[0-9]*-?R?[0-9]*-[0-9]+\b' | sort -u | while read -r id; do
  awk '/^## 9\./,0' <file> | grep -qF -- "$id" || echo "DANGLING $id"; done

# (2) every `§N's **NAME**` citation must occur inside that section
awk '/^## 0\./,0' <file> | grep -oE "§[0-9](\.[0-9])?'s \*\*[^*]+\*\*" | sort -u | while IFS= read -r cite; do
  sec=$(printf '%s' "$cite" | sed -E "s/^§([0-9](\.[0-9])?)'s.*/\1/")
  name=$(printf '%s' "$cite" | sed -E 's/^[^*]*\*\*(.*)\*\*$/\1/')
  awk -v s="$sec" 'BEGIN{re="^#+ " s "[ .]"} $0 ~ re {inS=1;next} /^#+ [0-9]/{if(inS)exit} inS' <file> \
    | grep -qF -- "$name" || echo "UNRESOLVED $cite"; done
```

Pass 1 returned **six** IDs — `C10-1`, `C10-2`, `C10-3`, `C10-4`, `O9-1`, `OP11-2` —
carrying **37** citations in the body (12, 9, 7, 4, 4 and 1), two of them inside §0's
requirement rows, against a §9 that stopped at round 9. Pass 2 returned **one**: the name
for §4's PASS-line rule that this guard offered above as its own model and that §4 does
not contain. Both are discharged in this round — §9 gains round 10, round 11 and round 12
entries, and the four citations are renamed — and both must return **nothing**
thereafter. **A round that files a new finding ID adds its §9 entry in the SAME round**,
or pass 1 fails on that round's own body text. ⚠️ **Pass 2's section matcher is `[ .]`,
not an escaped dot, and that is not cosmetic**: §3.3's heading is `### 3.3 Declaration
cache` with no dot, so a dot-anchored form extracts an empty section and reports
`§3.3's **SKIP RULE — ALL FOUR cli-SCOPED COMPARISONS**` as UNRESOLVED when it resolves —
standing rule 1, on the check itself. Line citations into OTHER
files stay and stay exact — those files are not rewritten by these rounds. §6 already
guards its row numbers this way ("cited from OUTSIDE this section, so nothing here is
renumbered casually"); this is the same guard for everything else.

⚠️ **A SECOND REPRODUCIBLE CHECK, ON TABLE ROWS (round 12).** GFM discards every cell
beyond its header's column count and does NOT exempt a pipe inside a code span, so one
unescaped `|` in a cell silently TRUNCATES the row there and throws the rest away — the
sentence is in the file and not on the page. Every `|` inside a cell is written escaped,
the shape `docs/presentation-policy.md:234` already uses. The check compares each row's
pipe count against its own table's header, **after stripping the escaped ones — and that
stripping is the whole of it**: the naive form still reports a CORRECTLY escaped row as
malformed, so it can never return nothing and is not a check (standing rule 1, on the
check itself):

```
awk '/^\|/{gsub(/\\\|/,""); n=gsub(/\|/,"|"); if(p==0)h=n; if(n!=h) print NR": "n" vs "h; p=1; next}{p=0}' <file>
```

Run 2026-08-20 before this round it printed exactly **one** line — §0's requirement 9 row,
**6** pipes against a **4**-pipe header — where a `git ls-files … wc -l` command cut the
cell at its first pipe and dropped the whole of the bounded-residual statement round 11
had just added to it. After escaping it returns **nothing**, verified against a simulated
fixed copy. The anchor grep above is the guard on WHERE a fix points; this is the guard on
WHAT it inserts, at the one place a correct sentence can be inserted and still not render.

⚠️ **THIS FILE IS NEVER EDITED WITH A STRING REPLACEMENT (round 12).** Round 11's first
apply passed replacement text containing a dollar followed by an apostrophe to
JavaScript's `String.replace`, which reads that pair as "everything after the match": it
spliced the rest of the file back in and doubled the document to **4499** lines. It was
caught, reverted, and re-applied with a function replacement plus a line-delta guard.
Both are STANDING requirements of the apply step, not that round's remedy, because this
document carries **four** live `String.replace` special patterns as legitimate content —
three dollar-apostrophes and one dollar-backtick, in §0's requirement-9 row, twice in §3's
reproducible-command block, and in §3.3's chunk-collision bound. Three of the four sit in
blocks re-derived and rewritten most rounds, so an edit whose replacement text spans one
is likely rather than exotic. The check is a shell-neutral census — `grep -on` for a
dollar followed by any character, over the whole file, discounting the forms that are not
special — measured 2026-08-20 at **four** hits. It is written unquoted, and the two
sequences are named in words rather than quoted here, for two measured reasons: quoting
them would make this guard the fifth and sixth instances, and the quoted form of the
census returns NOTHING under `fish`, which is how a first scan nearly recorded the
document as free of them — standing rule 1, at the verification of an absence claim.
Re-derived 2026-08-20 for residual damage of the round-11 class: **2574** lines, every
`#`-heading occurring once, no duplicated line over 120 characters, and no editor
directive, placeholder or "see above" standing in as document text. None survives.

## 0. Requirement traceability

| #   | requirement                                                                          | discharged by                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `dist` side scoped to compiler outputs, excluding the `bundle:cli` asset copy        | §3 output set; `dist/plugin/**` (covered by §3.4) + `dist/index.d.ts` (covered by §3.5) excluded from the **mtime** side for `packages/cli` — their PRESENCE is required by §3.3's artifact set, so "excluded" never means "the check ignores them". Fixture rows 7, 8, 22, §6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2   | orphan check                                                                         | §3.1 `checkOrphans`. ⚠️ **Bounded residual — §8(m)**: a `PLUGIN_ASSET_ENTRIES` source DELETED without a rebuild leaves its shipped copy under `packages/cli/dist/plugin`, which §3.1 exempts from orphan detection by construction, §3.3's clause 1 checks only for top-level presence, and §3.4 compares mtimes only. Round 2 dispositioned that as `C-C`, "accepted as a stated limit"; the limit reached no section until round 11                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 3   | `packages/cli/dist/bin.js` vs newest `dist` of every inlined `@crabgic/*`            | §3.2 `checkBundleFreshness`, over the **metafile-derived** inlined set (16 units, equal to the reference closure today but never derived from it) — **inert unless ALL FIVE of §1's `bundle-cli.mjs` edits land, and the clear/write pair in the right order** (round 12, CF12-4: the `writeFile` import, the clear, the write, the `export` of `PLUGIN_ASSET_ENTRIES` and the entry-point guard — §1 says of the last two that "nothing above is reachable without them", because without the `export` at `:89` the check's own import fails to link and §4's internal-error row fires `ERROR`, exit **2**, at `check:all` member 0; only the clear/write pair is ORDER-sensitive), which §6's mutant-proved wiring assertion is the only thing that establishes, and **conditional on the marker**: absent, the comparison does not run and the advisory `bundle-provenance-missing` is reported instead — unconditionally, never as a migration window (§3.3's cli reason table, §6 battery row 10), which is the state of every tree until the first build after this lands. **Discharged only when it RUNS**: §4's coverage line prints the `not-run` entry on both paths, so the row is never silently undischarged — **including the not-run case in which NOTHING is absent (round 10, C10-1)**: when `unitState("packages/cli").state === "unbuilt"` all four cli-scoped comparisons are suppressed, and all four then report `not-run` with the second mandated reason `packages/cli unbuilt` (§3.2, §3.3, §3.4, §3.5, and §4's verbatim reason list). Without it the most routine tree there is — §7's `npm run typecheck` row, a bare `tsc -b` after a completed bundle — prints one `unbuilt` finding and no coverage line at all, which §4's recipe step 5 reads as "all six ran". There is no `reduced` status — round 10 deleted it as unreachable: a `packages/cli` with no esbuild chunk is `unbuilt` through §3.3's clause 1, and no cli-scoped comparison runs on an `unbuilt` unit (§3.2) |
| 4   | STATE the bootstrap limit                                                            | **residual** — §8(a). Partly sidestepped: the check lives in `scripts/`, which no tsconfig compiles                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 5   | enumerate from root `references` (19), never `workspaces` (18)                       | §3, via `enumerateRootReferences`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 6   | each unit's `tsconfig.json` + its `extends` chain on the input side                  | §3 input rule 3. Fixture row 2, §6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 7   | STATE the build-program/toolchain limit                                              | **residual** — §8(b). Partly closed: each producer script is an input to ONE artifact it produces (§3.2, §3.3); `bundle-cli.mjs`'s other two outputs are compared against their sources (§3.4, §3.5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 8   | account for `packages/cli/.dts-cache/`                                               | §3.3 `checkDeclarationCache` (cache vs sources) + §3.5 `checkShippedDeclarations` (cache vs the shipped copy) — **both** returning `{ findings, coverage }`, and both reporting coverage `not-run` (§3, printed by §4) when their side of the comparison is absent — or, with nothing absent at all, when `packages/cli` is `unbuilt` and §3.2's suppression rule fires, reason `packages/cli unbuilt` (round 10, C10-1) — for §3.3 that side is `.dts-cache/index.d.ts`, which §3.3's own skip rule makes reachable on a fresh clone: `npm ci` never creates the cache, so that is the state `meta-checks` runs in. Fixture rows 6, 17, 22, 23, 29, §6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 9   | every `tsconfig*.json` a build program hands to a compiler, incl. downward `extends` | §3 input rule 4 + §3.3. Fixture row 3, §6. ⚠️ **Bounded residuals — §8(l) and §8(f)**: discharged for **21 of the 30** tracked `tsconfig*.json` (re-derived 2026-08-20: `git ls-files \| grep -E 'tsconfig.*\.json$' \| wc -l` → 30 — the pipes are ESCAPED, and that is not cosmetic: GFM discards every cell past its header's column count and does not exempt a pipe inside a code span, so until round 12 this row truncated at `git ls-files` and everything after it was in the file and not on the page). `enumerateTsconfigs` returns 27 project dirs + 2 variants = **29 PATHS**, which is the CENSUS POPULATION and never the covered set. Re-derived 2026-08-20 by running §3's rules 3 and 4 over all 30: **21** land in some unit's input set — the 19 unit `tsconfig.json` (rule 3), `tsconfig.base.json` (rule 3's upward chain, length 2 for all 19) and `packages/cli/tsconfig.dts.json` (rule 4) — and **NINE do not**. The nine are the root `tsconfig.json`, which bare `tsc -b` reads (`build` is `tsc -b && …`, `package.json:15`) and which carries no `compilerOptions` — residual **§8(l)** — plus the **8** non-`report` `e2e/*` configs, each declaring `"extends": "../../tsconfig.base.json"` (or `../../../`), which resolves to the root-level base and never INTO a unit, so neither rule reaches them, while `scripts/check-e2e-types.mjs:40` hands each to `npx tsc -p … --noEmit` for exactly `E2E_TYPECHECK_PROJECTS` (`:24-32`, wired as `check:e2e-types`, `package.json:24`) — residual **§8(f)**, bounded because all 8 set `noEmit: true` and emit nothing that can go stale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 10  | wire into `check:all`                                                                | §5 — 15th member, FIRST in the chain, verbatim `npm run check:stale-dist -- --strict`; §6 pins `members[0]` by equality, so neither the position nor the flag can drift. ⚠️ **Bounded residual — §5.1's Honest bound**: npm's pre-hook is NAME-EXACT, so `pretest` reaches `npm test` and nothing else. Re-derived 2026-08-20 (npm 11.16.0): four sibling scripts bypass it — `test:watch` (`package.json:20`, `vitest`), `test:live` (`:21`), `test:e2e` (`:22`) and `test:e2e:release-evidence` (`:23`) — plus `npx vitest`, so the measured bypass set is **five**, not the one §5.1 named for twelve rounds; and `test:watch` is the vitest WATCH loop, the founding incident's own context. "Trigger's real reach stated" is the claim; §5.1 is where it is now measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 11  | call `scripts/repo-census.mjs` rather than re-deriving                               | §2 — imports `enumerateRootReferences` + `enumerateTsconfigs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

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

Node builtins only, plus **exactly one** repo-internal import: `scripts/bundle-cli.mjs`,
for its `PLUGIN_ASSET_ENTRIES` (§3.3's clause 1, §3.4's source side). ⚠️ **That import is
not free, and the flat "dependency-free" claim does not survive it (round 10, C10-2):**
`bundle-cli.mjs:59` is `import { build } from "esbuild"`, so importing the module resolves
`esbuild` at load time. Re-derived 2026-08-20: `esbuild` is a root **devDependency**
(`package.json:61`, pinned `0.28.1`), which `npm ci` installs — so `meta-checks`, which
runs `npm ci` with no build step (the constraint
`scripts/citation-content/file-index.mjs` documents in its header and
`scripts/repo-census.mjs` restates at `:39-41`), resolves it. An `--omit=dev` install does
not — and what happens there depends on HOW the graph is entered, which this design now
rules on rather than leaving implicit. ⚠️ **IMPORT RULE (round 12, OP12-1):
`scripts/check-stale-dist.mjs` reaches `stale-dist/compare.mjs` and `stale-dist/report.mjs`
through `await import(...)` INSIDE its try/catch, never by a static `import` statement.**
Everything below those two keeps ordinary static imports — `walk.mjs`'s
`import { PLUGIN_ASSET_ENTRIES } from "../bundle-cli.mjs"` included, so no signature in §2
becomes async — because the whole static subgraph is resolved AT that `await import`, which
is inside the try. A static ESM graph, by contrast, is resolved and linked BEFORE the first
statement of the entry module runs, so the catch this section's file table and §4's
internal-error row assign as owner is not yet on the stack and cannot fire. Measured
2026-08-20 (node v24.18.0, npm 11.16.0, nothing else running but the shell) on a probe with
this design's exact shape — `cli.mjs` statically importing `sub/walk.mjs` importing
`sub/dep.mjs` importing an absent `esbuild`, with the call wrapped in the try/catch — BOTH
invocations printed no `check-stale-dist: ` line at all, node printed
`ERR_MODULE_NOT_FOUND` plus a ten-frame internal stack, and the process exited **1** with
`--strict` AND **1** without. By §5.1's own measured table (`pretest THROWS -> npm exits 1,
and test NEVER RUNS`) the non-strict path is then a total block on `npm test` — verbatim
round 1's `O-2`, re-opened by omission at the site round 10's C10-2 fix created. Under the
dynamic entry the throw lands in the catch and §4's row holds: `WARN`/exit 0 by default,
`ERROR`/exit **2** under `--strict`. Stated as residual §8(n), pinned by §6 row 31, and its
reachability is wider than `--omit=dev`: any incomplete or pruned `node_modules`, and any
load-time throw anywhere in the six-module graph, lands in the same uncatchable window. ℹ️ The alternative that
keeps a builtins-only import graph is to move the const into a builtins-only
`scripts/plugin-assets.mjs` that BOTH files import; it costs one more file and one more §6
assertion (that `bundle-cli.mjs` still imports it, so the bundler cannot fork its own
list) and needs no entry-point guard.

| file                                | lines (est.) | purpose                                                                                                                                                                                                                                                      |
| ----------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/check-stale-dist.mjs`      | ~110         | `#!/usr/bin/env node`, the WHY header, arg parsing, CLI — **and the `try`/`catch` that owns §4's internal-error row**: it reaches `checkStaleDist` and `formatFindings` through `await import("./stale-dist/compare.mjs")` and `await import("./stale-dist/report.mjs")` **inside** the try — §1's IMPORT RULE, because a static `import` puts the whole six-module graph outside the catch and a load-time throw then exits **1** with an unprefixed node stack and no `check-stale-dist: ` line at all (measured, round 12, OP12-1) — then prints `formatInternalError(err, { strict, json })` (§2), passing the `--json` it parsed so a throw under `--json` emits the JSON error object and never the human line (round 12, C11-5), and exits **2** under `--strict`, **0** without. Exit 2 comes from here and never from `exitCodeFor`, which takes a `result` a throw never produces                                                                                                                                                                                                      |
| `scripts/stale-dist/units.mjs`      | ~150         | build-unit enumeration and per-unit input/output sets                                                                                                                                                                                                        |
| `scripts/stale-dist/walk.mjs`       | ~95          | mtime walk primitives, `sameBytes`, and the output/input classifiers                                                                                                                                                                                         |
| `scripts/stale-dist/compare.mjs`    | ~250         | the SIX comparisons — the FOUR cli-scoped ones (§3.2, §3.3, §3.4, §3.5) return `{ findings, coverage }`, the other two (`checkUnitFreshness`, `checkOrphans`) `Finding[]` — plus `unitState` (§3.3's three-way reason table) and the `checkStaleDist` driver |
| `scripts/stale-dist/report.mjs`     | ~115         | findings **and coverage** → text/JSON, and the exit code; §4's coverage line prints on BOTH paths; **plus §4's ordered REMEDY PLAN** — the block `formatFindings` computes from the finding-KIND set with §4's three carve-outs applied, which had no owner, no shape and no assertion for twelve rounds (round 12, OP12-4), so an implementer printing the per-kind remedies beside each grouped block passed every row and handed the operator exactly the unordered list §4 measures as harmful; plus `formatInternalError` — the `WARN`/`ERROR` line §4's internal-error row prints, or the JSON error object under `--json` (round 12, C11-5), the one output this check writes that no `result` produces                                                                                                                                                            |
| `scripts/check-stale-dist.test.mjs` | ~620         | colocated suite (§6) — **34** battery rows, the false-negative battery, the mutant-proved wiring assertions and the live smoke test                                                                                                                                                                                                                                         |

⚠️ **THREE EXISTING FILES MUST ALSO CHANGE. The first two were a round-8 fix; `package.json` is round 9's (CF9-3).** The first two were specified only in §3.2's prose for two rounds, and `package.json`'s three edits have lived only in §5/§5.1 for nine — so an implementer could build all six new files, pass every battery row and the wiring test, and still leave requirement 3's comparison **permanently muted**, or chain the check last and non-strict so it blocks nothing — the vacuity class this whole change set exists for.
Round 7 filed that as `CF-3` and the disposition did not reach this table; caught by
pre-checking before round 8 reported, which is the eighth consecutive partly-true
completion claim in this record and the first caught by its author.

| existing file            | change                                                                                                                                                                                                                                                                                                                                                                                                                                                   | why it is load-bearing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/bundle-cli.mjs` | add `writeFile` to the `node:fs/promises` import (`:55` — absent today, measured); **clear** with `rm(join(CLI_ROOT, ".bundle-meta")…` in the wipe step, before `build()` at `:121`; **write** with `writeFile(join(CLI_ROOT, ".bundle-meta", "metafile.json")…` after the plugin-copy loop, beside `:181`. Those two literals are the anchors §6 asserts on: both edits name `.bundle-meta`, so a bare path anchor cannot tell the clear from the write. ⚠️ **TWO MORE EDITS TO THIS FILE, and nothing above is reachable without them (round 10, C10-2):** (4) `export` the `PLUGIN_ASSET_ENTRIES` const at `:89` — re-derived 2026-08-20, `grep -n "^export" scripts/bundle-cli.mjs` returns `:71` `EXTERNAL_DEPENDENCIES` and nothing else, so §3.3's clause 1 and §3.4's source side both cite a binding no importer can obtain, and a literal `import { PLUGIN_ASSET_ENTRIES } from "../bundle-cli.mjs"` fails to link ("does not provide an export named") — and that reaches §4's internal-error row (`ERROR`, exit **2**, from `check:all -- --strict` at member 0) **only under §1's IMPORT RULE**. Measured 2026-08-20 (node v24.18.0): with the entry module importing statically, the same link failure is a `SyntaxError` raised before its first statement runs, so no catch sees it — exit **1**, unprefixed stack, no `check-stale-dist: ` line, and under `pretest` no test suite at all (round 12, OP12-1); (5) put the file's last statement `await main()` behind the entry-point guard `scripts/repo-census.mjs:382` already uses in this repo (`process.argv[1] && statSync(process.argv[1]).ino === statSync(fileURLToPath(import.meta.url)).ino`) — without it a namespace import executes `main()` and REBUILDS `packages/cli/dist` from inside the check that observes it, the side effect round 3 disclosed, and throws at `:147` on a fresh clone. Nothing imports this module today (re-derived 2026-08-20: its only consumer is `package.json:48`'s `node scripts/bundle-cli.mjs`), so the guard changes no existing behaviour. **FIVE edits to this file** — the `writeFile` import, the clear, the write, the `export`, the entry-point guard — **of which §6 asserts FOUR SOURCE PROPERTIES**: the clear precedes `build()`, the write follows the plugin copy, `PLUGIN_ASSET_ENTRIES` is `export`ed, `await main()` sits behind the ino guard. The `writeFile` import is the fifth edit and is NOT separately asserted — §6's `WRITE` anchor pins the CALL, not the import. **Edits and asserted properties are different counts, stated apart** (round 12, CF12-4: this cell read "FOUR edits … all four asserted" inside its own "TWO MORE EDITS TO THIS FILE … (4) … (5)") | it is requirement 3's provenance oracle — the only record of what entered this bundle (§3.2) — and after round 9 its ABSENCE reports `bundle-provenance-missing` and never `unbuilt`; `unbuilt` keys on C9-1's freshness rule, which reads artifacts in the tree and needs no history. **The write's POSITION is what the rest rests on**: `:181` runs after every byte `bundle-cli.mjs` puts under `dist`, so a present marker implies every earlier step ran and a completed bundle always leaves mtime(marker) >= the newest qualifying output under `dist` — §3.3's marker-freshness clause — and `bundle-provenance-missing` is reachable only in the `:178`→`:181` window. Placed earlier it proves only that esbuild ran. ⚠️ **The wipe-step clear is retained as defence in depth and is NO LONGER the invalidation mechanism (round 9).** `build` is `tsc -b && npm run bundle:types && npm run bundle:cli` (`package.json:15`), so an interrupt during the ~5-minute `bundle:types` step means `bundle-cli.mjs` never runs and the clear never fires; the clear covers the classes where the bundler IS executing, the freshness comparison covers the classes where it is not. **Not cleared first the marker describes some OTHER run's bundle** — `OUT_DIR` is `dist` only (`:63`), so neither the wipe (`:113`) nor the design's own `rm -rf packages/cli/dist` touches the sibling `.bundle-meta/`, and a surviving metafile would name a stale inlined unit set |
| `.gitignore`             | append `packages/cli/.bundle-meta/` after the `packages/cli/.dts-cache/` entry at `:47`. Measured 2026-08-20: `git check-ignore -v packages/cli/.bundle-meta/` reports nothing and `grep -n bundle-meta .gitignore` returns no hit, so the directory is untracked-and-unignored today                                                                                                                                                                    | `.dts-cache/` is ignored at `:47`; without the matching entry every build leaves an untracked file that `repo-census.mjs` reports in its "on disk, neither tracked nor ignored" bucket and that sits in `git status` forever. §6 asserts it by reading `.gitignore`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `package.json`           | add `"check:stale-dist": "node scripts/check-stale-dist.mjs"` and `"pretest": "node scripts/check-stale-dist.mjs"` (neither carries `--strict`), and insert `npm run check:stale-dist -- --strict` as **`check:all`'s member 0**, before the 14 that exist today                                                                                                                                                                                         | position and flag ARE requirement 10's value. Measured: `check:tarball` is member 12 and `check:install-smoke` member 13, and both read local `dist` state (defect `25-install-smoke-depends-on-local-dist-state.md`), so a member appended last runs AFTER the two §5 orders it before; and without `--strict` `check:all` exits 0 on a stale tree. §6 asserts `members[0]` by equality                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

§6 asserts all three **by reading them**, in the source-reading shape
`check-support-window-freshness.test.mjs:543-544` and
`check-marketplace-pin-digest.test.mjs:353-358` use — `:530`/`:339`, cited here until
round 9, assert `package.json`, not a file read — and for ORDER the two-`indexOf` shape
`run-e2e-suites.test.mjs:31` uses. FIVE source properties, each proved non-vacuous by a
mutated copy of the source: the clear precedes `build()`, the write follows the plugin
copy, `PLUGIN_ASSET_ENTRIES` is `export`ed, `await main()` sits behind the entry-point
guard, and `.gitignore` carries the entry. The last two are round 10's (C10-2): without
them §3.3's clause 1 and §3.4's source side name a const no importer can reach, and the
only import that reaches it runs the bundler.

⚠️ **The third file, `package.json`, is deliberately NOT asserted in that citations' shape (CF9-3).** `:530` and `:339` are both `expect(root.scripts["check:all"]).toContain("check:…")` — membership only, blind to position and to flags. That is all those two checks need; here it is exactly the assertion a last-position, non-strict member passes. §6 pins this one by index and equality instead — `expect(members[0]).toBe("npm run check:stale-dist -- --strict")` (§5) — because position and flag ARE requirement 10's value.

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
//          references: string[], kind: "tsc" | "bundled" }
// A Unit carries NO state flag of any kind. `buildUnits` never reads `dist/`, so it
// cannot know one; the verdict is `unitState(unit)`'s, computed once by `checkStaleDist`.
// The corollary, stated because leaving it implicit is what made round 8's rule
// unimplementable at BOTH ends (round 9, C9-1): if no field on Unit carries a `dist`
// fact, then `unitState` is the function that reads them, and it is NOT pure over its
// argument. It stats `<unit>/dist` through `walk.mjs` and, for `packages/cli` only,
// calls `cliArtifactGaps(cwd)`. PRESENCE facts, not mtimes — round 9 moved completeness
// off the marker onto §3.3's artifact set, so nothing here needs a timestamp the
// struct would otherwise have to carry.

// walk.mjs
export function newestUnder(dir, accept)             -> { path, mtimeMs } | undefined
export function newestOfEntries(paths, accept)       -> { path, mtimeMs } | undefined
//   MIXED-TYPED roots: `statSync`s a regular-file member, walks a directory member.
//   §3.4's SOURCE side needs it and `newestUnder(dir, …)` cannot do it: of the six
//   `PLUGIN_ASSET_ENTRIES` — obtained as
//   `import { PLUGIN_ASSET_ENTRIES } from "../bundle-cli.mjs"`, which requires §1's
//   `export` and entry-point-guard edits and is NOT satisfiable today: re-derived
//   2026-08-20, `:89` is a bare `const` and the file's last statement is `await main()`
//   (round 10, C10-2) — five are directories and
//   `packages/plugin/.mcp.json` is a regular FILE. Re-derived 2026-08-20 against the
//   design's own six-entry list: `readdirSync` on that member throws
//   `ENOTDIR: not a directory, scandir '…/packages/plugin/.mcp.json'` — thrown on a
//   fully built, CLEAN tree, which `check-stale-dist.mjs`'s try/catch (§1) turns into §4's
//   internal-error row — `WARN` and exit 0 by default, `ERROR` and exit **2**,
//   from every `npm run check:all -- --strict` (round 10).
export function stemsUnder(dir, accept)              -> string[]   // extension-stripped, sorted
export function isCompilerOutput(unit, relPath)      -> boolean    // requirement 1
export function isCompilerInput(relPath)             -> boolean
export function sameBytes(pathA, pathB)              -> boolean    // size, then content — §3.5

// compare.mjs
export function checkUnitFreshness(unit)             -> Finding[]  // reqs 1, 5, 6, 9
export function checkOrphans(unit)                   -> Finding[]  // req 2
export function readMetafile(cwd)                    -> object | undefined
//   absent OR UNPARSEABLE ⇒ `undefined`, and `undefined` ⇒ a `bundle-provenance-missing`
//   finding with the reason its case mandates (§3.2). It NEVER throws (round 10, C10-3):
//   the marker is 404,198 bytes over 758 inputs written by a plain `writeFile`, so a
//   truncated one is reachable on a tree where every artifact is complete — and the
//   `object | undefined` signature read as an invitation to catch, versus read as a bare
//   `JSON.parse`, is two defensible implementations two exit codes apart: advisory at
//   **0**, or §4's internal error at **2** from `check:all -- --strict` at member 0.
export function checkBundleFreshness(units, metafile) -> { findings, coverage }  // req 3;
//   `metafile === undefined` ⇒ exactly ONE `bundle-provenance-missing` finding plus
//   coverage `not-run`, never a comparison over an empty inlined set
export function checkDeclarationCache(units)         -> { findings, coverage }  // req 8
export function checkPluginAssets(cwd)               -> { findings, coverage }  // §3.4
export function cliArtifactGaps(cwd, metafile)       -> string[]   // §3.3 artifact set
//   takes the metafile (from `readMetafile`, `undefined` when absent or unparseable)
//   because clause 1's chunk member is a SET when there is one and "at least one" when
//   there is not (§3.3, round 12, C11-6). It never throws on it — `readMetafile` already
//   returns `undefined` for both degraded cases — so this adds no new error path.
// checkUnitFreshness/checkOrphans return no coverage — theirs IS the unit table (§3, §3.1)
export function checkShippedDeclarations(cwd)        -> { findings, coverage }  // §3.5,
//   requirement 1's 2nd excluded artifact. ⚠️ **`{ findings, coverage }`, not `Finding[]`
//   (round 10).** §3.3's **SKIP RULE — ALL FOUR cli-SCOPED COMPARISONS** binds them to report a coverage
//   entry of `not-run` rather than the early `return []` it calls "the founding silence in
//   a smaller box", and §0's requirement 8 promises one for this comparison — but four
//   other sections said three, so this signature structurally forced the silence §3.3
//   bans. Under `Finding[]` a `skipped` run degenerates to `toEqual([])`, indistinguishable
//   from "ran and found nothing", and §6 row 23 had no assertable surface at all (its twin,
//   row 12, already records why a bare "skipped" is unassertable). Reachable today:
//   `rm -rf packages/cli/.dts-cache` on a complete `dist` leaves `packages/cli` `compared`,
//   so this comparison declines with nothing of its own to report.
export function inlinedUnitsFromMetafile(metafile)   -> string[]   // req 3's ground truth
export function checkStaleDist(cwd)                  -> { findings, states, coverage }
//   states: { unit, state, reason }[] — ONE entry per enumerated unit, from unitState().
//   ONE container for the three-way verdict: a `units` array beside a `skipped` array
//   is the same collapse in a different shape, and neither carried the `reason` §4's
//   PASS line prints (`1 skipped (packages/cli: no dist/)`, §4). Both PASS-line counts
//   are filters over this one array, and `units` is recoverable as states.map(s => s.unit).
//   `coverage` is separate and stays: it is about the FOUR cli-scoped COMPARISONS
//   (§3.2, §3.3, §3.4, §3.5), never about unit state.
export function unitState(unit)                      -> { state, reason }  // the §3.3 reason table

// `cliArtifactGaps` returns the required `packages/cli` artifacts that are ABSENT —
// the esbuild chunk SET, dist/bin.js, dist/index.js, dist/bin/supervisord.js,
// dist/index.d.ts, and the six dist/plugin entries. The METAFILE IS NOT A MEMBER — it is
// READ, for the chunk set only (§3.3 clause 1, round 12, C11-6), and never REQUIRED,
// which is what keeps `unbuilt` and `bundle-provenance-missing` disjoint. Round 12
// changed the reading, not the membership: a marker-less tree is still `compared` +
// `bundle-provenance-missing`, never `unbuilt` for want of a marker (CF9-2).
// The two cli kinds are disjoint by construction, and collapsing them re-opens CF9-2:
//   gaps.length > 0                   -> `unbuilt`, gaps named in the line, with the
//                                        reason §3.3's cli reason table gives — TWO of
//                                        them since round 12 (C11-3): `bundle:cli did
//                                        not finish`, and the `--clean` signature's own,
//                                        which is why `unitState` and never the reporter
//                                        picks it (§4, §6 rows 30 and 32)
//   gaps.length === 0 && no metafile  -> `bundle-provenance-missing`, unit stays
//                                        `compared`; a FINDING, never a skip.

// unitState().state ∈ "compared" | "unbuilt" | "skipped" — three values, never a
// boolean, and never a field on Unit. A `built: boolean` cannot separate the three
// outcomes §3.3's reason table produces, and the separation IS the fix: an implementer
// collapsing them to `built ? compare : skip` reproduces round 3's CR-2 exactly.
// Round 8 wrote this enum and left `built: boolean` in the struct 18 lines above;
// round 9 removed it (CF9-1). What each state DOES is §3's skip-rule table.
// Battery rows 9, 13 and 14 keep the three apart — one fixture per state, or the enum
// is untested decoration that any boolean implementation satisfies.

// ComparisonCoverage = { comparison, status, reason }
// comparison ∈ "bundle-freshness" | "declaration-cache" | "plugin-assets"
//              | "shipped-declarations"
//   FOUR members, one per cli-scoped comparison, matching §3.3's **SKIP RULE — ALL FOUR
//   cli-SCOPED COMPARISONS**. A
//   three-member union contradicted that rule, §0's requirement 8 and §6's live smoke
//   test in one stroke (round 10): an implementer who obeyed §3.3 and added a fourth
//   entry emitted a value no type admitted and FAILED the smoke assertion, and one who
//   obeyed this line shipped the sixth comparison with no coverage channel.
// status     ∈ "full" | "not-run"   — TWO values, and NOT a count. `not-run` has
// exactly TWO causes and BOTH are mandated (round 10, C10-1): a side of the comparison
// is ABSENT, or `unitState("packages/cli").state === "unbuilt"`, which suppresses all
// four (§3.2) on a tree where every artifact is present. Keying the entry on absence
// alone leaves the second cause with no reason this design admits — four comparisons
// suppressed and nothing printed. Do NOT answer it with a third status: round 10 deleted
// `reduced` to keep this enum two-valued, and re-widening it re-opens CF9-2.
// ⚠️ **`reduced` was REMOVED in round 10 as UNREACHABLE.** Its only producer was §3.2's
// fallback to the three entry outputs when no esbuild chunk exists. Round 9 made one file
// matching the chunk pattern a REQUIRED member of §3.3's clause-1 artifact set —
// `cliArtifactGaps` below lists "an esbuild-named chunk" first — so a chunkless
// `packages/cli` is `unbuilt` with `missing: chunk-*.js`, and §3.2 states that no
// cli-scoped comparison runs on an `unbuilt` `packages/cli`. Both predicates read the
// same `/-[A-Z0-9]{8}\.js$/` for PRESENCE, so they can never disagree that a chunkless
// tree is `unbuilt` — round 12 (C11-6) made clause 1's chunk MEMBERSHIP metafile-derived
// when a marker exists, which only NARROWS clause 1 and can never widen it — and
// `checkBundleFreshness` never reaches the fallback to report anything. ⚠️ **Standing rule 8: do NOT resolve
// that the other way.** Letting a chunkless tree report `reduced` at exit 0 is verbatim
// round 6's `CR6-3` — `PASS` on a `tsc -b`-only tree — the founding failure's eighth
// appearance, produced by the coverage element round 9 added. A member no reachable state
// produces is a value hardcoded never to appear: CF9-2's shape, relocated into this enum
// by round 9's own fix, with §6 row 16 mandating it.
// `comparisonsSkipped` was a count, appeared exactly ONCE in this design (§2's
// signature), had no line shape in §4 and no battery row in §6 — so the check computed
// a degraded coverage and never printed it. A count cannot say WHICH comparison did not
// run, and it cannot carry the REASON §4's coverage line prints — which is the whole of
// the argument now that `reduced` is gone and the enum is two-valued (round 10).
// Round 9, O9-1.
// `skipped` stays UNIT-scoped: it is §4's PASS-line slot and a `states` entry above,
// never a coverage entry — naming skipped UNITS and not skipped COMPARISONS is the
// same defect one level up.

// Finding = { kind, unit, remedy, newerInput?, olderOutput?, deltaMs?, reason? }
//   the three comparison fields are OPTIONAL — §4 names FOUR kinds with no delta
//   to print — `unbuilt`, `bundle-provenance-missing`, `orphan-output` and
//   `stale-shipped-declarations`, whose §4 line is byte-based (`(<a> vs <b> bytes)`) and
//   carries no mtime delta. NAMED, not counted, because this count has now drifted once:
//   an implementer marking "three" kinds delta-less guesses round 7's set and leaves
//   `stale-shipped-declarations` on the generic comparison shape, rendering
//   `stale-shipped-declarations packages/cli undefined undefined NaN` — round 4's
//   `OP-R4-2` and round 7's `OP-1` verbatim, and nothing in §6 fails (round 11).
//   `reason` carries unitState()'s reason for `unbuilt`, so §4's line states
//   WHICH reason-table row fired instead of one sentence that is false for two of them
//   (round 7's OP-2, recurring at the sites round 8's rule created).
// kind ∈ "stale-unit" | "orphan-output" | "stale-bundle" | "stale-declarations"
//       | "stale-shipped-declarations" | "stale-plugin-assets" | "unbuilt"
//       | "bundle-provenance-missing"

// report.mjs
export const ADVISORY_KINDS = new Set(["bundle-provenance-missing"])  // §4 exit table
export function formatFindings(result, { json })     -> string
//   Renders the PASS line, the grouped finding lines, **§4's ordered REMEDY PLAN** and
//   the coverage line — in that order, which §4's prefix rule fixes. The plan is a pure
//   function of the finding-KIND set with §4's three carve-outs applied, NOT a per-kind
//   remedy printed beside each grouped block, which is the unordered list §4 measures as
//   harmful. It prints whenever the run reports at least ONE finding, because §4's own
//   carve-outs make single-kind runs multi-step (a lone `stale-declarations` needs step 3
//   AND step 4, and the remedy table's row names only step 3). It had no owner in this
//   section for twelve rounds (round 12, OP12-4); §6 row 34 is what makes it non-vacuous.
export function formatInternalError(err, { strict, json }) -> string   // §4's internal-error row
//   The ONLY line this check prints that no `result` produces, and the reason §4's
//   internal-error row had no owner for eleven rounds (round 11). ⚠️ **It takes `json`
//   for the same reason `formatFindings` does (round 12, C11-5): `--json` PLUS a throw
//   was an input pair no section named.** Every reachable throw §4's own row admits — the
//   `ENOTDIR` on `packages/plugin/.mcp.json` (§2, §3.4), row 27's malformed unit
//   tsconfig, an `--omit=dev` install with no `esbuild` (§8(n)), a missing
//   `PLUGIN_ASSET_ENTRIES` export (§1's fourth edit) — would otherwise emit
//   `check-stale-dist: WARN internal error — …` on **stdout** under
//   `node scripts/check-stale-dist.mjs --json`, so the JSON stream is not JSON. **This
//   repository has already SHIPPED that failure:** `scripts/bundle-types.mjs:63-68`
//   records `check-published-tarball.mjs` dying with
//   `Unexpected token 'b', "bundle-typ"... is not valid JSON` because a producer wrote
//   human chatter to stdout. Latent today — nothing consumes `--json` yet — which is why
//   it is closed BEFORE a consumer exists rather than after. `check-stale-dist.mjs`'s
//   try/catch is its sole caller (§1); exit **2** comes from that catch, never from
//   `exitCodeFor`. ⚠️ **A catch owns only what is LOADED inside it (round 12, OP12-1):**
//   the entry module reaches `compare.mjs` and `report.mjs` through `await import(...)`
//   inside the try, because a static import resolves the whole graph before the try
//   exists and turns every load-time throw into an uncatchable exit **1** with no
//   prefixed line at all — §1's IMPORT RULE, §6 row 31. Without a catch the operator gets an unprefixed node stack — and under
//   `pretest` no test suite at all: re-derived 2026-08-20 in a scratchpad package (npm
//   11.16.0, node v24.18.0, nothing else running but the shell), an UNCAUGHT throw in
//   `pretest` exits npm **1** and `npm test` never runs, verbatim round 1's `O-2`.
export function exitCodeFor(result, { strict })      -> 0 | 1       // exit 2 is the CLI
//   catch's (`formatInternalError` above, §1) — a throw yields no `result` to pass here.
//   Round 2's `CF-A` raised this range because §4 required exit 2 and no element produced
//   it; round 11 supplies the element instead of widening the range. Partitions by kind,
//   never by count: `--strict` exits 1 only when some finding's kind is NOT advisory
```

Everything is pure over its arguments except `newestUnder`/`newestOfEntries`/`stemsUnder`/`sameBytes`,
`cliArtifactGaps` and `unitState`, which read the filesystem — the split
`repo-census.mjs` uses between `computeDisagreements` (pure, unit-tested) and
`enumerate*` (I/O). `sameBytes` is the only one that reads file CONTENT rather than
metadata; §3.5 states why that single artifact needs it, and why it is not the content
oracle §7 row 1 rejects.

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

**Skip rule.** A unit's state is `unitState(unit)`'s — `compared`, `unbuilt` or `skipped`, from the reason table in §3.3 — **never from directory existence alone, and never a boolean (§2)**. What each state DOES is stated here, because 'which comparisons run' is the thing `built ? compare : skip` gets wrong:

| state      | per-unit comparisons run              | reported as                                        |
| ---------- | ------------------------------------- | -------------------------------------------------- |
| `compared` | `checkUnitFreshness` + `checkOrphans` | findings, if any                                   |
| `unbuilt`  | neither — the absence IS the finding  | one `unbuilt` finding carrying its `reason`        |
| `skipped`  | neither                               | no finding; named with its `reason` in §4's `PASS` |

This bullet read "a unit whose `dist/` does not exist is `skipped`, never stale" for seven rounds while the rule that consumes it moved four times, 220 lines away in a section headed _Declaration cache_ (round 8). The research rationale it cited still holds for the genuinely-absent case (research
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
      ⚠️ **27 + 2 = 29 is the size of `enumerateTsconfigs`' RETURN, not the size of the
   covered set — and the covered set is 21 of 30 (round 12, C11-1/CF12-3, correcting
   round 11).** The two are different questions and round 11 answered the wrong one: 8 of
   those 27 project dirs are NOT units. Units come from `enumerateRootReferences` (**19**,
   re-derived 2026-08-20); the other 8 are `e2e/{attestation,live,provisioning,release}`
   and `e2e/matrix/{connector,git,installation,orchestration}` — exactly the set
   difference. Re-derived 2026-08-20 by running rules 3 and 4 over the 30 tracked configs:
   **21 land in some unit's input set, 9 do not.**

   The 21 are the 19 unit `tsconfig.json` (rule 3), `tsconfig.base.json` (rule 3's upward
   chain, length 2 for all 19), and `packages/cli/tsconfig.dts.json` (rule 4). The 9 are:

   - the **ROOT `tsconfig.json`**. Rule 3 reaches it only by an upward `extends` walk and
     it declares none; rule 4 reaches only configs whose own chain resolves INTO a unit,
     and this one has `"files": []` plus 19 `references` and nothing else — re-derived
     2026-08-20, `Object.keys` on the parsed file returns exactly `files, references`.
     `build` is `tsc -b && …` (`package.json:15`), so a build program DOES hand it to a
     compiler. Residual **§8(l)**, bounded because it carries no `compilerOptions` and
     because §3's own **Units** step re-reads it on every run (`enumerateRootReferences`);
   - the **8 `e2e/*` configs**, each declaring `"extends": "../../tsconfig.base.json"` (or
     `../../../`), which resolves to the root-level base — so rule 4's chain never
     resolves into a unit — and none of which an upward walk from the 19 reaches.
     `scripts/check-e2e-types.mjs:40` runs `npx tsc -p <config> --noEmit` for exactly
     `E2E_TYPECHECK_PROJECTS` (`:24-32`), wired as `check:e2e-types` (`package.json:24`),
     so requirement 9's own wording covers them. Residual **§8(f)**, bounded by that
     bullet's already-measured reason: all 8 set `noEmit: true`, so they emit no output
     that can go stale.

   Requirement 9 is therefore discharged for **21 of the 30**. ⚠️ **Standing rule 4 at the
   site of round 11's own fix**: 29 was a measurement of the enumeration, and this rule is
   about the input SETS.

⚠️ **EVERY CONFIG READ NAMES ITS FILE (round 12, OP12-5).** Rules 3 and 4 parse configs
with raw `JSON.parse` — all 30 do so today — and a `JSON.parse` failure carries no path:
measured 2026-08-20 on node v24.18.0, a malformed config yields `Expected double-quoted
property name in JSON at position 7 (line 1 column 8)` and nothing else, while an `fs`
failure yields `ENOENT: no such file or directory, open 'nope.json'` WITH the path. So
`units.mjs` wraps each read and re-throws as `<path>: <err.message>` — the shape `ENOENT`
gives for free — and wraps the one census call that parses, `enumerateRootReferences`
(`repo-census.mjs:290`), whose file is the root `tsconfig.json`. Without it §6 row 27's
own fixture hands a 3am operator one line, exit **2** at `check:all` member 0, with **30**
candidate configs and no locus. §4's internal-error line is where that path is printed,
and §6 row 27 is where the path is asserted.

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
  preserves it across the wipe. ⚠️ **This exclusion is load-bearing a SECOND time, in
  §3.3's marker-freshness clause (round 9).** Measured on a composite fixture with the
  pinned `typescript@6.0.3`: `touch src/a.ts && tsc -b` moved `dist/.tsbuildinfo` and left
  `a.js`/`a.d.ts` untouched. A freshness rule reading raw `dist/**` would therefore report
  **`unbuilt packages/cli`** after any `tsc -b` that re-checks a touched-but-unchanged
  source — §7 row 1's scenario (format-on-save, `git checkout`), promoted from `stale-unit`
  to the loudest kind there is, with a `rm -rf` + ~5-minute-rebuild remedy;

**This filtered set is also the comparand for §3.3's `packages/cli` completion-marker
freshness clause** — the same `isCompilerOutput` predicate, never a raw `dist/**` walk.
Stated here, in the section that DEFINES the output set, and not only where the rule is
written: that exact split is what round 6's `CF6-1` filed.

- for `packages/cli` only, `dist/plugin/**` — **requirement 1**. `bundle-cli.mjs:178`
  copies the six `PLUGIN_ASSET_ENTRIES` with `cp(..., { recursive: true })` and no
  `preserveTimestamps`, so those mtimes are copy time and say nothing about a compile.
  ⚠️ **Excluded from the MTIME comparison only (round 9, CF9-2)**: all six entries are
  members of §3.3's artifact set and must EXIST, and a missing one is `unbuilt` with the
  gap named. The presence check is load-bearing since round 9 moved completeness off the
  marker onto the artifact set — read as a plain exclusion, two of that set's members
  ship unchecked;
- for `packages/cli` only, `dist/index.d.ts` — a `copyFile` of the declaration cache
  (`bundle-cli.mjs:153`). Measured: `copyFile` does NOT preserve timestamps, so the
  destination always carries copy time, and leaving it in would make `packages/cli`
  look fresh after any bundle whether or not `tsc` recompiled — the masking fixture
  row 7 exists for. **Excluded from the mtime comparison only**, for the same reason:
  its presence is a member of §3.3's artifact set. Its CONTENT is **covered by §3.5's
  sixth comparison, NOT by §3.3** — §3.3 reads `.dts-cache/index.d.ts` only, and this
  pointer named it for seven rounds while nothing in the design read the shipped copy
  at all (round 9);
- **`dist/eo-*-fixture-*/**` — test-written scratch, in BOTH families.**
  `packages/journal/src/crash-fixtures/prepare-runtime.ts:25,:110` and
  `packages/journal/src/lease-fixtures/prepare-runtime.ts:60,:91` both set
  `SCRATCH_ROOT` to `packages/journal/dist` and `mkdtemp` into it, transpiling `.ts`
  sources to `.js` there. Round 5 named only the crash family and put the exclusion in
  §3.1's prose rather than here, where the output set is actually defined — so an
  implementer building `walk.mjs` from §2 and this list would have shipped no exclusion
  at all. The glob covers both families and any third that follows the convention.

**Verdict:** `newest(inputs) > newest(outputs)`, strictly. Equal timestamps are clean —
the safe direction under second-granularity filesystems.

**Comparison coverage.** That verdict answers each comparison that RAN. Four of the
six can fail to run on a tree that is otherwise clean, so `checkBundleFreshness`,
`checkDeclarationCache`, `checkPluginAssets` and `checkShippedDeclarations` each return
`{ findings, coverage }` with `status ∈ "full" | "not-run"` — two values, since round 10
deleted `reduced` as unreachable (§2, §3.2) — and a reason
naming the absent artifact — or, when `unitState("packages/cli").state === "unbuilt"`
suppresses all four with nothing absent to name, the mandated `packages/cli unbuilt`
(§3.2, §4; round 10, C10-1) — and **§4 prints every non-`full` entry on BOTH
the PASS path and the findings path**. A comparison that did not run is never absorbed
into `clean`, exactly as `unbuilt` is never folded into `clean` (§3.3).
`checkUnitFreshness` and `checkOrphans` emit no coverage entry: theirs is the unit
table, already printed in the PASS line's units-compared/skipped slot, and printing
that fact twice is the failure mode on the other side of this rule.

### 3.1 Orphan outputs — requirement 2

For the 18 `kind: "tsc"` units **that `unitState` reports `compared`**, compare extension-stripped stems: `dist/X.js` must have `src/X.ts`. A `skipped` or `unbuilt` unit is never walked for stems — see §3's mapping. Measured today across all 18: **0** orphaned outputs and **0**
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

**So the output and stem sets exclude test-written scratch**: `dist/eo-*-fixture-*/**`
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

⚠️ **That argument covers COMPLETED bundles only, and the gap is stated rather than closed
(round 11).** Delete a `PLUGIN_ASSET_ENTRIES` source and do NOT rebuild: the shipped copy
under `packages/cli/dist/plugin` survives as an orphan by this section's own rule, and
this exemption is precisely why nothing here reports it. Residual §8(m), cleared by the
next completed `bundle:cli`, whose wipe at `bundle-cli.mjs:113-119` removes `dist/plugin`
entirely before re-copying — re-derived 2026-08-20 at `:113`, where `KEEP` is
`.tsbuildinfo` alone.

**The orphan comparison therefore emits no coverage entry of its own** (§3).
`packages/cli` is exempt by construction, and any other unit it could not check is
`skipped` or `unbuilt` — already named in the PASS line's skipped slot or as a finding.
An implementer who adds a FIFTH entry here prints the same fact twice; one who reads
§3's "six comparisons" and expects six coverage entries prints a blank. Four entries,
never six: `checkUnitFreshness` and `checkOrphans` are the two comparisons without one,
and `checkShippedDeclarations` is the fourth that has one (§2, §3.5).

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

**So the design requires EDITS TO THE BUILD PROGRAM, and §1's table is the
authoritative scope list — this sentence states no count of its own** (round 12, CF12-4:
round 10's C10-2 raised the count from three to five and it reached §1, §2, §3.3, §3.4,
§6 and §8 but not here, so this line still read TWO). The two THIS section is about are: `bundle-cli.mjs` **writes** `result.metafile` to
**`packages/cli/.bundle-meta/metafile.json`** — gitignored, and deliberately OUTSIDE
`dist` — **after the plugin-copy loop**, and **clears** it in the wipe step before
`build()` so the marker names the build it belongs to (§3.3, round 8's C8-2). Both
placements are pinned by §6; neither is visible from the tree.

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
    `bundle-provenance-missing` **and sets this comparison's coverage to `not-run`,
  reason `.bundle-meta/metafile.json absent`** — or, for a marker that EXISTS and does not
  `JSON.parse`, the same advisory kind with the second mandated reason
  **`.bundle-meta/metafile.json unreadable`**, since `absent` would be false (round 10,
  C10-3). `readMetafile` returns `undefined` in both cases and never throws: on that tree
  every artifact is complete, clause 1 passes, clause 2 passes, the unit is `compared`, and
  a throw reaches §4's internal-error row — `ERROR`, exit **2** from
  `check:all -- --strict` at member 0, halting the other 14 — while the only deletion this
  design ever prints, `rm -rf packages/cli/dist`, does NOT clear it, because `.bundle-meta/`
  is a SIBLING of `dist` (§3.3's opening sentence, C8-2's own fact) — after round 10 the only non-`full`
  status this design produces anywhere, the unreachable `reduced` having been deleted
  (§2, §3.2's Rule), so the "two states must not share one word" caution is moot. ⚠️ **NO precedence
  rule, because the two kinds are DISJOINT (round 9, C9-3/O9-2 and CF9-2, replacing
  round 8's):** the marker is not a member of §3.3's artifact set, so a `dist` with a
  gap is `unbuilt` whatever the marker says, and a `dist` with no gaps and no marker is
  `bundle-provenance-missing` on a unit that stays `compared` — a **finding**, never a
  skip, so a marker-less tree is never a bare PASS and requirement 3 is not muted while
  the marker is missing. Round 8 tied both kinds to one fact, which made `unbuilt` win
  in every reachable case and left this kind **unable to fire at all** — a kind
  hardcoded never to fire, the defect class this change set exists for.
  ⚠️ **And it fires unconditionally IN TIME.** Round 8 excepted "the first build after
  adoption", but **the check holds no state**, so that is not a predicate it can
  evaluate. Measured 2026-08-20: `ls -d packages/cli/.bundle-meta` → no such file, while
  `dist` holds all three entry outputs, `index.d.ts`, the six `PLUGIN_ASSET_ENTRIES` and
  five chunks — so this tree is ALREADY in that state, permanently indistinguishable
  from a build interrupted between `bundle-cli.mjs:178` and `:181`. The one surviving
  condition is structural, not temporal: when `packages/cli/dist` is itself absent the
  comparison is `skipped` (§3.3) and no provenance finding is emitted, so a fresh clone
  and CI's `meta-checks` job (`npm ci`, no build) stay silent. **The coverage entry is
  set in every not-run case**, including the ones the skip rule silences — silencing a
  finding must never silence the report that requirement 3's comparison did not run, or
  the operator reads `skipped`, runs the remedy, and never learns the bundle was never
  compared (standing rule 8). And no cli-scoped comparison runs on an `unbuilt`
  `packages/cli` (§3.3, §3.5), so one fact never prints two findings — **and all four then
  report coverage `not-run` with the reason `packages/cli unbuilt`** (round 10, C10-1).
  That is the one not-run case in which no artifact is absent, so no absence string can
  spell it, and suppression is a not-run case like every other: this bullet's rule governs
  it, and exempting it is exactly the silence the bullet exists to forbid. The suppression
  is evaluated BEFORE any comparison inspects its own comparand, so on a tree that is both
  `unbuilt` and missing a side, `packages/cli unbuilt` is the reason and the absence string
  is not — one spelling per state, as §4's verbatim rule requires. §6 row 26's end state
  suppresses four comparisons: requirement 3's, and `stale-declarations`, whose comparand
  touches no `packages/cli/dist` artifact at all and whose remedy costs ~5 minutes; the wipe-step
  clear plus the after-the-plugin-copy write mean a marker that IS present always names
  the bundle whose chunks are on disk, so `inlinedUnitsFromMetafile` is never fed a
  metafile for a bundle the tree no longer holds (C9-1, answered by the write ordering
  rather than by a marker-mtime rule). §3.3 owns the state rule; §6 row 10 exercises it;
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
notion of), taking the **minimum** across the whole matching set — all five hashed chunks
on this tree, not the first one found — so a partial refresh cannot mask a stale sibling.
`bundleAt` is always defined here: this comparison runs only on a `compared`
`packages/cli`, and §3.3's clause 1 requires a chunk to exist.

⚠️ **THERE IS NO FALLBACK TO THE THREE ENTRY OUTPUTS — round 10 deleted the one this rule
carried, as UNREACHABLE.** It read: fall back to `min(mtime)` over the three entry outputs
"only when no such artifact exists", setting this comparison's coverage to `reduced`,
reason `no esbuild chunk`, printed by §4. Measured against this design's own rules, that
state cannot occur. Round 9 made one file matching the chunk pattern a REQUIRED member of
§3.3's clause-1 artifact set — `cliArtifactGaps` (§2) lists "an esbuild-named chunk" first
— so a chunkless `packages/cli` is `unbuilt` with `missing: chunk-*.js`, and §3.2 above
states that **no cli-scoped comparison runs on an `unbuilt` `packages/cli`**. Both
predicates read the same `/-[A-Z0-9]{8}\.js$/` for PRESENCE, so they can never disagree
that a chunkless tree is `unbuilt` — round 12 (C11-6) made clause 1's chunk MEMBERSHIP
metafile-derived when a marker exists, which only NARROWS clause 1 — and
`checkBundleFreshness` never reaches the fallback to report anything. §6 row 16 mandated a
rendered line — `bundle freshness reduced (no esbuild chunk)`, still exit 0 — that no
correct implementation can print; what actually prints on that tree is §4's own worked
example, `unbuilt packages/cli — bundle:cli did not finish; missing: chunk-*.js`, exit
**1** under `--strict`.

⚠️ **Standing rule 8, at the site of the fix: do NOT close this the other way.** Dropping
the chunk from clause 1 so the fallback becomes reachable lowers the newest output mtime
until clause 2 passes, `bundleAt` falls back to round 4's tsc-writable proxy, and
`dist/bin.js` opens with `import … from "./chunk-FRJGAF5Y.js"` (verified 2026-08-20) — a
CLI that cannot start, reported PASS for the eighth time. That is verbatim round 6's
`CR6-3`, and §3.3's four-proxy table forbids it. So: **no chunk ⇒ `unbuilt`, never a
degraded comparison.** Report `stale-bundle` when any of

- newest `dist` compiler output across the 16 units,
- newest compiler input under `packages/cli/src` (§3 rules 1-2),
- `scripts/bundle-cli.mjs`

is newer than `bundleAt`. Including the build program here is precise rather than noisy:
of the three artifacts `bundle-cli.mjs` produces, this is the only one compared against
its PRODUCER — `dist/plugin/**` (§3.4) and `dist/index.d.ts` (§3.5) are compared against
their own sources, so editing the producer fires `stale-bundle` once, not three times.

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

| unit state                                     | verdict                                                                                                                                                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| no `dist/` at all                              | `skipped`                                                                                                                                                                                                  |
| `dist/` exists, no qualifying compiler outputs | **decided by the reason table below, never by this row** — `unbuilt` only when something proves a build ran (`.tsbuildinfo`); `skipped` when the directory is empty or holds only `eo-*-fixture-*` scratch |
| `dist/` exists with outputs                    | `compared`                                                                                                                                                                                                 |

⚠️ **AND FOR `packages/cli`, PRESENCE OF OUTPUTS IS NOT ENOUGH — round 4.** `tsc -b --clean` removes only tsc's own outputs; the **five hashed esbuild chunks survive**, measured with `tsc -b packages/cli --clean --dry`. So after `npm run build:clean` the unit holds fresh qualifying outputs, is not `unbuilt`, compares **clean**, and `bundleAt` reads a chunk that is still there — while `packages/cli/dist/bin.js`, the published `bin.crabgic` entry point, **does not exist**. The check would print PASS on a tree with no CLI.

⚠️ **AND THE ENTRY-OUTPUT RULE IS ITSELF A tsc-WRITABLE PROXY — the FOURTH appearance
of this failure (round 6).** The **`packages/cli/` subset** of
`tsc -b packages/cli --clean --dry` is exactly `dist/bin.js`, `dist/index.js`,
`dist/index.d.ts`, `dist/bin/supervisord.js` and `.tsbuildinfo` (round 12: the whole
command lists 4,781 across 17 packages), so `tsc -b` alone writes every entry output the
rule checks. Interrupt
`npm run build` during the **~5 minute** `bundle:types` step — Ctrl-C, CI timeout, 3am —
and the tree has all three entries present, no chunks, no `dist/plugin`, and a stale
`.bundle-meta/` that `rm -rf dist` did not touch. The check reports **PASS, exit 0**, on
a tree with no `crabgic` binary.

⚠️ **AND CLEARING THE MARKER IN THE WIPE STEP DOES NOT CLOSE THAT — the SEVENTH appearance
(round 9).** Round 8 answered this with a per-build clear inside `bundle-cli.mjs`. But
`build` is `tsc -b && npm run bundle:types && npm run bundle:cli` (`package.json:15`), so an
interrupt during the ~5-minute `bundle:types` step means **`bundle-cli.mjs` never executes
and the clear never fires**. Reached from this design's own printed remedy:
`rm -rf packages/cli/dist`, then `npm run build`, then Ctrl-C. Measured — the
**`packages/cli/` subset** of `tsc -b packages/cli --clean --dry` is `dist/bin.js`,
`dist/index.js`, `dist/index.d.ts`, `dist/bin/supervisord.js` and `.tsbuildinfo` (round
12: the whole command lists 4,781 across 17 packages), so the tree is left with
three entries present, no chunks, no `dist/plugin`, and the PREVIOUS build's marker beside
`dist`. Marker present, entries present, every comparison passing or skipping: **PASS,
exit 0.** Round 8's fix could not fire in the failure class it was written for, because the
tool that carries the fix is the tool that did not run.

**So the rule is a CONJUNCTION OF THREE CLAUSES, none of which replaces another —
`packages/cli` is `unbuilt` unless all three hold:**

1. **Completeness: every artifact `bundle-cli.mjs` writes EXISTS** — the esbuild chunk
   SET (rule below, round 12, C11-6), the three entry outputs (`:121`), `dist/index.d.ts`
      (`:153`), and all six `PLUGIN_ASSET_ENTRIES` under `dist/plugin` (`:178`) — read from
   the `export`ed const §1 adds, **never a literal duplicated into `walk.mjs`** (round 10,
   C10-2): a copy leaves the check at six after a seventh member is added to
   `bundle-cli.mjs:89`, that asset then ships in `dist/plugin` with its absence not a gap
   and its edits never firing `stale-plugin-assets`, and §6's fixtures are synthetic trees
   so no battery row can observe the drift. `packages/plugin/workflows/` already exists in
   the source tree today and is not a member (re-derived 2026-08-20), so that drift is one
   commit away. That set is
   the **§3.3 artifact set**; it is read off the tree, needs no history, and §4 prints the
   gaps. ⚠️ **The chunk member is a SET, not "at least one" — round 12, C11-6.** Measured
   import graph on this tree 2026-08-20: `dist/bin.js` imports `chunk-FRJGAF5Y.js`, which
   imports `chunk-DVV3SNQ3.js`, `chunk-I6JBP7DT.js` and `chunk-UF6GI6PE.js`. Delete any
   three of those four on an otherwise complete tree WITH a marker and the check reports
   **PASS, exit 0 even under `--strict`** — clause 1 passes because one file still matches
   the pattern, clause 3 passes because the three entries survive, and clause 2 passes
   because deleting an output LOWERS the newest output mtime, which is this design's own
   argument for retaining clause 3 — on a `packages/cli` whose `bin.crabgic` dies with
   `ERR_MODULE_NOT_FOUND`. **So when the marker exists, chunk membership is taken from the
   chunk-pattern-matching entries of `metafile.outputs`**: `result.metafile` already names
   every file esbuild emitted, it is the artifact §1 writes, and §3.2 already reads it — so
   clause 1 checks the exact chunk set the bundle produced, and `cliArtifactGaps` takes the
   metafile as an argument (§2). ⚠️ **This is a READ, never a MEMBERSHIP, and the
   distinction is what keeps CF9-2 closed:** a marker-less tree is still `compared` plus
   the advisory `bundle-provenance-missing`, never `unbuilt` for want of a marker, and the
   rule can only ever NARROW clause 1. When the marker is **ABSENT** the clause keeps "at
   least one file matching the pattern", and **the completeness of the chunk set is then
   unverifiable** — stated in §8(i) beside the other marker-absent costs, never hidden
   here. ⚠️ **Standing rule 8, at the site of the fix: do NOT close it by hardcoding
   five.** The chunk count is a function of the import graph and moves with any
   re-chunking under `splitting: true`, so a literal would be a rule keyed on today's tree
   — §3.3's own proxy lesson at a new site. Reachability is thin and said so: no repo
   script produces this state, and the realistic paths are an interrupted esbuild write
   phase or a manual or partial `rm`. ⚠️ **The metafile is deliberately NOT a member (round 9).** Keying `unbuilt` on its
   presence made every correctly built tree report `unbuilt` on day one — measured
   2026-08-20, this tree holds all three entry outputs, `dist/index.d.ts`, the six plugin
   entries and five chunks, and no `.bundle-meta/` at all — and it left
   `bundle-provenance-missing` with no reachable state. An absent marker on a complete
   `dist` is `bundle-provenance-missing`, advisory, unconditionally (§3.2), and never
   `unbuilt`; the two kinds are **disjoint by construction** and need no precedence rule.
2. **Freshness — evaluated ONLY when the marker exists, which is a stated residual and not
   a bound this clause may hide (§8(i), round 10 C10-4): if
   `packages/cli/.bundle-meta/metafile.json` exists,
   `mtime(marker) >=` the newest mtime over `packages/cli`'s §3 output set** — the same
   `isCompilerOutput` filter, so `.tsbuildinfo`, `dist/plugin/**`, `dist/index.d.ts` and
   `dist/eo-*-fixture-*/**` are all excluded (§3 defines that comparand; §7 row 1 is why it
   is filtered and not a raw `dist/**` walk). `>=`, not `>`: equal is clean, matching §3's
   Verdict convention, and it is what makes the microsecond-apart `:178` → `:181` pair safe
   where the filesystem is coarse (§8(e)). An absent marker is not a failure of this
   clause — that case is clause 1's ⚠️ above.
3. **Existence of the three entry outputs — round 4's clause, RETAINED and not replaced** —
   `dist/bin.js`, `dist/index.js`, `dist/bin/supervisord.js`. They are members of clause 1's
   set and are named again because clause 2 **cannot subsume them**: deleting an output
   LOWERS the newest output mtime, which makes the marker look MORE current, not less.

**The design still requires that write to be placed AFTER the plugin-copy loop** (beside
`bundle-cli.mjs:181`) and the clear to be placed BEFORE `build()`. Clause 2 is worth exactly
what those two placements are worth, so both are pinned by §6's mutant-proved source-order
assertion — the assertion that stood there until round 9 passed on a bundler with no write
at all. `:181` runs after every byte `bundle-cli.mjs` writes under `dist`, which is what
makes clause 2 TRUE after every completed bundle and FALSE after anything that writes into
`dist` later — **including the failure classes where `bundle-cli.mjs` never runs at all and
the wipe-step clear therefore cannot fire.**

⚠️ **Standing rule 8, stated at the site of the fix.** Dropping the marker from the `unbuilt`
predicate re-opens round 7's `CR-2` unless clause 1 keys on the artifacts written AFTER
esbuild: the `:147` throw on a fresh clone leaves five chunks and three entries with no
`dist/index.d.ts` (`:153`) and no `dist/plugin/**` (`:178`), and the marker was the only
oracle that saw it. Both are present on every completed build, including every pre-adoption
one — verified 2026-08-20 on this tree — so keying on them costs no day-one false positive.
Clause 1 is also what catches the class round 8's clear could not: an interrupt during the
~5-minute `bundle:types` step leaves three entries with no chunk, no declarations and no
plugin assets.

**Stated cost, measured rather than assumed.** A bare `npm run typecheck` (`tsc -b`) that
actually re-emits then flags `packages/cli` as `unbuilt` through clause 2. That is a TRUE
positive, not a tax: `tsc -b` overwrites `dist/bin.js` and `dist/index.d.ts` with per-file
output that still imports `@crabgic/*` — `bundle-cli.mjs:105-112` states it, and `ci.yml`'s
`packaging` job comments on the same fact as the cause of defect
`25-install-smoke-depends-on-local-dist-state`. Verified on this tree: `dist/bin.js` is
esbuild's, importing `./chunk-FRJGAF5Y.js`. A tree in that state cannot publish and cannot
run its own `bin.crabgic`. A `tsc -b` that emits NOTHING (touched-but-unchanged source)
moves only `dist/.tsbuildinfo`, which clause 2's comparand excludes, so it stays clean
(§7 row 1).

⚠️ **An esbuild-only chunk was round 6's answer and it is not sufficient, because esbuild
is step 2 of 5 (round 7).** Verified order in `bundle-cli.mjs`:

| line         | step                                                                                          | absent if it never runs                                              |
| ------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `:113-119`   | wipe `dist`, keeping only `.tsbuildinfo` — **plus the `.bundle-meta` clear this design adds** | —                                                                    |
| `:121`       | `build()` — writes 5 chunks + 3 entries                                                       | ← a chunk oracle is satisfied HERE                                   |
| `:147-151`   | throw if `.dts-cache/index.d.ts` is absent                                                    | `dist/index.d.ts`                                                    |
| `:153`       | `copyFile` the declarations                                                                   | `dist/index.d.ts`                                                    |
| `:177-179`   | `cp` the six `PLUGIN_ASSET_ENTRIES`                                                           | `dist/plugin/**`                                                     |
| after `:179` | **write the marker (this design, §1)** — the LAST artifact                                    | `.bundle-meta/metafile.json` ← **the oracle is satisfied only HERE** |

A fresh clone has no `.dts-cache` (gitignored, `npm ci` does not create it), so
`npm run bundle:cli` throws at `:147` — leaving five chunks, three entries, **no
declarations and no plugin assets**. Every comparison then passes or skips, and the check
reports **PASS** on a `packages/cli` that would publish incomplete.

**Proving the whole sequence ran, not just its second step, is what the oracle must do** —
and round 9 split WHICH oracle does it. The marker answers provenance; the artifacts the
sequence's last two steps write (`dist/index.d.ts` at `:153`, `dist/plugin/**` at `:178`)
answer completion, and they answer it statelessly. That is the sixth form of this rule,
and the reason the previous five failed splits in two: four proved something _upstream_ of
the thing that matters, and the fifth failed at both ends of history — it proved completion
only for trees whose history the check can see, and its PRESENCE proved that A build once
finished, never that THIS tree came out of one, because the clear that would have
invalidated it lives inside the tool the failing path never runs. That second half is why
the marker is now read for FRESHNESS (clause 2) rather than for presence. ⚠️ No form is
called final in this record again.

**Pre-checked before the next round, per the rule that a fix must be run rather than
reasoned about.** The pattern matches all five live artifacts — `chunk-DVV3SNQ3.js`,
`chunk-FRJGAF5Y.js`, `chunk-I6JBP7DT.js`, `chunk-UF6GI6PE.js` and
`run-dispatcher-POLZZ2DH.js`, i.e. **both** naming families esbuild produces under
`splitting: true` — and matches **none** of the three tsc entry outputs.

⚠️ **Its one bound, stated rather than left implicit.** `tsc` names outputs after their
sources, so a source called `x-ABCD1234.ts` WOULD emit a matching `.js` and satisfy the
rule without esbuild running. Measured: **zero** tracked `.ts` files match
`-[A-Z0-9]{8}\.ts$`, and no `dist` outside `packages/cli` holds a matching `.js`. The
collision is possible in principle and absent in fact; the honest form of the rule is
"an artifact esbuild produces and no source in this repository would name". The entry-output condition
is additional, never the whole one.

The five superseded proxies, in order, are the record of how this was learned: directory
existence → output presence → entry-output presence → an esbuild-only chunk → the marker's
presence → **the artifacts the bundle's last two steps leave in `dist`, plus the marker's
FRESHNESS against the outputs it must dominate**.
Each of the first three is writable by `tsc -b` alone; the fourth proves only that esbuild
ran, which is step 2 of 5; and the fifth failed twice over — it proved all five steps and
nothing weaker, so a tree built before this check existed read as `unbuilt` (round 9,
CF9-2), and it survived a build that never happened, because the clear that would have
invalidated it runs only when `bundle-cli.mjs` runs (round 9, C9-1). The sixth form is a
conjunction of the two: the artifacts answer completeness statelessly, and the marker —
when there is one — answers freshness.

**Clause 3 above — the three entry outputs must EXIST — is round 4's rule, RETAINED and not replaced** — `dist/bin.js`, `dist/index.js`, `dist/bin/supervisord.js`, which §3.2 already names for `bundleAt`. Any one missing is `unbuilt`, whatever the chunks OR the marker say, and §4 names the gaps. The membership it belongs to is clause 1's **§3.3 artifact set** — one esbuild-named chunk and these three entries (`:121`), `dist/index.d.ts` (`:153`), the six `PLUGIN_ASSET_ENTRIES` under `dist/plugin` (`:178`) — of which `.bundle-meta/metafile.json` is deliberately not a member, which is what makes `unbuilt` and `bundle-provenance-missing` disjoint. ⚠️ **Freshness cannot subsume this clause (standing rule 8, on this fix):** deleting an output LOWERS the newest output mtime, which makes the marker look MORE current, not less — so `rm dist/bin.js` on an otherwise complete tree PASSES clause 2 and is caught only here. Dropping it would re-open `C-R4-1` and make §6 row 11 vacuous. This is the third appearance of one failure — a verdict of `clean` on a tree with no usable build output — and each time it survived because the previous fix keyed on a proxy (directory existence, then output presence) rather than on the artifact anyone actually runs.

`unbuilt` is never folded into `clean`.

⚠️ **`unbuilt` is decided by WHY `dist` is empty, not by how many entries it has
(round 7 — round 6's count-based rule reverted round 3's fix).** Counting non-excluded
entries made an empty `dist` report **clean**: `tsc -b --clean` deletes files and leaves
the directory, so after `npm run build:clean` all 19 units hold zero entries, zero
non-excluded entries, and compare clean against `undefined`. That is verbatim the state
round 3 filed `CR-2` for. The rule is therefore:

| what `dist` holds                          | verdict                                                                | why                                                                                                                                                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| nothing at all                             | **`skipped`**                                                          | indistinguishable — see below                                                                                                                                                                       |
| only `.tsbuildinfo`                        | `unbuilt`                                                              | `.tsbuildinfo` is positive proof the unit WAS built                                                                                                                                                 |
| only `eo-*-fixture-*` scratch              | `skipped`                                                              | a test `mkdir`ed it; nothing was ever built here                                                                                                                                                    |
| any real output, unit ≠ `packages/cli`     | compared                                                               |                                                                                                                                                                                                     |
| any real output, unit **= `packages/cli`** | `compared` only if clauses 1-3 above all hold; otherwise **`unbuilt`** | round 9: 'any real output → compared' is the row that let a `tsc -b`-only tree compare clean. The three entry outputs ARE real output, and they are exactly what an interrupted build leaves behind |

For `packages/cli` only, one further step **inside** the `compared` branch — never before
it, so an absent or empty `dist` is still `skipped` and the fresh-clone and `build:clean`
cases above are untouched:

| cli `dist`, given `compared`                              | verdict                                         | why                                                           |
| --------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------- |
| every tsc-written member absent — the three entry outputs, `dist/index.d.ts` AND `.tsbuildinfo` — while ≥1 esbuild chunk survives | `unbuilt`, gaps named, reason `tsc -b --clean removed the compiler outputs from a completed bundle` | the `--clean` SIGNATURE, and it is not `bundle:cli` failing (round 12, C11-3). ⚠️ **Standing rule 8, at the site of this fix:** keying on `.tsbuildinfo` absence ALONE would misfire on a standalone `npm run bundle:cli` against a fresh clone, which also has none — so the predicate is the conjunction. No `bundle-cli.mjs` failure class produces it: the wipe at `:113-119` removes the chunks FIRST, and `build()` at `:121` writes the entries before anything downstream can throw, so a surviving chunk with no entries can only be `tsc -b --clean` |
| any other member of the §3.3 artifact set missing         | `unbuilt`, gaps named, reason `bundle:cli did not finish` | a step of `bundle-cli.mjs` did not run                        |
| every member present, `.bundle-meta/metafile.json` absent | `compared` **plus** `bundle-provenance-missing` | the bundle is fine, the check is degraded — §3.2, and day one |
| every member present, marker present                      | `compared`, bundle comparison runs              | the whole sequence ran and named its own inputs               |

⚠️ **The empty case is `skipped`, not `unbuilt`, and that is a residual limit rather than a preference (round 8).** Round 7 made it `unbuilt` on the reasoning "it was built once and the outputs are gone". But both journal fixture families call `mkdir(SCRATCH_ROOT, { recursive: true })` and then `rm(dir, …)` — **the mkdtemp directory, not the root** (`crash-fixtures/prepare-runtime.ts:131`, `lease-fixtures/prepare-runtime.ts:110`). So on a fresh clone one `npm test` leaves `packages/journal/dist` **empty**, and the next `pretest` would report `unbuilt` on a tree nobody has ever built — CR6-2, re-opened by the fix that replaced CR6-2's fix.

**Nothing at the unit level distinguishes the two states**: `tsc -b --clean` deletes `.tsbuildinfo` too, so a `--clean`ed unit and a never-built one are byte-identical. `build:clean` is therefore **accepted as indistinguishable at unit granularity** and stated here rather than papered over. It is not undetectable overall — the **`packages/cli/` SUBSET** of `npx tsc -b packages/cli --clean --dry` is exactly five deletions (`dist/bin.js`, `dist/index.js`, `dist/index.d.ts`, `dist/bin/supervisord.js`, `.tsbuildinfo`; re-measured 2026-08-20, nothing under `.bundle-meta/`). ⚠️ **The WHOLE command lists 4,781 deletions across 17 packages (round 12, C11-2), because `--clean` cleans the project's entire REFERENCE GRAPH, not the project.** Quoting the `grep 'packages/cli/'` subset as the command's output was standing rule 1 — a search narrower than its claim — used as the bound for a residual, and the root `build:clean` (`tsc -b --clean`, `package.json:17`) is wider still: `npx tsc -b --clean --dry` lists **5,051** deletions across all **19** units, including 19 `.tsbuildinfo`. So a `--clean`ed tree loses its entry outputs and still reports `unbuilt packages/cli` — **through clauses 1 AND 3**: `dist/index.d.ts` (`:153`) is one of that five and is a clause-1 member, so clause 1 fires independently of clause 3 and the gap list §4 prints is `dist/bin.js, dist/index.js, dist/bin/supervisord.js, dist/index.d.ts`. ⚠️ **Clause 2 does NOT catch this state (round 9):** `build:clean` is `tsc -b --clean` and runs no bundle, so the wipe-step clear never fires; the five hashed chunks and `dist/plugin/**` survive as well, and having been written before the marker they are all OLDER than it, so the freshness comparison passes. ⚠️ **What clause 3 buys is therefore stated rather than overstated (round 12, C11-2).** The three entry outputs are clause-1 MEMBERS, so clause 1 alone already catches every state clause 3 does, `build:clean` included — "the second reason clause 3 can never be dropped" rested on the "through nothing else" claim corrected above. Clause 3 is retained as redundancy on purpose: an explicit guard against clause 2, which can never subsume it (a deletion LOWERS the newest output mtime and makes the marker look MORE current), and against a later edit dropping the entries from clause 1's set — the class of edit standing rule 8 keeps catching. It is not a second detector, and it is not deleted: dropping it is one edit away from re-opening `C-R4-1`. The marker is NOT what carries this: `--clean` never touches it, so it survives the very state it was cited for.

**The distinguishing fact is the REASON the directory is empty, and the count cannot
carry it** — a never-built tree and a `--clean`ed tree both hold zero entries.

⚠️ **The original round-6 wording — "requires at least one NON-EXCLUDED entry" — is what
reverted the earlier fix.** Both fixture families call
`mkdir(SCRATCH_ROOT, { recursive: true })` and their `cleanup()` removes only the
mkdtemp directory — so `packages/journal/dist` **persists, empty**, after the first
`npm test` on a tree that was never built. With every remaining entry excluded as
scratch, the next `pretest` would report `unbuilt packages/journal` and print
`rm -rf packages/journal/dist`. The round-5 fix would have converted a silent wrong
answer into a loud one. Round 2's exclusion of `.tsbuildinfo` makes this
state reachable a second way: `bundle-cli.mjs:113-119` deletes outputs while keeping
`.tsbuildinfo`, and a following `tsc -b` re-emits nothing.

⚠️ **SKIP RULE — ALL FOUR cli-SCOPED COMPARISONS, extended again in round 9.**
`checkPluginAssets` was outside it: on a fresh clone, or after the design's own
`rm -rf packages/cli/dist`, `newestUnder("packages/cli/dist/plugin")` is `undefined`, so
it would throw or emit `stale-plugin-assets` against a tree that was never built — round
1's C-1 recurring on the comparison round 1's own fix introduced. `checkShippedDeclarations`
joined them in round 9 — same failure, second excluded artifact — and its asymmetric case is
the sharp one: `rm -rf packages/cli/dist` deletes the copy and LEAVES the cache, so a rule
keyed on 'the cache is newer' would fire on a tree with no CLI. All four report `skipped`
when either side of their comparison is absent — and for all four those sides are artifacts
under `packages/cli/dist` and `packages/cli/.dts-cache`, **never**
`packages/cli/.bundle-meta/metafile.json`. With `dist` present and the marker absent,
`checkBundleFreshness` reports `bundle-provenance-missing` (§3.2, round 9); reading "either
side" as the metafile there would mute the only signal a missing marker now has, and make
the kind vacuous. And `skipped` here means a coverage entry of `not-run` naming that side
(§3), **printed** by §4 — never an early `return []`. ⚠️ **Absence is not the only
not-run cause (round 10, C10-1).** All four are ALSO suppressed when
`unitState("packages/cli").state === "unbuilt"` (§3.2), where every artifact is present
and nothing can be named absent — so those four entries carry the second mandated reason,
`packages/cli unbuilt`, verbatim (§4's list), and that suppression is evaluated before any
comparison inspects its own comparand, so it is the reason even when a side is also
absent. This section's rule is therefore "the coverage entry is set whenever the
comparison did not run", never "whenever a side is absent"; the narrower reading prints no
coverage line on §6 row 26's or §7's `npm run typecheck` tree, which §4's recipe step 5
then reads as "all six ran". A comparison that quietly declines to
run and says nothing is the founding silence in a smaller box.

⚠️ **SKIP RULE, EXTENDED IN ROUND 1.** §3's skip rule was per-unit and covered only
`checkUnitFreshness`; `checkBundleFreshness` and `checkDeclarationCache` stat their
targets unconditionally. On a fresh clone neither exists — `dist` is unbuilt and
`.dts-cache` is gitignored, so `npm ci` does not create it — and the check would throw.
**This design's own documented remedy reaches that state**: `rm -rf packages/cli/dist`,
then `npm test`, and the operator cannot run the suite at all (see §4's internal-error
row). Both comparisons now report `skipped` when their target is absent, exactly as a
unit with no `dist` does — their target being `packages/cli/dist` for the bundle comparison
and `packages/cli/.dts-cache/index.d.ts` for the declaration one, **never**
`packages/cli/.bundle-meta/metafile.json`: an absent OR unreadable metafile on a present, gap-free
`packages/cli/dist` is a finding (`bundle-provenance-missing`, §3.2, round 9; round 10,
C10-3), not a skip and not a throw,
or the kind can never fire — and with the same consequence: coverage `not-run`, reason
`packages/cli/.dts-cache/index.d.ts absent` or `packages/cli/dist absent`, printed by
§4. "Exactly as a unit with no `dist` does" only becomes true once comparisons are
named in the output the way skipped units already are (§4's **The `PASS` line NAMES SKIPPED UNITS**). Report
`stale-declarations` when the newest of

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
`stale-bundle` row gives. Report `stale-plugin-assets` when the newest mtime **over the six
`PLUGIN_ASSET_ENTRIES`** exceeds the newest beneath `packages/cli/dist/plugin`.
⚠️ **The source side is `newestOfEntries(PLUGIN_ASSET_ENTRIES)` (§2), never
`newestUnder` (round 10):** the const is IMPORTED from `scripts/bundle-cli.mjs`, which
only §1's fourth and fifth edits make possible — `export`ing `:89` and putting
`await main()` behind the entry-point guard — because today `:89` is a bare `const` and the
only import that reaches it executes the bundler and rebuilds `packages/cli/dist`
(round 10, C10-2). `bundle-cli.mjs:89` lists six entries and
`packages/plugin/.mcp.json` is a **regular file** while the other five are directories,
so a directory-typed walk throws `ENOTDIR` on a fully built, clean tree — §4's
internal-error row — `WARN` and exit **0** by default, `ERROR` and exit **2** under
`--strict`, both printed by `formatInternalError` from `check-stale-dist.mjs`'s try/catch
(§1, §2) and never propagated as a bare node stack. Re-derived 2026-08-20 on this machine
(node v24.18.0): `readdirSync` on that member throws
`ENOTDIR: not a directory, scandir 'packages/plugin/.mcp.json'`. The
dist side is safe with a plain recursive walk, because `.mcp.json` arrives under
`dist/plugin` as a leaf; only the SOURCE side has mixed-typed roots.

**Coverage:** `full` when the **mtime comparison** ran; `not-run` **whenever it did not
run, for either reason** (round 10, C10-1) — §3.3's skip rule firing, reason naming the
absent target (`packages/cli/dist` or `packages/cli/dist/plugin`); or `packages/cli` being
`unbuilt` (§3.2), reason `packages/cli unbuilt`, where nothing is absent to name — §4
prints it either way. The status is keyed on that comparison and not
on a six-entry presence check, which this comparison no longer performs — presence is
§3.3's clause 1 (round 10). `full` and `not-run` are the only two statuses anywhere (§2):
round 10 deleted `reduced` as unreachable, so "there is no `reduced` state HERE" no longer
distinguishes this comparison from any other, and every comparison either ran or did not.

⚠️ This paragraph carried a trailing `Remedy: npm run bundle:cli` for three rounds after
that command was banned four lines above it, and it survived two dispositions claiming
otherwise — the second time because a verification grep was single-line and the sentence
wrapped. §4's table is the only remedy source.

⚠️ **And mtime alone cannot see a PARTIAL copy (round 7).** `bundle-cli.mjs:177-179`
copies the six `PLUGIN_ASSET_ENTRIES` in a loop; interrupt it after `agents/` and before
`skills/` and `dist/plugin` exists with a copy-time mtime, so `newest(sources)` is not
greater and the comparison reports clean while the shipped CLI has no skills. So the
comparison does **NOT** check the six entries for presence: §3.3's clause 1 owns entry
presence and §3.4 owns **mtime alone** (round 10). Clause 1 is stateless and
marker-independent by construction — §2's `cliArtifactGaps` comment says "The METAFILE IS
NOT A MEMBER" — so `rm -rf packages/cli/dist/plugin/skills` with the marker absent yields
`unbuilt` with the gaps named, exactly as §6 row 20 asserts, and `checkPluginAssets` never
runs at all (§3.2). ⚠️ **The "equivalently, subsumed by the completion marker" reading was
REMOVED in round 9.** A partial copy does mean `bundle-cli.mjs` never reached the marker
write that follows the copy loop (§1's
`writeFile(join(CLI_ROOT, ".bundle-meta", "metafile.json")…` fragment, beside `:181`) —
an ordering §6 now proves rather than assumes — but an absent marker is now an
**advisory** `bundle-provenance-missing` that does not fail `--strict` (§4), never
`unbuilt`. ⚠️ **And the "ONLY thing standing between round 7's CR-3 and a CLI shipped with
no skills" sentence that closed this paragraph was DELETED in round 10.** It was refuted
two sentences above itself: an implementer taking it at its word and not gating on
`unitState` makes one fact print two findings, which §3.2 promises never happens; one
gating it correctly ships a clause with no reachable state and no battery row — the
"hardcoded never to fire" class §3.2 names as the defect class this change set exists for.
Round 9's fix vacated the very clause it simultaneously promoted to load-bearing (standing
rule 8, on that round's own fix). Round 7's CR-3 is answered by clause 1 on every tree,
marker or no marker, and that is what makes clause 1 and not this comparison the
load-bearing one.

This and §3.5 are the two places the design deliberately compares a copied artifact
rather than compiler output. It is safe HERE precisely because the comparison runs the
other way round: the asset copy refreshes the OUTPUT side, so it can only ever mask
staleness in the direction blind spot 1 names — never manufacture a false positive.
⚠️ **One masked case is NAMED rather than left implicit: a DELETED source (round 11).**
Removing a file under a `PLUGIN_ASSET_ENTRIES` directory raises nothing on the source
side, so this comparison stays clean while the shipped copy keeps a file no source
produces; §3.3's clause 1 does not catch it either, checking the six entries for top-level
presence and not their contents. And `check:marketplace-pin` digests the SOURCE, so it
stays green too — although `bundle-cli.mjs:171-173` records that the copy is kept
byte-identical to the source *precisely* so the trust pin's digest over the installed copy
matches. Residual §8(m), bounded by the wipe at `bundle-cli.mjs:113-119`.
§3.5's copy is keyed on bytes rather than mtime instead, for the reason stated there.

### 3.5 Shipped declarations — the hole excluding `dist/index.d.ts` opened (round 9)

Excluding `dist/index.d.ts` from `packages/cli`'s output set is what keeps requirement 1
honest: `bundle-cli.mjs:153` `copyFile`s it from `.dts-cache/` on every bundle, and
`copyFile` does not preserve timestamps (measured), so leaving it in makes `packages/cli`
look fresh after any bundle whether or not `tsc` recompiled.

⚠️ **But nothing then covered it, and §3 pointed at a section that never read it.** §3's
bullet said "handled as its own artifact in §3.3", while §3.3 compares sources against
`.dts-cache/index.d.ts` **only**. No comparison in this design read
`packages/cli/dist/index.d.ts` — the published `types` entry
(`packages/cli/package.json` `exports["."].types`, inside `files`). CF-2's shape exactly,
at the second excluded artifact, eight rounds later.

**The counterexample is §4's own recipe.** Run step 3 (`npm run bundle:types -- --force`)
and stop — step 4 exists precisely because "step 3 alone leaves the pre-force copy
shipped". `bundle-types.mjs` writes `packages/cli/.dts-cache/index.d.ts` and nothing else
(`:39`, `:87`, `:92`), so the cache is fresh, `stale-declarations` clears, the completion
marker and `bundleAt` are untouched, every unit compares clean — **PASS, exit 0**, with
the published declarations stale.

**Rule (sixth comparison), `checkShippedDeclarations(cwd)`:** report
`stale-shipped-declarations` when `packages/cli/.dts-cache/index.d.ts` and
`packages/cli/dist/index.d.ts` both exist and their **bytes differ** — size first, then
content. §4's table is the only remedy source.

⚠️ **mtime is the wrong predicate here, and this repository already shipped the bug that
proves it.** `bundle-types.mjs:32-38` records why the cache is not written straight into
`dist`: `tsc -b` emits its own `dist/index.d.ts` — "a barrel of `export * from
\"./errors.js\"` relative re-exports" — which "would clobber the bundled file AND refresh
its mtime", and `check-install-smoke.mjs` caught the result as `Cannot find module
'./exit-codes.js'` from an installed consumer. An mtime oracle here would therefore be
`tsc -b`-writable: the fifth appearance of §3.3's four-proxy lesson, and it would have
been introduced by the fix for the sixth. ⚠️ **That state is the ORIGIN of the byte rule,
not a state §3.5 can observe (round 10):** the same `tsc -b` emit also writes
`dist/index.js` and `dist/index.d.ts.map` — `tsconfig.base.json:22-23` sets `declaration`
and `declarationMap`, and no config sets `emitDeclarationOnly` or `noEmit` for
`packages/cli` (measured 2026-08-20) — and §3's filtered output set INCLUDES both, so
clause 2 makes `packages/cli` `unbuilt` and this comparison does not run; §7 row 4 is
row 2's scenario. What keys the rule on bytes on a tree that is actually `compared` is the
pair §3.5 still has to separate: the recipe's **step-3-only** state (`bundle:types
--force` then stop, which writes only `.dts-cache/index.d.ts` and moves no output mtime),
where the cache is newer and the shipped copy is stale, and a `--force` regeneration
producing IDENTICAL bytes with a newer cache mtime, which §6's false-negative battery
requires to stay clean. An mtime disjunct passes the first and FAILS the second. Byte equality is not writable by any compiler
and is exact in both directions — `copyFile` makes the two files identical by
construction (measured 2026-08-20: `cmp` reports identical, **230,199** bytes each), so
equal bytes means the shipped file IS the current cache, and unequal bytes means it is
not.

**Cost, measured rather than assumed:** six warm runs of `readFileSync` on both files
plus `Buffer.equals` took **0.30-1.43 ms** (spread reported per standing rule 3) against
the walk's 0.23-0.24 s. In the `tsc`-barrel case the sizes differ by three orders of
magnitude, so the size pre-filter decides it without a read.

**This is not the content oracle §7 row 1 rejects.** That rejection is about needing a
_persisted baseline_ — a twentieth build artifact with the same staleness problem. Here
the baseline already exists and is already checked: `.dts-cache/index.d.ts` is §3.3's
subject. The two comparisons chain — sources → cache (§3.3, mtime) → shipped copy (§3.5,
bytes) — and neither introduces a new artifact.

**Skip, coverage and precedence.** Absent EITHER file → `skipped`; never a throw, never a
finding — and, as §3.3's **SKIP RULE — ALL FOUR cli-SCOPED COMPARISONS** requires of all four, never an early
`return []`. `skipped` here IS a coverage entry: this comparison returns
`{ findings, coverage }` (§2), `full` when both files existed and were compared, and
otherwise `shipped-declarations` at `not-run` with the reason naming the absent side
verbatim — `packages/cli/dist/index.d.ts absent` or
`packages/cli/.dts-cache/index.d.ts absent` — or, when BOTH files exist and this
comparison is nevertheless suppressed because `packages/cli` is `unbuilt` (§3.2), the
reason `packages/cli unbuilt` (round 10, C10-1) — which §4's coverage line prints on both
paths. ⚠️ **The asymmetric case is why this is load-bearing rather than symmetry**:
`rm -rf packages/cli/dist`, step 1 of §4's own recipe, deletes the shipped copy and leaves
the cache beside `dist` (measured — `.dts-cache` is a SIBLING, §3.3's opening sentence),
so the declaration-cache comparison still runs `full` while this one skips. Without an
entry, the operator reads a coverage line naming the comparisons that did not run, applies
§4's recipe step 5 rule — "a comparison the coverage line reported `not run` was **not
performed**" — and concludes the published `types` entry was compared and is clean. It was
never compared.
`rm -rf packages/cli/dist` — this design's own remedy — leaves the cache and deletes the
copy, and a fresh clone has neither (`.gitignore:47`). And the comparison runs only on a
`packages/cli` whose state is `compared`: `unbuilt` and `skipped` win, for §3.3's stated
reason — they name the tree's actual state, while a declarations finding would send an
operator to `bundle:cli` when the whole bundle is missing.

**No day-one migration**, unlike round 8's marker: both files exist on a built tree today
and are byte-identical (measured), so the comparison is clean on adoption.

## 4. Output and exit code

Human text on stdout by default; `--json` for machine use (the `repo-census.mjs`
convention). One line per finding naming the unit, the newest input, the older output
and the delta.

⚠️ **AND ONE COVERAGE LINE, ON BOTH PATHS — for nine rounds the check computed a
degraded coverage and never printed it (round 9, O9-1).** `comparisonsSkipped` appeared
exactly once in this design, in §2's signature; "reduced-confidence" appeared three
times as a property of a result with no line shape anywhere. So on a tree whose bundle
provenance is missing the operator read `PASS — 19 units compared, 0 skipped` while
requirement 3's comparison — one of the six — had not run at all. ⚠️ **The example this
paragraph carried until round 10 was itself UNREACHABLE**, which is why it is replaced
rather than reworded: "no esbuild chunk and no `packages/cli/dist/plugin`" is TWO gaps in
§3.3's clause-1 artifact set, so that tree is `unbuilt packages/cli` — a finding, exit 1
under `--strict` — and never the `PASS` the sentence needs; and `reduced` is a status no
run can produce (§2, §3.2). The state below is reachable because neither the marker nor
the cache is a member of the artifact set. Rendered against THIS working copy (measured
2026-08-20: `ls -d packages/cli/.bundle-meta` → no such file, while `dist` holds four
`chunk-*.js` plus `run-dispatcher-POLZZ2DH.js`, the three entry outputs, `index.d.ts` and
the six plugin entries), the line is:

```
check-stale-dist: ⚠️ coverage: bundle freshness not run (.bundle-meta/metafile.json absent)
```

- it prints **after the PASS line and after the findings list** — both paths, never one;
- it lists only entries whose status is not `full`, so a fully covered run prints nothing extra;
- `--json` carries `coverage` verbatim from `checkStaleDist`'s return, so the machine path cannot drift from the text path;
- it carries **no remedy**: the table below is keyed by finding KIND and a coverage entry is not a finding. It names what the check could not see.
- **the renderer is stated here, once, because the design implied three incompatible ones (round 10).** Each entry renders as `${comparison.replace(/-/g, " ")} ${status.replace("-", " ")} (${reason})`; entries are joined by `·` in §2's union order (`bundle-freshness`, `declaration-cache`, `plugin-assets`, `shipped-declarations`), so the line is deterministic and a row may assert a whole line rather than a fragment; the whole is preceded by this section's `check-stale-dist: ` prefix and the `⚠️ coverage: ` label. So `declaration-cache` + `not-run` renders **`declaration cache not run (…)`** — never `declarations`, which no rule in this design produces, and never the raw `declaration-cache: not-run (…)`, which is what `result.coverage` HOLDS and what §6's direct-call rows 12 and 23 assert. And the `reason` is the one its own section mandates, **verbatim**: `.bundle-meta/metafile.json absent` or `packages/cli/dist absent` (§3.2, §3.3); `packages/cli/.dts-cache/index.d.ts absent` (§3.3); `packages/cli/dist` or `packages/cli/dist/plugin` absent (§3.4); `packages/cli/dist/index.d.ts absent` or `packages/cli/.dts-cache/index.d.ts absent` (§3.5); `packages/cli unbuilt`, carried by ALL FOUR entries whenever `unitState("packages/cli").state === "unbuilt"` suppresses them (§3.2, §3.3, §3.4, §3.5; round 10, C10-1) — the one not-run case in which no artifact is absent, and therefore the one no absence string can spell, and the one that WINS when a side happens to be absent too, because the suppression is evaluated first; and `.bundle-meta/metafile.json unreadable`, for a marker that exists and does not parse (§3.2; round 10, C10-3). A battery row asserting any other spelling fails an implementation that follows the sections; an implementation that satisfies such a row special-cases one label and leaves a mandated reason unused.

The shape is `check-citation-runs.mjs:290`'s: a PASS line that names its own unresolved
fraction (`, N unresolvable (tolerated)`) rather than printing a green line it has not
earned (`:269-273`).

⚠️ **AND THE FIRST THING THAT LINE PRINTS IS ITS OWN NAME — which this design copied none
of until round 10.** `check-citation-runs.mjs:290` reads `check-citation-runs: PASS — …`,
and the convention is universal here, not incidental: measured 2026-08-20, every one of
`check:all`'s 14 members prefixes its top-level output lines with its own script name —
`check-workspace-count:`, `check-package-graph-acyclic:`, `check-repo-hygiene:`,
`check-release-notes:`, `check-marketplace-pin-digest:`, `check-support-window-freshness:`,
`engine-pin-lint:` (`check-engine-pin.mjs`), `check-criteria-closeout:`,
`generate-criteria-baseline:` (`check:criteria-baseline`), `check-citation-runs:`,
`check-citation-content:`, `check-claim-scope:`, `check-published-tarball:`,
`check-install-smoke:` — **zero exceptions**. Standing rule 7 at the site of this design's
own cited precedent, and the third time this change set has copied part of a shape
(`CF8-1`, `CF9-4`).

**RULE: every top-level line this check writes to stdout or stderr begins
`check-stale-dist: `** — the `PASS` line, every finding line, every grouped `×N` line, the
**the ordered REMEDY PLAN's first line** (its steps are indented
continuation lines, which the sentence below exempts), the
coverage line, and the `WARN`/`ERROR` internal-error lines. Their ORDER is fixed here too,
because "which line lands where" is the other half of a rule an implementer can satisfy and
still print an unreadable page: the `PASS` line when there is one, then the grouped finding
lines, then the remedy plan, then the coverage line. The shapes given in the rest
of this section are the text that FOLLOWS the prefix. Continuation lines indented under a
prefixed line do not repeat it (`check-marketplace-pin-digest.mjs:377-379`'s shape).
`--json` is unaffected — and it is unaffected on EVERY path, the internal-error one included: `formatInternalError` takes `json` and emits the object stated with that row below, never a prefixed human line (round 12, C11-5).

Without it the check is unattributable in both wirings §5 targets. Under `check:all` it is
member 0 of 15, `&&`-chained into one stream beside 14 prefixed neighbours (measured: 14
members today, `check:tarball` at 12, `check:install-smoke` at 13), so its lines arrive
orphaned and cannot be grepped by name — a thing every other member supports. Under
`pretest` it is worse by §5.1's own measurement: the line lands at line **5 of 204**, ~199
lines above vitest's summary, and §5.1 records that the coverage line is the ONLY notice a
degraded run ever gives — one line, once. An unattributed line in 204 lines of scrollback
is the founding incident's own failure mode: two hours of misdiagnosis by someone reading
the bottom of the output.

⚠️ **FOUR kinds have no delta to print, and the line shape predates them.**
`Finding = { kind, unit, newerInput, olderOutput, deltaMs, remedy }` assumes a
comparison. `unbuilt`'s finding IS the absence of an output, and
`bundle-provenance-missing` has neither side; `orphan-output` has no newer input by
definition (round 7); and `stale-shipped-declarations` is byte-keyed, so its line prints
`(<a> vs <b> bytes)` and no mtime delta at all (round 9). All four are NAMED here rather
than counted, because §2 carried the count and it drifted (round 11). Printing the common
shape gives `unbuilt <unit> undefined undefined NaN`. ⚠️ **The example carried here until
round 12 named the wrong unit, the wrong count and the wrong state (C11-3).** Re-derived
2026-08-20: `tsc -b --clean` deletes `.tsbuildinfo` in EVERY project (`npx tsc -b --clean
--dry` at the root — which is what `build:clean` runs — lists 5,051 deletions across all
19 units, including 19 `*/dist/.tsbuildinfo`), so §3.3's reason table gives those units an
empty `dist` and `skipped`. After `npm run build:clean` this design therefore produces
**18 `skipped` units and exactly ONE `unbuilt` finding — `packages/cli`**, whose esbuild
chunks and `dist/plugin/**` survive; **zero** `unbuilt packages/contracts` findings occur
in that state, and the count and unit were carried forward from the pre-round-8 rule. The
state that DOES yield one finding per unit is §6 row 9's — outputs deleted, `.tsbuildinfo`
kept, which is exactly what `bundle-cli.mjs:113-119` does — applied to N units. The
argument is unaffected either way: one such line is enough. So those three fields are
optional and each kind states its own line:

- `unbuilt <unit> — <reason>`, printing `unitState()`'s reason verbatim. Today the only generic reason is `dist/ holds only .tsbuildinfo — outputs were deleted without it`. The sentence is not hard-coded here: the rule behind it changed in four of nine rounds and the line was twice left asserting what the previous rule meant (round 7's OP-2).
- `stale-shipped-declarations packages/cli — dist/index.d.ts does not match
.dts-cache/index.d.ts (<a> vs <b> bytes); the cached declarations were never copied in`
- `bundle-provenance-missing packages/cli — .bundle-meta/metafile.json absent; the bundle comparison did not run (advisory: does not fail --strict)`, and its twin for the unreadable case, `bundle-provenance-missing packages/cli — .bundle-meta/metafile.json unreadable; the bundle comparison did not run (advisory: does not fail --strict)` (round 10, C10-3: `absent` is false there, and this line is the only place the operator learns that `npm run build` — never `rm -rf packages/cli/dist`, which leaves the sibling `.bundle-meta/` untouched — is what clears it) — **round 9**: this is the
  permanent, stateless reading. The check holds no state, so it cannot say "until the first
  build after adoption"; it prints the same line on a pre-adoption tree and on a build
  interrupted between `bundle-cli.mjs:178` and `:181`, because those two trees are identical
  on disk. It never implies `unbuilt`, and its remedy never deletes `dist`. — the FINDING form, which fires only on a unit that is otherwise `compared` (§3.2 precedence). The coverage entry for the same comparison fires in **every** not-run case, including the ones precedence or the skip rule silence, so both can print on one run and neither is redundant
- `orphan-output <unit> — dist/<x>.js has no src/<x>.ts` — **round 7**: an orphan has no
  newer input by definition, so it printed `undefined … NaN` too. The same defect round 4
  filed for `unbuilt`, at a site that fix did not reach.
- `unbuilt packages/cli — bundle:cli did not finish; missing: <gap list>` — e.g.
  `missing: chunk-*.js, dist/plugin/skills`. ⚠️ **AND ITS `--clean` TWIN,
  `unbuilt packages/cli — tsc -b --clean removed the compiler outputs from a completed
  bundle; missing: <gap list>` (round 12, C11-3).** After `npm run build:clean` the gap
  list is `dist/bin.js, dist/index.js, dist/bin/supervisord.js, dist/index.d.ts` —
  measured, those four are the tsc-written members of clause 1's set and `--clean` deletes
  exactly them — on a tree where `bundle:cli` **finished normally** and `tsc -b --clean`
  deleted afterwards. Printing "bundle:cli did not finish" there is verbatim the OP-2
  failure this section files two bullets below ("the generic line says … which is FALSE"):
  the operator is sent after a step they never ran, at the tree state §3.3 and §8(h)
  discuss most. §3.3's cli reason table owns the predicate that separates the two, because
  §6 row 30 forbids the reporter inventing a sentence and this line prints `unitState()`'s
  reason verbatim; §6 row 32 is the non-vacuity row. The remedy is unchanged
  (`rm -rf packages/cli/dist` then `npm run build`), so the remedy table needs no row —
  only the diagnosis was wrong, and a wrong diagnosis is what the founding incident was.
  This is §3.3's artifact-set clause, and the
  gap list is the whole of it: the verdict is a gap over a MULTI-MEMBER set (`:121`'s
  chunk, the three entry outputs, `:153`'s `dist/index.d.ts`, `:178`'s six plugin
  entries), so the line names WHICH member is absent instead of asserting one step.
  ⚠️ **An absent marker is NOT one of these reasons** — after round 9 it reports
  `bundle-provenance-missing`, advisory, and never `unbuilt` (§3.3's cli table, §6 row
  10); printing "no completed bundle" for it would be the same English sentence this
  section prints about a tree that is fine. — **round 7**: the generic line says
  "holds no compiler output", which is FALSE
  in the case round 6 added the rule for. Interrupt `npm run build` during `bundle:types`
  and `dist` holds `bin.js`, `index.js`, `bin/supervisord.js` and `index.d.ts`. An
  operator who runs `ls` sees plenty of output, concludes the check is broken, and mutes
  it. The rule changed in round 6; the line did not.
- `unbuilt packages/cli — dist/<file> (<mtime>) is NEWER than the last completed bundle
(.bundle-meta/metafile.json, <mtime>); tsc -b has overwritten the bundled output` —
  **round 9**, for §3.3's clause 2, C9-1's marker-freshness clause. The line above is
  FALSE here in the other direction: the marker is PRESENT and a bundle DID finish. What
  is wrong is that `tsc -b` has since rewritten `dist/bin.js` and `dist/index.d.ts` over
  it — which nothing an operator can see with `ls` will reveal, and which §7 names as a
  CORRECT firing nobody may mute as noise. So the line names the offending file and both
  mtimes. Same defect as round 7's OP-2 — the rule changed and the line did not — at the
  site round 7's own fix created.

**Findings of the same `kind` are grouped, and the remedy is PER KIND.** Both were
round-1 findings and both are load-bearing:

| `kind`                       | remedy printed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stale-unit`                 | **`rm -rf <unit>/dist` then `npm run build`** — `npm run build` alone often CANNOT clear this                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `stale-bundle`               | **`npm run build`** — NOT `npm run bundle:cli`, which throws when `.dts-cache` is absent (`bundle-cli.mjs:146-151`), precisely the standalone invocation its own error text warns about                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `orphan-output`              | **`rm -rf <unit>/dist` then `npm run build`** — neither `npm run build` NOR `tsc -b --clean` clears this                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `stale-declarations`         | **`npm run bundle:types -- --force`** — `npm run build` alone CANNOT clear this. ⚠️ **~5 minutes**; `bundle-types.mjs:76` says so itself, and under `check:all --strict` that is a five-minute wait to unblock a push                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `stale-shipped-declarations` | **`npm run bundle:cli`** — the SECOND sanctioned standalone invocation, safe for the same reason as the recipe's step 4: this kind cannot fire unless `.dts-cache/index.d.ts` EXISTS, which is exactly what the guard at `bundle-cli.mjs:146-151` requires. Seconds, not the generator's ~5 minutes. `npm run build` also clears it, at the cost of a full `tsc -b`                                                                                                                                                                                                                                                                           |
| `stale-plugin-assets`        | **`npm run build`** — NOT `npm run bundle:cli`, for the reason the `stale-bundle` row gives                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `unbuilt`                    | **`rm -rf <unit>/dist` then `npm run build`** — plain `npm run build` clears it only when `.tsbuildinfo` went with the outputs. Measured: delete outputs but KEEP `.tsbuildinfo` (what `bundle-cli.mjs:113-119` does) and `tsc -b` re-emits nothing, twice over                                                                                                                                                                                                                                                                                                                                                                               |
| `bundle-provenance-missing`  | **`npm run build`** — clears BOTH readings, absent and unreadable: `bundle-cli.mjs`'s wipe-step clear removes `.bundle-meta/` and the write-after-copy replaces it, while `rm -rf packages/cli/dist` clears NEITHER (sibling, §3.3's opening sentence). **advisory**: listed, never fails `--strict` (the exit-code table below). **NOT** `rm -rf <unit>/dist` first, unlike every neighbouring row: the tree is complete and only its provenance record is missing, which on the first run after this lands is EVERY tree, so step 1 would buy a full `tsc -b` plus the generator's ~5 minutes to restore a bookkeeping file. One build clears it permanently. §3.2: the bundle comparison did **not run** (coverage `not-run`, §4's coverage line). `not-run` is the only non-`full` status this design produces, since round 10 deleted the unreachable `reduced` (§2, §3.2) |

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
naming the count **and the units**, not 19 near-identical lines printed above 83 vitest
failures. Naming only the count would make the recipe's step 1 unrunnable — the operator
cannot `rm -rf <unit>/dist` for units nobody listed. The success path already names its
skipped unit; the failure path must match:
`check-stale-dist: stale-unit ×4 — contracts, engine-claude, gates, plugin`.

⚠️ **When more than one kind fires, the remedies have exactly one correct order and the
design must print it, not a list (round 4).** Run the per-kind advice as listed and
`npm run build` executes before `bundle:types --force`, so the declarations finding
survives and the second full rebuild is wasted; do the `rm -rf` after the build and you
undo it. The live tree already returns four `stale-unit` findings, so this is not
hypothetical. ⚠️ **The recipe has an OWNER, a POSITION and an assertion, all three stated
here because for twelve rounds it had none (round 12, OP12-4).** `formatFindings` renders
it (§1, §2) as a `remedy plan:` block computed from the finding-KIND set with the three
carve-outs below applied; its first line carries §4's `check-stale-dist: ` prefix with the
steps indented beneath it (`check-marketplace-pin-digest.mjs:377-379`'s continuation
shape), and it prints AFTER the findings list and BEFORE the coverage line (the prefix rule
above). It prints whenever the run reports at least ONE finding — **not only on the
multi-kind case**, because this section's own carve-outs make single-kind runs multi-step:
a run whose sole finding is `stale-declarations` needs step 3 AND step 4, and that kind's
remedy-table row names only step 3, so a plan withheld there withholds half the remedy.
§6 row 34 is the non-vacuity row. Without it an implementer who reads "the remedy is PER
KIND" plus `Finding.remedy` prints the per-kind remedy beside each grouped block, passes
all 34 rows, the false-negative battery, the wiring assertions and the live smoke test, and
hands the operator exactly the unordered list this paragraph measures as harmful. One
ordered recipe:

1. every `rm -rf <unit>/dist` first — for the units reported `stale-unit`, `orphan-output` or `unbuilt` ONLY. A run whose only finding is `bundle-provenance-missing` starts at **step 2**: that tree is complete, and step 1 would delete a working `packages/cli/dist` to restore a missing bookkeeping file;
2. `npm run build` — **before** the generator, not after. ⚠️ **A run whose only finding is
   `stale-declarations` starts at step 3** — the third carve-out, in the shape step 1's
   `bundle-provenance-missing` clause and step 4's `stale-shipped-declarations` clause
   already use. Nothing was deleted, so every dependency `dist` that C-R5-2 requires is
   present, and step 4 then lifts the regenerated cache. The state is ordinary rather than
   degraded, and its reachable form is a PRODUCER edit: `scripts/bundle-types.mjs` is in
   this comparison's comparand (§3.3) and in no unit's input set, so touching it makes the
   cache stale with no `dist` stale — this kind alone. Step 2 there buys a full `tsc -b`
   across 19 units plus a duplicate `bundle:cli`, on top of the generator's ~5 minutes,
   and cannot clear the finding anyway: `bundle-types.mjs:70` skips regeneration whenever
   the cache is newer than a predicate that stats neither `.json` nor itself, which is why
   step 3 carries `--force`;
3. `npm run bundle:types -- --force` if `stale-declarations` fired (**~5 minutes**);
4. `npm run bundle:cli` if step 3 ran OR `stale-shipped-declarations` fired, so
   `bundle-cli.mjs:153` lifts the cache into `dist/index.d.ts` — step 3 alone leaves the
   pre-force copy shipped, which is precisely the state §3.5 now reports. If
   `stale-shipped-declarations` fired **alone**, this step is the whole remedy: steps 1-2
   would delete and rebuild outputs that are already current.

   ⚠️ **These are the ONLY TWO sanctioned standalone `bundle:cli` invocations** — this
   step, and §4's `stale-shipped-declarations` row — and the table bans it everywhere
   else. Both are the same case: the ban's stated cause is `.dts-cache` absence
   (`bundle-cli.mjs:146-151`); step 3 has just written that cache, and
   `stale-shipped-declarations` cannot fire unless it is already present. So the guard
   those lines implement is satisfied in exactly these two places and nowhere else.
   Round 6 traced the first; round 9 added the second on the same argument.

5. **re-run the check.** A comparison the coverage line reported `not run` was **not
   performed** — the first pass's `PASS` does not cover it, and only the re-run says
   whether it is clean. Steps 1-4 are what make a not-run comparison runnable again:
   after step 1's `rm -rf packages/cli/dist` three of the four cli-scoped comparisons are
   `not-run` — `bundle-freshness`, `plugin-assets` and `shipped-declarations` — while
   `declaration-cache` still RUNS, `full`, because `.dts-cache/` is a sibling of `dist`
   and step 1 leaves it (§3.3's opening sentence). Three, named, not "every": step 5's own
   rule turns a coverage line into a claim about what WAS compared, so a count that
   overstates it is the unearned green line one level up,
   so an operator who stops at step 4 is left with exactly the unearned green line the
   coverage line exists to prevent. This is the recipe's multi-kind case, which is the
   degraded-tree case.

⚠️ **An earlier ordering put the generator at step 2 and it could not run there
(round 5).** `packages/cli/tsconfig.dts.json` declares `"references": []` and
`"composite": false`, and neither it nor `tsconfig.base.json` declares `paths` — so
`@crabgic/*` resolves through the workspace symlink to
`exports["."].types === "./dist/index.d.ts"`. **Step 1 deletes exactly those files.**
Measured on a fixture with the same generator and `--no-check`: dependency `dist`
present → inlines the type, exit 0; deleted → `TS2307: Cannot find module`, exit 1, no
output written. `bundle-types.mjs` uses `execFileSync`, so it throws outright. The recipe
was wrong precisely in the multi-kind case it was written for. ⚠️ **Standing rule 8, at the
site of step 2's `stale-declarations` carve-out:** the carve-out does not re-open C-R5-2,
because C-R5-2's cause is step 1 DELETING the dependency `dist` that
`packages/cli/tsconfig.dts.json` resolves through the workspace symlink — and the carve-out
applies only to a run whose sole finding is `stale-declarations`, which deletes nothing.
Step 1 is already conditioned on `stale-unit`, `orphan-output` or `unbuilt`, so the two
clauses can never both be live.

| condition                                                 | default                                       | `--strict`          |
| --------------------------------------------------------- | --------------------------------------------- | ------------------- |
| no findings                                               | `PASS` line, exit **0**                       | exit **0**          |
| only advisory findings (`bundle-provenance-missing`)      | `PASS` line + the advisory listed, exit **0** | same, exit **0**    |
| findings                                                  | listed, exit **0**                            | listed, exit **1**  |
| internal error — **ANY** throw the catch can SEE (§1's IMPORT RULE), not only malformed config | `WARN` line, exit **0**                       | `ERROR`, exit **2** |

⚠️ **That row's OWNER and its TEXT, both stated because for eleven rounds neither was
(round 11).** No element in §2 could produce it — `exitCodeFor` takes a `result` and a throw
yields none, `formatFindings` renders findings and coverage, `kind` has no error member, and
§1 gave `check-stale-dist.mjs` "arg parsing, CLI" and no catch. So `check-stale-dist.mjs`
wraps `checkStaleDist` and `formatFindings` in `try`/`catch` (§1) and prints
`formatInternalError(err, { strict })` (§2):

```
check-stale-dist: WARN internal error — <path>: <err.message>; the staleness check did NOT run, so this is not a verdict on your tree
check-stale-dist: ERROR internal error — <path>: <err.message>; the staleness check did NOT run, so this is not a verdict on your tree; re-run `npm run check:stale-dist` for the same diagnosis at exit 0; this is check:all member 0 of 15, so the remaining 14 did not run
```

⚠️ **And under `--json` NEITHER of those lines is printed (round 12, C11-5).** `--json`
plus a throw was an input pair no section named, so both texts went to **stdout** and the
JSON stream stopped being JSON — the failure `scripts/bundle-types.mjs:63-68` records this
repository already shipping, `check-published-tarball.mjs` dying on
`Unexpected token 'b', "bundle-typ"... is not valid JSON` because a producer wrote human
chatter there. `formatInternalError` takes `json` exactly as `formatFindings` does (§2) and
emits one object instead:

```json
{ "internalError": "<err.message>", "ran": false }
```

It carries **no** `findings`, `states` or `coverage` key, so a consumer cannot read it as a
clean run; `<err.message>` already carries the `<path>: ` prefix §3's read wrapper adds, so
the machine path loses no locus; the exit code is unchanged (**0** non-strict, **2**
strict). §6 row 27 asserts all three invocations, including that the `--json` one parses.
Latent today — nothing consumes `--json` yet — which is why it is stated now rather than
after a consumer exists.

Both text lines carry this section's prefix. **What the operator does is PRINTED, not
merely stated here — round 12 (OP12-5) found both facts written to the wrong audience.**
They are not in the remedy table for the reason the coverage line carries no remedy: that
table is keyed by finding KIND, and an internal error is not a finding. So the `ERROR` line
itself carries them: re-run non-strict with `npm run check:stale-dist`, which prints the
same diagnosis and exits **0**; and this check is member **0** of 15, so the remaining
**14** members did not run either (§5). The `WARN` line carries neither — the re-run advice
is what the operator is already doing, and nothing was blocked. `<path>` is the config or
artifact whose read threw, supplied by §3's read wrapper because `JSON.parse` messages
carry no locus; where the error comes from no read (a link failure, a bug in the check
itself) the prefix is omitted and the line starts at `<err.message>`. Re-derived 2026-08-20 in a scratchpad package (npm 11.16.0, node
v24.18.0, nothing else running but the shell): an UNCAUGHT throw in `pretest` exits npm
**1** and `npm test` never runs — the same total block round 1's `O-2` filed (§5.1).

⚠️ **The advisory row is round 9's, and without it the fix trades one day-one failure for
another.** `.bundle-meta/` exists on no tree built before this change set lands (measured
2026-08-20), so an unconditional provenance finding with no carve-out exits **1** from
`check:all -- --strict` for every developer until they rebuild. `exitCodeFor` therefore
partitions by KIND (`ADVISORY_KINDS`, §2), not by count, and the `PASS` line still names
skipped units so a degraded run is still distinguishable from a failing one.

Coverage **never changes the exit code** — it is reported, not enforced (§8(j)); a
`not-run` bundle comparison exits **0** even under `--strict`. One qualification, taken
from `check-citation-runs.mjs:274-279`, which FAILS rather than print a pass it did not
earn: when **no** comparison ran and **no** unit was compared — a fresh clone, or
`meta-checks` (§5) — the PASS line says so in words:
`check-stale-dist: PASS — 0 units compared, 19 skipped; nothing was checked`. Still exit 0, because
research Q5 requires a fresh clone to be quiet, but never a bare green line.

⚠️ **The `PASS` line NAMES SKIPPED UNITS, because otherwise the design's own remedy leads to a silent failure (round 5).** An operator gets `stale-unit` on `packages/cli`, runs the printed `rm -rf packages/cli/dist`, and `npm run build` then fails — tsc error, Ctrl-C, disk. Re-running the check finds no `dist` at all, which is `skipped`; the other 18 compare clean; it prints **PASS, exit 0** on a tree with no CLI. Since round 8 BOTH routes are silent at unit granularity: `tsc -b --clean` deletes `.tsbuildinfo` along with the outputs, so a `--clean`ed unit holds nothing at all and §3.3's reason table makes it `skipped`, not `unbuilt`; the design's own `rm -rf` leaves no `dist` at all — also `skipped`. `packages/cli` is the one unit that still yields a finding there, and it does so through §3.3's entry-output clause, never through what `dist`'s emptiness says. The `PASS` line is therefore the ONLY surface for either route, which is what makes naming the units load-bearing rather than a nicety. The line reads `check-stale-dist: PASS — 18 units compared, 1 skipped (packages/cli: no dist/)`, **followed by the coverage line whenever any comparison is not `full`** — on that exact tree `bundle-freshness`, `plugin-assets` and `shipped-declarations` are all `not-run`, while `declaration-cache` RUNS `full` — `.dts-cache/index.d.ts` survives `rm -rf packages/cli/dist` (§3.3's opening sentence), which is the whole reason it is a separate comparison. Three of FOUR, named individually rather than counted, so a bare PASS there is the silent route this round-5 fix closed for units, still open one level up. Naming skipped UNITS and not skipped COMPARISONS is the same defect at comparison granularity (round 9, O9-1). The parenthetical is `unitState()`'s `reason` printed verbatim, never a sentence the reporter invents — this is the design's only other consumer of that field. §3.3's reason table has three `skipped` rows (no `dist/` at all, `dist/` empty, only `eo-*-fixture-*` scratch) and the operator needs to know which one they are in: two mean no build ever ran, one means their own `rm -rf` did (round 9, CF9-1).

⚠️ **The internal-error row changed in round 1, and the reason is measured.** It was
exit **2** in both columns. On npm 11.16.0 a `pretest` exiting **2** blocks `npm test`
exactly as exit 1 does — verified: `TEST RAN` never prints. So the "`pretest` is
non-strict, therefore it cannot block testing" argument did **not** cover the check's
own errors, and §3's skip rule made that path reachable from this design's OWN advice:
`rm -rf packages/cli/dist` and the bundle comparison has nothing to stat. Following the
documented remedy would have left the operator unable to run the suite at all.
Non-strict now degrades an internal error to a warning and exits 0 — which holds only if
something CATCHES. Re-derived 2026-08-20 (npm 11.16.0, node v24.18.0): an UNCAUGHT throw in
`pretest` exits npm **1** and blocks `npm test` exactly as exit 1 does, so round 1's `O-2`
is re-openable by omission alone. That is why the row above now names its owner and its
text.

Report-by-default with `--strict` on the chained entry is `check-claim-scope.mjs`'s
shape verbatim (`:25-27`; `check:claim-scope` is `--strict` at `package.json:44`). It
matters here because a false positive now blocks a push: an ad-hoc local run stays
non-punitive, and only the chained invocation fails.

Exit **2** is produced by `check-stale-dist.mjs`'s catch (§1), never by `exitCodeFor`,
whose range is therefore `0 | 1` (§2). It is a NEW convention in this repository —
`grep -rn "exit(2)" scripts/` returns zero hits today. It is worth introducing:
"your dist is stale" and "the check broke" must not share an exit code when the check
gates a push.

## 5. Wiring — requirement 10

- `"check:stale-dist": "node scripts/check-stale-dist.mjs"` in `package.json` — no `--strict` in the definition itself (§5.1).
- Chained into `check:all` as the **first** member, verbatim `npm run check:stale-dist -- --strict`, making it the **15th**
  (`node -e 'console.log(require("./package.json").scripts["check:all"].split("&&").length)'` → 14 today; `check:tarball` is member 12 and `check:install-smoke` member 13, so _appending_ puts this check after both).
  First, not last, because `check:tarball` and `check:install-smoke` already read local
  `dist` state and returned three different verdicts in one session for that reason
  (`docs/evidence/criteria-closeout/defects/25-install-smoke-depends-on-local-dist-state.md`);
    running this first turns their ambiguity into a named precondition. ⚠️ **Index 0 in an
  `&&` chain is also what makes §4's internal-error row load-bearing**: any non-zero exit
  here stops the other **14** members from running at all (re-derived 2026-08-20:
  `check:all` splits on `&&` into 14 members today), so an uncaught throw costs the whole
  of `check:all` and prints no attributable line. That is the cost the row's `WARN`/exit-0
  default avoids, and why §4 tells the operator the other 14 did not run.
- ⚠️ **§6 pins both by index, not by substring (CF9-3).** `expect(members[0]).toBe("npm run check:stale-dist -- --strict")`. A `toContain("check:stale-dist")` — the shape of the two checks §6 cites — is satisfied by a member appended last with no flag, which runs after the two members this bullet orders it before and exits 0 on a stale tree: every assertion green, the wiring's entire value gone.

⚠️ **What this wiring does and does not buy, measured rather than assumed.**
`npm run check:all` is invoked by **no** workflow and **no** hook. Measured:

```
git ls-files -z | xargs -0 grep -n "run check:all" | grep -v stale-dist-check-design   # 6 hits (2026-08-20), ALL in docs/evidence prose
      # THIS design file is excluded BY CONSTRUCTION, and NO unfiltered figure is stated
   # (round 12, C11-4). It is unmaintainable: round 11 wrote "9" while the true value was
   # 10, because the very comment it added to explain the drift quoted the string a
   # FOURTH time — the third recurrence of round 1's own O-4, one round after the second,
   # and again at the site the fixing round created. Any sentence explaining the drift
   # re-triggers it, so the sentence is gone rather than corrected. Re-derived
   # 2026-08-20: filtered 6, all in docs/evidence prose. The load-bearing claim — that
   # no workflow and no hook invokes `check:all` — is carried entirely by the 6, which
   # the command above produces.
git ls-files -z | xargs -0 grep -ln "check:all" | grep -v ^docs/ | wc -l   # 9 files: the
   # definition at package.json:45, 4 prose comments, 4 test assertions — no invocation
```

CI runs the members as individual steps in two jobs (`ci.yml:246` `meta-checks`,
`ci.yml:403` `packaging`), and `core.hooksPath` here points at a `pre-push` that runs
`lint typecheck build test`. Consequences, stated so nobody re-derives them:

- in `meta-checks` (`npm ci`, no build) every unit would report `skipped` — no `dist` exists — and all FOUR cli-scoped comparisons `not-run` — `bundle-freshness`, `declaration-cache`, `plugin-assets` and `shipped-declarations`, since `npm ci` creates neither `dist` nor the gitignored `.dts-cache` — so what prints there is the qualified `check-stale-dist: PASS — 0 units compared, 19 skipped; nothing was checked` plus §4's coverage line, never a bare green line;
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
stated here rather than in the round log: **the warning can scroll away — and so does §4's coverage line, which prints on the PASS path and is therefore the ONLY notice a degraded run ever gives.** A finding at least repeats on the next run; a coverage entry on a passing tree is one line, once.

83 failures from a `dist` that predated its source, misdiagnosed for two hours because
nothing said so.

**It runs WITHOUT `--strict`, and that is load-bearing.** Measured on npm 11.16.0:

```
pretest exits 0  ->  PRETEST RAN / TEST RAN
pretest exits 1  ->  PRETEST FAILED, and `test` NEVER RUNS
pretest exits 2  ->  npm exits 2,  and `test` NEVER RUNS
pretest THROWS   ->  npm exits 1,  and `test` NEVER RUNS   <- the UNCAUGHT case (§4)
```

So a strict `pretest` turns any false positive into a total block on local testing — **and
so does an uncaught throw, `--strict` or not**, which is the whole reason §4's
internal-error row must have an owner in §2 rather than being prose. ⚠️ **And an owner in
§2 is not enough on its own (round 12, OP12-1):** a catch covers only what is LOADED inside
it, so §1's IMPORT RULE — the entry module reaching `compare.mjs` and `report.mjs` through
`await import(...)` inside the try — is what puts the six-module graph in that catch's
scope. Measured on the design's own import shape, a STATIC entry import of a module that
throws at load exits **1** with no `check-stale-dist: ` line, which is this table's fourth
row and a total block on `npm test`. Re-derived 2026-08-20
in a scratchpad package (npm 11.16.0, node v24.18.0, nothing else running but the shell):
0 → npm 0 with the suite running; 1 → npm 1; 2 → npm 2; uncaught throw → npm 1; the suite
never ran in the last three. The
check therefore reports and continues there, so that a false positive cannot block local
testing. ⚠️ **It does NOT print "immediately above the failures", and this sentence said it
did for nine rounds after the paragraph above measured it false (round 12, OP12-3).** The
warning lands ~199 lines above vitest's summary and can scroll away — which is where the
founding incident's two hours of misdiagnosis happened, at the top of scrollback, read from
the bottom; §4's coverage line has it worse, being one line, once, on a passing tree.
"Immediately above" is a property of the reporter or `globalSetup` re-emit named above as
the future element, never of the `pretest` wiring. Rounds 2 (`O-A`) and 3 (`OP-4`) both
filed this and both fixes reached the measuring paragraph and not the argument resting on
it. `--strict` is
reserved for `check:all`, where a wrong verdict costs a re-run rather than a working
session.

**Honest bound — the measured set is FIVE, not the one this line named for twelve rounds
(round 12, OP12-2).** npm's pre-hook is NAME-EXACT. Re-derived 2026-08-20 (npm 11.16.0) in
a scratchpad package declaring `pretest`, `test`, `test:watch` and `test:e2e`: `npm test`
printed `PRETEST RAN / TEST RAN`, while `npm run test:watch` and `npm run test:e2e` each
printed their own line ALONE — npm looks for `pretest:watch`, not `pretest`. This
repository declares **four** siblings beside `test`: `test:watch` = `vitest`
(`package.json:20`), `test:live` (`:21`), `test:e2e` (`:22`) and
`test:e2e:release-evidence` (`:23`). So the bypass set is those four plus `npx vitest`.
This catches `npm test` and nothing else — and `test:watch` is the vitest WATCH loop, the
developer's inner loop and precisely the founding incident's context, so a developer who
lives there never sees the check at all. Combined with §5's measurement that no workflow
and no hook invokes `check:all`, the honest reach of this design is `npm test`.
⚠️ **Extending it is a NAMED future element, not silently taken here**, in the shape the
reporter re-emit above already uses: add `pretest:watch`, `pretest:live` and `pretest:e2e`
to §1's `package.json` row and to this section's JSON block, each pinned by equality in
CF9-3's shape, since a membership-only assertion is what let the last `package.json` wiring
gap through. It is not taken here because §5.1's ruling is the owner's and names `pretest`;
what this line owed was the measurement.

## 6. Testing, and how non-vacuity is proven

Fixtures are synthetic trees under `mkdtempSync(tmpdir())`, for the reason
`repo-census.test.mjs:17-20` states: asserting against the real repository makes a
test restate today's file list and fail on every unrelated addition.

**Non-vacuity battery.** Per finding kind, **per unit state and per coverage status**: one
fixture reporting clean, then ONE `utimesSync`/`rm`/`writeFileSync` mutation that must flip
it to the stated verdict — or, for the RENDERED-TEXT rows 16-18 and 26-34, that must make the check SAY what it stopped
covering. (`writeFileSync` is row 22's alone: §3.5 keys on bytes, not mtime, so a
`utimesSync` mutation there would prove nothing.)

Three rules the rows below carry, each earned from a defect a green battery passed:

- **Rows 16-18 and 26-34 assert `formatFindings`' RENDERED text, never the return value.**
  Rows 16-18 and 26 are the COVERAGE side of that group; rows 27-30 are the FINDING and
  internal-error side, added in round 11; rows 31-34 are round 12's — the LOAD-TIME
  internal error (OP12-1), the `--clean` reason (C11-3), the chunk SET (C11-6) and §4's
  ordered remedy plan (OP12-4), of which the first and last are surfaces §4 mandates that
  nothing in this section read. Re-derived: `formatFindings` occurred exactly
  TWICE in this design — §2's signature and this bullet — so every rendered assertion in §6
  concerned a coverage entry or the prefix, and §4's per-kind line shapes, its grouped
  `stale-unit ×N — <units>` line and its `WARN`/`ERROR` lines were proved by NOTHING — and its
  ordered REMEDY PLAN still was, until round 12 (OP12-4). Rows
  28-30 and 34 take a MUTANT FORMATTER as their single mutation rather than a filesystem change,
  because what they pin is what the reporter prints, and the rule stated one line above —
  that a row reading a return value goes green on the printing defect — applies to findings
  exactly as it does to coverage. O9-1 was a
  coverage value computed and never printed, so a row reading `result.coverage` goes green
  on the exact defect it exists to catch (round 9). Rows 12 and 23 are deliberately NOT in
  this group: their mutation column CALLS the comparison directly, so there is no rendered
  output to read and the return value is the only surface there is. ⚠️ **And every
  assertion in this group includes §4's `check-stale-dist: ` prefix — row 18 on the PASS
  line and the findings list at once (its fixture is advisory-only, the one state §4's exit
  table renders both), rows 16, 17 and 26 on the coverage line, rows 27-30 on the
  finding, grouped and `WARN`/`ERROR` lines (round 11), and rows 31-34 on the load-time
  `WARN`/`ERROR` lines, the two `unbuilt` lines and the remedy plan's first line
  (round 12).** For rows 16, 17 and 26 the
  prefix, the `⚠️ coverage: ` label and the asserted entry form ONE contiguous substring,
  because §4 renders only the non-`full` entries, in §2's union order, and on each of those
  three fixtures the asserted entry is FIRST among them — verified per row. ⚠️ **Round 10
  wrote the previous form of this bullet while rows 16 and 17 still asserted the bare
  entry**, so the property held for row 18 alone and the two rows it named would have
  FAILED a correct implementation, while passing one that emits no prefix at all — the very
  defect the group exists to catch. An implementer who omits the prefix now fails seven
  rows instead of one, and ships lines nobody can attribute in `check:all`'s 15-member
  stream — the same shape of gap as a coverage value nobody rendered, one level out.
- **Rows 9, 13, 14 and 15 are the unit-state set** — one fixture per `unitState().state`,
  plus the reasons. A `built: boolean` implementation passes any two of the three states and
  fails the third, which is the only thing that makes §2's three-value enum testable (CF9-1).
- **Row numbers are cited from OUTSIDE this section, so nothing here is renumbered
  casually.** §0's requirement 1 row cites fixture rows 7, 8 and 22; requirement 6 cites 2;
  requirement 8 cites 6, 17, 22 and 23; requirement 9 cites 3; §2's type note cites 9, 13
  and 14. Round 9 appended three separate groups of rows and each was drafted as "row 13":
  the state rows keep 13-15 so §2 stays true, and §3.5's two rows moved to 22-23. Round 10
  re-pointed §0's requirement 1 and 8 rows off the stale "row 13" onto those numbers, and
    appended rows 24-25 rather than renumbering anything. Round 11 appended rows 26-30 the
  same way, and §0's requirement 8 row now cites **29** as well. Round 12 appended **31**,
  **32**, **33** and **34** the same way; §8(n) cites 31, §4's `unbuilt` line shape cites
  32, §3.3's clause 1 cites 33 and §4's ordered-recipe paragraph cites 34, so those
  sections join the outside-citer list above.

| #   | clean fixture                                                                                          | single mutation                                                                                                                                                                | must become                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | dist newer than src                                                                                    | touch one `src/**.ts` forward                                                                                                                                                  | `stale-unit`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2   | dist newer than src                                                                                    | touch `tsconfig.base.json` forward                                                                                                                                             | `stale-unit` ×N (req 6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 3   | cli unit, dist newest                                                                                  | touch `tsconfig.dts.json` forward                                                                                                                                              | `stale-unit` (req 9)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 4   | 1:1 stems                                                                                              | delete one `src/x.ts`, keep `dist/x.js`                                                                                                                                        | `orphan-output` (req 2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 5   | bundle newest, marker newest                                                                           | touch an inlined unit's `dist/index.js` forward                                                                                                                                | `stale-bundle` (req 3) — the mutation is OUTSIDE `packages/cli/dist`, so §3.3's clause 2 still holds and the unit stays `compared`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 6   | cache newest, `dist/index.d.ts` byte-identical to it                                                   | touch any `packages/*/src/*.ts` forward                                                                                                                                        | `stale-declarations` (req 8) — and NOT `stale-shipped-declarations`, which the bytes keep quiet                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 7   | **stale src, marker newest, then** touch `dist/plugin/.mcp.json` **to now**                            | —                                                                                                                                                                              | still `stale-unit` (req 1) — and **NOT `unbuilt`**: `dist/plugin/**` is outside §3's filtered output set, so §3.3's clause 2 is unaffected. This row is the proof that the freshness comparand is the filtered set and not a raw `dist/**` walk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 8   | plugin assets fresh                                                                                    | touch `packages/plugin/skills/**` forward                                                                                                                                      | `stale-plugin-assets` (§3.4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 9   | unit built                                                                                             | `rm -rf <unit>/dist/*` keeping `.tsbuildinfo`                                                                                                                                  | `unbuilt` (round 3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 10  | bundle built WITH metafile, all outputs present                                                        | delete `.bundle-meta/metafile.json` only                                                                                                                                       | `bundle-provenance-missing`, and **not** `unbuilt` — the marker no longer feeds the `unbuilt` rule (§3.2, round 9) **AND**, in the RENDERED output, the entry `bundle freshness not run (.bundle-meta/metafile.json absent)` — §4's renderer, not the raw value shape: `bundle-freshness: not-run (…)` is what `result.coverage` HOLDS and what the direct-call rows 12 and 23 assert, and it never appears in rendered text (round 10). Precedence silences the finding, never the coverage                                                                                                                                                                                                                                                                                                   |
| 11  | cli built COMPLETE: metafile + 5 chunks + 3 entry outputs + `dist/index.d.ts` + the six plugin entries | `rm dist/bin.js` only                                                                                                                                                          | `unbuilt` — the fixture must be complete, or the baseline already carries a finding and the row is vacuous. Round 9: without the metafile the baseline is now `bundle-provenance-missing` rather than `unbuilt`, and with `dist/index.d.ts` or the plugin entries missing it is `unbuilt` before the mutation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 12  | false-negative: `packages/cli/dist` absent                                                             | run `checkPluginAssets`                                                                                                                                                        | no finding, no throw, and coverage `plugin-assets: not-run (packages/cli/dist absent)` — bare "skipped" is unassertable under §2's return shape                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 13  | unit built: outputs + `.tsbuildinfo`                                                                   | `rm -rf <unit>/dist/*` INCLUDING `.tsbuildinfo`                                                                                                                                | `skipped`, not `unbuilt` — row 9's twin; the pair is what a `built: boolean` cannot satisfy (§3.3's reason table, rows 1-2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 14  | unit whose `dist/` holds outputs + an `eo-*-fixture-*/` dir                                            | `rm` the outputs and `.tsbuildinfo`, keep the scratch dir                                                                                                                      | `skipped` — a test `mkdir`ed it; nothing was ever built here (§3.3's reason table, row 3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 15  | rows 9, 13 and 14's end states                                                                         | none — assert `unitState(unit).reason`                                                                                                                                         | three DISTINCT reason strings — §4's `unbuilt` line prints one verbatim and the PASS line's skipped slot names the others, so one collapsed string is a silent regression                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 16  | cli built COMPLETE, as row 11, marker present and newest                                               | `rm -rf packages/cli/dist` (§4 recipe step 1, the design's own printed remedy)                                                                                                 | rendered output contains `check-stale-dist: ⚠️ coverage: bundle freshness not run (packages/cli/dist absent)` — §4's PREFIX and LABEL, then the entry: a leading substring of the coverage line, never the whole line. Contiguous because §4 renders only the non-`full` entries and `bundle-freshness` is FIRST among them here — this mutation also puts `plugin-assets` and `shipped-declarations` at `not-run` (§3.3, §3.5), while `declaration-cache` still runs `full` because `.dts-cache/` is a sibling of `dist`, so nothing renders between the label and this entry. ⚠️ **Round 11: the previous text asserted the BARE entry**, which fails a correct implementation (§4 mandates prefix + label before the first entry) and passes one that emits no prefix at all. Unit `skipped`, still exit 0. ⚠️ **Round 10 replaced the previous fixture and mutation**, whose asserted text `bundle freshness reduced (no esbuild chunk)` was UNSATISFIABLE — a chunkless `packages/cli` is `unbuilt` through §3.3's clause 1, so §3.2's fallback never ran — and whose "metafile + 3 entries + 5 chunks" baseline was already `unbuilt` before the mutation, missing `dist/index.d.ts` and the six plugin entries. Row 25 now carries the chunk gap |
| 17  | cli built, `.dts-cache/index.d.ts` present                                                             | `rm -rf packages/cli/.dts-cache`                                                                                                                                               | rendered output contains `check-stale-dist: ⚠️ coverage: declaration cache not run (packages/cli/.dts-cache/index.d.ts absent)` — §4's prefix, label and renderer applied to §2's comparison id and §3.3's mandated reason, all verbatim. A leading substring of the coverage line, never the whole line, and contiguous because `declaration-cache` is FIRST among the non-`full` entries here: this row starts from a COMPLETE cli build with the marker written last (the rule below), so `bundle-freshness` and `plugin-assets` both stay `full`, and this mutation also puts `shipped-declarations` at `not-run` (§3.5, same absent file) BEHIND it in §2's union order. ⚠️ **Round 11 added the prefix and label**, for row 16's reason. No finding, exit 0. ⚠️ **Round 10:** the previous text `declarations not run (.dts-cache absent)` failed on BOTH halves — no renderer produces `declarations`, and that reason substring occurs in no section                                                                                                                                                                                                                                                   |
| 18  | a fixture whose findings are ADVISORY-ONLY (exactly one `bundle-provenance-missing`, as row 21) AND with ≥1 non-`full` comparison — the only combination §4's exit table renders a `PASS` line and a finding together (round 11: with a non-advisory finding there IS no PASS line, so the previous fixture could not assert the prefix on it)                                                 | none — assert the RENDERED text of both paths                                                                                                                                  | the coverage line appears on the findings path too; asserting only the PASS path is how this fix half-lands. Both asserted strings begin `check-stale-dist: ` (§4) — this is the row an unprefixed implementation fails                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 19  | cli built COMPLETE, marker newest                                                                      | `utimesSync` `dist/bin.js` forward past the marker                                                                                                                             | `unbuilt` via §3.3's clause 2, reason naming `dist/bin.js` — the ONLY row a presence-only marker implementation fails, and therefore the row that makes the freshness clause non-vacuous (C9-1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 20  | cli built COMPLETE, as row 11                                                                          | `rm -rf packages/cli/dist/plugin/skills` only                                                                                                                                  | `unbuilt`, gaps naming `dist/plugin` — the `:178` step's own row; without it the artifact set can ship as chunks + entries and rows 10-12 all still pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 21  | cli built COMPLETE, marker absent → exactly one advisory `bundle-provenance-missing`                   | call `exitCodeFor(result, { strict: true })`                                                                                                                                   | **0**; and **1** for the same call on a fixture whose findings include a non-advisory kind. Without this row an implementer makes the advisory blocking and every row above still passes (§4's exit table, `ADVISORY_KINDS`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 22  | cli `compared`: `.dts-cache/index.d.ts` and `dist/index.d.ts` byte-identical                           | rewrite `dist/index.d.ts` as a small `export * from "./errors.js"` barrel, mtime UNCHANGED or NEWER                                                                            | `stale-shipped-declarations` (§3.5) — the mutation is `tsc -b`'s own output, so a row that flips only on `utimesSync` would pass an mtime oracle and prove nothing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 23  | false-negative: cache present, `dist/index.d.ts` absent (what `rm -rf packages/cli/dist` leaves)       | run `checkShippedDeclarations`                                                                                                                                                 | no finding, no throw, and coverage `shipped-declarations: not-run (packages/cli/dist/index.d.ts absent)` — row 12's shape, and for row 12's stated reason: this row CALLS the comparison, so the return value is the only surface, and a bare "skipped" is unassertable under a `Finding[]` return, where it degenerates to `toEqual([])` — indistinguishable from "ran and found nothing", the early `return []` §3.3's **SKIP RULE — ALL FOUR cli-SCOPED COMPARISONS** bans as "the founding silence in a smaller box". Written in the same round as the return shape that makes it assertable (round 10)                                                                                                                                                                                                                                                                             |
| 24  | plugin assets fresh, cli built COMPLETE (as row 11)                                                    | touch `packages/plugin/.mcp.json` forward                                                                                                                                      | `stale-plugin-assets` (§3.4) — the one **FILE** member of `PLUGIN_ASSET_ENTRIES` (`bundle-cli.mjs:89`); the other five are directories. Row 8's mutation is `packages/plugin/skills/**`, a DIRECTORY member, and its fixture need not contain the file member at all — so without this row a directory-typed source walk can pass every other row and still throw `ENOTDIR` on the real tree, which §4 turns into `ERROR`, exit 2 (round 10)                                                                                                                                                                                                                                                                                                                                                   |
| 25  | cli built COMPLETE, as row 11                                                                          | `rm packages/cli/dist/chunk-*.js packages/cli/dist/run-dispatcher-*.js` — BOTH live naming families (verified 2026-08-20: four `chunk-*.js` plus `run-dispatcher-POLZZ2DH.js`) | `unbuilt`, gaps naming the esbuild chunk — §3.3 clause 1's `:121` chunk member, which had NO row until round 10. Clause 2 cannot catch it (deleting an output LOWERS the newest output mtime) and clause 3 cannot (the three entries survive), so this is the only row that makes the chunk member non-vacuous. It replaces the coverage assertion row 16 used to carry, which no correct implementation could print                                                                                                                                                                                                                                                                                                                                                                           |
| 26  | row 19's end state: cli built COMPLETE, marker newest, then `utimesSync dist/bin.js` forward past the marker | none — assert the RENDERED text of the coverage line | all FOUR entries present: `check-stale-dist: ⚠️ coverage: bundle freshness not run (packages/cli unbuilt) · declaration cache not run (packages/cli unbuilt) · plugin assets not run (packages/cli unbuilt) · shipped declarations not run (packages/cli unbuilt)` — §4's renderer, §2's union order, prefix and label contiguous with the first entry. NOTHING is absent on this fixture, so an absence-keyed implementation prints no entry at all and emits a line §4's recipe step 5 reads as "all six ran" when four did not, including requirement 3's and `stale-declarations`' (round 10, C10-1). Rows 16-18 are all absence-triggered, so every one of them passes an absence-keyed implementation |
| 27  | any unit's `tsconfig.json` rewritten as malformed JSON on an otherwise complete tree — the RUNTIME half of §4's "**ANY** throw the catch can SEE" (row 31 is the LOAD-TIME half, which this row's tree mutation provably cannot reach), reached deterministically and without depending on a wrong `newestOfEntries` | none on the tree — run `check-stale-dist.mjs` against the fixture **three** times: once without `--strict`, once with, and once with `--json` (round 12, C11-5) | non-strict: stdout contains `check-stale-dist: WARN internal error — ` **followed by the fixture's own tsconfig PATH** and the process exits **0**; strict: `check-stale-dist: ERROR internal error — <that path>: ` plus the re-run and member-0-of-15 sentences §4's line carries, and exit **2**; `--json`: stdout `JSON.parse`s and yields `{ internalError, ran: false }` with the path inside `internalError`, and contains **neither** human line. The path and the two sentences are round 12's (OP12-5): `JSON.parse` messages carry no locus — measured, `Expected double-quoted property name in JSON at position 7 (line 1 column 8)` and nothing else — so without them the row goes green on a line naming none of the **30** candidate configs and stating no next action; and a `formatInternalError` blind to `json` writes chatter onto the JSON stream, which is the failure `scripts/bundle-types.mjs:63-68` records this repository shipping (round 12, C11-5). Mutant = no `try`/`catch`, letting the throw propagate: node prints an unprefixed stack and exits **1**, failing both halves — and under `pretest` that blocks `npm test` outright (§5.1, round 1's `O-2`). Without this row §4's internal-error row has no owner and every other row passes (round 11, OP11-2) |
| 28  | a SYNTHETIC tree with `stale-unit` on ≥2 units (two units whose `src` is newer than their `dist`) | none on the tree — swap in a MUTANT `formatFindings` that renders the grouped line as the count alone, `check-stale-dist: stale-unit ×2` | the row must FAIL on the mutant: the rendered line is `check-stale-dist: stale-unit ×2 — <unit>, <unit>` (§4), prefixed and NAMING the units. §4's recipe step 1 is `rm -rf <unit>/dist` **for the units reported `stale-unit`**, so a count-only line makes the printed remedy unrunnable — round 6's `OP6-2`, whose fix landed in §4 prose and became no row until round 11. Synthetic, never the live tree's own four: §6's opening rule and the live-prediction paragraph both keep today's repository state out of the battery |
| 29  | one fixture per DELTA-LESS kind (§2, §4): `unbuilt` (row 9's end state), `orphan-output` (row 4's end state), `bundle-provenance-missing` (row 21's fixture) and `stale-shipped-declarations` (row 22's end state) | none on the tree — swap in a MUTANT `formatFindings` that prints the generic comparison shape `<kind> <unit> <newerInput> <olderOutput> <deltaMs>` for every finding | all four must FAIL: the generic shape renders `stale-shipped-declarations packages/cli undefined undefined NaN`, round 4's `OP-R4-2` and round 7's `OP-1` verbatim, at the kind round 9 added. Each must instead render its own §4 line, prefixed `check-stale-dist: ` — and for `stale-shipped-declarations` that line is byte-based, `(<a> vs <b> bytes)`, with no mtime delta |
| 30  | rows 9, 13 and 14's end states — one `unbuilt`, two `skipped` | none on the tree — swap in a MUTANT `formatFindings` that prints one hard-coded sentence in place of `unitState()`'s `reason`, in BOTH of its consumers: §4's `unbuilt <unit> — <reason>` line and the PASS line's skipped parenthetical | all three must FAIL: §4 prints that `reason` VERBATIM in both places ("never a sentence the reporter invents") and §3.3's reason table gives these three states three DISTINCT reasons. Row 15 asserts the same three on the RETURN value — precisely the surface this section's own rule says goes green on the printing defect — which is why the rendered twin is a separate row (round 11) |
| 31  | a fixture holding a COPY of this check's own modules — `check-stale-dist.mjs`, `stale-dist/*.mjs`, and a stub `bundle-cli.mjs` that `export`s `PLUGIN_ASSET_ENTRIES` and throws nothing — over a complete cli tree, run as `node <fixture>/check-stale-dist.mjs`: reports clean | replace the copied `bundle-cli.mjs` with one whose FIRST statement throws — a module that fails at LOAD, the half of §4's internal-error row that row 27's tree mutation provably cannot reach, because the check's real import graph resolves from the REPOSITORY and no fixture `node_modules` can touch it | non-strict: stdout contains `check-stale-dist: WARN internal error — ` and exit **0**; strict: `check-stale-dist: ERROR internal error — ` and exit **2**, both prefixed. Mutant = the entry module reaching `compare.mjs`/`report.mjs` by a STATIC `import` statement instead of §1's IMPORT RULE `await import(...)` inside the try: measured 2026-08-20 (node v24.18.0, npm 11.16.0, nothing else running but the shell), node prints the throw plus an internal stack, NO `check-stale-dist: ` line at all, and exits **1** in BOTH invocations — failing both halves, and under `pretest` blocking `npm test` outright (§5.1's table, round 1's `O-2`). Row 27's mutant is "no try/catch" over a RUNTIME throw and stays green here, so without this row §8(n) is a residual nothing proves (round 12, OP12-1) |
| 32  | cli built COMPLETE, as row 11, marker present and newest | `rm packages/cli/dist/bin.js packages/cli/dist/index.js packages/cli/dist/bin/supervisord.js packages/cli/dist/index.d.ts packages/cli/dist/.tsbuildinfo` — the `--clean` SIGNATURE: every tsc-written member gone, the esbuild chunks and `dist/plugin/**` left | `unbuilt`, gaps naming those four, and the RENDERED line reads `check-stale-dist: unbuilt packages/cli — tsc -b --clean removed the compiler outputs from a completed bundle; missing: dist/bin.js, dist/index.js, dist/bin/supervisord.js, dist/index.d.ts` (§3.3's cli reason table, §4). Mutant = a `unitState` carrying the single `bundle:cli did not finish` reason: it PASSES the verdict and FAILS the line — which is the whole row, because after `npm run build:clean` that sentence blames a step the operator never ran, verbatim §4's own OP-2 failure. A rendered-text row, in rows 27-30's group and for their stated reason (round 12, C11-3) |
| 33  | cli built COMPLETE, as row 11, marker present and newest, its `metafile.outputs` naming all five emitted chunk files | `rm` three of the four chunks `dist/bin.js` imports (measured 2026-08-20: `bin.js` → `chunk-FRJGAF5Y.js` → `chunk-DVV3SNQ3.js`, `chunk-I6JBP7DT.js`, `chunk-UF6GI6PE.js`), leaving one file that still matches the pattern | `unbuilt`, gaps naming the three deleted chunks — clause 1's chunk membership is `metafile.outputs` whenever the marker exists (§3.3, round 12, C11-6). Mutant = clause 1 requiring only "at least one file matching the pattern": it PASSES, and so do clauses 2 and 3 — a deletion LOWERS the newest output mtime — so the check reports **PASS, exit 0 even under `--strict`** on a `bin.crabgic` that dies with `ERR_MODULE_NOT_FOUND`. Its twin, asserted in the same row: the SAME mutation with the marker ABSENT must still be PASS plus one advisory `bundle-provenance-missing`, because that is §8(i)'s third stated cost and not a defect the row may quietly close |
| 34  | cli built COMPLETE (as row 11) plus a second unit whose `src` is newer than its `dist`, and `.dts-cache/index.d.ts` older than `packages/*/src` — TWO kinds, `stale-unit` and `stale-declarations` | none on the tree — swap in a MUTANT `formatFindings` that prints each kind's remedy-table row beside its own grouped block and no plan | the row must FAIL on the mutant: the rendered output carries ONE `check-stale-dist: remedy plan:` block with its steps as indented continuation lines, in §4's stated order, positioned after the findings list and before the coverage line. The mutant's per-kind list omits step 4 (`npm run bundle:cli`, which lifts the regenerated cache into `dist/index.d.ts` — §4: "step 3 alone leaves the pre-force copy shipped") and step 5 (re-run), so an operator who follows it spends the generator's ~5 minutes and is left with `stale-shipped-declarations` on the next run. Every other row passes the mutant, which is why the plan needed a row (round 12, OP12-4) |

**Every `packages/cli` fixture that writes `dist/index.d.ts` must also write
`.dts-cache/index.d.ts` with the SAME bytes, or omit the cache entirely.** Otherwise the
baseline already carries `stale-shipped-declarations` and rows 3, 5, 7, 10, 11 and 12
stop being clean-to-stale flips — CF8-2's defect, which reached two rows nobody looked
at.

Row 7 is the decisive one: the exact state in which the naively specified check
reports clean. The fixture asserts the plugin asset copy cannot mask a skipped compile.

⚠️ **Every cli-scoped row starts from a COMPLETE cli build, and from a marker WRITTEN
LAST** — rows 3, 5, 7, 8, 10, 11, 16, 17, 19, 20, 21, 22, 24, 25, 26, 32, 33, 34 and 29's two cli fixtures (its `bundle-provenance-missing` and `stale-shipped-declarations` states): a chunk, the three entry
outputs, `dist/index.d.ts`, the six plugin entries, plus `.bundle-meta/metafile.json` with
an mtime at or after the newest member of §3's filtered output set, except where the row
itself deletes or moves it. ⚠️ **AND that marker's `outputs` must name EXACTLY the
chunk-pattern files the fixture wrote (round 12, C11-6).** Clause 1's chunk membership is
`metafile.outputs`-derived whenever a marker exists, so a fixture whose marker names a
chunk the tree does not hold is already `unbuilt` at baseline, the mutation flips nothing
and the row is **vacuous** — CF8-2's defect, at every cli-scoped row at once, which is why
this requirement is stated here rather than in the one row that introduced the rule. Otherwise the baseline is already `unbuilt` — through the
artifact set when a member is missing, through §3.3's clause 2 when the marker is merely
present and older — the mutation flips nothing and the row is **vacuous**. That was row
11's parenthetical, generalised in round 9 after CF9-2 found the requirement stated for one
row out of seven, and extended the same round by C9-1: once the marker became a freshness
oracle, writing it into the fixture stopped being enough. Rows 12 and 23 are the deliberate
exceptions: their whole subject is an absent artifact.

**False-negative battery** (the check must stay quiet):

- a unit with no `dist` → `skipped`: no finding, and **named** in the PASS line's skipped slot (§4's **The `PASS` line NAMES SKIPPED UNITS**) — "not reported" has been wrong since round 5, and beside a coverage line it would read as a mandate to stay silent;
- `.tsbuildinfo` newer than every `.js` → clean — asserted **twice**: once for
  `checkUnitFreshness`, and once for `packages/cli` with `dist/.tsbuildinfo` touched
  forward PAST the marker, which must stay `compared` and must not become `unbuilt`
  (round 9). Measured on a composite fixture with the pinned `typescript@6.0.3`:
  `touch src/a.ts && tsc -b` moves `.tsbuildinfo` and no compiler output, so this is the
  only false positive clause 2 can produce and §3's exclusion is its entire mitigation;
- a `.info`/`.snap`/`.mjs` fixture under `src` newer than dist → clean;
- input mtime exactly equal to output mtime → clean;
- `.dts-cache/index.d.ts` regenerated with IDENTICAL bytes (a `--force` run on unchanged
  sources), mtime newer than `dist/index.d.ts` → clean. §3.5 keys on bytes, so a copy
  that already holds the current declarations is not a finding — and this is the row
  that fails if an implementer adds an mtime disjunct;
- `packages/cli/dist` absent AND the marker absent → `skipped`, **not**
  `bundle-provenance-missing`: the kind fires only on a unit that is otherwise `compared`,
  so a fresh clone stays silent (round 1's `C-1` and round 4's `C-R4-2`, re-opened for the
    kind round 9 made reachable on every unrebuilt tree);
- the marker PRESENT but truncated to half its bytes on row 11's complete fixture →
  exactly ONE advisory `bundle-provenance-missing`, reason
  `.bundle-meta/metafile.json unreadable`, `exitCodeFor(result, { strict: true })` → **0**,
  and **no throw**: a `readMetafile` that lets `JSON.parse` escape reaches §4's
  internal-error row and exits **2** from `check:all` member 0, halting the other 14
  (round 10, C10-3);
- cli `dist` present WITH a gap in §3.3's artifact set and the marker absent → `unbuilt`
    alone, never both kinds — the disjointness §3.3's cli table states, asserted rather than
  assumed;
- **the C10-4 conjunction, pinned rather than left as prose (round 10):** cli `dist`
  COMPLETE, marker ABSENT, `packages/cli/.dts-cache` ABSENT, and `dist/bin.js` rewritten as
  `tsc`-style per-file output importing `@crabgic/*` → the design's verdict is **PASS, exit
  0 even under `--strict`**, with exactly one advisory `bundle-provenance-missing` and
  THREE `not-run` coverage entries (`bundle-freshness`, `declaration-cache`,
  `shipped-declarations`; `plugin-assets` runs `full`). Clause 2 does not evaluate — no
  marker — and §3.5 declines — no cache — so nothing left can see it. The row asserts that
  verdict rather than a better one, because §8(i) states it as an accepted residual; what
  the row forbids is the verdict changing by accident in a later round.

**Wiring assertions.** The two source reads match
`check-support-window-freshness.test.mjs:543-544` and
`check-marketplace-pin-digest.test.mjs:353-358`; the source-ORDER comparison matches
`scripts/run-e2e-suites.test.mjs:31`, which is `indexOf(a) > indexOf(b)` with both
searches from 0 — the only positional precedent in `scripts/`, and the shape round 8
missed. The `package.json` reads deliberately do **NOT** copy those two files' `:530` and
`:339`: both are `expect(root.scripts["check:all"]).toContain("check:…")`, membership
only. That is all those two checks need; here it is exactly the assertion a member
appended LAST with no flag passes, while §5 orders this member FIRST and chains it with
`--strict` (CF9-3). So the chain is asserted BY INDEX:
`const members = root.scripts["check:all"].split("&&").map((s) => s.trim())
expect(members[0]).toBe("npm run check:stale-dist -- --strict") // position AND flag
expect(members.filter((m) => m.includes("check:stale-dist"))).toHaveLength(1)
// the two dist-reading members §5 orders it before: present, and after it
expect(members.indexOf("npm run check:tarball")).toBeGreaterThan(0)
expect(members.indexOf("npm run check:install-smoke")).toBeGreaterThan(0)
// no member COUNT is asserted, so a 16th member must not break this, and no ci.yml
// assertion: unlike the two files above, §5 proposes no CI step, so copying their
// second it() would pin a wiring this design refuses.
expect(root.scripts["check:stale-dist"]).toBe("node scripts/check-stale-dist.mjs")
expect(root.scripts.pretest).toBe("node scripts/check-stale-dist.mjs")
// No `pretest:watch` / `pretest:live` / `pretest:e2e` assertion, and that is a stated
// decision rather than an omission: npm's pre-hook is NAME-EXACT, so the four `test:*`
// siblings bypass this wiring and §5.1 states that as the measured bound rather than
// closing it (round 12, OP12-2). If a later round takes the reach, they are pinned HERE
// by equality in this same shape — never by membership, CF9-3's rule.

// The EXISTING-file edits, asserted by READING them — FOUR SOURCE PROPERTIES of
// `scripts/bundle-cli.mjs` (§1), out of the FIVE edits §1 makes to that file: the
// `writeFile` import is implied by the WRITE anchor below and is NOT separately
// asserted (round 12, CF12-4). Plus one in `.gitignore`. Without these an
// implementer builds the six new files, passes every battery row and the line
// above, and leaves requirement 3's comparison permanently muted.
const bundler = readFileSync("scripts/bundle-cli.mjs", "utf8")

// BOTH edits name `.bundle-meta`, so they are separated by DISTINCT fragments.
// Anchoring on the bare path finds the wipe-step CLEAR and passes with no write
// in the file at all — measured, round 9 / CF9-4.
const CLEAR = 'rm(join(CLI_ROOT, ".bundle-meta")'
const WRITE = 'writeFile(join(CLI_ROOT, ".bundle-meta", "metafile.json")'
const COPY = "for (const entry of PLUGIN_ASSET_ENTRIES)" // the loop at :177, NOT the const at :89
const EXPORTED = "export const PLUGIN_ASSET_ENTRIES = [" // §1's 4th edit; `:89` is a bare `const` today
const GUARD = "statSync(process.argv[1]).ino === statSync(fileURLToPath(import.meta.url)).ino"
const BARE_MAIN = "\nawait main();" // the file's LAST statement today, re-derived 2026-08-20
const BUILD = "await build({"
// COPY and BUILD each occur exactly once in `scripts/bundle-cli.mjs` today (measured
// 2026-08-20, `grep -cF`). CLEAR and WRITE occur ZERO times — they ARE the edits §1
// prescribes, and each must be introduced exactly once by them; `grep -n bundle-meta
// scripts/bundle-cli.mjs` returns nothing today. The mutants below are what prove the
// assertion sees their absence. "All four are unique in the file today" was an anchor
// claim asserted rather than measured, and false for half of them (round 10).

// ONE predicate, so the mutants below exercise the code the real tree exercises.
const placedCorrectly = (src) =>
src.includes(CLEAR) && src.includes(WRITE) &&
src.indexOf(CLEAR) < src.indexOf(BUILD) && // cleared before the build — C8-2
src.indexOf(COPY) < src.indexOf(WRITE) // written after the copy — round 7
expect(placedCorrectly(bundler)).toBe(true)

// NON-VACUITY, in the battery's own shape: one mutation each, every one must FLIP.
const lineWith = (t) => bundler.split("\n").find((l) => l.includes(t))
expect(placedCorrectly(bundler.replace(lineWith(WRITE) + "\n", ""))).toBe(false)
expect(placedCorrectly(bundler.replace(lineWith(CLEAR) + "\n", ""))).toBe(false)
expect(placedCorrectly( // write hoisted BEFORE the copy
bundler.replace(lineWith(WRITE) + "\n", "")
.replace(COPY, lineWith(WRITE).trim() + "\n " + COPY),
)).toBe(false)

// The two IMPORTABILITY edits (round 10, C10-2), in the same one-predicate,
// mutant-proved shape. Without them §3.3's clause 1 and §3.4's source side name a const
// no importer can obtain, and the only import that obtains one runs `main()` and
// rebuilds `packages/cli/dist` from inside the check that observes it.
const importable = (src) =>
src.includes(EXPORTED) && src.includes(GUARD) && !src.includes(BARE_MAIN)
expect(importable(bundler)).toBe(true)
// each mutant must FLIP the predicate — §6's battery discipline, applied here
expect(importable(bundler.replace(EXPORTED, "const PLUGIN_ASSET_ENTRIES = ["))).toBe(false)
expect(importable(bundler.replace(GUARD, "true"))).toBe(false)
expect(importable(bundler + BARE_MAIN)).toBe(false) // guard added, bare `await main()` left behind

expect(readFileSync(".gitignore", "utf8")).toContain("packages/cli/.bundle-meta/")`.

**One live smoke test** runs `checkStaleDist(REPO_ROOT)` and asserts only that it
returns, that every reported unit is a member of `enumerateRootReferences()`, and that
every `coverage` entry names one of the four cli-scoped comparisons and carries a
non-empty `reason` whenever its status is not `full` — no count and no named entry, so
it cannot rot as the repository grows or as the marker starts being written. Run against the tree at design time
the algorithm above returns four `stale-unit` findings (`packages/contracts`,

⚠️ **Plus one advisory `bundle-provenance-missing packages/cli` today — permanently, and
by design (round 9).** `packages/cli/.bundle-meta/` does not exist until `bundle-cli.mjs`
carries the change §1 specifies — measured 2026-08-20, `ls -d packages/cli/.bundle-meta`
returns no such file on a tree whose `dist` holds all three entry outputs, `index.d.ts`,
the six plugin entries and five chunks. So the first `npm test` after this lands prints one
advisory line for **every developer on a correctly built tree**, exit 0 even under
`--strict`, and one `npm run build` clears it.

Round 8 wrote that as a MIGRATION — `bundle-provenance-missing` "until the first build
after adoption". **The check holds no state, so "after adoption" is not a predicate it can
evaluate**: that tree and a build interrupted between `:178` and `:181` are byte-identical
on disk (C9-3). And §4, which is authoritative for output, carried no migration wording at
all, so an implementer following row 10 would have printed `unbuilt packages/cli` with the
remedy `rm -rf packages/cli/dist` to everyone on day one (O9-2). The rule is therefore
permanent and unconditional: an absent marker is `bundle-provenance-missing`, advisory,
never `unbuilt`; `unbuilt` comes from C9-1's freshness rule. The residual it leaves is
stated in §8(i).

**And the coverage line prints with it.** Measured on this working copy 2026-08-20:
`ls -d packages/cli/.bundle-meta` → no such file, while the five hashed chunks,
`.dts-cache/index.d.ts` and `dist/plugin` all exist. So today's live run renders exactly
one non-`full` entry —
`bundle freshness not run (.bundle-meta/metafile.json absent)`
— and requirement 3's comparison is the one thing this tree cannot cover. ⚠️ **The trailing
`— first build after adoption writes it` was deleted in round 10.** C9-3 dropped the
temporal qualifier from the RULE — thirteen lines above, this section already says "the
check holds no state, so 'after adoption' is not a predicate it can evaluate" — and §3.2
mandates this entry's reason verbatim as `.bundle-meta/metafile.json absent`, so a reason
carrying the migration wording is one the check can no longer produce. Recorded as a
measurement, not asserted by the test above, because it stops being true after the first
build.

`packages/engine-claude`, `packages/gates`, `packages/plugin`): a true report of this
working copy, and independent evidence the check is not vacuous against real inputs.

## 7. False-positive risks, each with its mitigation

| risk                                                                                                                                                                          | mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Touched-but-unchanged source (format-on-save, `git checkout` rewriting a file)                                                                                                | None available: a content oracle needs a persisted baseline, which is a twentieth build artifact with the same staleness problem (assumption 2). Remedy is one `npm run build`. Accepted by owner ruling. **It does NOT escalate to `unbuilt packages/cli`:** the only thing `tsc -b` moves in that case is `dist/.tsbuildinfo`, which §3's output set — and therefore §3.3's clause 2 — excludes. Measured on a composite fixture with the pinned `typescript@6.0.3`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A bare `npm run typecheck` (`tsc -b`) that re-emits, after a completed bundle                                                                                                 | Firing is CORRECT, and reports `unbuilt packages/cli` (clause 2), **plus four coverage entries reading `not run (packages/cli unbuilt)`** — §3.2 suppresses all four cli-scoped comparisons on this tree and nothing is absent, which is the routine tree round 10's C10-1 fix exists for. `tsc -b` overwrites `dist/bin.js` and `dist/index.d.ts` with per-file output that still imports `@crabgic/*` — `bundle-cli.mjs:105-112` states it, and `ci.yml`'s `packaging` job comments on the same fact as the cause of defect `25-install-smoke-depends-on-local-dist-state`. Verified: the live `dist/bin.js` imports `./chunk-FRJGAF5Y.js`, so a `tsc -b` over it destroys the bundle. Named here so nobody mutes it as noise.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Branch switch refreshing sources                                                                                                                                              | Firing here is CORRECT — it is the founding incident. Named so nobody mutes it as noise.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `npm run typecheck` clobbering `dist/index.d.ts` with `tsc`'s barrel                                                                                                          | Firing is CORRECT, and ⚠️ **clause 2 SUBSUMES this row — it is row 2's scenario, not a distinct one (round 10).** Measured 2026-08-20: `tsconfig.base.json:22-23` sets `declaration`+`declarationMap`, and no config sets `emitDeclarationOnly` or `noEmit` for `packages/cli`, so a `tsc -b` that writes the barrel `dist/index.d.ts` writes `dist/index.js` and `dist/index.d.ts.map` in the same emit. Those two ARE in §3's filtered output set, so `mtime(newest output) > mtime(marker)`, clause 2 fails, and the verdict is `unbuilt packages/cli — dist/index.js (…) is NEWER than the last completed bundle`. `packages/cli` is then `unbuilt`, so §3.5 and §3.2 do NOT run: neither `stale-shipped-declarations` nor `stale-bundle` fires, and the remedy is the `unbuilt` row's (`rm -rf packages/cli/dist` then `npm run build`), never recipe steps 3-4. `bundle-types.mjs:32-38` records the underlying incident `check-install-smoke.mjs` caught (`Cannot find module './exit-codes.js'` from an installed consumer), and §3.5 still keys on bytes for the reachable state its own section now names. Round 9 rewrote row 2 for clause 2 and left this row asserting pre-clause-2 behaviour. Named so nobody mutes it as noise. |
| Test fixtures under `src`                                                                                                                                                     | Input set restricted to `.ts` + `.json`; the other 15 of 18 non-`.ts` files under `src` are ignored.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Second-granularity mtimes                                                                                                                                                     | Compare strictly `>` on `mtimeMs`; equal is clean — and §3.3's clause 2 is the mirror, `>=`, so equal is clean there too. ⚠️ Ordering is asserted by `./mtime-propagation-probe.mjs`'s `ordering:` rows only for **writes more than a second apart** (`:74-75`, which calls `pastNextSecond()` between the two writes). The marker write at `bundle-cli.mjs:181` follows the plugin copy at `:178` by microseconds, which that probe does NOT cover — `>=` is precisely what makes the uncovered case safe (round 9).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Fresh clone, restored tarball, or a `dist/` left empty by `build:clean` or by a test's `mkdir`                                                                                | `unitState` returns `skipped` for all three (§3.3 reason-table rows 1 and 3) — a unit with nothing proving a build ran is not stale. The cost of covering the third case is residual §8(h): `build:clean` is indistinguishable from never-built.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Toolchain bump marking all 19 units stale                                                                                                                                     | Deliberately NOT implemented: putting `package-lock.json` in every unit's input set would make an unrelated `npm i` block a push. See §8 residual (b).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Check run while `npm run build` is mid-flight                                                                                                                                 | Not mitigable; a transient the operator caused. Documented in the header. **Round 9: the manifestation is now `unbuilt packages/cli`**, and the window is wide — `build` is `tsc -b && bundle:types && bundle:cli`, so for the whole ~5-minute `bundle:types` step the entry outputs are newer than the marker. `pretest` makes a second terminal running `npm test` hit it, and the printed remedy is `rm -rf packages/cli/dist`, aimed at a directory the running build is about to write — the same hazard §3.1 names for the journal scratch, on a second path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| A tree whose last build predates this change set (`.bundle-meta/` absent, `dist` complete) — **every developer's tree on day one, at every `npm test` until they build once** | Not a false positive — the check truthfully cannot verify provenance and says so. ⚠️ **But the cost is not provenance ALONE (round 10, C10-4):** §3.3's clause 2 is conditional on the marker ("**if** … exists"), so while it is absent C9-1's freshness oracle — the fix for the SEVENTH appearance of PASS-on-a-broken-tree — does not evaluate, and nothing reports that a unit-state clause was skipped: `skipped`/unit state stays UNIT-scoped (§2) while §4's coverage line is comparison-scoped, so it structurally cannot say it. On such a tree the only remaining oracle for `tsc -b` having overwritten a completed bundle is §3.5's byte comparison, which itself declines whenever `packages/cli/.dts-cache/index.d.ts` is absent. Accepted as a bounded residual naming that conjunction — §8(i), pinned by §6's false-negative battery. Reported as `bundle-provenance-missing`, **never `unbuilt`** (round 9, C9-3): the line says the CHECK is degraded, not that the tree is broken. Advisory: listed, exit **0** even under `--strict` (§4), and `pretest` carries no `--strict` (§5.1), so it warns without blocking `npm test`; remedy `npm run build`, never `rm -rf`. Measured 2026-08-20: `ls -d packages/cli/.bundle-meta` → no such file on a fully built tree (§6). Permanent and stateless — this tree cannot be told from a build interrupted between `bundle-cli.mjs:178` and `:181` (§8(i))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Stale `.d.ts.map` lingering after `declarationMap: false`                                                                                                                     | Makes `dist` look _fresher_ — a false negative, not a false positive. Named for completeness.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| §4's coverage line read as a failure on a clean tree (fresh clone, `meta-checks`, the marker-absent state §6 measures on this tree)                                           | It cannot change the verdict: exit code unchanged (§4, §8(j)), no finding, no remedy row. Every entry names, in the reason its own section mandates and rendered by §4's stated renderer, either the absent artifact or — for the four entries §3.2's `unbuilt` suppression produces, where nothing is absent — `packages/cli unbuilt` (round 10, C10-1); a marker that exists and does not parse names itself, `.bundle-meta/metafile.json unreadable` (round 10, C10-3). No entry claims a migration window: C9-3 deleted that wording from the rule, and round 10 deleted it from the last two places it survived — §6's live rendering and this cell. The alternative is the bare PASS round 9 filed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## 8. What this design does NOT establish

- **(a) Bootstrap — requirement 4, residual.** `packages/cli/package.json:22` declares
  `"crabgic": "dist/bin.js"`, so `crabgic doctor` is a compiled artifact and a stale
  `packages/cli/dist` runs a doctor registry that predates any check added to it. This
  design does not solve that; it _sidesteps_ it by living in `scripts/` (§1). No check
  can solve it from inside the tool, and `crabgic doctor` remains subject to it.
- **(b) Build program and toolchain — requirement 7, residual.** `scripts/bundle-cli.mjs`
  and `scripts/bundle-types.mjs` are read as INPUTS for one artifact each (§3.2, §3.3)
  and for nothing else. `bundle-cli.mjs` also produces `dist/plugin/**` (§3.4) and
  `dist/index.d.ts` (§3.5); both are compared against their own sources rather than
  against the producer, so editing it fires `stale-bundle` alone and not three findings. A `typescript` bump off `6.0.3` moves nothing the
  check reads, yet invalidates every `dist`. `.tsbuildinfo` is the only complete oracle
  and the research rejects it: no public interface describes its contents (three
  mentions in `typescript.d.ts`, all about the path) and it carries `version: "6.0.3"`,
  binding a parser to a compiler release.
- **(c) That the check DISCRIMINATES in CI.** It does FIRE there — `ci.yml:129` is
  `run: npm test` in the two-leg `test` matrix, so `pretest` runs **twice per push** —
  but `ci.yml:86` builds immediately before it, so it can only ever report clean. An
  earlier draft said the check "cannot fire in CI", which is the opposite of the truth
  and would have left a CI failure with no documented owner (round 5).
- **(d) Content correctness, with one stated exception.** The check answers "was the
  build re-run since its inputs moved", never "is the output right" — a rebuild producing
  byte-identical output still refreshes mtimes and still reports clean. The exception is
  `packages/cli/dist/index.d.ts`, which §3.5 compares BYTE FOR BYTE against
  `.dts-cache/index.d.ts`; that establishes the shipped copy is the bytes
  `bundle-types.mjs` last produced, and nothing about whether that cache is itself
  current — which is §3.3's mtime question, under §7 row 1's bound.
- **(e) Behaviour off WSL2/ext4.** Mtime ordering is asserted by a probe on this
  filesystem only, and only for writes more than a second apart
  (`mtime-propagation-probe.mjs:74-75`). Where mtimes are coarse or absent the four mtime
  COMPARISONS under-report and do not over-report. ⚠️ **§3.3's clause 2 is the one
  exception, added in round 9, and it CAN over-report.** It asserts that a write at
  `bundle-cli.mjs:181` carries an mtime no earlier than every write that preceded it in the
  same process. `>=` makes coarse granularity safe, but a clock that steps BACKWARD
  mid-build — an NTP correction, a network filesystem with its own clock — leaves
  `mtime(marker) < mtime(output)` on a correctly built tree and reports
  `unbuilt packages/cli`. Accepted as a residual rather than mitigated: the alternative is a
  monotonic build counter, which is a persisted build artifact carrying the same staleness
  problem assumption 2 rejects.
- **(f) Anything about the other 8 `e2e/*` tsconfigs.** All 8 set `noEmit: true`
  (`grep -l '"noEmit": true' e2e/*/tsconfig.json e2e/matrix/*/tsconfig.json | wc -l` → 8),
    emit no `dist`, and are outside the 19-unit enumeration by construction. `e2e/matrix`
  has no top-level `tsconfig.json` at all. ⚠️ **They ARE handed to a compiler by a build
  program, so requirement 9's wording reaches them and §8(l) counts them among its 9
  (round 12).** `scripts/check-e2e-types.mjs:40` runs `npx tsc -p <config> --noEmit` for
  exactly `E2E_TYPECHECK_PROJECTS` (`:24-32`), which is these 8 — re-derived 2026-08-20,
  as is the fact that each declares `"extends": "../../tsconfig.base.json"` (or
  `../../../`), so §3 rule 3 does not reach them (it covers `<unit>/tsconfig.json` for the
  19 root references only) and rule 4 does not either (it reaches only configs whose chain
  resolves INTO a unit). With (l)'s root config that is **9 of 30** outside every input
  set, which is why §0's requirement 9 row and §3 rule 4 both state **21 of 30**.
  `noEmit` is the whole of the bound: a config that emits nothing produces nothing that
  can go stale, which is why they are excluded from every input set by design rather than
  by oversight. Measured here, cited from §8(l) and §3 input rule 4.
- **(g) That 1:1 stem mapping is permanent.** It holds for all 18 tsc units today. A
  future `allowJs`, a `.tsx` file, or an emitted `.json` would break it — which the
  orphan check would report as a finding rather than silently mis-handle, and which the
  fixtures in §6 do not cover.
- **(h) That a `build:clean`ed unit is distinguishable from a never-built one.**
  `tsc -b --clean` deletes `.tsbuildinfo` along with the outputs, so a `--clean`ed unit
  and one nobody has ever built are byte-identical, and §3.3's reason table gives both the
  same `skipped`. Accepted rather than papered over, and bounded rather than open: §3.3
    records what `--clean` actually removes **from `packages/cli`** (the `packages/cli/`
  SUBSET of `npx tsc -b packages/cli --clean --dry` → exactly five deletions, nothing
  under `.bundle-meta/`, re-measured 2026-08-20; the whole command lists **4,781** across
  17 packages and the root `build:clean` **5,051** across all 19, because `--clean` cleans
  the reference graph — round 12, C11-2), so the cost is one verdict on one tree state and
  not a hole of unknown size. It is also why the
  verdict is a three-valued `unitState` and not a boolean (§2): a boolean must fold the
  empty tree into `stale`, which is noise on every fresh clone (CR6-2), or into `clean`,
  which is `PASS` on a tree with zero build output — round 3's `CR-2`, recorded there as
  "the worst available answer for the incident this check is named for".

- **(i) WHICH absence a missing marker is.** The check holds no state, so a tree built
  before this check landed and a build interrupted between `bundle-cli.mjs:178` and `:181`
  are byte-identical: the marker never existed in the first and existed-then-was-cleared in
  the second, and nothing on disk distinguishes them. Both report the advisory
  `bundle-provenance-missing`; requirement 3's comparison runs for neither, and no
  `unbuilt` verdict is inferred from the marker (round 9, C9-3). ⚠️ **And a SECOND cost,
  stated in round 10 (C10-4): while the marker is absent, §3.3's clause 2 does not
  evaluate at all.** Its predicate is "**if** the marker exists", so C9-1's freshness
  oracle is inert for exactly that window, and the coverage line cannot report it — the
  line is comparison-scoped while a clause of unit state is not (§2). The residual is the
  CONJUNCTION, named rather than left implicit: marker absent AND
  `packages/cli/.dts-cache/index.d.ts` absent, where §3.5's byte comparison also declines
  and a `tsc -b` that rewrote `dist/bin.js` over a completed bundle reports **PASS, exit 0
  even under `--strict`**. With the cache present the common case IS caught — but by §3.5,
  whose stated purpose is different, not by the clause written for it. Do NOT close it by
  making an absent marker `unbuilt` again: that is C9-3/O9-2, and it prints
  `rm -rf packages/cli/dist` to every developer on day one. Bounded rather than open:
    the marker is written last, so every earlier step is proven by §3.3's artifact set, and
  the second window is the milliseconds between two adjacent statements. ⚠️ **A THIRD
  cost, stated in round 12 (C11-6): while the marker is absent, clause 1 cannot verify the
  chunk SET.** Its membership is `metafile.outputs`-derived only when there IS a metafile;
  without one the clause falls back to "at least one file matching the pattern", so a
  `dist` holding one chunk of five passes clause 1, passes clause 3, and passes clause 2
  (which does not evaluate at all here — the first cost above), and the check reports
  **PASS, exit 0 even under `--strict`** on a `bin.crabgic` that dies with
  `ERR_MODULE_NOT_FOUND` (measured import graph, §3.3 clause 1). Bounded the same way as
  the other two: no repo script produces the state, and the first completed build both
  writes the marker and rewrites the whole chunk set. Accepted rather than closed by
  hardcoding a count, which would be a rule keyed on today's import graph. It self-clears —
  the first completed build writes the marker, and the wipe step clears it thereafter, so
  the state recurs only on a genuinely interrupted build. Accepted rather than papered
  over, in the shape §3.3 uses for `build:clean` at unit granularity. Round 8 tried to
  distinguish the two from the filesystem and produced the contradictory pair round 9 filed
  as CF9-2. ⚠️ **Round 10 merged two bullets that stated this same residual twice, and
  relabelled the tail of this section (i)/(j)/(k):** five bullets carried the label `(h)`,
  so all five citations from §4, §6, §7 and §9 resolved to whichever a reader hit first.
- **(j) That a degraded run is BLOCKED — only that it is stated.** §4's coverage line
  reports; it does not gate. A `not-run` bundle comparison — requirement 3's, the
  founding incident's own — exits **0** under `--strict`, so `check:all` passes on a
  tree where that comparison never ran. Enforcing it was rejected here as a scope
  expansion, and `check-citation-runs.mjs:274-288` is the shape to copy if it is ever
  wanted: FAIL only when NOTHING was verified, never on a partial. The state is live —
  `packages/cli/.bundle-meta/` does not exist until this change set lands (§6).
- **(k) That the bundler edits RUN in the asserted order.** §6 pins TEXT order inside
  `bundle-cli.mjs`'s single `main()` — clear before `await build({`, write after the
  plugin-copy loop. A write hoisted into a helper invoked earlier, or guarded by a
    condition, satisfies the assertion and still breaks the oracle. ⚠️ **The same bound now
  covers round 10's two importability edits (C10-2):** §6 reads that `:89` says
  `export const` and that `await main()` sits behind the ino guard; it does not establish
  that importing `scripts/bundle-cli.mjs` runs nothing. A top-level side effect added
  ABOVE the guard satisfies both fragments and re-opens the rebuild round 3 disclosed —
  from inside the check that observes `packages/cli/dist`. Text order is chosen
  because it needs no build; the honest claim is "the source says so", never "the process
  does". Stated in round 9, when the previous form of this assertion was measured to pass
    with no write in the file at all — a fix that replaced one overclaim with another would
  be the eleventh partly-true completion claim in this record.
- **(l) That the root `tsconfig.json` OR the 8 `e2e/*` `noEmit` configs are in any unit's
  input set — requirement 9, residual. NINE files, not one (round 12, C11-1).** `build` is `tsc -b && npm run bundle:types && npm run bundle:cli`
  (`package.json:15`), so a build program DOES hand the root config to a compiler, and it
  is in **no** unit's input set: §3 input rule 3 reaches it only by an upward `extends`
  walk and it declares none; rule 4 reaches only configs whose own chain resolves INTO a
  unit, and this one has `"files": []` plus 19 `references` and nothing else (re-derived
  2026-08-20 — `Object.keys` on the parsed file returns exactly `files, references`).
    ⚠️ **And the root config is not alone — `29` was the size of `enumerateTsconfigs`'
  RETURN, never the size of the covered set (round 12).** Re-derived 2026-08-20 by running
  §3's rules 3 and 4 over all 30 tracked configs: **21** land in some unit's input set (the
  19 unit `tsconfig.json` through rule 3, `tsconfig.base.json` through rule 3's upward
  chain, and `packages/cli/tsconfig.dts.json` through rule 4) and **9** do not — the root
  config plus the **8 `e2e/*` configs**, each of which declares
  `"extends": "../../tsconfig.base.json"` (or `../../../`), resolving to the root-level
  base and never INTO a unit, and none of which an upward walk from the 19 units reaches.
  A build program DOES hand those 8 to a compiler — `scripts/check-e2e-types.mjs:40` runs
  `npx tsc -p <config> --noEmit` for exactly `E2E_TYPECHECK_PROJECTS` (`:24-32`) — so
  requirement 9's own wording reaches them. They are bounded by **§8(f)**'s
  already-measured reason: all 8 set `noEmit: true`, so they emit no output that can go
  stale, and omitting them from the COUNT rather than stating that bound was standing
  rule 4 at the site of round 11's fix. Requirement 9 is therefore discharged for **21 of
  the 30** — the count against THIS bullet's own definition of discharge, membership of
  some unit's input set, and NOT §3 rule 4's 27 + 2 = 29 census population, which rule 4
  now states apart. The root config specifically is bounded rather than open, for two
  measured reasons: it carries **no `compilerOptions`**, so it contributes nothing to any unit's
  emitted output; and the one thing it does control — WHICH units exist — the check
  re-reads on every run, because §3 enumerates from this exact file
  (`enumerateRootReferences`, requirement 5), so a reference added or removed changes the
  unit list immediately rather than leaving a stale unit uncompared. Round 2 dispositioned
  this as `CF-B`, "accepted as a stated limit", and named §8 as where it would land; it
  reached no section for ten rounds (round 11).
- **(m) A DELETED plugin asset source — requirement 2, residual.** Delete
  `packages/plugin/skills/<x>/SKILL.md` and do not rebuild:
  `packages/cli/dist/plugin/skills/<x>/` survives and nothing reports it. Three sections
  each miss it for a different stated reason — §3.1 exempts `packages/cli` from orphan
  detection by construction; §3.3's clause 1 checks the six `PLUGIN_ASSET_ENTRIES` for
  top-level PRESENCE, not their contents; and §3.4 compares mtimes only, and a deletion
  raises nothing on the source side (whether a directory's own mtime counts is left to
  `newestOfEntries`' walk rather than settled here, because neither reading makes this
  comparison see it). `check:marketplace-pin` does not close it either: it digests the
  SOURCE (§3.4). Bounded: `bundle-cli.mjs:113-119` wipes `dist` — `KEEP` is `.tsbuildinfo`
  alone, re-derived 2026-08-20 at `:113` — so `dist/plugin` is removed and re-copied by
  the next completed `bundle:cli`, and the surviving file is an EXTRA rather than a stale
  one. Round 2 dispositioned this as `C-C`, "accepted as a stated limit"; like (l) it
  reached no section for ten rounds (round 11).
- **(n) That the check runs on a production-only install.** Round 10's C10-2 fix gives the
  check one repo-internal import, `scripts/bundle-cli.mjs`, whose `:59` is
  `import { build } from "esbuild"`, so `esbuild` must resolve at import time. Re-derived
  2026-08-20: it is a root `devDependency` (`package.json:61`, `0.28.1`), which `npm ci`
  installs, so `meta-checks` and every local invocation resolve it; an `--omit=dev`
  install does not. ⚠️ **What happens there depends on §1's IMPORT RULE, and the exit code
  this bullet stated was wrong for one round (round 12, OP12-1).** Under the mandated
  `await import(...)` at the entry module the throw lands in `check-stale-dist.mjs`'s catch
  and §4's internal-error row holds: `WARN`/exit **0** by default, `ERROR`/exit **2** under
  `--strict`. Under a STATIC entry import the resolve happens before the catch exists —
  measured 2026-08-20 (node v24.18.0, npm 11.16.0, nothing else running but the shell):
  `ERR_MODULE_NOT_FOUND`, a ten-frame node stack, no `check-stale-dist: ` line, and exit
  **1** with `--strict` AND without, which under `pretest` blocks `npm test` entirely —
  round 1's `O-2`. §6 row **31** proves the mandated form; without it this residual is a
  claim nothing tests. ⚠️ **And the reachability is wider than `--omit=dev`**: any
  incomplete or pruned `node_modules`, and any load-time throw anywhere in the six-module
  graph, lands in the same uncatchable window. Accepted rather than papered
  over, and bounded: no workflow
  under `.github/` and no root script installs with `--omit=dev` today (re-derived
  2026-08-20). §1 states the alternative that removes the residual entirely (a
  builtins-only `scripts/plugin-assets.mjs` both files import).

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

**Accepted as stated limits rather than closed — and round 11 finally put two of them in §8, ten rounds after this sentence named it.** CF-B is now **§8(l)** and C-C is **§8(m)**; the other two items DID land at the time — C-D in §3.3's chunk-predicate bound ("an artifact esbuild produces and no source in this repository would name") and O-A in §5.1's scroll-away limit — which is what makes the two misses falsifiable rather than a matter of taste. CF-B — the root `tsconfig.json`
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
⚠️ **That last disposition was partly true, and round 12 (OP12-3) is the eleventh of its
kind in this record.** The correction reached the paragraph that STATES the measurement;
the sentence that RESTS on it — the closing argument for report-and-continue — still read
"immediately above the failures" nine rounds later. Round 2's `O-A` and round 3's `OP-4`
both dispositioned it `fixed`, and both verifications read the measuring paragraph rather
than the argument. `grep -n "immediately above"` over the whole file returned two hits,
one of them live in §5.1.

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
printed `undefined undefined NaN` (round 4 wrote "eighteen times after `build:clean`"; round 12 re-derived that state as **18 `skipped` units and ONE `unbuilt packages/cli`**, so the count and the unit were wrong at the round that filed them — the finding stands, the example did not); seven remedies had
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
only one); `--clean` on `packages/cli` (exactly five deletions **in the `packages/cli/` subset** —
round 12 re-derived the whole command at 4,781 across 17 packages, and the root
`build:clean` at 5,051 across 19 — chunks and `plugin/**` survive); §6's four-`stale-unit` live claim, re-derived independently; and every count and
anchor. Walk timing 0.20-0.28 s over six runs, spread 0.08 s — wider than round 2's 0.06,
and the lens noted its machine was concurrently running vitest.

**Round 6 (2026-08-20) — three `revise`, nine findings, three high. The same failure
appeared for the FOURTH time, and the diagnosis is now exact.**

**CR6-3, high — `PASS` on a tree with no CLI, again, because the entry-output rule is
also a `tsc`-writable proxy.** The **`packages/cli/` subset** of
`tsc -b packages/cli --clean --dry` is exactly the three entry outputs plus `index.d.ts`
and `.tsbuildinfo` (round 12 re-scoped this: the whole command lists 4,781 across 17
packages) — so `tsc -b` alone satisfies round 4's rule. Interrupt `npm run build` during the **~5 minute** `bundle:types` step
and the tree has all three entries, no chunks, no `dist/plugin`, and a stale
`.bundle-meta/` that `rm -rf dist` never touched. Reported PASS, exit 0, on a tree with
no `crabgic` binary.

⚠️ **The four proxies are the whole lesson**, and they are recorded in order because
each looked sufficient at the time:

| round | keyed on                         | writable by `tsc -b` alone |
| ----- | -------------------------------- | -------------------------- |
| CR-2  | directory existence              | yes                        |
| 3     | output presence                  | yes                        |
| 4     | entry-output presence            | **yes**                    |
| 6     | an **esbuild-only** hashed chunk | no                         |

Three successive fixes chose something the wrong tool also produces. The rule is now
keyed on the one artifact only the bundler can make.

**CR6-1, high — round 5's scratch exclusion named ONE of two fixture families.**
`packages/journal/src/lease-fixtures/prepare-runtime.ts:60,:91` does exactly what the
crash family does — `SCRATCH_ROOT = packages/journal/dist`, `mkdtemp` into it, transpile
`.ts` to `.js`. A repo-wide `mkdtemp` sweep excluding `tmpdir()` bases returns exactly
these two. The exclusion is now `dist/eo-*-fixture-*/**`, which covers both and any third
following the convention.

**CR6-2, high — and that exclusion CREATED a false positive.** Both families call
`mkdir(SCRATCH_ROOT, { recursive: true })` and their `cleanup()` removes only the mkdtemp
directory, so `packages/journal/dist` persists **empty** after the first `npm test` on a
tree that was never built. With every remaining entry excluded, the next `pretest` would
report `unbuilt packages/journal` and print `rm -rf`. Round 5 would have turned a silent
wrong answer into a loud one. `unbuilt` now requires at least one non-excluded entry.

**CF6-1, high — and the exclusion had landed in ONE section.** §3's authoritative
_Per-unit output set_ had three `minus:` bullets and no scratch bullet; the exclusion sat
only in §3.1's prose. An implementer building `walk.mjs` from §2 and the output set from
§3 — the two places that define them — would have shipped no exclusion at all. It is in
the output set now.

**CF6-2 — the sixth consecutive partly-true completion claim.** Round 4's `C-R4-3` was
filed against §3.3's restated `unbuilt` remedy and dispositioned `fixed`; two rounds
later §3.3 still carried it. §3.3 now cites §4 rather than restating.

**OP6-1, OP6-2** — §4 banned `npm run bundle:cli` and then prescribed it as recipe step 4. The lens traced it and found the step genuinely **safe** — the ban's cause is
`.dts-cache` absence, and step 3 has just written that cache — so the fix was one clause
saying why, not a reorder. And the grouped `stale-unit ×N` line named only a count, which
makes step 1 unrunnable: the operator cannot `rm -rf` units nobody listed. It names them
now, matching what the success path already did.

ℹ️ **Six rounds, fifty findings, and a pattern worth stating plainly.** In four of six
rounds a fix in this design carried a defect, and three of those were caught only because
the fix was RUN rather than reasoned about. The design is 1000+ lines, seven finding
kinds, five comparisons — and the recurring failure has been a rule keyed on a proxy for
the thing it means. That is a property of the FULL design the owner selected, not of any
one round, and it is recorded here so the design-gate decision can weigh it.

**Round 7 (2026-08-20) — three `revise`, ten findings, three high. One is a REGRESSION
this design introduced in round 6, and one finally names the right oracle.**

**CR-1, high — round 6's `unbuilt` precondition REVERTED round 3's `CR-2` fix.** Round 6
required "at least one non-excluded entry" so that a test-created empty
`packages/journal/dist` would not report `unbuilt`. But `tsc -b --clean` deletes files and
leaves the directory, so after `npm run build:clean` **all 19 units hold zero entries**,
therefore zero non-excluded entries, therefore not `unbuilt`, therefore **clean** — the
exact state round 3 called "the worst available answer for the incident this check is
named for".

⚠️ **A count cannot carry the distinction, because a never-built tree and a `--clean`ed
tree both hold zero entries.** The rule is now keyed on WHY the directory is empty:
`.tsbuildinfo` alone is positive proof the unit _was_ built, so it is `unbuilt`; only
scratch means a test `mkdir`ed it and nothing was ever built, so it is `skipped`.

**CR-2, high — the chunk proves esbuild ran, not that the bundle completed, and esbuild
is step 2 of 5.** Verified order in `bundle-cli.mjs`: `:121` `build()` writes the chunks,
`:147` throws if `.dts-cache` is missing, `:153` copies the declarations, `:178` copies
the six plugin entries, `:181` reads the metafile. A fresh clone has no `.dts-cache`, so
`npm run bundle:cli` throws at `:147` — leaving chunks and entries present, and **no
declarations and no plugin assets**. Every comparison passes or skips, and the check
reports PASS on a `packages/cli` that would publish incomplete.

**So the oracle is the LAST artifact `bundle-cli.mjs` writes**, and the design now
requires the metafile write to be placed after the plugin copy. That is the fifth form of
this rule, and the reason the first four failed is identical each time: **they proved
something upstream of the thing that matters.**

| #   | oracle                        | proved                     |
| --- | ----------------------------- | -------------------------- |
| 1   | directory exists              | nothing                    |
| 2   | any output present            | `tsc` ran                  |
| 3   | entry outputs present         | `tsc` ran                  |
| 4   | an esbuild-only chunk         | esbuild ran — step 2 of 5  |
| 5   | **the last artifact written** | **the whole sequence ran** |

**CR-3, medium — mtime cannot see a partial plugin copy.** Interrupt the six-entry loop
after `agents/` and `dist/plugin` exists with a copy-time mtime, so the comparison reports
clean while the shipped CLI has no skills. Subsumed by the completion-marker rule, and
stated anyway.

**CF-1, high — §3.3 contradicted itself in two lines**, and §6's row 9 mandated the
refuted behaviour: an implementer who passed row 9 had not implemented the round-6 rule,
and one who implemented it failed row 9.

**CF-2, CF-3 — the wiring assertions copy one third of the shape they cite**, and the two
edits to EXISTING files are in no scope list. `pretest` — which §5.1 calls the ONLY
trigger that can fire on a stale tree — has no assertion anywhere; an implementer could
omit it, pass all 12 battery rows and the wiring test, and ship a check that never runs
automatically. Likewise `bundle-cli.mjs`'s metafile write and `.gitignore`'s entry exist
only in prose, so an implementer builds the six new files, passes everything, and leaves
requirement 3's comparison **permanently muted** — the vacuity class this change set
exists for.

**OP-1, OP-2 — `orphan-output` also printed `undefined … NaN`** (three kinds without a
delta, not two), and the `unbuilt` line said "holds no compiler output" in precisely the
case where `dist` holds four files. Round 6 changed the rule and not the sentence.

ℹ️ **Seven rounds, sixty findings.** Rounds 6 and 7 each produced a materially better
rule rather than another patch — the proxy diagnosis, then the completion-marker oracle —
but round 6's own fix also reverted round 3's. **A fix that narrows one failure can
re-open another when both are governed by the same predicate**, and neither round noticed
because each tested its own scenario and not the other's. That is the argument for the
battery rows CF-1 exposes as contradictory, and for treating this design's size as a
finding in its own right at the gate.

**Round 8 (2026-08-20) — three `revise`, fifteen findings, four high. Standing rule 8
fired on BOTH of round 7's fixes, exactly as it predicts.**

**C8-2, high — the completion marker was never invalidated, so it proved that SOME build
once finished.** `bundle-cli.mjs:63` sets `OUT_DIR` to `dist`, and the wipe at `:113`
iterates that directory only — so `packages/cli/.bundle-meta/`, a **sibling** of `dist`,
survives both the wipe and the design's own `rm -rf packages/cli/dist`. Round 6 had
already recorded "a stale `.bundle-meta/` that `rm -rf dist` never touched", while the
marker was not yet the oracle; round 7 promoted it without changing that. On a
previously-built tree, `rm -rf packages/cli/dist && npx tsc -b packages/cli` then yields
three entries, no chunks, no `dist/plugin`, a surviving marker — and **PASS, exit 0**.
Sixth appearance of the founding failure, introduced by the fix for the fifth. The marker
is now **cleared in the wipe step** and written after the plugin copy, so it marks the
build it belongs to.

**C8-1, high — the reason table could not see the reason.** Round 7 made an empty `dist`
`unbuilt` on the reasoning "it was built once and the outputs are gone". But both journal
fixture families `mkdir(SCRATCH_ROOT)` and then `rm(dir, …)` — the **mkdtemp directory,
not the root** — so a fresh clone that has run `npm test` once has an EMPTY
`packages/journal/dist`, and the next `pretest` reports `unbuilt` on a tree nobody built.
CR6-2, re-opened by the fix that replaced CR6-2's fix.

⚠️ **And nothing at unit granularity distinguishes the two states** — `tsc -b --clean`
deletes `.tsbuildinfo` too, so a `--clean`ed unit and a never-built one are byte-identical.
The empty case is therefore `skipped`, and `build:clean` is **accepted as indistinguishable
at unit granularity** and stated as a residual. It is not undetectable overall:
`packages/cli`'s marker lives outside `dist` and is now cleared per build, so a `--clean`ed
tree still reports `unbuilt packages/cli`.

**CF8-1, high — and this is the ninth consecutive partly-true completion claim, inside a
fix written to end that pattern.** Round 8's own §1 addition said "§6 asserts both by
reading the files". §6's entire wiring block was one `toContain` line. The assertions are
in §6 now — `toBe` on both scripts, a source-order check that the metafile write follows
the plugin copy, and a `.gitignore` read — in the three-part shape
`check-support-window-freshness.test.mjs:530` uses, which §6 had been citing while copying
one third of it.

**CF8-2 — the same rule change broke two battery rows nobody looked at.** Row 10's single
mutation mandated one kind while §3.3 mandated two, and row 11's "clean" fixture had no
metafile, so it was already `unbuilt` and the mutation flipped nothing — **vacuous**, the
defect class this change set exists for. Both fixed, and §3.3 now states precedence:
`unbuilt` wins, because it names the tree's state while `bundle-provenance-missing` would
say the check is degraded when the bundle is.

**CF8-3, CF8-4, CF8-5, CF8-6, CF8-7, C8-4, O8-1..O8-3** — `Unit.built: boolean` could not
carry a three-way verdict and is now `state`; §3's authoritative skip bullet still stated
the round-1 rule while the rule it consumes had moved four times 220 lines away; `pretest`
had **no assertion anywhere** despite §5.1 calling it the only trigger that can fire on a
stale tree; and §6's live prediction omitted `unbuilt packages/cli`, which is also the
**day-one migration** — every developer would see it on a correctly built tree until the
first build writes the marker, so a _missing_ marker on an otherwise-complete `dist`
reports `bundle-provenance-missing` with a migration note instead.

**C9-2, high — §3 excluded a second artifact and pointed at a section that never read
it.** `dist/index.d.ts` was excluded from `packages/cli`'s output set with the pointer
"handled as its own artifact in §3.3", while §3.3 compares against
`.dts-cache/index.d.ts` only — **no comparison in the design read the shipped copy at
all**. Re-derived from §4's own recipe: run step 3 (`bundle:types -- --force`) and stop,
and the cache is fresh, `stale-declarations` clears, the marker and `bundleAt` are
untouched, and the check prints PASS with the published `types` entry stale. CF-2's shape
at the second excluded artifact. Closed by §3.5's sixth comparison — and keyed on BYTES,
not mtime, because `bundle-types.mjs:32-38` records that `tsc -b` clobbers that exact file
with a barrel AND refreshes its mtime, which `check-install-smoke.mjs` caught as a real
shipped defect. The proposed mtime predicate would have been the fifth tsc-writable proxy
in this design, introduced by the fix for the sixth recurrence.

**Round 9 (2026-08-20) — CF9-2, high.** §6's battery row 10 and §6's own day-one
migration rule mandated OPPOSITE verdicts for one tree state, 44 lines apart, and the
migration rule's escape clause ("once the marker has existed and gone — which the
per-build clear makes observable") is unimplementable: the check sees one filesystem
state, not a history. Round 8's precedence rule then made `unbuilt` win in every reachable
case, so `bundle-provenance-missing` had **zero** non-vacuity rows and no reachable state
— a kind hardcoded never to fire, created by the fix that removed its only row. Resolved
by moving completeness off the marker onto the artifact set (`:121` chunk + 3 entries,
`:153` `dist/index.d.ts`, `:178` six plugin entries) and leaving the marker as §3.2's
provenance record: the two kinds are now disjoint by construction and need no precedence.

⚠️ **Round 8's disposition said "§3.3 now states precedence"; the text went into §3.2**
(`grep -n precedence` → row 10's citation and `:328` only), so row 10 cited a rule its own
section did not contain — the tenth consecutive partly-true completion claim, and the
third whose cause was the cross-reference rather than the rule.

**Round 9 (2026-08-20) — `C9-1`, high: the SEVENTH appearance of `PASS` on a broken tree,
and the first where the fix could not run at all.** Round 8 invalidated the completion
marker by clearing it in `bundle-cli.mjs`'s wipe step. But `build` is
`tsc -b && npm run bundle:types && npm run bundle:cli` (`package.json:15`), so an interrupt
during the ~5-minute `bundle:types` step means `bundle-cli.mjs` never executes and the clear
never fires — reached from this design's own printed remedy. Measured:
`rm -rf packages/cli/dist` then `tsc -b packages/cli` writes exactly `dist/bin.js`,
`dist/index.js`, `dist/index.d.ts`, `dist/bin/supervisord.js` and `.tsbuildinfo`; the
previous build's marker survives beside `dist`; no chunks, no `dist/plugin` — **PASS,
exit 0**.

⚠️ **The lesson is new, and it is not "another proxy".** Forms 1-4 failed by keying on
something the wrong tool also writes. Form 5 keyed on the right artifact and failed because
its INVALIDATION lived inside the tool that did not run. The marker is now a **freshness**
oracle — present AND no older than the newest qualifying compiler output under
`packages/cli/dist` — and the write-after-copy placement is what makes that invariant true
after every completed bundle and false in every failure class.

⚠️ **Standing rule 8 fired three times while fixing it.** Reading the comparand as raw
`dist/**` would (i) re-open §7 row 1 — measured on a composite fixture with the pinned
`typescript@6.0.3`, `touch src/a.ts && tsc -b` moves `dist/.tsbuildinfo` and no compiler
output — and (ii) vacate §6 row 7, whose entire mutation is touching
`dist/plugin/.mcp.json` to now. And replacing round 4's entry-output clause with freshness
would re-open `C-R4-1`, because a deletion LOWERS the newest output mtime and makes the
marker look more current. The comparand is §3's filtered output set, and the rule is a
conjunction of three clauses, none of which replaces another.

ℹ️ **One live inconsistency was found by the site walk rather than by a lens**: §2's `Unit`
comment still declared `built: boolean` two lines above the round-8 note stating it is "NOT
a boolean" — `CF8-3`'s fix reached the note and not the type. The tenth partly-true
completion claim in this record, and the first caught by walking every site a finding
governs before writing any of them.

### Owner ruling, 2026-08-20 — keep the full design

⚠️ **The counts below are the ones put to the owner AT ROUND 8's CLOSE and are not restated
as current (round 12).** Rounds 9, 10, 11 and 12 followed the ruling and are logged above and
below this subsection; the ruling itself — keep the full design and keep iterating — is
unchanged by them. The manager put the accumulated evidence to the owner: eight rounds, seventy-five
findings, one failure recurring six times with each fix introducing the next, and nine
consecutive partly-true completion claims. The alternatives offered were narrowing to the
single bundle-freshness comparison, going to the gate as-is, or splitting the work.

**The owner ruled: keep the full design and keep iterating.** Recorded here rather than
argued again — the concern was raised with its evidence and reaffirmed, which makes it the
owner's call. What the rounds have produced is real: five successive oracles ending in one
that is right for a stated reason, and a design that now names its own residual limits
rather than discovering them.

**Round 9 (2026-08-20) — C9-3/O9-2, medium — the day-one migration rule needed a history
the check does not have.** Round 8 made a missing marker report `bundle-provenance-missing`
"until the first build after adoption writes it", but the check holds no state. Measured
2026-08-20: `packages/cli/.bundle-meta` does not exist while `dist` holds all three entry
outputs, `index.d.ts`, the six plugin entries and five chunks — so this tree is already in
that state, permanently indistinguishable from a build interrupted between `:178` and
`:181`. And §4, authoritative for output, carried no migration wording, so an implementer
following battery row 10 would print `unbuilt packages/cli` with the remedy
`rm -rf packages/cli/dist` to every developer on day one. The temporal qualifier is dropped:
an absent marker is `bundle-provenance-missing`, advisory, unconditionally; `unbuilt` comes
from C9-1's freshness rule.

⚠️ **Standing rule 8 fired again, and is answered in the fix.** Removing the marker from
the `unbuilt` predicate re-opens round 7's CR-2 unless that rule keys on `dist/index.d.ts`
(`:153`) and `dist/plugin/**` (`:178`) — the artifacts the `:147` throw leaves absent.
Sites changed: §1's why-cell and battery count; §2's `checkBundleFreshness` signature,
`readMetafile` and `ADVISORY_KINDS`; §3.2's absence bullet (precedence deleted); §3.3's
rule, "final form" summary, proxy chain, entry-output referent, `--clean` reason and BOTH
skip-rule sentences; §3.4's "subsumed by" clause; §4's line shape, remedy row and exit
table; §6's rows 10-11, new row 13 and the day-one paragraph; §7's new row; §8(i).

**Round 9 (2026-08-20) — CF9-4, high: the source-order assertion round 8 added to END
the vacuity pattern was itself vacuous, measured.** §6 read
`bundler.indexOf(".bundle-meta", bundler.indexOf("PLUGIN_ASSET_ENTRIES"))`
`.toBeGreaterThan(bundler.indexOf("PLUGIN_ASSET_ENTRIES"))`. `indexOf(needle, from)`
returns `>= from` or `-1`, so the comparison can only restate "found something"; and the
anchor is `PLUGIN_ASSET_ENTRIES`'s **declaration** at `bundle-cli.mjs:89`, not the copy
loop at `:177`. Round 8's own wipe-step clear at `:113` supplies the passing occurrence.
Measured on mutated copies of the real bundler:

- write placed right after `build()`, **36 lines BEFORE** the copy loop: **passes**;
- write **ABSENT ENTIRELY**, only the round-8 clear present: **passes**, and
  `expect(bundler).toContain(".bundle-meta")` passes alongside it.

So both bundler assertions were satisfied by a tree in which requirement 3's comparison
is **permanently muted** — verbatim the failure §1's existing-file table was added to
prevent, and the tenth consecutive partly-true completion claim. CF8-1's citation was
wrong too: `check-support-window-freshness.test.mjs:530` asserts `package.json`, so §6
was copying a shape that does not read a file at all.

**Fixed** with two DISTINCT fragments (the clear and the write are indistinguishable by
path alone), two-`indexOf`-from-zero comparisons in `run-e2e-suites.test.mjs:31`'s shape,
and three mutants that must FLIP the predicate — §6's own battery discipline, applied to
the wiring assertions for the first time. §0, §1, §3.2, §3.3 and §3.4 were reconciled in
the same pass, and §8(k) now states what source-order text still does not establish.

**Round 9 (2026-08-20) — CF9-1, high: the struct still declared the boolean its own
footnote refutes.** §2 read `built: boolean` eighteen lines above its own note asserting
`state ∈ compared | unbuilt | skipped`, "never a boolean" — and round 8's entry above
claims that field is "now `state`". The ℹ️ note above records how it was found: the site
walk, not a lens, and the tenth partly-true completion claim in this record. The
disposition is that the field is REMOVED, not renamed. A `Unit` carries no state flag of
any kind, because `buildUnits` never reads `dist/` and so cannot know one; the verdict is
`unitState()`'s alone, computed once by `checkStaleDist` (§2). §3's skip rule now states
WHICH comparisons each of the three states runs, because "which comparisons run" is the
thing `built ? compare : skip` gets wrong. Three further sites carried the old predicate:
§3.3's first table said an existing-but-empty `dist` is `unbuilt` while its own reason
table says `skipped`; §4's `unbuilt` line shape hard-coded a sentence that is false for
the cases rounds 6 and 8 added, and now prints `unitState()`'s reason verbatim; and §6's
battery exercised one of the three states, so a boolean implementation passed every row.
§6 now keeps the three apart with one fixture per state (§2), and the cost of the third
state is recorded as residual §8(h).

**Round 9 (2026-08-20) — CF9-3, medium: the wiring assertions could not see the wiring.**
§6 pinned `check:all` membership with `toContain`, which pins neither the member's
POSITION nor the `--strict` on the chained form. §5 requires index **0** — ahead of
`check:tarball` (member 12) and `check:install-smoke` (member 13), citing defect
`25-install-smoke-depends-on-local-dist-state` — so an implementer appending it last with
no flag passed every assertion and shipped a check that runs after the two members it was
ordered before and exits **0** on a stale tree: every assertion green, the wiring's entire
value gone. Now pinned by INDEX and by equality on the full member string (§5). And
`package.json` joins §1's existing-file table, which had listed two of the three files
this change set must edit while its three script edits lived only in §5/§5.1 — the same
shape as CF9-4's finding one paragraph above, at the third file.

**Round 9 (2026-08-20) — O9-1, medium: the coverage the check computed was never
printed.** `comparisonsSkipped` appeared exactly ONCE in this design — §2's signature —
had no line shape in §4 and no battery row in §6, so on a tree whose bundle provenance was
missing the operator read `PASS — 19 units compared, 0 skipped` while requirement 3's
comparison had not run at all. A count also cannot say WHICH comparison declined, nor
carry the reason §4 prints. Disposition: replaced by §2's
`ComparisonCoverage = { comparison, status, reason }`, returned by all four cli-scoped
comparisons; §4 gains the coverage line, printed on BOTH the PASS path and the findings
path; §6 gains the rendered-text rows, which assert `formatFindings`' output because a row
reading `result.coverage` goes green on the exact defect it exists to catch. `skipped`
stays UNIT-scoped: naming skipped UNITS and not skipped COMPARISONS is round 5's own fix
one level up.

**Round 10 (2026-08-20) — four findings, all re-derived and all `fixed`, cited by
identifier from §0, §1, §2, §3.2, §3.3, §3.4, §3.5, §4, §6, §7 and §8.** Recorded here in
round 12 (C11-7/CF12-2), because rounds 10 and 11 dispositioned at the sites they govern
and left §9 without an entry — so "all dispositioned" was true but uncheckable from the
record the gate reads. Measured before writing this: six IDs (`C10-1`, `C10-2`, `C10-3`,
`C10-4`, `O9-1`, `OP11-2`) carried **37** citations in the body against a §9 that stopped
at round 9.

- **C10-1, high — a `not-run` cause with no reason this design could spell.** All four
  cli-scoped comparisons are suppressed when `unitState("packages/cli").state ===
  "unbuilt"` (§3.2), and on that tree NOTHING is absent, so a coverage entry keyed on
  absence had nothing to name. The tree is the most routine there is — §7's
  `npm run typecheck` row — and it printed one `unbuilt` finding and no coverage line at
  all, which §4's recipe step 5 reads as "all six ran". `not-run` now has exactly TWO
  mandated causes, the second carrying the verbatim reason `packages/cli unbuilt`,
  evaluated BEFORE any comparison inspects its own comparand.
- **C10-2, high — the design's one repo-internal import could not be taken.** §3.3's
  clause 1 and §3.4's source side both read `PLUGIN_ASSET_ENTRIES` from
  `scripts/bundle-cli.mjs`, but `:89` is a bare `const` (re-derived: `grep -n "^export"`
  returns `:71` `EXTERNAL_DEPENDENCIES` and nothing else), and the file's last statement is
  `await main()`, so the only import that DID resolve would rebuild `packages/cli/dist`
  from inside the check that observes it. Two further edits — `export` the const, and put
  `await main()` behind the ino entry-point guard `scripts/repo-census.mjs:382` uses —
  raising the file to **five** edits, of which §6 asserts **four source properties**. The
  import also resolves `esbuild` at load time: residual §8(n).
- **C10-3, medium — `readMetafile`'s `object | undefined` signature was an invitation to
  throw.** The marker is 404,198 bytes over 758 inputs written by a plain `writeFile`, so
  a truncated one is reachable on a tree where every artifact is complete. Absent OR
  unparseable ⇒ `undefined`, never a throw, with a second mandated reason
  `.bundle-meta/metafile.json unreadable`.
- **C10-4, medium — §3.3's clause 2 is conditional on the marker, and the design said so
  nowhere.** C9-1's freshness oracle is inert for exactly the window in which the marker
  is absent. Stated as the CONJUNCTION residual in §8(i) and pinned by a false-negative
  battery row that asserts the accepted verdict rather than a better one.

Round 10 also deleted `reduced` as unreachable (§2, §3.2), relabelled §8's tail
(i)/(j)/(k) after five bullets carried the label `(h)`, and appended battery rows 24-25.
⚠️ **And round 10's own bulk apply wrote editor directives into the design as document
text** — the finding that produced the standing lesson that an apply step needs a guard on
WHAT it inserts, not only on WHERE.

**Round 11 (2026-08-20) — 60 consolidated edits applied; `OP11-2`, high, plus four
author-side site walks, all `fixed`.** `OP11-2`: §4's internal-error row had no owner in
§2 and no row in §6 — `exitCodeFor` takes a `result` and a throw yields none, `kind` has no
error member, and §1 gave `check-stale-dist.mjs` "arg parsing, CLI" and no catch. Closed
by `formatInternalError(err, { strict })` in `report.mjs`, called from that file's
try/catch, with both line texts written out and §6 row 27 exercising it. The round's four
other subjects: the preamble's intra-document citation rule, after
`grep -on '§[0-9][0-9.]*:[0-9]'` returned SIX anchors all resolving to the wrong text;
§8 gained **(l)** and **(m)**, the two round-2 dispositions that had reached no section for
ten rounds, and §0's requirement 2 and 9 rows gained the pointers that stop them claiming
unqualified discharge over a measured gap; §3 rule 4 gained its tsconfig arithmetic where
the input sets are DEFINED; §2's delta-less kinds are NAMED rather than counted; and §5's
self-referential `run check:all` grep was re-scoped. Battery rows 26-30 were appended.

⚠️ **Round 11's first apply CORRUPTED this document and the corruption was caught, not
shipped.** One edit's replacement text contained a dollar sign immediately followed by an
apostrophe, which JavaScript's `String.replace` expands to "everything after the match" —
it spliced the rest of the file back in and doubled it to **4499** lines. Reverted and
re-applied with a function replacement plus a line-delta guard. ⚠️ **The hazard is still
live in the document, and round 12 re-derived it:** three lines carry that sequence inside
backticked shell commands and one carries a dollar-backtick, so every future apply
touching them must use a function replacement — now a standing rule in this file's
preamble. Round 12 checked the CURRENT document for residual damage of that class —
**2574** lines, no duplicated headings, no duplicated long line, no placeholder standing
in as document text — and found none.

**Round 12 (2026-08-20) — `contract-fit` / `correctness` / `operability`, seventeen
findings: `CF12-1`, `CF12-2`, `CF12-3`, `CF12-4`, `C11-1`, `C11-2`, `C11-3`, `C11-4`,
`C11-5`, `C11-6`, `C11-7`, `OP12-1`, `OP12-2`, `OP12-3`, `OP12-4`, `OP12-5`, `OP12-6`.**

- **`CF12-1`** — §0's requirement 9 row carried an unescaped `|` inside a code span, so
  GFM truncated the cell and dropped the whole bounded-residual statement round 11 had
  just added. The preamble gains an escape-aware row census; the naive form reports a
  correctly escaped row as malformed and so can never return nothing.
- **`CF12-2`** — the round-11 citation rule was enforced only against `§N:line` anchors, so
  a NAME or an ID that resolves to nothing passed it. Two more preamble passes, both
  scoped below `## 0.`; four `PASS-line rule` citations renamed; this section's missing
  entries written.
- **`CF12-3` / `C11-1`** — requirement 9's numerator was the enumeration's return size
  (29), not the covered set (21); nine configs are uncovered, not one.
- **`CF12-4`** — §1's five `bundle-cli.mjs` edits were summarised as four, and §0 and §3.2
  still said two.
- **`C11-2`** — the `--clean` residual was bounded by a scoped measurement read as
  unscoped: `npx tsc -b packages/cli --clean --dry` lists **4,781** deletions across 17
  packages (the `packages/cli/` subset is the five named), and the root `build:clean`
  **5,051** across all 19 units. `build:clean` is also caught by clause 1, not clause 3
  alone.
- **`C11-3`** — §4's `eighteen times over` example described a state that yields 18
  `skipped` and ONE `unbuilt`, and the line printed there blames a step the operator never
  ran; §3.3's cli reason table gains the `--clean` signature's own reason.
- **`C11-4`** — the unfiltered `check:all` figure was wrong at the commit that wrote it
  for the third time (measured: filtered 6, unfiltered 10, design said 9) and is deleted
  rather than corrected.
- **`C11-5`** — `--json` plus an internal error emitted a human line onto the JSON stream:
  the failure `bundle-types.mjs:63-68` records this repository shipping.
- **`C11-6`, advisory** — clause 1's chunk member was an at-least-one test over a set §3.2
  takes a minimum across. Measured: `bin.js` → `chunk-FRJGAF5Y.js` → three more chunks, so
  deleting three of four leaves a PASS on a `bin.crabgic` that dies with
  `ERR_MODULE_NOT_FOUND` — the eighth appearance of the founding failure.
- **`C11-7`, advisory** — this section, which had no entry for rounds 10 or 11.
- **`OP12-1`** — §4's internal-error row cannot see a LOAD-TIME throw: a static ESM graph
  is linked before the entry module's first statement runs, so the catch is not on the
  stack. Measured on this design's own shape: `ERR_MODULE_NOT_FOUND`, a ten-frame stack,
  no prefixed line, exit **1** with `--strict` AND without — under `pretest` a total block
  on `npm test`, round 1's `O-2` re-opened by omission. §1 gains an IMPORT RULE.
- **`OP12-2`** — §5.1's honest bound named ONE bypass; npm's pre-hook is name-exact and
  this repository declares four `test:*` siblings, so the measured set is **five**, and
  `test:watch` is the founding incident's own context.
- **`OP12-3`** — §5.1's closing argument still read "immediately above the failures" 25
  lines below the paragraph measuring it at ~199 lines; rounds 2 and 3 both dispositioned
  it `fixed` and both verifications read the measuring paragraph rather than the argument.
- **`OP12-4`** — §4's ordered remedy plan had no owner in §1 or §2, no position in the
  prefix rule and no battery row for twelve rounds.
- **`OP12-5`** — the internal-error line carried no locus (`JSON.parse` messages name no
  file) and told the operator nothing about the re-run or the 14 members that did not run.
- **`OP12-6`** — the `String.replace` hazard is a property of the apply step, now stated
  as document text rather than as one round's remedy.

Battery rows **31-34** were appended, nothing renumbered.
