# Phase 22 — Reviewed learning pipeline & local evals: evidence

Governing spec: `roadmap/22-learning-system.md`. This note maps each exit criterion
to its test/artifact, records deviations from the source material, and lists
carry-forwards for reconcile. Format follows `docs/evidence/phase-14/README.md`.

## Adversarial-validation repair pass (2026-07-24)

A fresh adversarial validator returned **FAIL** on the first build of this phase.
Verified sound (unchanged by this pass): contracts unmodified
(`LearningProposalState` exact 11-member union, no drift), `token.ts`/`prompt.ts`
edits strictly additive, NO `learning.*` MCP tool (grep+test real), CLI is the sole
real caller, and the DEPLOYED end-to-end invariant already held (a model has no
path to promotion — no MCP tool exists to attempt one). **BUT** the validator found
the promotion guard **inside `@eo/learning` itself** only checked `tokenId` STRING
distinctness, never authenticity, subject kind, or binding — and the flagship
self-promotion red-team test was **vacuous** (it never actually tried the attack it
claimed to defend against). Both are fixed, strict TDD (RED confirmed against the
pre-fix code, then GREEN):

- **MAJOR (promotion guard was a distinctness check, not an authenticity/binding
  check) — FIXED.** Reproduced exactly as reported: a proposal walked to
  `independent_review` via the public API, then
  `promoteProposal({..., reviewApprovals: [{tokenId:"fabricated-a"}, {tokenId:
  "fabricated-b"}]})` returned `state: "promoted"` plus a real `ChangeSet` — no
  minting, no CLI, no secret, no MCP tool involved. The root cause:
  `ProposalRegistry.transition`'s old `TransitionOptions.reviewApprovals` field
  accepted a caller-supplied array of `{tokenId, verifiedAt}` objects **trusted by
  name**, and `recordReviewApproval` accepted the identical shape with zero
  verification. **Fix:** `TransitionOptions.reviewApprovals` and
  `PromoteProposalOptions.reviewApprovals` are REMOVED entirely (not deprecated —
  the type no longer has the field, so no caller can pass one, not even by
  accident). `recordReviewApproval(id, rawToken, verify)` now takes a RAW token
  string plus an INJECTED `LearningReviewTokenVerifier` function
  (`(rawToken, proposal) => Promise<{tokenId}>`); it calls `verify` BEFORE
  recording anything, and only a genuine success is ever accumulated.
  `transition(id, "promoted")` reads ONLY this proposal's own already-verified
  `record.reviewApprovals` — there is no parameter through which a different array
  can be supplied. `packages/cli`'s `learn approve` backend supplies the REAL
  verifier (`buildLearningReviewTokenVerifier`,
  `packages/cli/src/learning/learn-command-backend.ts`), wrapping 11's own
  `verifyApprovalTokenDurable` with the `"learning_review"` subject kind and a
  proposal-bound digest (`sha256(proposalId:content)`, recomputed from the LIVE
  proposal object the registry passes in, never a stale closure value) — the exact
  confused-deputy fix pattern 11's own `contract.approve` C1 repair used.
  `@eo/learning` still holds no signing secret (the verifier is injected, never
  implemented here) — the `@eo/cli` -> `@eo/learning` dependency direction is
  unchanged.
- **De-vacuumed the red-team suite — FIXED.** The original
  `self-promotion.redteam.test.ts` only tested 0/1/duplicate approvals, and its
  "two distinct" case actually failed on `IllegalTransitionError` at `observation`
  — it never reached a proposal genuinely `independent_review` with two DISTINCT
  tokens at all, so it would have passed identically whether or not the fabrication
  attack worked. It now has an explicit flagship case — "a proposal genuinely AT
  `independent_review`, 'approved' with two FABRICATED (never-minted) distinct
  token strings, is REJECTED" — plus confused-deputy (token minted for a different
  proposal), wrong-subject-kind, and single-use-replay cases, all using a
  faithful-but-decoupled reference token implementation
  (`src/test-support/reference-token-verifier.ts`, real HMAC signing + subject +
  proposal-binding + single-use semantics, never depending on `@eo/cli`). RED
  confirmed first (the fabrication attack succeeded against the pre-fix code, and
  the new attack-matrix property test's "one fabricated token" case resolved
  instead of rejecting); GREEN after the fix. `no-bypass.redteam.test.ts` and
  `pipeline.e2e.test.ts` were also updated to mint+verify GENUINE, proposal-bound
  tokens via the same reference verifier, instead of bare `"tok-a"`/`"tok-b"`
  strings.
- **MINOR (`computeCaseHash` silently dropped nested input content) — FIXED.**
  `JSON.stringify(input, Object.keys(input).sort())` used a sorted TOP-LEVEL key
  list as `JSON.stringify`'s REPLACER — which JSON applies as an ALLOWLIST at
  EVERY nesting level, not just the top one, so any nested key not also present at
  the top level was silently dropped. RED confirmed: `{scenario:{step:"login"}}`
  and `{scenario:{step:"logout"}}` hashed identically (both normalized to
  `{"scenario":{}}`) before the fix. **Fix:** a real recursive `canonicalize()`
  function that sorts every plain object's keys at every nesting depth (arrays
  keep element order); `computeCaseHash` now stringifies the canonicalized value
  directly, with no replacer trick. 3 new tests (nested-difference-detected,
  key-order-stability-at-depth, 3-levels-deep) all GREEN post-fix.
- **NITs — FIXED.** `eval-runner.ts`'s doc comment referenced the pre-rename
  `groundTruthEvidenceRecordId`; corrected to `groundTruthRequirementId`
  (matching the actual schema field). The "two distinct tokens" claim below is
  now stated precisely: it is two independently-minted, single-use, proposal-bound
  tokens, each from one terminal "yes" confirmation by whoever is running the CLI
  — this repo has no multi-tenant reviewer-identity system, so the SAME human
  operator running `learn approve` twice does satisfy the two-distinct-token
  requirement (that is consistent with, and disclosed as, this repo's existing
  single-operator security model — see "Threat model, precisely" below — never
  implied to mean two distinct human IDENTITIES).

**Corrected claim (superseding an earlier, FALSE version of this section):** the
original evidence doc claimed the self-promotion guard made a direct, no-CLI,
in-process call "structurally incapable" of promoting — implying protection against
arbitrary in-process code execution. That claim was **false** (arbitrary code that
can call `@eo/learning`'s exports can also stub out an injected verifier function —
no library-level guard can prevent that, and it was never the real deployed
threat surface anyway). See "Threat model, precisely" below for the corrected,
actually-meetable claim.

## Summary

- **Files — `packages/learning/` (new, 19 source + 19 test files)**:
  `src/state-machine.ts` (+`.test.ts`), `src/errors.ts`, `src/index.ts`,
  `src/pipeline.e2e.test.ts`; `src/store/{layout,fs-utils,case-fixture-store}.ts`
  (+ layout/case-fixture-store tests); `src/proposal-store/registry.ts`
  (+`.test.ts`); `src/eval/{case-schema,contamination,eval-runner}.ts` (+ tests);
  `src/reproducer/reproducer-harness.ts` (+`.test.ts`);
  `src/shadow/shadow-comparator.ts` (+`.test.ts`);
  `src/test-support/reference-token-verifier.ts` (test-support, not in the public
  barrel — added in the repair pass, see above);
  `src/changeset/build-change-set.ts` (+`.test.ts`); `src/promotion/promote.ts`
  (+`.test.ts`); `src/rollback/rollback.ts` (+`.test.ts`);
  `src/expiry/expiry-sweeper.ts` (+`.test.ts`); `src/promptfoo/export.ts`
  (+`.test.ts`); `src/test-support/minimal-compiled-profile.ts` (test-support,
  not in the public barrel); `src/red-team/{self-promotion,no-bypass,
  grader-isolation,no-mcp-tool-family,no-promptfoo-dependency}.redteam.test.ts`.
  Plus `package.json`/`tsconfig.json` (dependencies/references only — no
  `npm install` run, lockfile untouched).
- **Files — `packages/cli/` (learn-verb backend only)**: new
  `src/learning/{learning-dependencies,learn-command-backend}.ts` (+
  `learn-command-backend.test.ts`); edited `src/commands/dispatch.ts` (the four
  `learn-*` case branches, mirroring `intake`'s optional-`deps.learning`
  pattern), `src/commands/types.ts` (`CliDependencies.learning?` field),
  `src/approval/token.ts` (third `ApprovalTokenSubjectKind` member,
  `"learning_review"` — additive only), `src/approval/prompt.ts` (exhaustive
  `subjectKindLabel` switch replacing a two-way ternary, so the new subject
  kind gets a correct label instead of silently reusing "capability manifest"),
  `src/approval/prompt.test.ts` (+1 test for the new label);
  `package.json`/`tsconfig.json` (dependency + reference on `@eo/learning`
  only). **No other CLI command, and no other file, was touched.**
- **CI**: new `.github/workflows/learning-redteam.yml` (mirrors
  `gates-conformance.yml`'s pattern) running the `@learning-redteam` suite plus
  the full `packages/learning`/`packages/cli` suite.
- **Tests** (post-repair-pass): `packages/learning` — **19 test files, 223 tests,
  all passing** (212 before the repair pass; net +11 — de-vacuuming
  self-promotion added a flagship fabrication case, a confused-deputy case, a
  wrong-subject-kind case, a genuine-tokens-still-work case, and restructured the
  attack-matrix property test; `registry.test.ts` gained fabricated-token and
  type-level `TransitionOptions` proof cases; `case-schema.test.ts` gained 3 new
  canonicalization cases; `promote.test.ts` gained a type-level proof case).
  `packages/cli` — **59 test files, 386 tests, all passing** (unchanged in count
  from before the repair pass — `learn-command-backend.ts`'s wiring to the new
  injected-verifier API changed internally; its existing 13 test cases already
  covered the same observable behavior and needed no new cases, only the
  underlying `buildLearningReviewTokenVerifier` wiring change).
- **Coverage** (this phase's own new code —
  `packages/learning/src/**/*.ts` + `packages/cli/src/learning/**/*.ts` +
  `packages/cli/src/approval/**/*.ts`, excluding `*.test.ts`/`test-support/**`):
  **95.8% statements, 91.07% branches, 98.14% functions, 96.34% lines** —
  clears the ≥80% line+branch ground rule comfortably on both axes.
- `npx tsc -b` (whole monorepo): clean.
- `npm run lint` (whole monorepo, ESLint): clean.
- `npm run format` (whole monorepo, `prettier --check .`): clean.
- Whole-repo suite (`npx vitest run`, all 20 packages, post-repair-pass):
  **529 test files, 4307 tests** — 2 pre-existing, unrelated,
  host-load-timing-flaky property tests (`packages/engine-claude/src/
  session.test.ts`, `packages/gates/src/coverage/ratchet.property.test.ts`)
  independently reproduced GREEN in isolation; `git status` confirms zero diff
  in either file from this session. No other package's tests were touched or
  broken by this work.

## Exit criteria

- [x] **`LearningProposalState` transition-table suite green; fuzz over random
  event sequences finds no illegal path.**
  `packages/learning/src/state-machine.test.ts`: exhaustive `11×11` table
  (every `from -> to` pair asserted legal-or-throws), 4 explicit "skip a stage"
  regressions (`observation -> promoted`, `candidate -> independent_review`,
  `dev_eval -> shadow_run`, `shadow_run -> promoted`), plus two fast-check
  properties: 10,000 random `(from, to)` pairs never accepted/rejected against
  a wrong verdict, and 5,000 random walks of length ≤12 proving no walk ever
  lands on `promoted` without visiting `dev_eval` → `held_out_eval` →
  `shadow_run` → `independent_review` in that order. CI: this suite runs in
  the default `npm test` gate and in `learning-redteam.yml`'s second step.

- [x] **Held-out contamination detected; reward hacking caught by grader
  isolation; grader-drift attempt blocked; rejected promotion changes
  nothing; expiry + rollback work — each a separate passing case in the
  `@learning-redteam` suite.**
  - Contamination: `src/eval/contamination.test.ts` (case-hash overlap,
    shared-provenance overlap, both independently detected; disjoint sets
    correctly pass) + `src/pipeline.e2e.test.ts`'s own
    `assertNoContamination` call, run BEFORE either eval fires.
  - Grader isolation / grader-tampering: `src/red-team/grader-isolation.
    redteam.test.ts` — a hostile `node:fs` call (bypassing this package
    entirely) against a SEALED held-out directory fails `EACCES`, both for a
    new file and for overwriting the existing sealed file; this package's
    own `write()` also refuses in-process; reads still succeed post-seal;
    two `CaseFixtureStore` instances (dev vs. held-out) are proven
    independent.
  - Rejected changes nothing: `src/proposal-store/registry.test.ts`'s
    "rejected: changes nothing else about the proposal's recorded
    evidence/content" case.
  - Expiry: `src/expiry/expiry-sweeper.test.ts` (5 cases — expires a stale
    reference, leaves fresh references alone, skips proposals with none,
    skips already-terminal proposals, and expires even an already-`promoted`
    proposal via the `promoted -> expired` edge).
  - Rollback: `src/rollback/rollback.test.ts` (3 cases) +
    `src/pipeline.e2e.test.ts`'s full rollback step.
  - "Reward hacking caught by grader isolation": the fixture-modeled grading
    path (`src/eval/eval-runner.ts`) grades ground-truth-linked cases against
    real `@eo/gates` `EvidenceRecord`s (immutable, journaled by 14, never
    writable by this package) rather than a self-reported verdict — a
    candidate lesson cannot "reward hack" its own dev/held-out grade because
    the grading signal is either (a) a real, independently-produced
    `EvidenceRecord` the proposer's own process never journals, or (b) held
    behind the sealed fixture directory above. No case in this build allows a
    candidate to supply its own pass/fail verdict directly.

- [x] **Active run provably cannot promote its own policy: a test attempting
  direct promotion-logic invocation from within a running work unit fails,
  and a grep-based CI check over `packages/gateway`'s registered tool names
  confirms no `learning.*` MCP tool exists.**
  `src/red-team/self-promotion.redteam.test.ts` (8 cases, post-repair-pass): a
  fresh `observation`-stage proposal cannot be promoted directly regardless of
  the (genuinely-verified) approvals supplied (`IllegalTransitionError`); a
  proposal genuinely at `independent_review` cannot be promoted with zero
  approvals (`InsufficientIndependentReviewError`); **the flagship case** — a
  proposal genuinely at `independent_review`, "approved" with two FABRICATED
  (never-minted) distinct token strings, is REJECTED (this is the case the
  pre-repair-pass suite never actually tested — see the repair-pass section
  above); a token genuinely minted for a DIFFERENT proposal cannot promote this
  one (confused-deputy guard); a token genuinely minted for the WRONG subject
  kind is rejected; the SAME genuinely-minted token replayed twice never counts
  as two; two GENUINELY minted, correctly-subject-kinded, this-proposal-bound,
  distinct tokens DO still promote (the real path keeps working); and a
  6-attack property matrix (zero tokens, fabricated tokens, wrong-proposal
  tokens, wrong-subject-kind tokens, mixed genuine+fabricated) never reaches
  `promoted`. These call `ProposalRegistry.recordReviewApproval`/`transition`/
  `promoteProposal` DIRECTLY — no CLI, no supervisor round-trip — injecting a
  faithful-but-decoupled reference token verifier
  (`src/test-support/reference-token-verifier.ts`) so the suite exercises REAL
  verification semantics, not merely trusted claims. Separately,
  `src/red-team/no-mcp-tool-family.redteam.test.ts` reads (never imports)
  `packages/gateway/src/**/*.ts` and asserts zero `name: "learning.…"`
  registrations and zero bare `"learning."`/`'learning.'` string-literal
  occurrences in non-test source — this lives in `packages/learning` (not
  `packages/gateway`, which I did not touch) per interface-ledger Gap 1's own
  attribution ("Phase 22 carries a grep-based CI check … permanently
  enforcing this absence"). **This exit criterion's actual, meetable scope is
  the CLI/MCP-tool boundary, not arbitrary in-process code execution against
  `@eo/learning`'s own exports — see "Threat model, precisely" below.**

- [x] **E2E: seeded recurring failure → lesson → shadow improvement → human
  promotion (two distinct approval tokens, journaled) → behavior change →
  rollback restores baseline (committed E2E fixture + journal excerpt).**
  `src/pipeline.e2e.test.ts` — one committed test walking all 9 named beats
  on the fake engine (`@eo/testkit`): builds a `FakeEngineScript` reproducing
  a schema-violation failure, replays it to confirm the baseline genuinely
  fails, advances the proposal through every pipeline stage
  (contamination-checked dev/held-out eval, a real `runShadowComparison`
  proving `"improved"` against the established baseline), promotes with two
  GENUINELY MINTED, `learning_review`-subject, this-proposal-BOUND distinct
  tokens (via the same reference verifier the red-team suite uses — updated in
  the repair pass from bare `"reviewer-a-token"`/`"reviewer-b-token"` strings,
  which would no longer pass the hardened guard anyway), asserts the exact
  ordered `learning_transition` journal excerpt
  (`["reproducer","candidate","dev_eval","held_out_eval","shadow_run",
  "independent_review","promoted"]`), confirms the returned `ChangeSet`, then
  rolls back and asserts the final journal entry is `{from:"promoted",
  to:"rolled_back"}`.

- [x] **Persistent artifacts change only through reviewed promotion:
  fs-permission test proves the proposer namespace cannot write grader/
  held-out paths.**
  `src/red-team/grader-isolation.redteam.test.ts` (6 cases) — see above; the
  proposer-facing store type (`ProposalRegistry`) has NO constructor
  parameter or method referencing a grader/held-out path at all (a
  type-level absence, verifiable by reading `src/proposal-store/registry.ts`
  and `src/store/layout.ts`'s own doc comment), and the grader-only
  `CaseFixtureStore`'s `seal()` makes the OS itself refuse writes
  (`chmod 0o500`/`0o400`) regardless of which code performs them.

- [x] **`learn list|approve|reject|rollback` passes P09's CLI conformance
  harness, replacing its `NOT_IMPLEMENTED` stub (golden CLI-output test).**
  `packages/cli/src/commands/cli.commands.schema.test.ts` (UNCHANGED, still
  asserts `learn-*` returns `NOT_IMPLEMENTED` when `deps.learning` is
  omitted — exactly like `intake`'s `deps.intake` pattern, proving the stub
  behavior is preserved for every caller that doesn't wire the real backend).
  `packages/cli/src/learning/learn-command-backend.test.ts` (13 cases) proves
  the REAL backend: `learn list` (empty + populated, human + `--json`);
  `learn approve` (unknown id, wrong-state refusal, records 1/2 without
  promoting, promotes on the 2nd distinct real terminal-prompt approval with
  real HMAC tokens journaled twice as `approval_token_mint`, and a declined
  prompt mints/records nothing); `learn reject` (unknown id, known id, human
  + `--json`); `learn rollback` (unknown id, not-yet-promoted refusal, full
  promote-then-rollback round trip). `dispatch.ts`'s new `learn-*` branches
  are wired identically to `intake`'s `deps.intake !== undefined` pattern.

- [x] **Every `learning_transition` journal entry round-trips through 02's
  `JournalEntryType` exhaustiveness compile check.**
  No new `JournalEntryType` member was added (`@eo/contracts`'s 13-member
  union and `learning_transition`'s existing `LearningTransitionPayloadSchema`
  — a `{from, to}: LearningProposalState` pair — were used verbatim,
  untouched); `packages/journal/src/codec/journal-payloads.ts`'s
  `JOURNAL_ENTRY_PAYLOAD_SCHEMAS satisfies Record<JournalEntryType,
  z.ZodTypeAny>` (04's own pre-existing exhaustiveness mechanism) still
  compiles clean under `npx tsc -b packages/journal` — this phase writes
  `learning_transition` entries (`src/proposal-store/registry.ts`'s
  `transition()`) exclusively through `@eo/journal`'s own typed
  `appendEntry`, never a hand-rolled envelope. Proven functionally by every
  test above that inspects `journal.queryEntries({type:
  "learning_transition"})`.

- [x] **Project-scoped promotion produces a real `ChangeSet` that clears the
  SAME gates (14) as any other change before publish (08) — integration
  test on fake engine proves no bypass path exists.**
  `src/red-team/no-bypass.redteam.test.ts` — promotes a real proposal, then
  constructs `@eo/gates`'s OWN `createGateRegistry()` (the identical
  public API any human-authored `ChangeSet` fires against), registers a
  passing and a failing fake gate, and calls `fireAll` keyed to the promoted
  `ChangeSet`'s id. Both gates fire and journal real `evidence_pointer`
  entries under that exact `changeSetId`; the failing gate genuinely reports
  `passed: false` — nothing about the ChangeSet's learning origin suppressed
  or special-cased the failure. `packages/learning` never imports, wraps, or
  re-implements `createGateRegistry`/`fireAll`/`fireByTag` anywhere.

## The two keystone invariants — how they are STRUCTURALLY enforced

**Two distinct, GENUINELY VERIFIED approval tokens** (hardened in the
2026-07-24 repair pass — see that section above for the vulnerability this
replaced). `ProposalRegistry.transition(id, "promoted")`
(`src/proposal-store/registry.ts`) is the ONE code path in the package that
can ever write `state: "promoted"`, and it takes **no parameter through which
a caller can supply an approvals array** — `TransitionOptions` has no
`reviewApprovals` field at all (removed, not merely deprecated). It reads
ONLY this proposal's own `record.reviewApprovals`, which accumulates
EXCLUSIVELY through `recordReviewApproval(id, rawToken, verify)` — and that
method calls the INJECTED `verify: LearningReviewTokenVerifier` function
(`(rawToken, proposal) => Promise<{tokenId}>`) on the RAW token string
BEFORE recording anything; a throw (bad signature, wrong subject kind, wrong
proposal binding, expired, already-consumed) leaves the accumulated list
completely untouched. Only once `verify` genuinely succeeds is a
`VerifiedApprovalRecord` ever appended, and `transition("promoted")` still
separately requires ≥2 pairwise-distinct `tokenId`s among those
(`assertSufficientDistinctApprovals`, kept as a defense-in-depth backstop —
proven to still matter, independent of `verify`, by
`registry.test.ts`'s dedicated "DuplicateApprovalTokenError defense-in-depth"
case, which injects a deliberately-buggy stub verifier that always returns
the same `tokenId` and confirms the registry's own check still catches it).

`@eo/learning` itself never mints tokens, never holds a signing secret, and
never implements `verify` — that would create an unwanted `@eo/learning` ->
`@eo/cli` dependency (the wrong direction). `packages/cli`'s
`learn-command-backend.ts` supplies the REAL verifier
(`buildLearningReviewTokenVerifier`): it wraps 11's own
`verifyApprovalTokenDurable`/`ApprovalTokenMinter` (`packages/cli/src/
approval/*`, unmodified mechanism) under a NEW, third, distinct
`ApprovalTokenSubjectKind` — `"learning_review"` — and binds the expected
digest to `sha256(proposal.id : proposal.content)`, recomputed from the LIVE
`proposal` object `recordReviewApproval` passes into the verifier (never a
possibly-stale closure value) — the same confused-deputy defense pattern 11's
own `contract.approve` C1 repair uses for `ChangeSet`/envelope binding. A
token minted for a DIFFERENT proposal, or of the wrong subject kind, or never
genuinely minted at all, fails this check and is never recorded — proven
directly in `self-promotion.redteam.test.ts` using a faithful-but-decoupled
reference implementation of the same HMAC+subject+binding+single-use
properties (`src/test-support/reference-token-verifier.ts`), and exercised
against the REAL CLI-side verifier in `packages/cli/src/learning/
learn-command-backend.test.ts`.

**Fs-permission separation of duties.** `src/store/layout.ts` pins three
disjoint subdirectories under `04`'s pinned state root: `registry/` (proposal
lifecycle records — read/write for the whole pipeline), `grader/dev/`, and
`grader/held-out/`. The proposer-facing type, `ProposalRegistry`, has **no
constructor parameter, field, or method that ever references a grader/
held-out path** — this is a type-level absence, not a runtime check that
could be bypassed by calling the "wrong" method. The grader-only type,
`CaseFixtureStore`, is constructed once per directory (never both at once)
and exposes `seal()`, which `chmod`s the held-out directory to `0o500`
(no write, even for the owning uid) and every file in it to `0o400` — a REAL
OS-level permission change. `grader-isolation.redteam.test.ts` proves this
by calling `node:fs`'s `writeFile` DIRECTLY against the sealed directory
(bypassing every abstraction this package provides) and asserting `EACCES` —
both for a brand-new file and for overwriting the existing sealed file — so
the boundary holds even against code that never goes through
`@eo/learning` at all, not merely against this package's own polite API.

## Threat model, precisely (corrected, 2026-07-24 repair pass)

The pre-repair-pass version of this document claimed the self-promotion guard
made a direct, no-CLI, in-process call "structurally incapable" of promoting a
proposal — worded to imply protection against a compromised work-unit process
with ARBITRARY in-process code execution rights against `@eo/learning`'s own
exports. **That claim was false, and no library-level guard in ANY language
can make it true**: code with arbitrary execution rights inside the same
process can always monkey-patch, re-implement, or stub out an injected
function (including a hostile `LearningReviewTokenVerifier` that simply
returns `{tokenId: "whatever"}` without checking anything) — a guard that
lives in the same address space as its adversary cannot defend against that
adversary by construction. This was never the real deployed threat surface
either: a work unit's actual capability is bounded by 06's `EngineAdapter`
sandbox/permission model, and nothing about "how tightly `@eo/learning`'s own
in-process function contracts are worded" changes what a sandboxed worker
process can actually reach.

**The invariant this build actually enforces and actually tests, precisely
stated:**

1. **No model-invokable promotion path exists at all.** There is no MCP tool
   family (`learning.*` or otherwise) that exposes `promoteProposal`,
   `recordReviewApproval`, or `transition` to a model — verified by a
   permanent, CI-run grep/registration-name scan of `packages/gateway/src`
   (`no-mcp-tool-family.redteam.test.ts`). A model running inside a work unit
   has no tool call that reaches this code at all, full stop — this is the
   load-bearing boundary, not an in-process type contract.
2. **The ONLY real caller is `packages/cli`'s `learn approve` command**,
   reached by a human typing `engineering-orchestrator learn approve <id>` at
   a real terminal. That command requires, PER TOKEN: a real, interactive
   terminal "yes" confirmation (`runApprovalFlow`); a genuinely HMAC-signed
   token minted by `ApprovalTokenMinter` under a secret key no work-unit
   process has access to; durable, cross-process, single-use consumption via
   `verifyApprovalTokenDurable`; the `"learning_review"` subject kind; and
   binding to the exact proposal being approved (confused-deputy guard).
3. **Promotion requires TWO such tokens, genuinely distinct.** Because each
   token is single-use and the verifier's binding/subject checks are real,
   the two tokens cannot be the same token replayed, cannot be a token minted
   for a different proposal, and cannot be a token of a different subject
   kind — they must be two SEPARATE, successful `learn approve` invocations
   against this exact proposal.
4. **"Two distinct tokens" does NOT mean "two distinct human identities."**
   This repository has no multi-tenant reviewer-identity system anywhere —
   `contract.approve`'s own framing (11) is already "a human-only gate," not
   "a SPECIFIC, authenticated human." The SAME operator running
   `learn approve <id>` twice, at two separate terminal prompts, DOES satisfy
   this build's two-distinct-token requirement. This is disclosed here
   explicitly, not implied away: it is consistent with, not a gap relative
   to, this repo's existing single-operator security model — but a reader
   should not infer a stronger guarantee ("two different people signed off")
   than the system actually provides.

Within `@eo/learning`'s own process boundary, the guard is real and
load-bearing for exactly what it is: it makes a caller-supplied claim
("trust me, this was verified") insufficient — SOME verification must
genuinely run and genuinely succeed, twice, with distinct results, before
`promoted` is reachable. What it does NOT and CANNOT do is defend against a
caller that supplies its OWN (hostile) `verify` implementation — that
adversary is out of scope for this or any in-process library guard, and is
excluded by boundary #1 above (no model ever reaches this code to attempt it).

## Deviations / fixture-modeled vs. live

- **Grading against P14's gate framework** (roadmap/22 §Risks: "this phase's
  own architectural inference, not stated verbatim… a fully separate bespoke
  grader still satisfies every exit criterion, just with more duplicated
  verification logic") is implemented as designed: `src/eval/eval-runner.ts`'s
  `gradeCase` looks up real `EvidenceRecord`s via `@eo/gates`'s own
  `findEvidenceForRequirement` for any case carrying a `groundTruthRequirementId`,
  and falls back to a documented fixture-modeled structural comparison
  (`input.actualJudgment === expectedJudgment`) for cases with no gate
  linkage — never a second bespoke pass/fail engine.
  - Renamed the case field from an earlier draft's `groundTruthEvidenceRecordId`
    to `groundTruthRequirementId` mid-implementation once it became clear
    `findEvidenceForRequirement` keys off `requirementId`, not an
    `EvidenceRecord`'s own `id` — the earlier name would have silently never
    matched anything.
- **`ChangeSet` cross-references are caller-supplied.** `buildChangeSetForPromotion`/
  `buildInverseChangeSetForRollback` accept `intentContractId`/
  `authorizationEnvelopeId`/`capabilityManifestId`/
  `provisionalPerformanceContractId` as parameters rather than constructing
  real instances of those contracts — 11's intake pipeline is the actual
  constructor of those objects (out of this phase's scope to reimplement);
  this phase only builds the `ChangeSet` object and hands it off. Tests
  supply fixed placeholder ids for these references, matching how
  `contract-approve-handler.test.ts` (11) seeds its own fixtures.
- **Reproducer/shadow-run are entirely fixture-modeled on the fake engine**
  (`@eo/testkit`), never the live Claude Code engine — matching every other
  phase's `@live`-gated split; roadmap/22 §Risks confirms "no engine-fact
  spikes are load-bearing for this phase."
- **Two-distinct-approval-token semantics interpretation** — see the
  "Threat model, precisely" section above (added in the 2026-07-24 repair
  pass) for the full, corrected statement of what this build actually
  enforces and what it explicitly does NOT claim (in particular: "two
  distinct tokens" is not "two distinct human identities").
- **Expiry "raises a proposal"** is implemented as transitioning the SAME
  stale proposal to `expired` (journaled, a real signal) rather than minting
  a SEPARATE new proposal purely to announce staleness — documented as this
  phase's own minimal-sufficient choice in `src/expiry/expiry-sweeper.ts`'s
  doc comment; either reading satisfies the exit criterion's plain text
  ("raises an expiry proposal" / a `learning_transition` to `expired` is
  itself the raised signal).
- **`promotedChangeSetId` tracking** — 02's frozen `LearningProposal` schema
  has `rollbackChangeSetId` (the INVERSE) but no field for the FORWARD
  ChangeSet a promotion produces; this is tracked in `ProposalRegistry`'s
  own package-internal storage envelope (never added to the frozen 02
  contract) so `rollbackProposal` can look it up without every caller
  threading it through by hand.

## Carry-forwards for reconcile

- None blocking. The one open item from roadmap/22 §Risks ("Confirm with
  14's author before treating gate reuse as load-bearing") remains open per
  the roadmap's own text — this build implements the documented fallback
  (gate-linked grading where available, fixture-modeled structural
  comparison otherwise) so no exit criterion depends on that confirmation
  landing a particular way.
- `getReviewApprovals`/`getPromotedChangeSetId` are small, genuinely-used
  package-internal storage accessors added mid-implementation (not in the
  original design sketch) to support `learn approve`'s multi-call
  accumulation and `learn rollback`'s default-lookup convenience — both are
  exported from `@eo/learning`'s public barrel and covered by their own
  registry tests.

## Package-boundary confirmation

- `packages/learning/`: all new files, this session's own package.
- `packages/cli/`: touched ONLY
  `src/learning/{learning-dependencies,learn-command-backend}.ts` (new),
  `src/learning/learn-command-backend.test.ts` (new),
  `src/commands/dispatch.ts` (added the 4 `learn-*` branches only — every
  other branch byte-identical to before), `src/commands/types.ts` (added one
  optional field, `learning?: LearningDependencies`), `src/approval/token.ts`
  (added one union member, `"learning_review"`, to
  `ApprovalTokenSubjectKind` — additive only, `envelope_hash`/
  `capability_digest` behavior is byte-identical), `src/approval/prompt.ts`
  (replaced a 2-way ternary with an exhaustive 3-way switch — the two
  pre-existing labels are unchanged, only a new label was added for the new
  kind), `src/approval/prompt.test.ts` (added 1 case), `package.json`/
  `tsconfig.json` (dependency/reference on `@eo/learning` only). The
  `evidence`/`install`/`upgrade`/`uninstall`/`status`/`cancel`/`doctor`/
  `run`/`gateway-mcp`/etc. commands and every other file under
  `packages/cli/src` are untouched — confirmed via `git status --porcelain
  packages/cli` showing exactly the files listed above.
- `packages/gates`, `packages/perf`, `packages/connectors-*`,
  `packages/scheduler`, `packages/supervisor`: NOT edited. Consumed only via
  their public exported APIs (`@eo/gates`'s `emitEvidence`/
  `findEvidenceForRequirement`/`createGateRegistry`; `@eo/scheduler`'s
  `runShadowAttempt`/`buildTaskPacket`).
- No `npm install` was run; no third-party package was added beyond
  `zod`/`fast-check` (already present elsewhere in the workspace at the same
  pinned versions) and `@eo/*` workspace packages. Promptfoo is a
  package-internal object-shape export only — `src/red-team/no-promptfoo-
  dependency.redteam.test.ts` proves no `promptfoo` dependency in
  `package.json` and no import of it anywhere in source.
- One new CI workflow: `.github/workflows/learning-redteam.yml`.
