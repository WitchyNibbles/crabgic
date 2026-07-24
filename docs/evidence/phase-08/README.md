# Phase 08 evidence

This directory is the evidence trail for `roadmap/08-integration-publication.md`'s work
items and exit criteria. Phase 08 shares `packages/git-engine` with phase 07 (already
committed) — every file this phase added is NEW; no phase-07 module was modified (see
"Module-boundary note" below). Real `git` (2.43.0) was used throughout — no mocked git
anywhere in this phase's own suite; every integration test operates on real, on-disk
fixture repositories built via 07's existing `src/test-support/fixture-repo.ts`.

## Files added (all under `packages/git-engine/src/`)

| File | Role |
| --- | --- |
| `merge-preflight.ts` (+ `.test.ts`) | `preflightMerge` — WI1 |
| `cas-ref-update.ts` (+ `.test.ts`) | `applyCasUpdate` + bounded rebuild/reverify loop — WI2 |
| `branch-namer.ts` (+ `.test.ts`, `.property.test.ts`) | `buildBranchNameCandidate`/`nameBranch` — WI3 |
| `commit-renderer.ts` (+ `.test.ts`) | `renderCommit` (`commit_subject`/`commit_body`) — WI4 |
| `evidence-attachment.ts` (+ `.test.ts`) | `attachEvidence` (`pr_title`/`pr_body`/`review_comment` → `EvidenceRecord`) — WI5 |
| `publish-local.ts` (+ `.test.ts`) | `publishLocal` — WI6 |
| `integration-journal.ts` (+ `.test.ts`) | This phase's own minimal journal-appending surface (`cas_ref_update`/`evidence_pointer`), deliberately separate from 07's `journal-appender.ts` (see below) |
| `integration-journal-entry-type-compliance.test.ts` | Mirrors 07's own `journal-entry-type-compliance.test.ts` for this phase's two members |
| `renderer-corpus-shared.test.ts` | Reuses (reads directly, never forks) `packages/renderer/fixtures/corpus/` for this phase's 6 owned `ArtifactKind`s |

`src/index.ts`, `package.json` (added `@eo/renderer` dependency), and `tsconfig.json`
(added a project reference to `../renderer`) were edited; every 07 module under
`packages/git-engine/src/` (`plumbing.ts`, `invariance.ts`, `git-arg-guard.ts`,
`control-clone.ts`, `worktree-lifecycle.ts`, `overlap-analyzer.ts`, `journal-appender.ts`,
`intake-freeze.ts`, `repo-validation.ts`, `porcelain-parser.ts`, `layout.ts`,
`worktree-ref.ts`, `git-identity.ts`, `attempt-token.ts`, and every one of 07's own test
files) is byte-for-byte untouched.

## Module-boundary note (roadmap §Risks: "module boundaries ... must stay clearly
separated")

07's `journal-appender.ts` exports `GitEngineJournalEntryInput`, a union CLOSED over
exactly 07's two members (`git_freeze`/`worktree_quarantine`) — its own
`journal-entry-type-compliance.test.ts` exit-criterion asserts "writes exactly two
members — never a 3rd." Extending that union for this phase's own `cas_ref_update`/
`evidence_pointer` members would have both violated 07's closed exit criterion and
blurred the module boundary. Instead this phase added `integration-journal.ts`, typing
directly against `@eo/journal`'s own generic `JournalStore`/`JournalEntryInput` surface
(already a declared dependency of this package) via `Pick<JournalStore, "appendEntry">`
— zero edits to 07's file, and this phase's own
`integration-journal-entry-type-compliance.test.ts` asserts the disjoint, exactly-2-member
property on its own side.

## 2026-07-24 adversarial-validation fixes

Independent adversarial validation confirmed the two deep axes (CAS compare-and-swap
correctness; git argv-injection reuse of 07's guards) sound, and found 4 issues, all
fixed here via TDD (failing test confirmed red against the pre-fix code — verified by
temporarily reverting each fix in isolation and re-running its own regression test — then
green after). No fix touched anything outside `packages/git-engine/`.

| # | Severity | File(s) | Fix | New/changed test(s) |
| --- | --- | --- | --- | --- |
| 1 | HIGH (semantic) | `merge-preflight.ts` | The `frozenBaseObjectId` parameter — always an ancestor of `candidateRef` by construction — made conflict detection VACUOUS (`merge-tree`'s own computed merge-base always resolved to that ancestor, so the merge was always a trivial fast-forward, never a real conflict, no matter what another concurrently-preflighted candidate touched). Renamed to `integrationTipObjectId` and re-documented as "the CURRENT tip of the in-progress integration ref, which the caller re-resolves and advances as each work unit lands — never the frozen base." | `merge-preflight.test.ts`'s new "2026-07-24 HIGH-finding fix" describe block: a real two-work-unit end-to-end test (WU-A preflights clean against the frozen base, is "integrated" via a real `git commit-tree` built from the returned `treeId`, advancing the tip; WU-B — built from the SAME frozen base, diverging from WU-A on the same line — is THEN preflighted against the advanced tip and correctly conflicts) PLUS a companion test that deliberately preflights WU-B against the STALE frozen base instead, proving (documenting) the exact vacuity the parameter rename closes |
| 2 | MEDIUM (confirmed security regression) | `merge-preflight.ts` | The `git merge-tree` call passed no `env` at all, inheriting full `process.env` — an ambient `.gitattributes`-declared custom merge driver (config-sourced command) could execute during preflight. Now passes `CONTROL_CONTEXT_ENV` (07's MAJOR-2 discipline), matching every other control-context call in this package. | `merge-preflight.test.ts`'s new "2026-07-24 MEDIUM-finding fix" describe block: an ambient `GIT_CONFIG_GLOBAL`-declared merge-driver (mirroring 07's own `control-context-isolation.test.ts` technique) never fires during a real conflicting-file preflight |
| 3 | MEDIUM (confirmed absent) | `publish-local.ts` | The roadmap's own "Belt-and-suspenders" bullet (publication independently re-asserts no engine attribution, regardless of host settings) was entirely unimplemented — `publishLocal` checked only HEAD/index/worktree invariance. Added a post-fetch scan of exactly the commits THIS publish newly introduced (captured via `for-each-ref` before the fetch, `rev-list ... --not` after) against `@eo/contracts`'s `scanForAttributionTokens` (the SAME primitive 17's lint stage reuses, never forked). Fails closed: on a hit, the just-created branch ref is deleted (`update-ref -d`) and `PublishedAttributionLeakError` is thrown. | `publish-local.test.ts`'s new tests: "fails closed (throws, removes the branch) when a published commit carries attribution" (real tainted commit message, real branch-deletion verified via `git branch --list`); "never flags a PRE-EXISTING commit already in the user's history, only NEWLY introduced ones" (proves the before/after ref-tip scoping is correct, not over-broad); two graceful-degradation tests for a `for-each-ref`/`rev-list`/`log` read failure (fails open, never fatal, on the SCAN itself failing — distinct from an actual detected leak) |
| 4 | LOW-MEDIUM | `evidence-attachment.ts` | `contentHash` hashed the ENTIRE `EvidenceAttachmentSource` for every kind, so fixing ONE blocked kind's own field (e.g. `finding`, consumed only by `review_comment`) changed the idempotency-registry hash for `pr_title`/`pr_body` too — `checkOrRecord` reported `"conflict"` on those UNRELATED, already-successfully-attached kinds, throwing before the operator's actual fix to `review_comment` was ever attempted. Two changes, both required together: (a) `contentHash` is now derived from `scopedFieldsFor(kind, source)` — only the fields THAT kind's own template consumes, the SAME projection `generatorFor` renders from; (b) `renderWithRegeneration` now runs BEFORE (outside) any `IdempotencyRegistry.checkOrRecord` call — a BLOCKED render never touches the idempotency registry at all (no side effects to protect), so it is always freely retriable; only a SUCCESSFUL render is idempotency-protected (same content → replay; different content → `EvidenceAttachmentConflictError`, unchanged for genuinely-already-attached evidence). | `evidence-attachment.test.ts`'s new "partial-block recovery" test: `review_comment` blocked (attribution leak in `finding`) while `pr_title`/`pr_body` attach; a second run with ONLY `finding` fixed replays `pr_title`/`pr_body` byte-identically (same `EvidenceRecord.id`s, no conflict) AND successfully attaches the fixed `review_comment` — exactly 3 journaled entries total, no duplication, no permanent block |

Full gate after all 4 fixes: **31 test files / 246 tests, all green** (07's 148 tests
still byte-for-byte unaffected — reverified by the same temporary-relocation method as
before); new-code coverage **99.06% stmts / 95.45% branches / 100% funcs / 99.51% lines**
(up from the pre-fix 98.87/94.84/100/99.42 — see "Gate results" below for the exact
recaptured numbers and the file-by-file table).

## Exit-criteria → evidence map

| Exit criterion (roadmap/08) | Evidence |
| --- | --- |
| Conflict fixtures yield resolution `WorkUnit`s; clean fixtures integrate to a `treeId` | `merge-preflight.test.ts`: "a clean, non-overlapping candidate yields a treeId and no conflicts"; "an intersecting hunk yields resolution WorkUnits, never a silent auto-merge" (real `git merge-tree --write-tree` against on-disk fixture repos, both directions) |
| Racing integrators: CAS never overwrites; rebuild converges or blocks with a journaled `cas_ref_update` entry | `cas-ref-update.test.ts`: "never overwrites on a lost race and blocks (no rebuild supplied), leaving the ref exactly at the winner's value" (asserts the journaled entry is present even on the losing/blocked path); "converges via the rebuild loop when the loser recomputes against the winner's new tip"; "terminates (never loops forever) when a competitor keeps racing ahead — bounded by maxAttempts" |
| Golden/property rendering tests pass incl. Unicode/length edges, asserted against 17's shared corpus rather than a forked copy | `renderer-corpus-shared.test.ts` (reads `packages/renderer/fixtures/corpus/*.json` directly, scoped to this phase's 6 owned `ArtifactKind`s — zero embedded copies); `branch-namer.property.test.ts` (fast-check, 500+100 runs: length/charset/collision-monotonicity); `commit-renderer.test.ts` (over-long subject, over-long body, attribution-leak-in-body blocking cases) |
| Publish test: branch appears; user checkout byte-identical; zero remote interaction | `publish-local.test.ts`: "creates the destination branch..."; "never checks out, never touches HEAD/index/working tree — byte-identical user checkout before/after"; "zero remote interaction — no spawn call ever includes a push subcommand" (real spawn-capture shim over every argv issued) |
| Seeded "Generated with…" body is blocked (shared fixture with 17) | `renderer-corpus-shared.test.ts`'s dedicated "the seeded attribution-leak fixture is present and scoped to commit_body" assertion, reading `packages/renderer/fixtures/corpus/attack-attribution-leak.json` directly (not a forked copy) and asserting it still blocks through `lint()`; `commit-renderer.test.ts`'s own "blocks when the body carries an attribution leak" exercises the same class functionally through `renderCommit`'s real path |
| A fixture `ChangeSet`'s rendered `pr_title`/`pr_body`/`review_comment` are each wrapped in an `EvidenceRecord` with an `evidence_pointer` journal entry, queryable from the journal by `ChangeSet` ID with no duplication on re-run | `evidence-attachment.test.ts`: "attaches exactly 3 EvidenceRecords ... each references a distinct RenderedArtifact digest" (queries a REAL `@eo/journal` store by `changeSetId`, asserts exactly 3); "is idempotent: re-running with the SAME source never duplicates..."; "survives a BRAND NEW IdempotencyRegistry instance pointed at the same journal (durable, not in-process-only)"; "throws EvidenceAttachmentConflictError when a re-run supplies DIFFERENT source content" (the one edge case the roadmap doesn't explicitly resolve — see Deviations) |

## Work items → evidence

1. Merge-preflight wrapper + conflict extraction — `merge-preflight.ts`/`.test.ts` (9 tests: clean, conflict, custom role, flag-shaped-ref rejection, non-hex-object-id rejection, genuine-git-failure-vs-conflict disambiguation, the two-work-unit non-vacuity proof + vacuity demonstration, ambient-merge-driver isolation)
2. CAS update + bounded rebuild/reverify loop — `cas-ref-update.ts`/`.test.ts` (13 tests incl. the two-integrator race, correlation-id threading, zero-OID sentinel path, termination bound)
3. Branch namer + property tests + `renderWithRegeneration()` — `branch-namer.ts`/`.test.ts`/`.property.test.ts` (15 unit + 2 property tests; the roadmap's own named failing-first case — "a seeded slug containing an attribution token must be blocked ... before any git-ref-legality concern is even reached" — is `nameBranch`'s own "blocks a slug carrying an attribution token, even though it is charset/length-legal" test)
4. Commit renderer + golden corpus — `commit-renderer.ts`/`.test.ts` (9 tests: assembly, clean render, over-long subject/body, attribution leak)
5. Evidence-attachment routine — `evidence-attachment.ts`/`.test.ts` (7 tests incl. idempotency across a fresh registry instance, a conflict path, and partial-block recovery)
6. Local publish routine + invariance-harness extension + fake-remote assertion + attribution belt-and-suspenders — `publish-local.ts`/`.test.ts` (11 tests)

## Invariance-harness extension (roadmap §Interfaces produced)

- `preflightMerge` and `applyCasUpdate` both wrap their git calls in 07's own
  `withTreeInvariance` UNCHANGED — `merge-tree --write-tree`/`update-ref`/`rev-parse`
  never touch the working tree, only `.git/objects`/`.git/refs` (both ignored or,
  for refs, expected to change under CAS), so this proves each operation's own promise
  structurally.
- `publishLocal` does NOT reuse 07's `withUserCheckoutInvariance` as-is: that wrapper
  hashes `HEAD`/`config`/`index`/`packed-refs`/**every loose ref file** as one combined
  digest — correct for a pure READ (07's `freezeIntake`) but wrong here, since this
  operation's entire purpose is to add exactly one new loose ref (wrapping it in that
  combined hash would make the harness reject its own intended effect). `publish-local.ts`
  therefore EXTENDS the harness with a narrower, purpose-built check: `computeWorkingTreeHash`
  (07's own function, reused unmodified) plus a small `HEAD`/`index`-only digest this file
  defines itself — proving "HEAD/index/worktree untouched" exactly as the exit criterion
  states, deliberately excluding `refs/` (expected to change) and `config`/`packed-refs`
  (irrelevant to this operation). Documented in `publish-local.ts`'s own file-level doc
  comment. Proven both in the happy path (`"never checks out..."` test) and adversarially
  (`"throws PublishLocalInvarianceViolationError when HEAD/index/working-tree change
  during the fetch"`, via a fake `GitPlumbing` that deliberately mutates `HEAD` as a side
  effect).

## Signature deviations (documented, not invented silently)

The roadmap's own prose gives `preflightMerge(candidateRef, frozenBaseObjectId)`,
`applyCasUpdate(ref, expectedOldValue, newValue)`, and `publishLocal(changeSet, branch)`
as bare-positional signatures. Every other git-touching function 07 already shipped in
this same package (`ensureControlClone`, `freezeIntake`, `createWorktree`) takes
`(plumbing, options)` — this phase's three functions follow that SAME established
convention instead, for consistency with the rest of the package's calling surface, per
each function's own file-level doc comment. `nameBranch`/`renderCommit`/`attachEvidence`
are new interfaces this phase itself introduces (not literally named with a fixed
signature anywhere in the roadmap's prose beyond `nameBranch(changeSet): string` /
`renderCommit(workUnit): { subject, body }`), so their exact input shapes
(`BuildBranchNameInput`, `RenderCommitInput`, `EvidenceAttachmentSource`) are this
worker's own minimal-sufficient design, built from already-produced structured fields
per the roadmap's explicit "no free-text authorship" instruction, rather than accepting
a bare `ChangeSet`/`WorkUnit` and reaching into its fields internally — this keeps the
caller's own assembly from `ChangeSet`/`WorkUnit`/`Requirement` explicit at the call
site, which 13/23 (the two production callers per the roadmap's own Interfaces-produced
table) will need to do regardless.

## Design decisions not fully pinned by the roadmap prose

- **One resolution `WorkUnit` per conflicting path** (not one per whole merge attempt):
  the roadmap says conflicts "become typed resolution `WorkUnit`s" (plural) and are
  "surfaced directly as `WorkUnit` instances of a resolution kind" without pinning
  granularity. One-per-path is the most dispatchable granularity for 13's scheduler
  (each conflict independently resolvable) and is what `merge-preflight.test.ts` asserts.
- **`WorkUnit.role`** carries `"merge-conflict-resolution"` (caller-overridable) as the
  discriminator for a resolution unit — `WorkUnit.role` has no closed vocabulary
  anywhere in `@eo/contracts` (02's own schema comment: "no closed role vocabulary is
  pinned ... free-text, non-empty string"), so this is this phase's own
  minimal-sufficient choice, not a schema change.
- **`cas_ref_update` journals EVERY attempt, win or lose** — the payload schema
  (`{ ref, objectId }`, owned by 02/04, not extendable here) has no `succeeded` field, so
  "every attempt journaled" is satisfied by recording the objectId THAT attempt targeted;
  a reader cross-references the ref's actual final state to see which attempt won. This
  also directly satisfies the exit criterion's "blocks WITH a journaled `cas_ref_update`
  entry" (the losing attempt's own entry, not a separate "blocked" record type that
  doesn't exist).
- **`EvidenceAttachmentConflictError`** — the roadmap's idempotency test-plan bullet
  covers the SAME-content replay case explicitly but is silent on a re-run with
  DIFFERENT content for the same `(changeSetId, kind)`. Rather than silently overwriting
  (forbidden by every other CAS/idempotency primitive in this codebase) or silently
  keeping the stale record, this phase raises a typed, documented error — a genuine
  caller-bug signal, never a silent resolution either way.

## Gate results

Captured in `exit-criteria-package-gate.txt` (this exact run):

- `npx tsc -b packages/git-engine` — clean, zero errors.
- `npx vitest run packages/git-engine --coverage.enabled=false` — **31 test files, 246
  tests, all green.** Verified split (temporarily relocating the 10 new phase-08 test
  files out of the package and re-running, then restoring them): the 21 pre-existing
  phase-07 test files alone are **148 tests, all still passing, byte-for-byte
  unmodified**; the 10 new phase-08 test files add **98 tests**, all passing — zero
  phase-07 regression.
- `npx eslint packages/git-engine` — clean, zero errors/warnings.
- `npx prettier --check packages/git-engine` — clean, all files match Prettier style.
- New-code coverage (scoped to this phase's 7 new non-test source files —
  `merge-preflight.ts`, `cas-ref-update.ts`, `branch-namer.ts`, `commit-renderer.ts`,
  `evidence-attachment.ts`, `publish-local.ts`, `integration-journal.ts` — via
  `--coverage.include` restricted to exactly those 7 files, since the repo-wide gate's
  own `coverage.include` glob would otherwise dilute the denominator with every OTHER
  untested package, the same caveat 07's own evidence README notes):

  ```
  All files          |   99.06 |    95.45 |     100 |   99.51
  ```

  (statements / branches / functions / lines — all four well above the 80% line+branch
  gate.) Three small, documented gaps remain, all genuinely defensive/edge branches:
  `branch-namer.ts:143` (the final "constructed candidate is not legal by construction"
  guard — unreachable under any input this module's own construction logic can produce,
  mirroring this codebase's existing convention of an unreachable-but-total defensive
  branch, e.g. `git-identity.ts`'s `runWithLockRetry`); `merge-preflight.ts:204` (a
  `?? ""` fallback on `String.prototype.split("\n")[0]`, which JS guarantees is always
  defined for any string input, empty or not); `publish-local.ts:93,276` (the
  `index`-file-absent branch of `computeHeadAndIndexDigest`, never hit because every
  fixture repo in this suite has a populated index, and the empty-stderr fallback string
  in the "fetch failed" block).

## TDD process note (failing-first, per-work-item red/green captures)

Every file in this phase was built RED-then-GREEN in the conversation that produced it
(a failing assertion against a not-yet-existing function, then the minimal implementation
to pass it, matching each work item's own explicit "Failing-first" instruction quoted in
that file's own doc comment) — this is the mechanism, not a claim invented after the
fact. Per-work-item standalone `-failing.txt`/`-passing.txt` capture files (07's own
evidence convention) were not separately re-captured post-hoc for this phase, to keep
this evidence pass proportionate; `exit-criteria-package-gate.txt` captures the final
green state of the complete suite instead, and each test file's own doc comment quotes
the exact roadmap "Failing-first" sentence it satisfies.

## Carry-forward / deferred items (not fixed here — outside this phase's file scope)

- **Pre-existing, unrelated build break discovered during a full-repo `npx tsc -b` sanity
  check**: `packages/cli/src/installer/git-repo-state.ts` (an untracked file, not part
  of any commit, not touched by this session) fails with `TS1443`/`TS1160` (malformed
  template literal / module declaration). This is unrelated to `packages/git-engine` and
  outside this phase's allowed file scope (`packages/git-engine/` and
  `docs/evidence/phase-08/` only) — flagged here for the owner, not fixed.
- **`final_verifying` (14) composition-root sequencing** (roadmap §Risks: "no phase text
  states what composition root sequences 08 → 14 → 08") — genuinely unresolved by any
  phase's own text; not invented here.
- **Threat-model coverage gap** (roadmap §Risks: 02/23 omit `packages/git-engine` from
  their STRIDE/keystone framing) — not this phase's file to fix.
- No root-config, `docs/interface-ledger.md`, or roadmap file edits were made or judged
  necessary for this phase's work.

## New public interface names exported for downstream phases (13, 23; `packages/git-engine`'s `src/index.ts` barrel)

- `preflightMerge`, `PreflightMergeOptions`, `PreflightResult`
- `applyCasUpdate`, `ApplyCasUpdateOptions`, `CasUpdateResult`, `RebuildFn`, `RebuildOutcome`, `RebuildBlocked`
- `nameBranch`, `buildBranchNameCandidate`, `slugify`, `isBranchType`, `BRANCH_TYPES`, `BranchType`, `BuildBranchNameInput`, `NameBranchResult`, `MAX_BRANCH_NAME_LENGTH`, `InvalidBranchTypeError`
- `renderCommit`, `assembleCommitSubject`, `assembleCommitBody`, `COMMIT_TYPES`, `CommitType`, `RenderCommitInput`, `RenderCommitResult`
- `attachEvidence`, `EvidenceAttachmentConflictError`, `AttachEvidenceOptions`, `AttachEvidenceResult`, `EvidenceAttachmentOutcome`, `EvidenceAttachmentSource`
- `publishLocal`, `PublishLocalInvarianceViolationError`, `PublishedAttributionLeakError`, `PublishLocalOptions`, `PublishResult`, `AttributionLeak`
- `INTEGRATION_JOURNAL_ENTRY_TYPES`, `IntegrationJournalEntryType`, `IntegrationJournalAppender`, `buildCasRefUpdateEntryInput`, `buildEvidencePointerEntryInput`
