# Phase 08 — Merge preflight, CAS refs, neutral Git rendering, local publication

| | |
|---|---|
| **Depends on** | 02 (`ChangeSet`/`WorkUnit`/`CommunicationPolicy`/`JournalEntryType`/`EvidenceRecord`/`RenderedArtifact`), 07 (control clone, worktrees, overlap analysis), 17 (`ArtifactKind`, `lint()`/`renderWithRegeneration()`) |
| **Unlocks** | 23 (`P08 --> P23` in the README graph; no other phase's header names 08 as a dependency — see Risks) |
| **Sources** | original plan "Git and worktree isolation" (integration/publication half) + "Concise communication policy" (neutral identity); adaptation §5.4 (neutral identity), §8 ("local-branch publication without checkout/push" — stays exactly as planned) |
| **Primary package** | `packages/git-engine` (shared with 07 — 08 adds the integration/publication half; see Risks for module-boundary note) |

## Goal

Verified commits become a local branch in the user's repo — preflighted, compare-and-swap-safe, rendered under the neutral communication policy, never checked out, never pushed — and the ChangeSet's terminal PR-title/PR-body/review-comment handoff copy is lint-passed and attached to its evidence bundle for a human operator to retrieve and paste into their own VCS-host workflow. No phase calls a PR/hosting API; this phase is where that boundary is enforced structurally, not merely documented.

## In scope

- **Preflight:** `git merge-tree --write-tree` between candidate and frozen target (07's intake freeze); conflicts become typed resolution `WorkUnit`s (02 schema) — no auto-resolution.
- **CAS integration:** `git update-ref` with expected-old-value; target advance → bounded rebuild & reverify loop, every attempt journaled as a `cas_ref_update` entry (`JournalEntryType`, 02).
- **Branch naming:** `<type>/[JIRA-KEY-]<short-slug>`; types feat/fix/perf/refactor/security/test/docs/ci/chore; ≤64 chars; numeric collision suffix; no engine/worker/run identifiers; git-ref charset/length legality enforced by construction, then passed through 17's `renderWithRegeneration()` for the `branch_name` `ArtifactKind`.
- **Commit rendering:** subject `type(scope): outcome` ≤72; body ≤5 short lines (why/risk/compat/verification only); optional `Refs:` footer; assembled from already-produced `ChangeSet`/`WorkUnit`/`Requirement` fields (no free-text authorship) and routed through 17's `renderWithRegeneration()` for `commit_subject`/`commit_body` — 08 does not re-implement attribution/Unicode/secret scanning itself.
- **Evidence attachment (Gap 6):** `pr_title`/`pr_body`/`review_comment` candidates assembled from the ChangeSet's `Requirement`/`EvidenceRecord` summaries (the same underlying data as the commit body, projected into the PR's 4-section and the review-comment's 1-finding shape), rendered via 17's `renderWithRegeneration()`; each lint-passed `RenderedArtifact` is wrapped in an `EvidenceRecord` (02) and journaled as an `evidence_pointer` entry (`JournalEntryType`, 02) against the ChangeSet — no delivery, no VCS-host call, ever.
- **Publication:** final branch created in the **user's** repo without checkout or push (`git fetch <control-repo> <ref>:refs/heads/<branch>` run in the user repo; control-repo path per 07's `$XDG_CACHE_HOME/engineering-orchestrator/<project-hash>/git-control/`); HEAD/index/worktree untouched.
- **Belt-and-suspenders:** publication asserts rendered commits carry no engine attribution regardless of host settings, independent of whatever 03/06 configured in the worker's own settings — a redundant second enforcement layer, not a substitute for 17's lint.

## Out of scope

- Opening a pull request or posting a review comment to any VCS host, ever — no GitHub/GitLab/Bitbucket connector exists or is planned (17's Goal; Gap 6). `pr_title`/`pr_body`/`review_comment` are copy-paste handoff artifacts only.
- Tying `review_comment` evidence to 13/14's gate-failure/repair-dispatch pipeline — rejected by Gap 6's resolution; it groups with `pr_title`/`pr_body` here as a terminal, evidence-retrievable artifact, not a repair-loop trigger.
- The `lint()`/`renderWithRegeneration()` stage pipeline, Unicode/secret/attribution scanning logic, and template length rules themselves — owned by 17; 08 is a caller, not an implementer.
- Defining the `ChangeSet`/`WorkUnit`/`CommunicationPolicy`/`JournalEntryType`/`EvidenceRecord`/`RenderedArtifact` schemas — owned by 02.
- Git plumbing wrapper, control clone, worktree lifecycle/quarantine, porcelain-v2 parsing, rename-aware overlap analysis — owned by 07; 08 consumes their outputs as preflight/publish inputs.
- Dispatching or attempting the resolution `WorkUnit`s this phase creates (`WorkUnitAttemptStatus` transitions) — owned by 13's scheduler.
- Re-verifying the integrated result (`final_verifying`) — owned by 14; runs between this phase's integration-stage work and its publish-stage work.
- Surfacing attached evidence via a CLI command — owned by 09's `evidence <change-set-id>` (Gap 6).
- The journal's own chain/fsync/idempotency mechanics — owned by 04 (transitively available via 07).

## Interfaces produced

- **Package** `packages/git-engine`, integration/publication half (shared with 07).
- **`preflightMerge(candidateRef, frozenBaseObjectId): PreflightResult`** — wraps `git merge-tree --write-tree`. `PreflightResult` is `{ ok: true, treeId: string } | { ok: false, conflicts: WorkUnit[] }`; conflicts are surfaced directly as `WorkUnit` (02) instances of a resolution kind. Consumed by: 13's scheduler, via the generic `WorkUnit` dispatch interface it already has through its existing dependency on 07 (shared `packages/git-engine`) — no new 08→13 dependency edge needed.
- **`applyCasUpdate(ref, expectedOldValue, newValue): CasUpdateResult`** — wraps `git update-ref` compare-and-swap; on a lost race, drives the bounded rebuild-and-reverify loop. Every attempt is journaled as a `cas_ref_update`-typed entry (`JournalEntryType`, 02) via 04's journal (transitively available through 07). Consumed by: 23 (Git-invariance matrix harness, re-run against the release candidate).
- **`nameBranch(changeSet): string`** — deterministic `<type>/[JIRA-KEY-]<short-slug>` generator, charset/length-legal by construction, then passed through 17's `renderWithRegeneration()` for the `branch_name` `ArtifactKind`. Consumed by: `publishLocal` (below), 23.
- **`renderCommit(workUnit): { subject: string, body: string }`** — assembles the `type(scope): outcome` candidate from already-produced structured fields, rendered via 17's `renderWithRegeneration()` for `commit_subject`/`commit_body`. Consumed by: `publishLocal`, 23.
- **Evidence-attachment routine** — for each of `pr_title`/`pr_body`/`review_comment`, assembles a candidate from the ChangeSet's evidence summaries and calls 17's `renderWithRegeneration()`; every lint-passed `RenderedArtifact` is wrapped in an `EvidenceRecord` (02) and journaled as an `evidence_pointer` entry (`JournalEntryType`, 02). Consumed by: 09's `evidence <change-set-id>` command, via the generic `EvidenceRecord`/journal query surface (02/04) it already reads regardless of writer — no new 08→09 dependency edge (Gap 6); 23 (release-gate report reads the same `EvidenceRecord`s).
- **`publishLocal(changeSet, branch): PublishResult`** — the single write into user space: `git fetch <control-repo> <ref>:refs/heads/<branch>` executed inside the user's repo; asserts zero checkout/index/HEAD mutation and zero remote interaction. Consumed by: 23 ("Local publication routine... reused directly inside the Git-matrix harness"; demo-run exit criterion invokes this path directly).
- **Invariance-harness extension** — extends 07's tree-hash before/after harness across every operation this phase adds (preflight, CAS update, publish). Consumed by: 23 (Git-invariance + neutral-rendering matrix harness).
- **Shared attribution-leak fixture** — the seeded "Generated with…"/"Co-Authored-By" fixture is the *same* fixture 17's work item 4 uses, asserted from both sides; 08 does not fork a duplicate copy. Consumed by: 23 (re-executes 17's corpus as release-gate evidence; 08's own golden suite asserts the identical fixture).

## Interfaces consumed

From **02** (`packages/contracts`):
- `ChangeSet`, `WorkUnit`, `Requirement` schemas — preflight/branch/commit/evidence-assembly inputs.
- Run-lifecycle states `integrating` and `published_local` (terminal `blocked` on unresolved conflict/CAS failure) — the states this phase's logic realizes. `final_verifying` (14) runs between this phase's integration-stage work and its publish-stage work — see Risks.
- `CommunicationPolicy` constants: branch ≤64; commit subject ≤72 (`type(scope): outcome`); commit body ≤5 lines; PR title ≤72; PR body ≤12 lines/4 sections (Outcome/Validation/Risk/Tracking); review comment ≤6 lines (one finding, evidence, action) — the last per Gap 6's constant addition to 02.
- `JournalEntryType` — specifically the `cas_ref_update` and `evidence_pointer` members.
- `EvidenceRecord`, `RenderedArtifact` schemas.
- `WorkUnitAttemptStatus` — this phase creates resolution `WorkUnit`s typed against it; it does not dispatch or attempt them (13 does).

From **07** (`packages/git-engine`, shared package):
- Control clone under `$XDG_CACHE_HOME/engineering-orchestrator/<project-hash>/git-control/` (cache-root pinned in 04, Gap 14).
- Frozen target ref + exact base object ID + porcelain-v2 dirty snapshot (Intake freeze) — preflight's comparison baseline.
- Per-work-unit worktrees + quarantine lifecycle — preflight's candidate source.
- Rename-aware overlap-analysis output — the same data 13 uses for serialization; 08 uses it as merge-preflight input.
- Git identity config (`user.name "Engineering Orchestrator"` + service email) — applied to the published branch's commits.
- Invariance harness (tree-hash before/after) — extended, not re-built, by this phase.

From **17** (`packages/renderer`):
- `ArtifactKind` — the six members this phase owns as caller: `branch_name`, `commit_subject`, `commit_body`, `pr_title`, `pr_body`, `review_comment`.
- `lint(candidate, kind, policy): LintOutcome` and `renderWithRegeneration({ kind, generate, policy }): Promise<RenderOutcome>` — this phase supplies the `generate` callback (template assembly from structured data, never free-text authorship) and consumes `RenderOutcome`.
- `RenderedArtifact` instances (schema owned by 02, populated by 17) for all six `ArtifactKind`s.
- `policy_blocked` canonical error (02) — returned by `renderWithRegeneration` on a second lint failure; this phase's conflict/CAS-failure paths converge on the same `blocked` run-lifecycle terminal.
- The shared seeded attribution-leak fixture (17 work item 4) — reused for this phase's own golden suite rather than forked.

## Work items

1. Merge-preflight wrapper (`preflightMerge`) + conflict extraction to typed resolution `WorkUnit`s. Failing-first: a fixture with an intersecting hunk must yield a `WorkUnit`, not a silent auto-merge; a clean fixture must yield a `treeId` with no `WorkUnit`s.
2. CAS update (`applyCasUpdate`) + bounded rebuild/reverify loop, journaled as `cas_ref_update`. Failing-first: two concurrent updates racing the same `expectedOldValue` — the loser must retry-rebuild-or-block, never silently overwrite.
3. Branch namer (`nameBranch`) + property tests (length, charset, type set, collision suffix) + `renderWithRegeneration()` call for `branch_name`. Failing-first: a seeded slug containing an attribution token must be blocked by 17's lint before any git-ref-legality concern is even reached.
4. Commit renderer (`renderCommit`) on the same `renderWithRegeneration()` path for `commit_subject`/`commit_body` + golden corpus (bad subjects, over-long bodies, attribution leaks — shared fixture with 17). Failing-first: the golden corpus must fail red before the renderer exists.
5. Evidence-attachment routine for `pr_title`/`pr_body`/`review_comment` → `EvidenceRecord` + `evidence_pointer` journal entries. Failing-first: a fixture `ChangeSet` must yield exactly zero attached `EvidenceRecord`s before the routine exists, then exactly three (one per `ArtifactKind`) after, each referencing a distinct lint-passed `RenderedArtifact`.
6. Local publish routine (`publishLocal`) + invariance-harness extension (07) + fake-remote assertion that nothing is pushed. Failing-first: a publish test on a fixture repo must show no branch and no evidence before the routine exists; after, the branch appears, the user checkout is byte-identical, and there is zero remote interaction.

## Test plan

- **Unit:** `preflightMerge` on clean/conflicting fixture pairs; `applyCasUpdate` on matching/mismatched `expectedOldValue`; `nameBranch` charset/length/collision fixtures; `renderCommit` template-assembly fixtures; evidence-attachment count/reference-identity fixture.
- **Property:** fast-check over random branch-name inputs — output always ≤64 chars, always git-ref-legal, collision suffix always monotonic; random commit-subject/body assemblies never exceed the 72/5-line limits *before* reaching 17's lint (defense-in-depth on this phase's own assembly logic, not a re-derivation of 17's corpus).
- **Integration:** two-integrator race on the same target ref (CAS never overwrites; rebuild converges or blocks with journaled evidence); `renderWithRegeneration()` round-trip for all six `ArtifactKind`s against 17's fixtures (fail-then-pass renders, always-fail blocks on attempt two).
- **Conformance:** reuse (not fork) of 17's seeded "Generated with…"/"Co-Authored-By" fixture; reuse (extension) of 07's tree-hash invariance harness across every operation this phase adds.
- **Security:** argv-only `git merge-tree`/`git update-ref` invocation (no shell interpolation — same review discipline as 07's plumbing wrapper); idempotent re-run of the evidence-attachment routine for an already-published `ChangeSet` must not duplicate `EvidenceRecord`s (04's idempotency-key mechanism, transitively available via 07).

## Exit criteria

- [ ] Conflict fixtures yield resolution `WorkUnit`s; clean fixtures integrate to a `treeId`.
- [ ] Racing integrators: CAS never overwrites; rebuild converges or blocks with a journaled `cas_ref_update` entry.
- [ ] Golden/property rendering tests pass incl. Unicode/length edges, asserted against 17's shared corpus rather than a forked copy.
- [ ] Publish test: branch appears; user checkout byte-identical; zero remote interaction.
- [ ] Seeded "Generated with…" body is blocked (shared fixture with 17).
- [ ] A fixture `ChangeSet`'s rendered `pr_title`/`pr_body`/`review_comment` are each wrapped in an `EvidenceRecord` with an `evidence_pointer` journal entry, queryable from the journal by `ChangeSet` ID with no duplication on re-run (Gap 6).

## Risks & open questions

- **Resolved — the mermaid graph now draws a `P08 --> P23` edge**, reflecting 23's release-gate consumption of this phase's preflight/CAS/publication work (every Interfaces-produced row above names 23 as a consumer). 13 and 09 still consume 08's outputs with no new edge of their own: 13 already depends on 07, which shares `packages/git-engine` with 08; 09 already reads the generic `EvidenceRecord`/journal surface (02/04) regardless of writer. This is the mirror image of 17's own flagged open item (17→08 consumption vs. 08's header formerly omitting 17) — closed on this side by adding 17 to Depends on above.
- **`final_verifying` (14) runs between this phase's two stages** (`integrating` work, then `published_local` work) — no phase text states what composition root sequences 08 → 14 → 08. Not resolvable from this file; flagged as an open architectural question, not invented here.
- **Rebuild-and-reverify loop must terminate** — bounded attempt cap, converge-or-block-with-evidence, never an unbounded retry; covered by the racing-integrators test above.
- **PR/review-comment content is template-filled from existing structured data, not freshly authored prose** — if a future product decision wants richer, model-authored PR narrative, that is a genuine product decision the source doc doesn't settle and would need an explicit owner call, not a quiet scope add here.
- **Shared package with 07** (`packages/git-engine`) — module boundaries (07's clone/worktree/overlap code vs. this phase's preflight/CAS/publish code) must stay clearly separated to avoid merge friction between the two phases' work.
- **Threat-model coverage gap:** 02's threat-model STRIDE surfaces and 23's "03/16/17 security keystones" framing both omit `packages/git-engine` (07/08), even though this phase's command-injection surface (git plumbing invocation) and CAS race-condition handling are security-relevant — the same class of gap 17 already flagged for the renderer; worth 02/23 explicitly covering git-engine too, not fixed here.
- **Engine fidelity:** this phase asserts no Claude Code engine fact — no flags, settings keys, hook events, permission-rule forms, SDK options, or sandbox fields — confirmed against adaptation §8's "stays exactly as planned" list, same as 17's own note. No `docs/engine-baseline.md` citation or verify-at-build-time spike applies here.
