# Phase 22 — Reviewed learning pipeline & local evals

| | |
|---|---|
| **Depends on** | 13, 14 |
| **Unlocks** | 23 |
| **Sources** | original plan "Learning from mistakes"; adaptation §0 (plan-limit policy), §2 row 12 (Promptfoo/evals, no managed-eval dependency), §5.7/risk 9 (token-based cost accounting under subscription auth), §8 (learning pipeline carried over unchanged, independent review) |
| **Primary package** | `packages/learning` |

## Goal

Persistent behavior changes only through a reviewed, non-self-servable pipeline: `observation → reproducer → candidate → dev_eval → held_out_eval → shadow_run → independent_review → promoted|rejected`, with `rolled_back`/`expired` as post-promotion terminals. When this phase is done, a lesson can travel that path from an observed recurring failure to a promoted, evidence-backed behavior change — and at no point on it can the run that proposed a lesson also promote it.

## In scope

- **Pipeline states journaled** with evidence at every transition (`LearningProposalState`, see Interfaces produced); every transition emits a `JournalEntryType.learning_transition` entry (02/Gap 5).
- **Separation of duties:** proposer cannot modify its grader, held-out cases, or promotion criteria — enforced structurally (distinct store namespaces, fs permissions, supervisor-mediated writes), with a test proving an active run cannot promote its own policy. No MCP `learning.*` tool family exists — promotion/review is CLI-only (`learn list|approve|reject|rollback`) by design; a model-invokable promotion tool would violate this section's tested invariant that an active run cannot promote its own policy.
- **Independent review:** promotion requires a second, distinct supervisor-issued approval token — same minting mechanism as `contract.approve` (11, adaptation §5.5), never a bare model-initiated call — so the proposer's own confirmation never counts toward it.
- **Run-scoped lessons:** a repair may use a lesson during the active run; persistent instructions/roles/skills/policies never change mid-run; persistent proposals batch for end-of-run review.
- **Eval infra:** provider-neutral local format (JSONL cases + expected judgments), dev + held-out sets, contamination checks (case-hash overlap, provenance); dev/held-out grading is executed against P14's gate framework and `EvidenceRecord`s as ground truth for cases that exercise a real gate outcome, rather than a second bespoke verification path; optional Promptfoo adapter (package-internal export, no new CLI verb) — no managed-platform dependency.
- **Shadow runs:** a candidate lesson is applied to a mirrored dispatch of a real work unit through `packages/scheduler`'s (13) executor on a disposable worktree, diffing outcome against the unmodified baseline.
- **Storage policy:** project-scoped lesson promotion constructs a `ChangeSet` (02) dispatched through the normal scheduler→gates→publish pipeline (13/14/08) — promoted lessons clear the same verification as any human-authored change, never a bypass. Personal/transient lessons live under `$XDG_STATE_HOME/engineering-orchestrator/<project-hash>/learning/` (04's pinned state root), outside the repo; all local, no telemetry.
- **Expiry/rollback:** lessons carry `EvidenceRecord` references; a referenced record going stale (object ID/fingerprint no longer current) raises an expiry proposal; promoted-lesson rollback dispatches an inverse `ChangeSet` through the same pipeline and restores prior behavior with journaled rationale.

## Out of scope

- Gate execution mechanics (SAST, coverage, TDD evidence) — owned by 14; this phase consumes gate outcomes/`EvidenceRecord`s as grading signal, doesn't reimplement verification.
- Scheduler dispatch, readiness, and fan-out mechanics — owned by 13; shadow runs invoke 13's executor through a mirrored-dispatch entry point, don't reimplement DAG execution.
- Journal mechanics (chaining, fsync, tail repair) — owned by 04; this phase only types its own entries.
- ChangeSet publication and branch/commit rendering — owned by 07/08; a promoted or rolled-back lesson only constructs and hands off a `ChangeSet`.
- `learn` command parsing, output formatting, and CLI shape — owned by 09; this phase implements the backend behind an already-declared command.
- Approval-token minting mechanics and the human-confirmation UX — owned by 11 (`contract.approve`'s mechanism, reused here, not rebuilt).
- Release-wide seeded-fault matrix orchestration — owned by 23; this phase supplies its own fixture set into that matrix.

## Interfaces produced

- **`LearningProposalState`** (closed union) — `observation | reproducer | candidate | dev_eval | held_out_eval | shadow_run | independent_review | promoted | rejected | rolled_back | expired`. By this roadmap's own precedent for cross-cutting closed unions (Gap 4's `WorkUnitAttemptStatus`, Gap 5's `JournalEntryType`), the union itself belongs in P02 (`packages/contracts`) as the type of `LearningProposal.state` — not yet present in P02's current text. Named here because this phase owns the semantics: the exhaustive transition-table tests, guards, and enforcement (the "state machine" the ledger already attributes to 22 for `LearningProposal`), exactly as 13 owns `WorkUnitAttemptStatus`'s transition behavior despite P02 hosting that enum. Flagged for reconciliation with P02's author.
- **`learn list|approve|reject|rollback` CLI backend** — implements the command P09 already declares (`09-cli-and-doctor.md` §In scope → Commands), replacing P09's typed `NOT_IMPLEMENTED` stub with real `packages/learning` logic.
- **Proposal store** (`packages/learning`) — namespaced, fs-permission-separated from grader/held-out-case storage; the structural basis for the separation-of-duties invariant.
- **Shadow-run comparator** — registers against `packages/scheduler`'s (13) mirrored-dispatch primitive (see Interfaces consumed); its outcome-diff format is internal to dev/held-out grading, not exposed cross-phase.
- **Red-team fixture suite**, tagged `@learning-redteam` (mirrors the `@live` tagging convention P01/P06 use for engine conformance, Gap 15) — self-promotion, grader-tampering, contamination scenarios. This is the concrete artifact P23's "seeded-fault matrices from 14/15/22" (`23-release-hardening.md` §In scope) invokes for this phase.
- Journal entries typed **`JournalEntryType.learning_transition`** (enum member owned by 02/Gap 5) — one per pipeline-state transition; this is the artifact P23's evidence-backed release gate reads for promotion history.
- **No MCP `learning.*` tool family** — an intentional absence (Gap 1; see In scope → Separation of duties for the invariant it protects), stated here so no later phase or reconciler pass re-adds one to `packages/gateway`'s tool registry.

## Interfaces consumed

- **From 02** (`packages/contracts`; transitively via 13/14, matching this roadmap's existing treatment of foundational contracts — not a direct dependency edge): `LearningProposal` schema; `EvidenceRecord`; `ChangeSet`; `JournalEntryType` members `learning_transition`, `approval_token_mint`, `fanout_rationale` (Gap 5); `WorkUnitAttemptStatus` (Gap 4) attempt history as observation-stage input signal.
- **From 04** (`packages/journal`): the pinned `$XDG_STATE_HOME/engineering-orchestrator/<project-hash>/` state root (04 §In scope → Layout); this phase nests `learning/` under it for personal/transient lesson storage, the same convention Gap 14 uses for 07/12's cache-root nesting.
- **From 13** (`packages/scheduler`): the **Shadow-run mechanism** (`13-scheduler-packets-context.md` §In scope → "Shadow-run mode", §Interfaces produced, work item 6) — an isolated mirrored-dispatch execution entry point on the executor: apply a modified `TaskPacket` against a disposable worktree/session, cache-bypassed, capture the resulting `WorkerResult`/artifact handle, without mutating the original work unit's state beyond a marker journal entry. Also the **Ephemeral lesson-preamble injection point** on 13's TaskPacket builder (13 §Interfaces produced) — one of exactly two callers, alongside an in-run repair attempt. Both are already specified in 13's current text, which names this phase as consumer of each directly — not a still-to-be-designed addition. Also consumes fan-out rationale records directly (`JournalEntryType.fanout_rationale`) as scheduling-lesson candidates, and the `parked:rate_limit` (`WorkUnitAttemptStatus`) pattern as an observation source — reusing token-cost accounting per adaptation §5.7/risk 9, never USD.
- **From 14** (`packages/gates`): the gate framework and its `EvidenceRecord` emission — dev/held-out eval cases grade against recorded gate outcomes for the scenario in question; gate/fixture immutability to the proposer is what makes "grader isolation" structural rather than a policy statement.
- **From 11** (transitively via 13): the supervisor-issued approval-token mechanism backing `contract.approve` (adaptation §5.5) — reused, not rebuilt, for the independent-review token.
- **From 03** (transitively, via `packages/testkit`): fake-engine fixtures, used for the reproducer harness and shadow E2E — existing fixture format, not reinvented here.

## Work items

1. Proposal store + `LearningProposalState` machine + journaled transitions (`JournalEntryType.learning_transition`) — fs-permission-separated namespaces for proposer vs. grader/held-out storage.
2. Reproducer harness (failing scenario → replayable fake-engine fixture, via `packages/testkit`).
3. Eval runner (dev/held-out) + contamination detector; grading path against P14 gate outcomes/`EvidenceRecord`s.
4. Shadow-run comparator registered against 13's mirrored-dispatch primitive; outcome diffing.
5. Review/promotion CLI backends (`learn list|approve|reject|rollback`) + independent-review token (11's mechanism, second distinct token); project-scoped promotion constructs a `ChangeSet` for the normal pipeline instead of writing files directly.
6. Promptfoo export (package-internal); expiry sweeper (stale `EvidenceRecord` refs → expiry proposal); rollback path (inverse `ChangeSet`).

## Test plan

- **Unit:** `LearningProposalState` exhaustive transition-table tests (illegal transitions — e.g. `observation → promoted` skipping review — throw typed errors); proposal-store fs-permission boundary tests.
- **Property:** fast-check over random pipeline event sequences — invariant "no sequence reaches `promoted` without both eval stages, `independent_review`, and two distinct approval-token IDs."
- **Integration:** shadow-run E2E on fake engine (`packages/testkit`) — mirrored dispatch, outcome diff, no mutation of the original work unit's state.
- **Security / red-team** (tagged `@learning-redteam`): self-promotion attempt (active run calls promotion logic directly, no CLI/token) must fail; grader-tampering attempt (proposer process writes to held-out fixture or grader path) must fail at the fs-permission boundary; contamination (dev/held-out case-hash overlap, shared provenance) must be detected before eval runs.
- **Conformance:** `learning_transition` entries round-trip through 02's discriminated-union exhaustiveness check (Gap 5); `LearningProposal.state` values are exactly the `LearningProposalState` union members, no drift between the two contracts.

## Exit criteria

- [ ] `LearningProposalState` transition-table suite green; fuzz over random event sequences finds no illegal path (evidence: CI job + fast-check report).
- [ ] Held-out contamination detected; reward hacking caught by grader isolation; grader-drift attempt blocked; rejected promotion changes nothing; expiry + rollback work — each a separate passing case in the `@learning-redteam` suite.
- [ ] Active run provably cannot promote its own policy: a test attempting direct promotion-logic invocation from within a running work unit fails, and a grep-based CI check over `packages/gateway`'s registered tool names confirms no `learning.*` MCP tool exists to route around it (Gap 1).
- [ ] E2E: seeded recurring failure → lesson → shadow improvement → human promotion (two distinct approval tokens, journaled) → behavior change → rollback restores baseline (committed E2E fixture + journal excerpt).
- [ ] Persistent artifacts change only through reviewed promotion: fs-permission test proves the proposer namespace cannot write grader/held-out paths.
- [ ] `learn list|approve|reject|rollback` passes P09's CLI conformance harness, replacing its `NOT_IMPLEMENTED` stub (golden CLI-output test).
- [ ] Every `learning_transition` journal entry round-trips through 02's `JournalEntryType` exhaustiveness compile check (shared CI job with 02/04).
- [ ] Project-scoped promotion produces a real `ChangeSet` that clears the same gates (14) as any other change before publish (08) — integration test on fake engine proves no bypass path exists.

## Risks & open questions

- `LearningProposalState`'s home is P02 by this roadmap's own precedent (Gap 4/5), but isn't there yet. Mitigation: named exactly here for the reconciler (Interfaces produced); the schema-layer work in item 1 shouldn't start until P02's file carries the matching bullet.
- 13's Shadow-run mechanism (`13-scheduler-packets-context.md` §In scope → "Shadow-run mode", §Interfaces produced, work item 6) already specifies the mirrored-dispatch entry point this phase's shadow runs need — including the Ephemeral lesson-preamble injection point on 13's TaskPacket builder — and 13 names this phase as consumer of both directly. No cross-phase design gap remains here; work item 4 registers against an already-specified primitive rather than one still to be jointly shaped with 13's author.
- Grading against P14's gate framework is this phase's own architectural inference, not stated verbatim in the source doc (adaptation §8 lists quality gates and the learning pipeline as parallel, both-carried-over bullets without linking them). Confirm with 14's author before treating gate reuse as load-bearing; a fully separate bespoke grader still satisfies every exit criterion above, just with more duplicated verification logic.
- Token-based, not USD-based, cost accounting (adaptation §5.7, risk #9): fan-out rationale records carry token cost under subscription auth; any scheduling-lesson evaluation that assumes `--max-budget-usd` semantics is testing the wrong signal.
- No engine-fact spikes are load-bearing for this phase — it builds entirely on already-adjudicated 02/04/13/14 abstractions, not raw Claude Code flags; nothing here needs a `docs/engine-baseline.md` citation.
