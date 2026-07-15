# Phase 07 — Git engine: control repo, worktrees, overlap analysis

| | |
|---|---|
| **Depends on** | 04 |
| **Unlocks** | 08 (shares `packages/git-engine`: frozen base object ID, control clone, worktree/ref conventions, invariance harness), 13 (overlap-analysis output, worktree lifecycle, frozen base object ID); 23 transitively (via 08's `P08 --> P23` edge — reuses this phase's invariance harness, worktree quarantine, and control-clone location directly) |
| **Sources** | original plan "Git and worktree isolation"; adaptation §3.2 (why not native `.claude/worktrees`), §4.5 (worktree-scoped session resume), §8 (Git engine "stays exactly as planned") |
| **Primary package** | `packages/git-engine` |

## Goal

Supervisor-owned Git machinery that never touches the user's checkout: a control clone, an intake freeze that pins the exact base object ID and dirty state, per-attempt worktrees with quarantine (never silent cleanup), and a rename-aware overlap analyzer that lets 13 serialize only the work units that actually collide. Done means: every operation in this package's own test suite proves the user's working tree is byte-identical before and after, and 08/13/23 can each consume this phase's outputs directly, with none of them re-deriving or re-implementing what this phase already built.

## In scope

- **Repository validation:** Git plumbing checks (not `.git` presence); unborn HEAD, SHA-256 object-format repos, submodules, LFS pointers (no smudge in control-repo context), filters/hooks neutralized in control context (`core.hooksPath` empty).
- **Control clone:** `git clone --no-local` per project into `$XDG_CACHE_HOME/engineering-orchestrator/<project-hash>/git-control/` (cache-root convention pinned in 04); never shared object alternates; fetch strategy for target-ref updates.
- **Intake freeze:** target ref, exact base object ID, repository format, porcelain-v2 dirty snapshot of the user checkout; planned-write vs dirty-path overlap → typed block; unrelated dirt untouched. Journaled as a `git_freeze` entry (`JournalEntryType`, 02, via 04).
- **Worktrees:** created per dispatched attempt — a work unit's primary attempt, a repair attempt, or 13/22's shadow-run mirrored attempt all get their own worktree — under supervisor-owned dirs; neutral internal refs `work/<run>/<change-set>/<task>/<attempt>` (the `<attempt>` segment disambiguates concurrent or repeated attempts on the same task so two worktrees never collide on one ref); destroy/quarantine lifecycle (dirty or uncertain worktrees quarantined with a journaled `worktree_quarantine` entry, never silently cleaned); crash-orphan sweep on startup.
- **Git identity:** per-worktree `user.name "Engineering Orchestrator"` + configured service email, set at worktree-creation time — every commit a worker makes already carries it before 08 ever inspects the tree.
- **Overlap analysis:** rename-aware path analysis (`git diff --find-renames`) between planned write-path sets plus a declared non-Git resource registry (lockfiles, migrations, generated artifacts, shared schemas) — produces the serialization input 13's readiness engine reads.
- **Invariance harness:** an exported, reusable before/after tree-hash assertion, used throughout this phase's own suite and reused directly (not forked or re-implemented) by 08 and 23.

## Out of scope

- Merge preflight (`git merge-tree --write-tree`), CAS ref updates and the rebuild/reverify loop, branch naming, commit rendering, and local publication — phase 08, built on top of this phase's plumbing/clone/worktree/freeze primitives inside the same `packages/git-engine` package (08 and 07 are two phases building one package, not a producer/consumer pair across a package boundary).
- DAG scheduling, fan-out/concurrency decisions, TaskPacket construction, model routing, limit-parking, and attempt-repair policy — phase 13. This phase supplies the overlap-analysis primitive, the worktree lifecycle, and the frozen base object ID; it never decides when or whether to dispatch anything.
- Deciding which paths a given work unit owns (`AuthorizationEnvelope`'s owned-paths) — phase 11 (assembly) / phase 03 (envelope compiler). This phase's overlap analyzer takes a caller-supplied set of planned write paths as input; it never determines ownership itself.
- Serving `project.inspect`'s repo-summary reads — phase 11 reads this phase's already-journaled freeze/quarantine records directly from the journal (04): "soft reads of already-journaled state, not phase-code dependencies," per 11's own text. This phase does not expose or serve a separate read API for that purpose.
- Journal chain/fsync/snapshot/lease mechanics themselves — phase 04; this phase only writes typed entries into it.
- Spawning, configuring, or adjudicating the engine (EngineAdapter, permission/sandbox compilation) — phases 06/03/05. This phase hands a worktree path to its caller as a plain string; it has no opinion on what runs inside it.
- Using Claude Code's native `.claude/worktrees/` / subagent `isolation: "worktree"` mechanism for worker isolation — deliberately not used here (adaptation §3.2: young feature — a v2.1.203 bug let worktree-isolated subagents run commands in the parent checkout — interactive cleanup semantics, no crash-safe supervisor ownership). That mechanism is reserved for phase 10's manager-side read-heavy exploration subagents only.

## Interfaces produced

Everything below is exported from `packages/git-engine`, which this phase builds; 08 extends the same package in place.

- **Plumbing wrapper** — spawned `git` (argv-array only, no shell interpolation) + version probe. Reused by 08 for its own `git merge-tree`/`git update-ref` calls rather than a second spawn implementation.
- **Control clone** — on-disk control repository at `$XDG_CACHE_HOME/engineering-orchestrator/<project-hash>/git-control/` (Gap 14). Consumed by 08 (`git fetch <control-repo> <ref>:refs/heads/<branch>`, run in the user's repo, at publication time) and by 23 (Git-invariance matrix harness, reused directly at this exact path).
- **Intake freeze** — target ref, exact base object ID, repository format, porcelain-v2 dirty snapshot, and a typed block when planned writes intersect dirty paths. The base-object-id this captures is what 13's TaskPacket builder threads into `TaskPacket`'s base-object-id field (02) and what 08 uses as its CAS "expected-old-value" baseline for `git update-ref`. Journaled as a `git_freeze` entry (`JournalEntryType`, 02). Not a `packages/contracts` schema — a `packages/git-engine`-internal structure whose relevant fields feed 02-owned contracts downstream.
- **Worktree lifecycle** (create / destroy / quarantine) — every dispatched attempt (primary, repair, or 13/22's shadow-run mirror) gets a worktree path handed to it as its engine spawn `cwd` (06's spawn surface, invoked by 13 — this phase never calls 06 itself). Neutral internal ref `work/<run>/<change-set>/<task>/<attempt>`. Quarantine journaled as a `worktree_quarantine` entry (`JournalEntryType`, 02); reused directly by 23's orchestration/Git-invariance matrix. Crash-orphan sweep runs at the next call into this package after a kill -9, invoked in practice by 13's executor per its own dependency on this phase.
- **Overlap analyzer** — given candidate work units' planned write-path sets plus the declared non-Git resource registry, returns a rename-aware pairwise collision verdict. This is exactly the "serialization input" 13's readiness engine reads; 13's own property-test exit criterion ("overlapping units never concurrent") is a test of this function's correctness as exercised through 13.
- **Git identity guarantee** — every worktree this phase creates already carries `user.name "Engineering Orchestrator"` + the configured service email before any commit lands in it. 08's commit rendering and its belt-and-suspenders attribution assertion depend on this already being true; neither re-configures identity.
- **Invariance harness** — an exported before/after tree-hash assertion utility. Reused directly (not forked or re-implemented) by 08's publish-invariance assertions and by 23's Git-invariance + neutral-rendering matrix harness.
- **Journal entries** — this phase is the sole writer of the `git_freeze` and `worktree_quarantine` members of `JournalEntryType`'s 13-member union (02, Gap 5; ledger's "Git freeze records" / "Worktree quarantine records" categories). Readable by any phase with journal access (04) — in particular 11's `project.inspect` (soft read, no dependency edge, per 11's own text) and 23's release-gate report generator.

## Interfaces consumed

- **From 04** (`packages/journal`) — the one real dependency edge: the journal append API and its typed-entry/schema-versioning discipline, through which this phase's `git_freeze`/`worktree_quarantine` entries are written; the `$XDG_CACHE_HOME/engineering-orchestrator/` shared cache root (04's Layout bullet, Gap 14) that this phase's control clone nests under at the `<project-hash>/git-control/` subpath; the project-hash convention 04 already establishes for its own state layout, reused here rather than re-derived; 04's crash/kill-harness test utility, reused directly for this phase's own crash tests (the same style of direct reuse as 08's/23's reuse of this phase's invariance harness).
- **Ambient, via `packages/contracts` (02)** — foundational schema package on the critical path ahead of every phase in Depends-on, not a direct Depends-on edge; the same convention 11 and 13 already state for their own 02 consumption (11's own text names 07 explicitly among the phases with this pattern): `JournalEntryType`'s `git_freeze` and `worktree_quarantine` members — the two entry types this phase's freeze and quarantine operations are typed against and tested for exhaustiveness against (02's discriminated-union harness).

## Work items

1. Plumbing wrapper (spawned `git`, argv-array only, no shell) + version probe. Failing-test-first: a path/branch fixture containing shell metacharacters (`;`, `&&`, `$(...)`, backticks) must reach `git` as one literal argv element, never a shell.
2. Invariance harness (tree-hash before/after) as an exported utility. Failing-test-first: a deliberately mutated fixture tree must fail the harness before the harness is trusted by any later work item's own tests.
3. Repository-validation checks on top of the plumbing wrapper: unborn HEAD, SHA-256 object format, submodules, LFS pointers, `core.hooksPath` neutralization. Failing-test-first: each fixture repo shape fails validation until its specific check exists.
4. Porcelain-v2 parser + dirty-snapshot capture. Failing-test-first: a hand-built `git status --porcelain=v2` byte stream (modified/added/deleted/renamed/untracked/ignored/conflicted) must parse to the expected structured snapshot before the parser exists.
5. Control clone (`$XDG_CACHE_HOME/engineering-orchestrator/<project-hash>/git-control/`, Gap 14) + fetch-refresh path + intake freeze (uses work items 1/3/4) + journaled `git_freeze` entries incl. the planned-write/dirty-path typed block. Failing-test-first: freezing a dirty user checkout with an intersecting planned write blocks with the exact offending paths named; a disjoint dirty path never blocks.
6. Worktree lifecycle (create per attempt / destroy / quarantine) + crash-orphan sweep at startup, journaled `worktree_quarantine` entries. Failing-test-first: kill -9 mid-worktree-creation, then the next startup must either complete the worktree or quarantine it — never silently drop it.
7. Rename-aware overlap analyzer (`git diff --find-renames`) + non-Git resource registry. Failing-test-first: a moved-in-one/edited-in-other fixture must be flagged as a collision before the analyzer has real logic.
8. Git identity configuration per worktree + tests. Failing-test-first: a commit made immediately after worktree creation, with no explicit identity call from the caller, must already carry the configured neutral identity.

## Test plan

- **Unit:** plumbing-wrapper argv-injection resistance (shell-metacharacter/backtick/newline fixtures); porcelain-v2 parser against hand-built status-v2 fixtures covering every state (modified, added, deleted, renamed, untracked, ignored, conflicted); repository-validation fixtures (unborn HEAD, SHA-256 repo, submodule, LFS pointer, non-empty `core.hooksPath`); worktree internal-ref collision resistance across concurrent attempt IDs on the same task.
- **Property (fast-check):** rename-aware overlap analyzer over random path-set pairs with injected renames — never misses a true collision, never flags a disjoint pair; porcelain-snapshot parser determinism — re-parsing an identical status-v2 byte stream twice always yields byte-identical structured output.
- **Integration:** control-clone create + fetch-refresh against a real on-disk fixture repo (no mocked git); worktree create → dirty it → quarantine → recover across a supervisor-process restart; dirty-overlap block fires exactly on the seeded intersecting path and never on a seeded disjoint "unrelated dirt" path; crash tests reusing 04's kill harness (kill -9 mid-clone, mid-worktree-create, mid-quarantine — each must recover deterministically on next startup).
- **Conformance:** the invariance harness wraps every test in this phase's own suite — user checkout tree-hash asserted identical before/after every operation, not just the ones with a dedicated exit criterion.
- **Security:** command-injection corpus — path/branch-name/ref fixtures containing shell metacharacters, backticks, `$(...)`, and embedded newlines, each proven to reach `git` as a literal argv element (spawned, no shell) rather than being interpreted; path-escape fixtures (`../`, absolute paths, symlink escape out of the assigned worktree) rejected at the worktree boundary.

## Exit criteria

- [ ] Invariance harness: user checkout tree-hash identical before/after every engine operation across the suite (`invariance.spec`).
- [ ] SHA-256, submodule, LFS, unborn-HEAD, filters/hooks fixtures pass repository validation.
- [ ] Dirty-overlap block fires exactly on intersection with the porcelain snapshot; a disjoint dirty path never blocks.
- [ ] Quarantine journaled and recoverable; crash-orphan sweep completes or quarantines every orphaned worktree after a kill -9, never silently drops one.
- [ ] Every worktree carries the configured neutral git identity (`user.name`/`user.email`) immediately after creation, with no explicit identity call from the caller — verified across the worktree-creation fixture set.
- [ ] Overlap analyzer catches rename collisions (moved-in-one/edited-in-other fixture) and clears disjoint-path fixtures, exercised by the fast-check property suite.
- [ ] Every entry this package journals matches the `git_freeze` or `worktree_quarantine` member of `JournalEntryType` and passes 02's discriminated-union exhaustiveness harness (mirrors 13's own exit-criterion phrasing for the same harness).
- [ ] Control clone resolves at `$XDG_CACHE_HOME/engineering-orchestrator/<project-hash>/git-control/` — a path-convention test, not just documentation.
- [ ] Command-injection corpus: zero fixtures reach a shell; a static check confirms no `shell: true` / string-concatenated command line exists anywhere on this package's spawn surface.

## Risks & open questions

- Command-injection surface: argv-only invocation is this phase's core security property, reviewed in its own security-test pass and re-asserted structurally (not just by test absence) per the last exit criterion above.
- Native worktree/subagent isolation is young (adaptation §10 risk 6; v2.1.203 fixed worktree-isolated subagents running commands in the parent checkout) — exactly the class of failure supervisor-owned worktrees are designed to avoid by never delegating worktree lifecycle to the engine. This phase asserts no Claude Code engine fact of its own (no flags, settings keys, permission forms, or sandbox fields) — confirmed against adaptation §8's "stays exactly as planned" list. Adaptation §9's new test-matrix items (envelope conformance, hook enforcement, sandbox, hermeticity, structured output, sessions, neutrality, version drift) are owned by 00/03/06/08/09/10/13/17 — none by this phase, since it is pure Git plumbing. No `docs/engine-baseline.md` citation or verify-at-build-time spike applies here.
- The declared non-Git resource registry (lockfiles, migrations, generated artifacts, shared schemas) has no stated cross-phase producer anywhere in the source material — this phase treats it as configuration it accepts and matches directly, per the original skeleton's own framing. Flagging for the reconciler: a future phase (11's contract assembly is the natural candidate) may want to be the actual declarer rather than each project hand-configuring it.
- The per-attempt worktree ref `work/<run>/<change-set>/<task>/<attempt>` adds an `<attempt>` segment beyond a plain per-task ref, needed so a repair attempt or a shadow-run mirror (13/22) never collides with the primary attempt's worktree on one ref — 13's and 22's own text already assume this capability ("each dispatched attempt, primary or shadow, gets a worktree path"). The exact `<attempt>` token format is this phase's own to define and is not itself a cross-phase contract; 13 supplies the value, this phase only guarantees uniqueness.
- WSL2: the control clone and every worktree live under `$XDG_CACHE_HOME`, inheriting the same host-filesystem caveat 04/09 already flag for XDG state dirs (9p-mount quirks under `/mnt/c`); no new engine fact is asserted here, only the existing doctor-level warning applying to one more path root.
