# Why an agent misses code in this repo, and what actually fixes it

**Answer.** The blind spots were not a findability problem — one unscoped `grep`
finds the file that ten review rounds missed. They were a **coverage-accounting**
problem, and every off-the-shelf index scopes itself by the same rule that
created the blind spot.

## What was actually missed

| #   | miss                                                                                                                                         | why                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | `scripts/bundle-types.mjs:70` — an mtime staleness check identical to the one being designed, while the record answered "nothing detects it" | the search enumerated `doctor/checks/` and `check:all`; `scripts/` is in **zero** tsconfigs             |
| 2   | `e2e/report` — a compiled unit executed in CI                                                                                                | enumerated from the `packages/*` workspaces glob; it has no `package.json`                              |
| 3   | `packages/cli/.dts-cache/` — copied into `dist`                                                                                              | gitignored, so invisible to git-based search — but only reachable _because_ `scripts/` was out of frame |
| 4   | `getTsBuildInfoEmitOutputFilePath`                                                                                                           | `BuildInfo\b` cannot match it; corpus was `node_modules`, outside every repo index                      |
| 5   | six count defects (`14/15`, `12/13`, `142/141`, `turbo`, undated reflog, and #4)                                                             | every one a search narrower than the claim it evidenced                                                 |

⚠️ **The decisive counter-test.** `git ls-files | xargs grep -ln mtime`, excluding
`docs/`, returns **8 files** — `scripts/bundle-types.mjs` among them. Widening to
`mtimeMs|statSync` returns **39**. Both were available in round 1. **This was never
a retrieval-capability deficit**; the search space was narrowed by plausible
convention before any search ran, and nothing compared that space to the claim.

## Why the obvious answers fail — measured, not argued

**SCIP's blind spot mirrors the root tsconfig exactly.** `@sourcegraph/scip-typescript`
indexed this repo in **22.1s** producing a **34MB**, **1501-document** index. Also
measured: **0** `.mjs` documents, and all **8** unreferenced e2e projects (204 TS
files) absent. The one tool with real symbol precision is structurally blind to the
exact region that caused failure 1.

That is not a maturity gap. `scip-typescript`, `tsserver` and `ts-morph` are all
built on the same TypeScript `Program` abstraction, so all three inherit tsconfig
scoping; a third-party tool (`scip-io`) exists purely to route around it. The
escape routes are closed: `github/stack-graphs` (cross-file resolution without a
type checker) is **archived**; Glean has no native TS indexer and ingests SCIP,
inheriting the limit; Kythe has no JS/TS indexer outside Google's build.

**Each scoping rule is the rule that hid the file.**

| candidate                         | scopes by                      | why it misses `scripts/bundle-types.mjs`                                                                          |
| --------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| SCIP                              | tsconfig membership            | in zero tsconfigs — **measured: 0 `.mjs` indexed**                                                                |
| repo map (tree-sitter + PageRank) | git-tracked + graph centrality | **zero importers** → rank floor → truncated first                                                                 |
| dependency graph                  | import edges                   | invoked by a shell string, `"bundle:types": "node scripts/bundle-types.mjs"` (`package.json:48`) — no edge exists |

**Two candidate tools reproduced the failure mode during measurement.**

- `depcruise --no-config packages/contracts/src` prints
  `✔ no dependency violations found (0 modules, 0 dependencies cruised)` and exits
  **0**. A green tick for zero work — a confident false clean, which is failure
  mode 5 exactly.
- An `ast-grep` pattern `export function $N($$$) { $$$ }` matched **1** node across
  `packages/`, because nearly every exported function carries a return-type
  annotation that changes the AST shape. A kind-based rule found **1154** matches
  across 599 files. The tool proposed to cure brittle patterns has brittle
  patterns of its own.
- Separately: `npx --yes ast-grep` resolves to an **unrelated package at 0.1.0**;
  the real tool needs `npx --yes --package @ast-grep/cli ast-grep` (0.45.1).

**And the literature does not support the graph answers.** Aider's repo map has
**no published evaluation** — the origin post is a mechanism description. Every
quantified agentic-search-vs-RAG number is vendor-internal. ContextBench (1,136
tasks, 66 repos, gold-annotated context) finds _"sophisticated agent scaffolding
does not necessarily improve context retrieval performance"_, with plain bash
retrieval matching specialised scaffolds and line-level F1 below **0.45**
throughout. The one measured comparison of structural search against grep
(arXiv 2506.11598, 21 C libraries) found **grep performed better in the majority
of cases**, root-caused to parser failures on valid code.

**The honest gap.** No published technique tells an agent that its search space
omitted a region. Context precision/recall metrics all require a known gold set,
so they are benchmark-construction tools, not a runtime signal. Failure mode 1 has
no countermeasure in the literature.

## The measured shape of this repo

| population                                                              | count        |
| ----------------------------------------------------------------------- | ------------ |
| tracked files                                                           | **2723**     |
| tracked `.ts`/`.mts`/`.cts`                                             | 1722         |
| …covered by a **root-referenced** project                               | 1502 (87.2%) |
| …covered by **any** tsconfig                                            | 1706 (99.1%) |
| …covered by **none**                                                    | 16           |
| tracked `.mjs`/`.js`/`.cjs` — never covered, `allowJs` unset everywhere | **71**       |
| tsconfigs that exist                                                    | **28**       |
| tsconfigs referenced from root                                          | **19**       |
| gitignored files on disk, excluding `node_modules`                      | **7833**     |

Two findings fall straight out of that table.

1. **28 tsconfigs exist; 19 are in the root graph.** The 8 e2e projects are
   typechecked by `scripts/check-e2e-types.mjs`, which **hardcodes** its project
   list rather than discovering tsconfigs. It currently matches — a new e2e
   project would be typechecked by nothing, silently.
2. **One `.env` file is present on disk**, gitignored. Invisible to every
   git-based tool, readable by any filesystem walker. Worth knowing before
   pointing a filesystem-walking indexer at this tree.

## The recommendation

Not an index. A **census** plus a **quantifier check**, both local and
dependency-free.

### 1. The census — ground truth about what exists, generated on demand

One row per path on disk (tracked _and_ ignored, excluding `node_modules`),
carrying every membership that any enumeration might key on: tracked or ignored;
which of the **28** tsconfigs include it; whether it is in the root `tsc -b`
graph; its workspace, if any; which npm script or workflow names it _as a string_;
and whether it is emitted output.

The novel part is not the inventory. It is that the census derives membership
from **several independent enumerations and reports where they disagree** —
28 tsconfigs vs 19 references, 18 workspaces vs 19 references, files named by a
script but in no build graph. **The disagreements are the blind spots**, and
listing them is the coverage signal the literature says does not exist.

⚠️ **Generate on demand; never commit it.** A committed census becomes the 20th
build artifact with its own staleness problem — the precise defect class this
whole change set is about. A stale census yields a _confidently wrong_
enumeration, which is strictly worse than an obviously incomplete one.

### 2. The quantifier check — a claim's corpus must be as wide as its claim

A universal negative ("nothing in this repository detects it") backed by two
directory-scoped searches is a visible quantifier mismatch. Requiring the exact
command beside the claim makes it visible; checking the command's corpus against
the census population makes it mechanical.

This generalises to failures 1, 2, 4 and 5. It is also what actually worked:
nine rounds of context-fed review missed the file; it was found in round 10 **by
the first reviewer given a shell**.

### 3. Non-vacuity — a search returning zero must be shown able to return non-zero

Both footguns above return a confident zero. So did a `/dev/null` guard removed
earlier in this change set, and so would any future one. The discipline already
applied to gates applies to searches: demonstrate the negative can flip.

## What this does NOT establish

- **It does not solve recognition.** The census tells you `scripts/` exists and is
  outside every index. It does not tell you `bundle-types.mjs` _is_ a staleness
  check — you still read 17 non-test scripts. It converts a semantic miss into a
  coverage miss: necessary, not sufficient.
- **It cannot help with failure 4.** That corpus was `node_modules/typescript`,
  outside any repo census by definition. The fix there is a corpus rule, not
  infrastructure.
- **SCIP is not useless** — 22s for type-accurate references within the build
  graph is cheap and genuinely precise. It is disqualified as _the answer to this
  problem_, because adopting it here would have added an authoritative-looking
  surface with our exact blind spot compiled in.
- **The census is itself an enumeration** and can be wrong. It earns trust only
  by cross-checking independent sources and publishing the disagreements, never
  by being the single source it replaces.

## Prior art in this repo, to extend rather than replace

- `scripts/check-package-graph-acyclic.mjs` — already builds a workspace graph
  from `package.json` manifests. Its header records _why_ it reads manifests
  rather than tsconfig references: a stale `dist/` once masked a real cycle. The
  same theme, already learned here.
- `scripts/citation-content/file-index.mjs` — a line-level file index with a
  four-rung normalisation ladder, **dependency-free by design** because
  `meta-checks` runs `npm ci` with no build step. Any new tooling should honour
  that constraint.
- `scripts/check-repo-hygiene.mjs` — the canonical `git ls-files -z` walker with
  an extension-classification table.
