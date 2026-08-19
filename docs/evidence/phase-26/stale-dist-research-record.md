# Research record — a doctor check for a stale built `dist`

**Change set:** `cbd21c01-0588-41e4-b297-a34794b3a8b6`
**Stage:** `research` · **Obligations:** `research-questions-answered`,
`research-no-silent-assumptions`, `research-prior-art-checked`

## Why this change set exists

Not a hypothetical, and it spans two days — a distinction round 6's
source-quality lens was right to force. The stale `packages/gates/dist` was
produced on the evening of **2026-08-18**; the failures were observed on
**2026-08-19**, before the 09:14 rebuild that cleared them
(`./stale-dist-incident.md` §1). A stale `packages/gates/dist` made the
`packages/cli` suite import a built `@crabgic/gates` that predated
`registerCoverageGate`, producing **83 failures with one cause**. It was
misdiagnosed twice — first as a product flake with an invented "2 in 9" rate,
then as possible npm contention — and it blocked two pushes. The measurement
that settled it was one line:

```
dist/index.js  21:37     src/coverage-gate-registration.ts  21:46
```

⚠️ **Reported, not reproducible — cite them that way.** These mtimes, the "83
failures", the "6 of 6" in Q1 and Q3's "green on the same commit" were read during the
session that hit this and were NOT logged to a committed file at the time.
`./stale-dist-incident.md` carries what can still be shown and states plainly
what it cannot: a reader "cannot re-derive the specific counts". Nothing
downstream may cite these numbers as reproducible, and Q3's "it was green"
observation has no artifact behind it at all.

This disclaimer covers ONLY that observation. Q3's OTHER claim — that CI builds
from scratch and so can never observe a stale `dist` — is a present, checkable
fact about the workflow files, and is cited as one in Q3. Bundling the two under
one blanket label would have told a design-stage reader not to cite something
that is perfectly citable (round 5, assumption-audit lens).

`tsc -b`'s incremental state did not rebuild across a branch switch. **This is
now measured rather than asserted** (round 5, completeness lens), from the reflog
and git history:

All four events below are on **2026-08-18** — the table originally gave times
with no date, which invited exactly the confusion the lens caught:

| time (2026-08-18) | reflog event                                                   |
| ----------------- | -------------------------------------------------------------- |
| 21:36:42          | `checkout: moving from feat/coverage-report-reader to main`    |
| **21:37**         | **`dist/index.js` mtime**                                      |
| 21:46:40          | `checkout: moving from docs/citation-unresolved-paths to main` |
| 21:46:41          | `pull --quiet: Fast-forward` → `4414a16`                       |
| **21:46**         | **`src/coverage-gate-registration.ts` mtime**                  |

`packages/gates/src/coverage-gate-registration.ts` is **absent** at `8605760`
and **present** at `4414a16` (`git cat-file -e`), so the 21:46:41 fast-forward is
what materialised it on disk — which is why its mtime is 21:46 to the minute.
`dist/` is gitignored (`.gitignore:5`), so that same checkout did not touch
`dist/index.js`, leaving it at 21:37. Source moved forward; compiled output did
not. No automated check compares the two, which is the gap this change set
addresses — see Q2 for the repo-wide search that establishes it, and for what
that search found once it was finally run over the whole tree.

## Questions this stage had to answer

**Q1. Is the failure mode real and repeatable, or was it one bad afternoon?**
Repeatable: **6 of 6** consecutive full runs failed identically while the source
was correct. It is not a race — it is a deterministic consequence of a stale
artifact, which is why it is so convincing as a "flake".

**Q2. Does anything already detect it?**
**Nothing detects the incident — but the mechanism is already in this
repository, and nine rounds of review searched the wrong places for it.**

⚠️ **The search that settles this, stated so its scope can be checked against
the claim.** A universal negative needs a repo-wide corpus; every earlier
version of this answer cited two directory-scoped searches instead, which is
exactly how it went wrong. `scripts/check-claim-scope.mjs` now flags that
mismatch mechanically, and flagged THIS section on its first run:

```
git ls-files | xargs grep -ln "mtime"              # 28 files (2026-08-19)
git ls-files | xargs grep -ln "mtimeMs\|statSync"  # 53 files (2026-08-19)
```

`scripts/bundle-types.mjs` is in both. Every other hit is documentation, a test,
or an unrelated use of `mtime` — a temp-directory sweep cutoff, a generic
`FsStat` field, a git index side effect — and none is a second build-staleness
comparison. **Read the whole 28 before trusting that sentence**; it is the point
of quoting the command.

⚠️ **Two defects here, both found by round 11's source-quality lens, and both
mine.** The record first claimed **8** and **39**. Neither reproduced: the
command as written has no `docs/` filter and returns 28, while the 8 came from a
run that DID filter `docs/` and whose filter was dropped in transcription. And
the filtered count had itself drifted from 8 to 12 as this change set added
files. **A count is a measurement with a timestamp; the command is the
reproducible part.** The counts above are therefore dated, and the unfiltered
command is quoted deliberately — narrowing a universal negative's corpus to
exclude `docs/` is the very move `scripts/check-claim-scope.mjs` exists to
refuse.

Nothing detects it: `packages/cli/src/doctor/checks/` holds **15** non-test
check files and none reads a build timestamp — `checksum-drift.ts` and
`capability-manifest-freshness.ts` are the two most timestamp-adjacent by name
and both compare content digests. `check:all`'s sub-checks do not either — **13**
when this was researched, **14** since this change set added
`check:claim-scope`, which lints prose rather than reading any timestamp;
the closest, `check-install-smoke`, packs and installs the CLI, so it exercises
`dist` but answers "does the tarball work", not "is `dist` current".

⚠️ **The original answer stopped there, and it was wrong to.** Both searches
covered `packages/cli/src/doctor/checks/` and `check:all`. Neither covered
`scripts/`. `scripts/bundle-types.mjs:70` is **exactly the comparison this
record proposes**, already shipped:

```js
if (!force && existsSync(OUTPUT) && statSync(OUTPUT).mtimeMs >= newestSourceMtime()) {
```

`newest(sources)` against an artifact's mtime, guarding
`packages/cli/.dts-cache/index.d.ts`. So the answer to "does anything already
detect it" is not a flat no: **the design exists here, applied to one artifact,
and the research did not find it because `scripts/` is compiled by no
`tsconfig.json` (root `tsconfig.json:2` is `"files": []`) and so fell outside
every enumeration the record had built.** See prior art, where what that
implementation already learned is recorded.

**Q3. Would CI have caught it?**
No, and this is the part that makes a local check worth having. CI builds from
scratch every run, so it can never observe a stale `dist` — cited, not assumed:
`.github/workflows/ci.yml:86` and `:417` run `npm run build` unconditionally on a
fresh runner checkout; the seven `cache: npm` entries (`:25,42,84,206,241,259,411`)
are `actions/setup-node`'s dependency cache, keyed on `package-lock.json`, which
caches npm's download cache and never build output; and a repository-wide search
for `actions/cache@`, `nx run` and `remote-cache` returns **zero** matches
outside this record. `turbo` matches **three** lines — `derive-policy.ts:51,61`
and `sandbox-profile.ts:101` — every one of them the literal `.turbo` inside a
list of build-artifact directory names to exclude, none of them Turborepo
caching. So nothing persists a `dist` across runs; the conclusion held but the
count did not, and the count is what this record promises. It was green on the
same commit throughout — that half is a session observation with no artifact,
disclaimed above — — and that disagreement between a clean build and a local
one is precisely the signal a check should surface immediately rather than after
two hours of misdiagnosis.

**Q4. What is the cheapest question that discriminates?**

⚠️ **The first answer here was WRONG, and measured wrong in round 1.** It said:
compare the mtime of a package's `dist` root against its `src` root — "one `stat`
per package, no directory walk". That does not discriminate anything.

A directory's mtime changes only when its OWN immediate entry list changes. It
does not move when a nested file is edited, and — measured, which is stronger
than the reviewer's own POSIX-semantics argument — it does not move when a file
is ADDED two levels down either:

Reproduce it — `node docs/evidence/phase-26/mtime-propagation-probe.mjs`,
which asserts the behaviour and exits non-zero if it ever stops holding:

```
root-mtime before                       : 1787157592
root-mtime after editing src/nested/f.ts: 1787157592
root-mtime after ADDING src/nested/g.ts : 1787157592
file-mtime after the edit               : 1787157594
ordering: first write                   : 1787157596
ordering: second write, >1s later       : 1787157598

PASS - a root mtime is blind to every change beneath its immediate entry list.
```

The last two rows are the ones **assumption 1** cites for mtime ordering. They
were added to the probe in round 6 but this transcript was not regenerated until
round 8 caught it — a stale artifact, inside a record about stale artifacts. The
irony is recorded rather than quietly fixed, because it is the same failure the
whole change set exists to detect: **an output that was correct when written and
was never re-derived after its producer changed.**

Unlike the incident numbers disclosed at the top of this record, **this one is
cited and re-runnable**: the probe is committed, takes under a second, and
busy-waits past a second boundary so granularity cannot hide a real change.

Most packages here nest the bulk of their sources — `packages/contracts/src`
holds a single direct child (`index.ts`, its public barrel) and **141 files below
it** across thirteen subdirectories — so editing any of those 141 leaves the
`src` root mtime untouched, a root-vs-root comparison sees `src` no newer than
`dist`, and the check reports nothing. **A check that almost never fires, failing
silently**, which is the opposite of the safe direction assumption 1 claimed.

The answer that actually discriminates: compare the NEWEST mtime beneath each
root. That costs a walk of both trees, so Q4's original cost claim is withdrawn
rather than defended. It is still cheap next to content hashing, and it is the
cheapest thing that answers the question at all.

**Q5. What must it NOT do, and what can it NOT see?**

Not rebuild. Not error. Not report a package that has no `dist` at all: a package
that has never been built is not stale, and reporting it would make the check
noisy on a fresh clone, which is how a check gets ignored.

⚠️ **Nine blind spots, each measured rather than feared.** They belong here, in
the section a reader consults for limits, and not only in Corrections:

1. **It cannot see its own staleness.** `bundle:cli` copies plugin assets with
   `cp(..., { recursive: true })` and no `preserveTimestamps`
   (`scripts/bundle-cli.mjs:178`), unconditionally after `tsc -b`. So `dist`
   always looks fresh for `packages/cli` — the one package whose staleness
   started this.
2. **It cannot see a deletion.** Remove a source file without rebuilding and
   `newest(src)` can be older than `newest(dist)`; the orphaned artifact goes
   unreported.
3. **It cannot see cross-package staleness at all.** `bundle:cli` is an
   `esbuild` bundle (`bundle: true`) that inlines every `@crabgic/*` dependency
   through its `"main": "./dist/index.js"` — all 18 workspace packages declare
   exactly that. Rebuild `packages/gates` alone (it has its own `tsc -b` script)
   and BOTH per-package checks report clean while `packages/cli/dist/bin.js`
   still carries the pre-fix `gates` code, frozen at the last bundle. No walk
   scope fixes this: the staleness is a legitimate dependency baked in at bundle
   time, not noise in a directory listing.

   ⚠️ **"No walk scope fixes this" is not "nothing fixes this", and the
   difference is a design requirement.** A src-vs-dist comparison inside any one
   package cannot see it. A DIFFERENT comparison can: **`packages/cli/dist/bin.js`'s
   mtime against the newest `dist` mtime of every `@crabgic/*` package esbuild
   inlines into it.** That is a bundle-freshness check, not a walk, and a design
   that omits it does not address the incident this record is named for. Stated
   here because a reader who stops at the sentence above would carry away the
   opposite conclusion.

4. **It cannot bootstrap its own first activation.**
   `packages/cli/package.json:22` declares `"crabgic": "dist/bin.js"`, so the
   `crabgic` on a developer's PATH is a COMPILED artifact. A stale
   `packages/cli/dist` therefore runs the OLD doctor registry — which, before
   the first rebuild after this check ships, does not contain the check at all.
   This is mechanistically unlike the other three: they are cases where the
   check runs and sees nothing, this is a case where **the check does not run**.
   It cannot be solved from inside the tool, and a design that does not say so
   is claiming a guarantee it has not got.
5. **It sees only what its enumeration names, and the obvious enumeration is
   wrong.** A check scoped to `packages/*` — the npm-workspaces glob, and the
   first thing anyone reaches for — has **zero** entries for `e2e/report`, which
   is a real compiled unit with a real runtime consumer. See assumption 4: the
   scope must come from root `tsconfig.json`'s `references`. This blind spot is
   the one on this list that a design can actually close, and it closes only if
   the design is told; it is recorded here so that it is.
6. **A `src`-only walk misses every config input, workspace-wide.** Edit
   `tsconfig.base.json` — flip `strict`, add a `lib` — and rebuild nothing. No
   file under any unit's `src/` moves, so `newest(src)` is unchanged for all
   **19** units at once, and the check reports clean everywhere. **One edit, a
   silent miss across the entire workspace** — a blast radius larger than blind
   spots 1-3, each of which is confined to a single package.

   ⚠️ **This record already held the evidence against its own design and did not
   read it.** The prior-art bullet quotes `.tsbuildinfo`'s top-level keys to
   argue against parsing it — and one of those keys is `options`, which is
   tsc's own record of the compiler options a build was performed under: **20**
   of them in `e2e/report/dist/.tsbuildinfo`, including `strict`, `target` and
   `module`. The structure cited to reject the alternative is the same structure
   that documents what the chosen approach drops.

   Closable, like blind spot 5: include each unit's own `tsconfig.json` and its
   `extends` chain in the input side of the comparison.

7. **It cannot see the build program or the toolchain change.** Edit
   `EXTERNAL_DEPENDENCIES` in `scripts/bundle-cli.mjs` — or `splitting`,
   `target`, `format` — and rebuild nothing. No `src` file moves, no
   `tsconfig.json` moves, no `dist` moves. The check reports clean for all 19
   units while `packages/cli/dist/bin.js` is the build of the old settings.
   `scripts/` is compiled by no `tsconfig.json` (root `tsconfig.json:2` is
   `"files": []`), so it is outside assumption 5's chain by construction.

   The same holds for the pinned toolchain: bump `typescript` off `6.0.3` and
   `npm ci`, and every `dist` was emitted by a compiler the check cannot see.
   **`tsc` disagrees with the check here** — `.tsbuildinfo` records
   `version: "6.0.3"` and invalidates on mismatch, which is precisely the input
   an mtime comparison drops. See assumption 6.

8. **There are three tiers, not two.** `packages/cli/dist/index.d.ts` is a
   `copyFile` of `packages/cli/.dts-cache/index.d.ts` (`bundle-cli.mjs:153`),
   and that cache is **gitignored** (`.gitignore:47`) — neither `src` nor
   `dist`, so invisible at BOTH ends of the comparison. This is not blind spot 1:
   that one is a `dist`-side mtime refresh, this one is an artifact the
   comparison never looks at.

   The counterexample is the operator's own remedy. `rm -rf packages/cli/dist`
   and rebuild — exactly what a reader does when the check fires. `.dts-cache`
   survives the clean, `bundle-types.mjs` skips regeneration, `bundle-cli.mjs`
   copies it in with a fresh mtime. **The check says clean before and after.**

9. **An `extends` chain walked UPWARD misses a config that extends DOWNWARD.**
   `packages/cli/tsconfig.dts.json` declares `"extends": "./tsconfig.json"` — a
   descendant. Walking up from `packages/cli/tsconfig.json` reaches
   `tsconfig.base.json` and stops, so assumption 5's remedy never reaches it. It
   is not among the root's **19** references either, so assumption 4 misses it
   too. And it is load-bearing: `scripts/bundle-types.mjs:83-84` hands it to
   `dts-bundle-generator` as `--project`, producing `.dts-cache/index.d.ts`,
   which `bundle-cli.mjs:153` copies to the **published**
   `packages/cli/dist/index.d.ts`.

   Counterexample, **run rather than argued** (round 11, assumption-audit): add
   `"stripInternal": true` to `tsconfig.dts.json` alone and the emitted
   declarations lose a type. No `.ts` source moves, no unit `tsconfig.json`
   moves, `tsconfig.base.json` does not move, no `dist` file moves. The check
   reports clean for all 19 units while the published type surface is the old
   one.

   ⚠️ **The prior art this record adopts shares this blind spot.**
   `bundle-types.mjs`'s `newestSourceMtime()` walks only `.ts` files under
   `packages/*/` (`:43-54`), so it never stats ANY `.json` — including the very
   config that steers its own generator. Touching `tsconfig.dts.json` does not
   invalidate its cache. Q2 calls that predicate "exactly the comparison this
   record proposes"; it is, and it carries this hole with it. **`npm run census`
   surfaces both offenders today**, in its `configInputsOutsideProjectGraph`
   bucket.

## Prior art checked

- **`packages/cli/src/doctor/checks/`** — the 15 existing checks establish
  the shape this one must take: a pure function returning a typed result with a
  severity, composed in the doctor registry. `installer.checksum-drift` is the
  closest analogue: it also reports drift as a **warning**, and also cannot know
  whether the drift was intentional.
- ⚠️ **The stash/`dist` rule is NOT in `docs/verification-playbook.md`.** An
  earlier draft of this record said it was, and called it "the repository's own
  rule, already written and already paid for". Measured: that file has **zero**
  matches for `git stash` and zero for "doesn't revert"; its only `stash` mention
  (`:785`) is an unrelated e2e typecheck incident. The wording came from a
  private session memory note. Quoting it as a repository rule borrowed authority
  the source never had, and it is named here as a fabrication rather than quietly
  re-pointed at a better source.
- **`docs/evidence/criteria-closeout/defects/25-install-smoke-depends-on-local-dist-state.md`**
  — filed 2026-08-18, one day before this research, and the CLOSEST prior art in
  the repository: `check:install-smoke` produced three different verdicts in one
  session depending on local `dist` staleness, and a local answer was quoted as a
  fact about `main`. It corroborates Q2 and Q3 directly and should have been the
  first thing this record cited. Missed in the first draft; found by review.
- **`scripts/bundle-types.mjs:70` — THE CLOSEST PRIOR ART, and it is inside this
  repository.** An mtime staleness check of exactly the proposed shape, shipped
  and running. It should have been the first thing this record read; it was
  found in round 10, by the first lens given a shell.

  Its own comment (`:32-38`) records the design **failing in production**:
  `tsc -b` emitted its own `dist/index.d.ts` over the bundled one, which "would
  clobber the bundled file AND refresh its mtime, so the staleness check below
  would then declare the cache current while holding tsc's output — which
  `check-install-smoke.mjs` caught as `Cannot find module './exit-codes.js'`".

  That is blind spot 1 — a later build step refreshing the artifact's mtime and
  making a stale thing look current — **already suffered, already diagnosed, and
  already worked around in this codebase**, by moving the artifact out of `dist`
  into a cache the clobbering step does not touch. A design that does not read
  this file is re-deriving a lesson the repository has already paid for.

- **`scripts/repo-census.mjs` — the enumeration half is ALREADY BUILT, tested and
  in `check:all`'s neighbourhood.** Added after round 10 precisely because this
  record's Q2 answer was wrong, it computes the discriminators assumptions 4-6
  spent five rounds deriving by hand:

  | census output                     | re-derives                                                                       |
  | --------------------------------- | -------------------------------------------------------------------------------- |
  | `referencedButNotWorkspace`       | assumption 4 — 19 references vs 18 workspaces, i.e. `e2e/report`                 |
  | `configInputsOutsideProjectGraph` | assumption 5 — `tsconfig.base.json`, extended by all 19, a project in none       |
  | `sourceClaimedByNothing`          | Q2's own miss — `scripts/` claimed by no tsconfig                                |
  | `claimedOnlyByString`             | the shell-string reachability that hides `bundle-types.mjs` and `bundle-cli.mjs` |

  ⚠️ **This record applied that standard to itself and then failed it.** It
  condemns omitting `bundle-types.mjs` as prior art — "a design that does not
  read this file is re-deriving a lesson the repository has already paid for" —
  and then omitted `repo-census.mjs`, which exists _because of this record's own
  defect_. Found by round 11's completeness lens. **The design should call the
  census rather than re-derive its sets**, and must say which it does.

- **The wider ecosystem** — `tsc -b`'s `.tsbuildinfo` is the canonical staleness
  oracle and is strictly better than mtimes, but reading it means parsing an
  internal format that TypeScript may change without notice. **Measured against
  the installed compiler** (TypeScript **6.0.3**), rather than asserted:
  - `node_modules/typescript/lib/typescript.d.ts` mentions build info **three**
    times, case-insensitively — and every one is about WHERE the file goes,
    never WHAT IS IN IT:

    | line   | declaration                                                      | what it exposes             |
    | ------ | ---------------------------------------------------------------- | --------------------------- |
    | `7102` | `tsBuildInfoFile?: string`                                       | the compiler option, a path |
    | `7338` | `TsBuildInfo = ".tsbuildinfo"`                                   | the file extension          |
    | `9511` | `getTsBuildInfoEmitOutputFilePath(options): string \| undefined` | the emit path               |

    There is **no public interface describing the contents**, so a parser cannot
    be typed against the public API — and the three-way breakdown makes that
    conclusion stronger than the one-line version it replaces, not weaker.

  - The files themselves carry the writer's version. `e2e/report/dist/.tsbuildinfo`
    has top-level keys `fileNames, fileIdsList, fileInfos, root, options,
referencedMap, latestChangedDtsFile, version` and `version: "6.0.3"` — the
    format is **bound to the compiler version by design**, which is the risk
    stated, observed directly rather than feared.

  Rejected in favour of mtimes for that reason, and the weaker guarantee is
  stated rather than hidden. A design that later wants the stronger oracle now
  knows exactly what it is buying: real per-file information, at the cost of a
  parser pinned to a compiler version.

## Assumptions, stated rather than silent

1. **Mtime ordering is meaningful on this filesystem.** WSL2 over an ext4 volume
   preserves it, at second granularity or better. **Cited, not asserted**
   (round 6, assumption-audit lens): `mtime-propagation-probe.mjs` writes the
   same file twice more than a second apart and fails if the second mtime is not
   strictly greater — the `ordering:` rows in its output. On a filesystem with coarse or
   absent mtimes the check would report nothing useful; it would not report a
   false alarm, so THIS failure direction is safe.

   ⚠️ Round 1 corrected the scope of that safety claim. It was only ever
   evaluated against mtime PRECISION, never against directory-mtime SCOPE — and
   the scope problem produces a silent miss, which is not safe. Q4 above now
   carries the measurement and the withdrawn cost claim.

2. **A touched-but-unchanged source file produces a false warning.** Accepted
   deliberately. The alternative — content hashing every source file — costs far
   more than the question is worth, and a warning that is occasionally
   unnecessary is cheaper than the two hours this cost.
3. **Package granularity is enough.** The check names a package, not a file. A
   reader who sees the warning runs `npm run build`; knowing which file was newer
   would not change what they do.
4. **Scope is defined by root `tsconfig.json`'s `references`, NOT by
   `workspaces`.** The two differ: **19** references against **18** workspace
   members. The odd one is `e2e/report` (`tsconfig.json:59`) — no `package.json`,
   so invisible to `npm workspaces` and to any `packages/*` glob, yet it sets
   `outDir: "./dist"`, is compiled by the root `build`, and is executed as
   `node e2e/report/dist/cli.js` (`.github/workflows/release-e2e.yml:394`).
   Enumerating by `package.json` presence would silently omit a real build unit
   with a real runtime consumer. Enumerating by `outDir` presence would be worse
   in the other direction: four of the six `e2e/*` units declare an `outDir` they
   never write, because `noEmit: true` suppresses emission. **The discriminator
   is "a unit that emits compiled output", and in this repository that set is
   exactly the `references` array.**
5. **A unit's build inputs are NOT confined to its `src/` tree, and a unit may
   have MORE THAN ONE project config.** The input set is _every `tsconfig*.json`
   a build program hands to a compiler for this unit_ — not "its `tsconfig.json`
   and its `extends` chain", which is what an earlier version of this assumption
   said and which provably misses a shipped config (blind spot 9). Measured:
   **19 of 19** in-scope units declare `"extends": "../../tsconfig.base.json"`,
   and that file sits at the repository root — outside every unit's `src/`.
   A comparison that walks only `src` is therefore not a comparison of the
   build's inputs, and this assumption is stated so a design cannot inherit the
   narrower reading by default.
6. **"Inputs" means DATA. The build's own program and its pinned toolchain are
   inputs too, and neither is in assumption 5's set.** Measured from the very
   artifact this record quotes twice — `e2e/report/dist/.tsbuildinfo`'s
   `fileNames`, which is tsc's own enumeration of what the build read:

   | slice                                 | count   |
   | ------------------------------------- | ------- |
   | total                                 | **421** |
   | under `node_modules`                  | **304** |
   | of those, `typescript/lib/lib.*.d.ts` | **63**  |
   | workspace `dist/*.d.ts`               | **107** |
   | **under any `src/`**                  | **10**  |

   **10 of 421.** The compiler's own answer is that `src` is about 2% of what a
   build reads. This assumption is stated, not closed: closing it fully means
   reimplementing `.tsbuildinfo`, which the prior-art bullet rejects for good
   reason. What the design must NOT do is mistake a `src`-and-tsconfig walk for
   a walk of the build's inputs.

## What this record does NOT establish

⚠️ **Concretely, not abstractly.** An earlier draft hedged here at the level of
"mtime comparison may not suffice for a general build system", which reads as a
hypothetical while nine PROVEN, always-present failure modes sat further down
the page. They are named in Q5 above and repeated here because this is the other
section a design-stage reader consults for limits:

- the check **can never fire for `packages/cli`**, the package whose staleness
  motivated it;
- it is **blind to a deleted source file**, in every package;
- it is **blind to cross-package staleness**, which is the founding incident's
  own shape — a consumer running stale compiled dependency code. Closable, but
  only by a different comparison: `packages/cli/dist/bin.js`'s mtime against the
  newest `dist` of every package it inlines (Q5, blind spot 3);
- it **cannot bootstrap its own first activation** — `crabgic` is itself
  `dist/bin.js` (`packages/cli/package.json:22`), so a stale `packages/cli/dist`
  runs a doctor registry predating the check. The failure disables the tool
  meant to detect it;
- it **sees nothing outside its enumeration**, and the natural enumeration
  (`packages/*`, 18 members) omits `e2e/report`, a compiled unit executed in CI.
  Scope must come from root `tsconfig.json`'s `references` (19) — assumption 4.
  Unlike the four above, this one is a design instruction rather than a residual
  limit: it is closable, and the design that ignores it reintroduces it;
- it **misses every config input** if it walks only `src`. All **19** units
  extend the root `tsconfig.base.json` (assumption 5), so one edit there goes
  unnoticed across the whole workspace at once. Also closable, and also a design
  instruction: the input side must include each unit's `tsconfig.json` and its
  `extends` chain;
- it **cannot see the build program or the toolchain** — `scripts/bundle-cli.mjs`
  is compiled by no `tsconfig.json`, and a `typescript` version bump moves
  nothing the check reads. Not fully closable without reimplementing
  `.tsbuildinfo`; assumption 6 states it rather than pretending otherwise;
- it **is blind to the middle tier** — `packages/cli/.dts-cache/` is gitignored
  and is neither `src` nor `dist`, so it is invisible at both ends, and it
  survives the `rm -rf dist` a reader performs when the check fires;
- it **misses a config that extends DOWNWARD**. `packages/cli/tsconfig.dts.json`
  extends `./tsconfig.json`, so an upward `extends` walk never reaches it, yet
  it steers the published `.d.ts` (`bundle-types.mjs:83-84` →
  `bundle-cli.mjs:153`). Closable: enumerate every `tsconfig*.json` a build
  program hands to a compiler, which `npm run census` already lists.

What it DOES establish: the repository currently asks nothing at all, and a
newest-mtime-beneath-root comparison would have caught the specific measured
failure that started this — for every package except the one it happened in.

That last clause is the honest summary of this research, and a design that does
not answer it has not answered the question.

## Corrections

**Round 1, assumption-audit lens (2026-08-19) — one blocking finding, upheld and
then strengthened by measurement.** The reviewer argued from POSIX semantics that
directory mtimes do not propagate, and said plainly that it lacked `Bash` to
prove it. Running its own suggested experiment confirmed the finding AND went
further than it predicted: adding a nested file does not move the root either,
because the new entry lands in the subdirectory. The mechanism Q4 proposed would
have shipped a check that never fires. Q4 is rewritten and its cost claim
withdrawn.

**Round 1, completeness lens (2026-08-19).** Q2 originally said "fourteen checks"
and "twelve checks". Counted: **15** non-test files under
`packages/cli/src/doctor/checks/`, and **13** `npm run` sub-checks chained by
`check:all`. Both were off by one, in opposite directions.

The finding was verified independently before it was accepted — `ls | wc -l` and
a parse of the `check:all` script — rather than taken on the reviewer's word.
Q2's answer is unchanged (nothing reads a build timestamp), but a record whose
"Measured:" line is not measured is exactly the kind of claim this repository
refuses to let stand, and the numbers were about to be quoted into a design.

**Round 2 (2026-08-19) — and the finding that matters most is about the process,
not the artifact.**

Two independent lenses reported that round 1's blocking findings were **still
present in the file**. They were right. The script meant to apply them aborted on
an assertion before writing, and the round-1 disposition was reported as done
without verifying the write. The fabricated citation and the missing incident
link survived a round that claimed to have fixed them.

⚠️ **A disposition that is not verified is not a disposition.** This is the second
time in one session that a silent no-op edit was reported as applied — the first
was a JSON `str.replace` that matched nothing because the file encoded the string
differently. Both times the cause was asserting on the wrong thing: that the new
value differed, rather than that the file changed. Every fix in this round was
re-read out of the file afterwards, and the greps are the record of it.

Also upheld, from two lenses independently:

- **`25-install-smoke-depends-on-local-dist-state.md` was the closest prior art
  and was not cited.** Filed one day before this research, documenting
  `check:install-smoke` giving three verdicts in one session from local `dist`
  staleness. Now cited.
- **Q1's and Q3's headline numbers cited nothing at all**, and the one artifact
  that carries them explicitly disclaims their reproducibility — a caveat the
  record had dropped. Now carried, in the record rather than only in the
  companion.

**Round 2, assumption-audit lens (2026-08-19) — three further blocking findings,
all verified against the repository before acceptance.**

1. **The check could never fire for `packages/cli` itself.**
   `scripts/bundle-cli.mjs:178` copies plugin assets with
   `cp(..., { recursive: true })` and NO `preserveTimestamps`, and `bundle:cli`
   runs unconditionally after `tsc -b` in the root `build` script. So in exactly
   the incident this check exists for — `tsc -b` silently skipping a recompile —
   `dist/plugin/**` still refreshes to now, `newest(dist)` beats `newest(src)`,
   and the check reports clean. Verified: `dist/plugin/.mcp.json` is present and
   carries a copy-time mtime.
2. **Self-hosting bootstrap.** `packages/cli/package.json` declares
   `"crabgic": "dist/bin.js"`. A stale `packages/cli/dist` runs the OLD compiled
   doctor registry, which has no stale-dist check in it. The tool meant to catch
   the failure is disabled by the failure.
3. **Blind to deletion.** Delete a source file without rebuilding and
   `newest(src)` can be older than `newest(dist)`, leaving an orphaned artifact
   unreported. Assumption 2 covers only the opposite direction.

**Where that leaves the design.** `newest(dist)` is a valid proxy for compiled
output only — not for copied assets, and not for deletions. A sound check has to
scope its `dist` walk to compiler outputs, add an orphan check, and state the
bootstrap limit it cannot solve from inside the tool. That is a real design, not
a one-file doctor addition, and the owner's ruling (2026-08-19) is to build it
properly rather than swap in an easier change set.

**Round 3, source-quality lens (2026-08-19) — `approve`, with one advisory
upheld.** Every citation was independently re-verified by the reviewer and all
four resolve as claimed, including the NEGATIVE about `verification-playbook.md`.

The advisory: this record said `packages/contracts/src` "has no direct file
children at all". False — `packages/contracts/src/index.ts`, the package's public
barrel, sits directly under `src`. Corrected above to what is actually true and
actually measured: one direct child, **141 files** beneath it across thirteen
subdirectories. The illustration was wrong; the conclusion it illustrated is not
affected, because that rests on the measured POSIX experiment rather than on this
example.

Dispositioned as `fixed` rather than `accepted-debt`: an advisory holds a stage
open exactly as a blocker does, and a wrong fact in a research record is the
cheapest possible thing to correct.

**Round 3, completeness lens (2026-08-19) — `revise`, one blocking finding,
upheld.** Q5 and "What this record does NOT establish" — the two sections a
design-stage reader consults for limits — still carried the abstract hedge
("mtime comparison may not suffice for a general build system") while three
measured, always-present blind spots sat further down the page in Corrections.

The finding is about **where truth lives**, not whether it is present. A record
that states its limits in the limits section as a hypothetical, and proves three
concrete failures elsewhere, misleads exactly the reader those sections exist
for. "It was in there" is not a defence.

Both sections now name the three: blind to its own package via
`scripts/bundle-cli.mjs:178`, blind to deletion, blind to cross-package
staleness. Dispositioned `fixed`.

**Round 3, assumption-audit lens (2026-08-19) — `revise`, one blocking finding,
upheld, and it is the finding of this whole stage.**

**Cross-package staleness is invisible to any per-package mtime check.** Verified
against the repository before acceptance:

- all **18** packages declare `"main": "./dist/index.js"`;
- `scripts/bundle-cli.mjs` sets `bundle: true`, so esbuild **inlines** every
  `@crabgic/*` dependency into `packages/cli/dist/bin.js` at bundle time;
- `packages/gates/package.json` declares its own `"build": "tsc -b"`.

So: full build, then edit `packages/gates/src`, then run
`cd packages/gates && npm run build` — a real, declared script — and never re-run
the root build. `packages/gates` is clean (its own `dist` is newer than its own
`src`). `packages/cli` is clean (nothing under `packages/cli/src` moved). And
`packages/cli/dist/bin.js` still carries the **pre-fix `gates` code**, frozen at
the last bundle.

That is the founding incident's exact shape — a consumer running stale compiled
dependency code — reached through a mechanism **no walk scope can see**, because
the staleness is not expressible as a src-vs-dist comparison within any one
package. Scoping the walk to compiler outputs does not help; adding an orphan
check does not help.

Dispositioned `fixed` as a record correction: the limit is now stated in Q5 and
in the limits section. It is **not** fixed as a design problem, and the design
stage inherits it as a named requirement — a check that compares
`packages/cli/dist/bin.js`'s mtime against the newest `dist` of every package it
inlines, or it does not address the incident it is named for.

**Round 4, assumption-audit lens (2026-08-19) — `revise`, one novel blocking
finding, upheld, verified independently, and then found to be sharper than the
reviewer stated.**

**The record silently equated "everything this check must cover" with
`packages/*`** — the npm-workspaces glob (`package.json:11-13`) — and never wrote
that down as an assumption, so no round had tested it. Q2's "18 packages" was
arrived at by counting `package.json` files, which is the same equation restated.

Verified against the repository, independently of the reviewer:

| claim                                               | measured                              |
| --------------------------------------------------- | ------------------------------------- |
| `tsc -b` project references in root `tsconfig.json` | **19**                                |
| of those, under `packages/`                         | **18**                                |
| workspace members (`packages/*/package.json`)       | **18**                                |
| references NOT under `packages/`                    | `"./e2e/report"` (`tsconfig.json:59`) |

`e2e/report` has **no `package.json`**, so it is invisible to `npm workspaces`,
to a `packages/*` glob, and to any enumeration keyed off `package.json` presence.
It nonetheless sets `outDir: "./dist"` and `composite: true`, is compiled by the
root `build` script (`package.json:15`), and has a real runtime consumer:
`.github/workflows/release-e2e.yml:394` runs `node e2e/report/dist/cli.js`
directly. A check built exactly as this record specified would hold **zero
entries** for it — silent not because of a known limit, but because the design
never looked at that directory.

**Sharper than the finding as filed.** Five `e2e/*` directories have a
`tsconfig.json` and no `package.json` — so "has a `package.json`" is the wrong
discriminator in both directions. Measured across all six `e2e/*` units, exactly
one emits:

| unit               | `noEmit`                                       | in root refs | `dist/` on disk |
| ------------------ | ---------------------------------------------- | ------------ | --------------- |
| `e2e/attestation`  | `true`                                         | no           | no              |
| `e2e/live`         | `true`                                         | no           | no              |
| `e2e/matrix`       | `true` (4 sub-projects; no top-level tsconfig) | no           | no              |
| `e2e/provisioning` | `true`                                         | no           | no              |
| `e2e/release`      | `true`                                         | no           | no              |
| **`e2e/report`**   | —                                              | **yes**      | **yes**         |

Five of the six declare an `outDir` they never write, because `noEmit: true`
suppresses emission. `e2e/matrix` is the awkward one: it has **no top-level
`tsconfig.json` at all**, and its four sub-projects (`connector`, `git`,
`installation`, `orchestration`) each declare `outDir: "./dist"` with
`noEmit: true` — the same shape, one level down. An earlier version of this table
recorded it as "no `outDir`", which was true of the directory and false of the
unit (round 5, source-quality lens).

⚠️ **The table's unit of enumeration is a framing choice, disclosed here.** It
counts the six `e2e/*` directories. `scripts/check-e2e-types.mjs`'s
`E2E_TYPECHECK_PROJECTS` counts **8** typecheck projects, because it expands
`e2e/matrix` into its four. Neither is wrong; a design that enumerates build
units must pick one and say which. So enumerating by "directory with an `outDir`" would produce
four permanent false warnings for units that correctly have no `dist` at all.

**The discriminator is neither `package.json` nor `outDir`. It is: a unit that
emits compiled output.** In this repository that set is exactly the root
`tsconfig.json` `references` array — 19 entries, a strictly larger and more
accurate set than `workspaces`, and the only enumeration that is both complete
and free of false positives.

Dispositioned `fixed` as a record correction — the assumption is now stated and
the enumeration corrected. The design stage inherits it as a named requirement:
**enumerate from `tsconfig.json`'s `references`, never from `workspaces`.**

**Round 4, source-quality lens (2026-08-19) — `revise`, two blocking count
defects, both confirmed by independent re-measurement.**

Every other citation the lens checked resolved exactly as claimed, including the
four newly added in round 3's dispositions: `scripts/bundle-cli.mjs:129`
(`bundle: true`), `:178` (the `cp` with `recursive: true` and no
`preserveTimestamps`), all 18 packages' `"main": "./dist/index.js"`,
`packages/gates/package.json:25` (`"build": "tsc -b"`), and
`packages/cli/package.json:22` (`"crabgic": "dist/bin.js"`).

**Defect 1 — "142 files below it" was the total, not the count below.** Measured
three ways with `find`: 142 files anywhere under `packages/contracts/src`, **1**
direct child, **141** at depth ≥ 2. The number introduced as round 3's own fix
was off by one in the same direction and by the same mechanism as the "fourteen"
and "twelve" corrected in round 1 — a count quoted rather than taken. Corrected
to **141** at both sites.

**Defect 2 — the record contradicted itself about one directory.** Round 1
corrected `packages/cli/src/doctor/checks/` from "fourteen" to **15** in Q2, but
the Prior-art section said "the fourteen existing checks" and was never touched.
Measured: **15** non-test `.ts` files. Corrected.

⚠️ **The lesson is not the arithmetic.** Round 1's disposition fixed **one
occurrence** of a number that the record used at **two** sites, and three
subsequent rounds — including a source-quality `approve` — passed over the
survivor. This is the same failure shape as the session's two silent no-op edits,
one layer up: there, the write did not land; here, the write landed at one of the
places it was needed. **A disposition is complete only when every site carrying
the wrong claim is re-measured, not when the cited one is.** Both fixes above
were verified in both directions — old string absent, new string present at the
expected count — and that is now the standing bar for a disposition in this
record.

**Round 4, completeness lens (2026-08-19) — `revise`, one novel blocking finding,
upheld, and fixed more strongly than either remedy the lens proposed.**

**Q4's propagation experiment was uncited and covered by no assumption.** The
warning box at the top of this record discloses four unlogged session
measurements by name — the incident mtimes, the "83 failures", the "6 of 6" in
Q1, and Q3's CI-status claim. Q4's directory-mtime experiment is the same
epistemic category and is **absent from that list**. Verified: `1787144919`
appeared nowhere in this repository outside the three lines of Q4 itself — no
script, no test, no companion entry.

That is a direct violation of this stage's exit criterion, _every answer carries
a citation or is listed as an explicit assumption_. The answer had neither, and
none of the three stated assumptions covers it: assumption 1 is about mtime
**precision**, not propagation **scope**.

The lens offered two remedies — disclose it in the warning box as a fourth
unreproducible item, or add a fourth assumption. **Both are weaker than the
situation allows.** The incident numbers are unreproducible because the state
that produced them is gone. This experiment is not: it is ordinary POSIX
behaviour, reproducible in under a second on any machine.

So it is now reproduced rather than disclosed.
`docs/evidence/phase-26/mtime-propagation-probe.mjs` is committed, builds its own
fixture in a temp directory, busy-waits past a second boundary so granularity
cannot mask a real change, asserts all three conditions Q4 relies on, and exits
non-zero if any stops holding. Q4 now carries the probe's own fresh output and
names the command that regenerates it. Dispositioned `fixed`.

⚠️ **One disagreement between lenses, settled by measurement.** This lens
reported "142 files across 13 subdirectories" as confirming the record; the
source-quality lens reported the same figure as an off-by-one. It read the file
before that correction landed. `find` settles it: **142** total under
`packages/contracts/src`, **1** direct child, **141** below. A reviewer
confirming a number is not evidence for it — only the count is.

**Round 5 (2026-08-19) — three lenses, three `revise`, three novel findings, all
verified against the repository and all dispositioned `fixed`.** Round 5 was
dispatched to `eo-reviewer`, which owns these three lenses; round 4 sent two of
them to `eo-domain-reviewer`, whose eight lenses do not include them. Round 4's
findings stand on the measurements in this record, not on that reviewer's
authority — see the note at the end.

**completeness — the branch-switch root cause was asserted with no citation.**
The record stated that `tsc -b`'s incremental state did not rebuild across a
branch switch, then said one sentence later that nothing had answered the
question. Neither cited nor listed as an assumption. Grepped: `branch switch`
appeared nowhere in the repository outside this record, and the companion
`stale-dist-incident.md` says nothing about one — its mtime pair is equally
consistent with the plainer "edited and forgot to rebuild".

The lens could not run `git`, and named that as the one avenue that could rescue
the sentence. It did. The reflog and git history place the mechanism to the
minute, and Q3's incident section now carries the table: `coverage-gate-registration.ts`
is absent at `8605760` and present at `4414a16`, so the 21:46:41 fast-forward is
what wrote it; `dist/` is gitignored, so the same checkout left `dist/index.js`
at 21:37. **Measured, not downgraded** — the same move as round 4's probe.

**assumption-audit — Q3 bundled a citable fact with an uncitable one under a
single disclaimer.** The warning box covered "the CI-status claim in Q3" as a
whole. But Q3 makes two claims of different evidentiary status:

|     | claim                                                          | status                           |
| --- | -------------------------------------------------------------- | -------------------------------- |
| A   | CI builds from scratch, so it can never observe a stale `dist` | **citable today**                |
| B   | it was green on the same commit throughout                     | session observation, no artifact |

Verified for A: `.github/workflows/ci.yml:86` and `:417` run `npm run build`
unconditionally on a fresh checkout; the seven `cache: npm` entries are
`actions/setup-node`'s dependency cache keyed on `package-lock.json`; and a
repository-wide search for `actions/cache@`, `turbo`, `nx run` and `remote-cache`
returns **zero** matches, so nothing persists build output between runs.

The failure this produced is precise: the box instructs that nothing downstream
may cite those numbers, so a design author obeying it would have declined to cite
`ci.yml` — a file that fully supports claim A. Q3 now cites it, and the
disclaimer is narrowed to B by name.

**source-quality — the `e2e/*` table's `e2e/matrix` row was wrong.** Claimed
"no `outDir`". Actual: `e2e/matrix` has no top-level `tsconfig.json`, and its
four sub-projects each declare `outDir: "./dist"` with `noEmit: true` — the same
shape as the other four, one level down. True of the directory, false of the
unit, and it contradicted the sentence beneath it. Corrected.

The lens also observed that `scripts/check-e2e-types.mjs`'s
`E2E_TYPECHECK_PROJECTS` enumerates **8** projects where this table enumerates
**6** directories. Not a defect — both are truthful — but a design that
enumerates build units must pick one and say which, so that is now disclosed
under the table rather than left for the design stage to trip over.

⚠️ **A dispatch error, recorded because it bears on how much these rounds are
worth.** Rounds 1-4 sent `completeness`, `source-quality` and `assumption-audit`
to `eo-domain-reviewer`. Only round 4's completeness instance refused, correctly,
on the grounds that the lens belongs to `eo-reviewer`; the others answered
outside their registry. Every finding they raised was independently re-measured
here before acceptance, and each is cited to a file rather than to a reviewer —
which is the only reason the rounds still count. **A review round is worth what
its findings can be checked against, not what the reviewer asserted.**

**Round 6 (2026-08-19) — three lenses, three `revise`, four novel findings, all
verified and all `fixed`.** Two of them are corrections to material this record
added in round 5, which is the argument for running another round rather than
closing on a clean-looking one.

**assumption-audit — assumption 1 carried the last uncited "measured:".** It
claimed WSL2/ext4 preserves mtime ordering "(measured: consecutive writes two
seconds apart produced distinct mtimes)". No citation, not in the warning box's
four disclosed items, and not in `stale-dist-incident.md`. The lens also noted
the figure did not match the probe's own output, whose gap is five seconds and
which never asserted an ordering comparison at all.

Fixed the same way Q4 and Q3 were: `mtime-propagation-probe.mjs` now writes one
file twice, more than a second apart, and **fails if the second mtime is not
strictly greater** — reported as the two `ordering:` rows. Assumption 1 cites it.
That was the last "measured:" in this record standing on session memory.

**completeness — the bootstrap limit lived only in Corrections.** Round 2
verified that `packages/cli/package.json:22` declares `"crabgic": "dist/bin.js"`,
so a stale `packages/cli/dist` runs a doctor registry that predates the check,
and round 2 named "state the bootstrap limit" as an inherited design
requirement. Grepped: every occurrence of `bootstrap`/`self-hosting` was inside
`## Corrections`. Q5 and "What this record does NOT establish" both listed three
blind spots.

This is round 3's finding recurring on a different fact — limits stated only in
Corrections are limits a design reader will not see. It is also **mechanistically
unlike** the other three, which is why it needed its own bullet rather than a
mention: those are cases where the check runs and sees nothing; this is a case
where the check does not run. Both sections now list four.

**source-quality — two defects in round 5's own additions.**

1. **The reflog table had times and no date**, under a heading that framed the
   whole incident as 2026-08-19. The lens converted the epoch stamps by hand and
   placed the events on **2026-08-18**. Confirmed with `git reflog --date=iso`.
   The correction is not a flip, though: the companion's §1 capture shows the
   repairing rebuild at `Aug 19 09:14` against a source file at `Aug 18 21:57`,
   so the incident genuinely **spans two days** — stale output produced on the
   18th, failures observed on the 19th. Both the opening paragraph and the table
   now say which is which.
2. **Q3's "zero matches" was not the count.** `turbo` matches **three** lines —
   `derive-policy.ts:51,61` and `sandbox-profile.ts:101` — all of them the
   literal `.turbo` in build-artifact exclusion lists, none Turborepo caching.
   The conclusion survives; the count did not. Corrected to state both.

ℹ️ **Two lenses declined to guess rather than filing.** Source-quality could not
run `git cat-file` and said so, listing the branch-switch object check as
unverified rather than confirming or denying it. Assumption-audit spotted an
uncited `.tsbuildinfo` "undocumented format" claim and **dropped it** for want of
a tool to test it. Both are the correct behaviour, and both leave real work: the
`.tsbuildinfo` claim is now the only known uncited assertion in this record, and
round 7 should either cite it or cut it.

**Round 7, completeness lens (2026-08-19) — `revise`, one novel blocking finding,
upheld, and it is the same structural fault for the THIRD time.**

**The round-4/5 enumeration fix never left Corrections.** Round 4 found the
record silently equated the check's world with `packages/*` and dispositioned it
`fixed` — "the assumption is now stated". Round 5 corrected the `e2e/matrix` row
and said the framing was "now disclosed under the table". **Both claims were
false of the sections that matter.** Grepped for `tsconfig|references|workspaces|e2e/report`:
every occurrence sat inside `## Corrections`, except one unrelated `.tsbuildinfo`
line. Q5 listed four blind spots and none was this; the assumptions list had
three and none named the scope source; the limits section had four bullets and
none mentioned `e2e/report`.

This is exactly what round 3 found (limits hedged abstractly while proofs sat
below) and what round 6 found (the bootstrap limit confined to Corrections), now
on a third fact — **after being marked `fixed` twice**. Writing the correction
down is not the same act as putting it where it is read, and this record has now
paid for that distinction three times. It is recorded here as the standing rule:
**a disposition that changes what the check must do is not complete until it
appears in Q5, in the assumptions list, or in the limits section — Corrections is
the audit trail, not the specification.**

Fixed in all three:

- **Assumption 4** now states scope comes from root `tsconfig.json`'s
  `references` (**19**) and not `workspaces` (**18**), names `e2e/report` and its
  CI consumer, and records why neither `package.json` presence nor `outDir`
  presence is the right discriminator — the latter would produce four permanent
  false warnings, since four of six `e2e/*` units declare an `outDir` that
  `noEmit: true` stops them writing.
- **Q5 gains a fifth blind spot**, flagged as the one on the list a design can
  actually close.
- **The limits section gains a fifth bullet**, marked as a design instruction
  rather than a residual limit: ignoring it reintroduces the gap.

ℹ️ The lens was told not to re-raise the enumeration gap and did not. Its finding
is a different one — that the _fix_ for it never reached the body — which is why
it is admissible and why the instruction did not suppress it.

**Round 7, source-quality lens (2026-08-19) — `approve`.** The first clean lens
since round 3, and it earned it: **25** citations checked, including decoding the
reflog's raw epoch stamps by hand to confirm the 2026-08-18 dating, and the
per-key structure of `e2e/report/dist/.tsbuildinfo`. No defects.

**Round 7, assumption-audit lens (2026-08-19) — `revise`, one advisory, upheld,
and the count was wrong in my own favour.** The record claimed
`typescript.d.ts` has "exactly **one** occurrence" of the build-info string,
cited to discharge the claim that TypeScript exposes no public type for the
format. The lens found **two**. Re-measured: case-insensitively there are
**three**, and the lens's own search missed one for the same reason mine did —
a pattern narrower than the question.

| line   | declaration                                 | what it exposes |
| ------ | ------------------------------------------- | --------------- |
| `7102` | `tsBuildInfoFile?: string`                  | a path          |
| `7338` | `TsBuildInfo = ".tsbuildinfo"`              | the extension   |
| `9511` | `getTsBuildInfoEmitOutputFilePath(options)` | the emit path   |

**The conclusion came out stronger.** All three public surfaces name _where the
file goes_; none types _what is in it_. The bullet now carries the table instead
of the count, so the claim is checkable rather than trusted.

⚠️ **This is the sixth count defect in this record**, after `fourteen`/`15`,
`twelve`/`13`, `142`/`141`, `zero`/`three` for `turbo`, and the dateless reflog
table. Every one had the same cause: a search narrower than the claim it was
offered as evidence for. Mine here was `BuildInfo\b`, which cannot match
`getTsBuildInfoEmitOutputFilePath` because no word boundary follows `BuildInfo`.
**When a grep is the evidence, the pattern is part of the claim** — and a
count stated without the pattern that produced it cannot be checked.

Dispositioned `fixed`, following round 3's precedent that a wrong fact in a
research record is the cheapest possible thing to correct. Note that severity
changed nothing here: an `advisory` holds the stage open exactly as a blocker
does, and round 7 was already held open by the completeness finding above.

**Round 8, completeness lens (2026-08-19) — `revise`, one novel blocking finding,
upheld. Fourth instance of the same structural fault, and the worst one.**

Round 3's assumption-audit entry named the design requirement for the
cross-package blind spot: a check comparing `packages/cli/dist/bin.js`'s mtime
against the newest `dist` of every package it inlines. Grepped: that requirement
existed **only** inside round 3's own Corrections entry, and nowhere in the body.

⚠️ That sentence originally cited "Corrections lines 421-422" by number, and
`prettier --check` later padded two tables and added four blank lines above it,
silently moving the target to 575. **A line-number reference into a living
document is stale the moment the document is reformatted** — the same lesson
`docs/interface-ledger.md` carries as "never reflow it, merged records cite it by
line number", reappearing here in a file that cites ITSELF. Replaced with a
description that survives reformatting. `check:citation-content` did not catch it
because it validates citations INTO other files, not a document's references to
its own line numbers.

**Why this instance is worse than the previous three.** The others were omissions
— a limit stated in Corrections and absent from the body. This one left an active
misdirection in place. Q5's bullet 3 ended:

> No walk scope fixes this: the staleness is a legitimate dependency baked in at
> bundle time, not noise in a directory listing.

That sentence is true and, read alone, tells a design-stage reader the founding
incident's own shape is **unaddressable**. It is not. No _walk_ fixes it; a
different comparison does — the bundle-freshness check this record had already
found and then filed where the design would not look. A reader following the
record's own instruction to consult Q5 for limits would have concluded the
opposite of its actual finding.

Both sections now carry the remedy, and Q5 spells out the distinction:
**"no walk scope fixes this" is not "nothing fixes this."**

ℹ️ The lens also walked every Corrections entry from rounds 1-7 against the three
body sections and reported no further placement gap — naming what it checked
(round 2's three findings, round 4's enumeration, rounds 5-6's dating and
citation fixes) and why the pure count corrections are out of scope for that
check. That is the search that makes "no further instances" worth something.

**Round 8, source-quality lens (2026-08-19) — `approve`.** Second consecutive
clean verdict from this lens. It re-derived the `.tsbuildinfo` table line by
line, confirmed the case-insensitive search finds exactly three and no fourth,
re-counted 19 references against 18 workspace members, verified the 4-of-6
`noEmit` arithmetic, checked the "sixth count defect" tally against the prior
Corrections entries, and independently confirmed the regex claim that
`BuildInfo\b` cannot match `getTsBuildInfoEmitOutputFilePath`. No defects.

**Round 8, assumption-audit lens (2026-08-19) — `revise`, one advisory, upheld,
and it is the funniest defect in this record.**

**Q4's transcript was stale.** The probe gained its `ordering:` rows in round 6;
Q4's quoted output was never regenerated. So assumption 1 said "the `ordering:`
rows in its output" while the only output printed anywhere in the document had
four rows and no `ordering:` line. A reader checking the citation against the
document — rather than re-running the script — could not find what it referenced.

**A stale artifact, in a record about stale artifacts, produced by exactly the
mechanism the record exists to describe**: an output that was correct when
written and was never re-derived after its producer changed. Regenerated; the
transcript now shows six rows and the record says why it was wrong.

⚠️ **The lens ruled out two candidate findings instead of filing them**, and said
so: it checked `/proc/mounts` and confirmed `/tmp` is `ext4` — the same
filesystem class as the repository — so the probe's temp fixture is a valid stand-in
for assumption 1's "on this filesystem"; and it checked every CI `runs-on` and
found only hosted runners, so Q3's "builds from scratch" rests on a true
ephemeral-runner premise. **Neither was filed, because neither was a defect.**
Reporting the negatives is what makes the `approve`-shaped parts of a review
mean anything.

Dispositioned `fixed`. Severity again changed nothing: the round was already held
open by the completeness finding, and an `advisory` would have held it open alone.

**Round 9, completeness lens (2026-08-19) — `approve`.** The first clean verdict
from this lens in nine rounds, and it earned it by refusing to take round 8's
word. It independently re-walked every Corrections entry from rounds 1-8 against
Q1-Q5, the assumptions list and the limits section, confirming by grep — not by
the record's own claim — that all four previously misplaced facts now sit in the
body at named line numbers.

It also **found a borderline candidate and argued itself out of filing it**: the
`E2E_TYPECHECK_PROJECTS` 8-vs-6 note lives only in Corrections, but assumption 4
settles scope from the 19-entry `references` set without needing it, and
`e2e/matrix` is outside that set under either count. So a design reader who never
sees the note still gets correct scope — "it doesn't survive the _these inputs,
that wrong result_ test". That is the admissibility rule applied against the
lens's own instinct to file, which is what makes the `approve` worth having.

And it checked for a **missing question** rather than only bad answers — the one
defect nine rounds of hardening answers could never surface. Q1-Q5 cover
problem-is-real, nothing-detects-it, CI-cannot-see-it, cheapest-discriminator,
and must-not/cannot-see; remediation, severity and placement are answered inline.
No Q6 is missing.

**Round 9, assumption-audit lens (2026-08-19) — `revise`, one novel blocking
finding, upheld, verified independently, and it is the best finding in this
record.**

**A fifth assumption, never written down: that a unit's build inputs live under
its `src/` tree.** They do not. Measured: **19 of 19** in-scope units declare
`"extends": "../../tsconfig.base.json"`, and that file sits at the repository
root — outside every unit's `src/`.

The counterexample is exact. Edit `tsconfig.base.json`, rebuild nothing. No file
under any `src/` moves, so `newest(src)` is unchanged for all 19 units, `dist` is
unchanged, and the check compares two unmoved numbers and reports clean
everywhere. **One edit, a silent miss across the entire workspace** — a blast
radius larger than blind spots 1-3, each confined to one package. It is the same
failure direction the record already condemned for the root-vs-root mtime design,
reappearing at a layer no round had inspected.

⚠️ **The record held the evidence against its own design and did not read it.**
The prior-art bullet quotes `.tsbuildinfo`'s top-level keys to argue against
parsing it, and one of those keys is `options` — tsc's own record of the compiler
options a build ran under, **20** of them in `e2e/report/dist/.tsbuildinfo`,
including `strict`, `target` and `module`. The structure cited to reject the
alternative is the same structure that documents what the chosen approach drops.
Nine rounds of review walked past it because every round checked whether the
citation _supported the claim made from it_, and none asked what else the cited
artifact said.

Dispositioned `fixed` as **assumption 5**, plus a sixth blind spot in Q5 and a
sixth bullet in the limits section — placed in the body on the first attempt this
time, which is the only visible return on paying for that lesson four times.

ℹ️ The lens also re-verified round 8's two rule-outs rather than inheriting them:
`/proc/mounts` confirms `/` is `ext4` (not the 9p-backed `/mnt/*`), and every
`runs-on` across the workflows is GitHub-hosted with no `self-hosted` label
anywhere. Both premises stand.

**Round 9, source-quality lens (2026-08-19) — `approve`.** Third consecutive
clean verdict, and the most thorough citation pass yet: Q4's regenerated
transcript checked row by row against the script's print order **and its
`padEnd(40)` column arithmetic**, the cross-package remedy confirmed to state the
same comparison in Q5, the limits section and Corrections, and a broad resample
of every path, line and count in the record.

Two details worth keeping:

- It re-derived the reflog epochs independently and noted that
  `1787082401 - 1787081802 = 599s`, which matches the record's own 21:36:42 →
  21:46:41 gap exactly. A cross-check the record did not ask for.
- It **declined to re-run the probe**, having no `Bash`, and said so — verifying
  by reading the script and matching the transcript's shape against its logic
  instead. It also declined the `git cat-file` check for the same reason, making
  the same call round 6's lens did.

ℹ️ That leaves exactly one claim in this record that no reviewer has been able to
verify independently: `coverage-gate-registration.ts`'s presence at `4414a16` and
absence at `8605760`. It was measured with `git cat-file -e` by the manager
session, which has `Bash`, and is recorded as such. Two lenses have now correctly
declined to confirm or deny it rather than guessing. **That is the honest state
of it, and it is written here so no later round mistakes reviewer silence for
verification.**

**Round 10 (2026-08-19) — completeness `approve`, source-quality `approve`,
assumption-audit `revise` with the finding that changes this record's headline
answer.** Round 10's assumption-audit lens was the first given a shell, and that
one difference produced more than the nine rounds before it.

**Two claims no reviewer could previously check are now independently verified.**

| check                                                                      | result                                               |
| -------------------------------------------------------------------------- | ---------------------------------------------------- |
| `git cat-file -e 8605760:packages/gates/src/coverage-gate-registration.ts` | **ABSENT**, as claimed                               |
| same at `4414a16`                                                          | **PRESENT**, as claimed                              |
| `node docs/evidence/phase-26/mtime-propagation-probe.mjs`                  | **exit 0**, `PASS`, all six rows in the quoted order |

The ℹ️ note closing round 9 is discharged: nothing in this record now rests on a
measurement only the manager session has seen.

⚠️ **Q2's answer was wrong, and this is the most important correction in the
record.** Q2 said nothing already detects it. `scripts/bundle-types.mjs:70` is
**exactly the comparison this record proposes** — `newest(sources)` against an
artifact's mtime — shipped and running in this repository. Q2 missed it because
both of its searches covered `packages/cli/src/doctor/checks/` and `check:all`,
and neither covered `scripts/`; `scripts/` is compiled by no `tsconfig.json`
(root `tsconfig.json:2` is `"files": []`), so it fell outside every enumeration
this record had built. **The record's own scope bug hid its own prior art.**

Worse and better at once: that implementation's comment records the design
**failing in production** — `tsc -b` overwrote the bundled `.d.ts` and refreshed
its mtime, so the check "would then declare the cache current while holding
tsc's output", caught downstream as `Cannot find module './exit-codes.js'`. That
is blind spot 1, already suffered and already worked around here. Prior art now
leads with it.

**Finding 1 (blocking) — "inputs" was silently read as "data".** The build's own
program and its pinned toolchain are inputs. Counterexample, verified: change
`EXTERNAL_DEPENDENCIES` in `scripts/bundle-cli.mjs` and rebuild nothing — no
`src`, no `tsconfig`, no `dist` moves, the check reports clean for all 19 units,
and `bin.js` is the build of the old list. Same for a `typescript` version bump,
where `tsc` itself disagrees with the check: `.tsbuildinfo` carries
`version: "6.0.3"` and invalidates on mismatch.

**And again the record held the evidence and had not read it.** Round 9 mined
`options` out of `.tsbuildinfo`'s key list. The same artifact's `fileNames` is
tsc's own enumeration of what the build read — re-measured here:

| slice                       | count   |
| --------------------------- | ------- |
| total                       | **421** |
| `node_modules`              | **304** |
| `typescript/lib/lib.*.d.ts` | **63**  |
| workspace `dist/*.d.ts`     | **107** |
| **under any `src/`**        | **10**  |

**10 of 421.** The compiler's answer is that `src` is ~2% of a build's inputs.
Recorded as **assumption 6** — stated, not closed, because closing it means
reimplementing `.tsbuildinfo`.

**Finding 2 (advisory) — the pipeline has three tiers, not two.**
`packages/cli/dist/index.d.ts` is a `copyFile` of
`packages/cli/.dts-cache/index.d.ts` (`bundle-cli.mjs:153`), and that cache is
gitignored (`.gitignore:47`) — **neither `src` nor `dist`, invisible at both ends**.
The lens distinguished it from blind spot 1 rather than letting it be absorbed:
that one is a `dist`-side mtime refresh, this is an artifact the comparison never
looks at. Its counterexample is the operator's own remedy — `rm -rf dist` and
rebuild leaves `.dts-cache` untouched, so the check says clean before and after.

Dispositioned `fixed`: **assumption 6**, **blind spots 7 and 8**, and two new
limits bullets — Q5 and the limits section now carry eight each, in
correspondence. Placed in the body on first landing.

ℹ️ **The lens flagged the Q2/prior-art problem as outside its own lens** and said
so, rather than filing it under `assumption-audit` to make its report bigger. It
was verified and acted on here because the manager session has the shell to check
it, not because the lens claimed it.
