# Phase 11 — Intake, IntentContract, approval envelope flow

| | |
|---|---|
| **Depends on** | 06, 09, 10 |
| **Unlocks** | 13; transitively, 23 (no direct 11→23 edge — 23's own "Depends on: all" header includes 11, but the mermaid graph's simplified inbound edges to 23 are 08/15/19/21/22 only) |
| **Sources** | original plan "Intent contract and approval"; adaptation §0 (auth/budget policy), §5.5 (approval flow, gateway tool list), §9 (EngineAdapter capabilities), Appendix B (worker permission profile), §10 risks 9/10 |
| **Primary package** | `packages/supervisor`, `packages/plugin`, `packages/cli` |

## Goal

The one-approval workflow: read-only inspection over whatever the journal already holds produces a
decision-complete `IntentContract`, DAG, `AuthorizationEnvelope`, and `CapabilityManifest` for a new
`ChangeSet`; a single human approval (CLI prompt or `/eo:approve`) mints an envelope-bound token that no
model-driven call can mint for itself; any of seven named stop conditions forces a fresh approval instead of
silent continuation. Done means: an approved `ChangeSet` carrying a currently-valid token is the only thing
13's scheduler is ever allowed to dispatch.

## In scope

- **`project.inspect`:** read-only repo/stack/connection summary — 07 freeze when a control clone exists, 12
  detection when available; graceful degradation before 12 (and before any freeze exists): both are soft
  reads of already-journaled state, not phase-code dependencies. **Also answers ChangeSet-state queries; no
  separate `change_set.*` tool family exists.**
- **Contract assembly:** stable requirement IDs; scope/non-goals/audience/compatibility/security/performance/
  observability/rollout/acceptance; bidirectional requirement ↔ work-unit/artifact/test/evidence mapping.
- **`ChangeSet` lifecycle:** exactly one `ChangeSet` created per intake request; `draft → awaiting_approval`
  on completion; re-inspecting an unchanged repo state is idempotent (no duplicate `ChangeSet`).
- **Planning outputs:** decision-complete DAG, roster (role → model, balanced routing), write ownership,
  integration order, rollback strategy.
- **AuthorizationEnvelope:** commands, paths, network destinations, credential references, dependencies,
  remote resources (high-impact flags surfaced using 02's canonical labels, e.g. `closing transitions`,
  `bulk mutations` — never a connector-specific gloss), temporary services, prohibited actions; canonical
  hash-stable form.
- **CapabilityManifest:** digest-pinned skills/plugins/hooks/MCP servers/external tools; folds in 12's
  quarantine entries and 10's own plugin manifest entry when present — same graceful-degradation posture as
  `project.inspect`.
- **Approval (amended 2026-07-28 — ledger Gap 18):** routine approval is **standing, over an envelope
  class**, not per ChangeSet. 10's `install` writes an `EnvelopePolicy`; at dispatch (13) the compiled
  `AuthorizationEnvelope` is tested for **containment** in it. Contained → no prompt, no token, the run
  proceeds. Not contained → `expanded_authority` below halts it, all-or-nothing, never a partial grant of the
  contained subset. **No session-reachable surface may write or widen the policy** — that, not the prompt, is
  now what makes "the model can never satisfy its own gate" true. The rendering obligation is unchanged and
  moves to `install`: contract + plan + provisional perf budgets + connector mutation previews + manifest are
  still shown in full, once, to the human who confirms the policy. 09's minting mechanism and MCP
  `contract.approve` (still **verify-only**) are retained for the escalation paths — an out-of-policy
  envelope, 12's capability quarantine, 22's learning promotion. Amendments still create new envelope
  versions; a new version is re-checked against the policy, and needs a human only if it leaves it.
- **Stop conditions enforced:** material amendment, expanded authority, critical security issue, unsafe
  overlap, irreducible product decision, exhausted repairs, blocking verification. New requests → separate
  `ChangeSet` unless explicit amendment. **These seven are also the manager session's complete list of
  legitimate reasons to stop** — 10's manager operating protocol renders them (keyed by this phase's own
  `STOP_CONDITION_KINDS` strings, parity-tested in `packages/cli`) into the managed `CLAUDE.md` block, and
  10's Stop autonomy gate refuses to end a turn while a run is in flight for any other reason. Exactly one
  of the seven — `irreducible_product_decision` — is a QUESTION put to the owner rather than a halt, and
  it is asked with `AskUserQuestion` (`docs/engine-baseline.md` §18), never as a plain-text option list.
  See interface-ledger Gap 17.
  **Two of the seven carry 2026-07-28 amendments.** `expanded_authority` is now also the halt for an
  envelope that fails the `EnvelopePolicy` containment check, which makes it the *routine* escalation path
  rather than a rare one (Gap 18). And `exhausted_repairs` is explicitly **not** the bound on an adversarial
  review loop: it counts attempts against gates on one WorkUnit (initial + 2, unchanged), while a review
  round is read-only and spends no attempt — see 13 and Gap 19. Conflating the two either caps quality
  convergence at three rounds or makes real gate failures unbounded.

  **`irreducible_product_decision` gains a second trigger (2026-07-29, Gap 19 amended).** It is now also
  where a review stage goes when its progress budget is spent — a round that closes no blocking finding, or
  the fifth round, whichever comes first. This is deliberate reuse rather than a new stop condition: the
  situation is already the one this condition describes, since a stage that cannot close its own blocking
  findings has reached a judgement no amount of further reading decides. It is the only stop condition that
  asks the human rather than halting, which is the behaviour a stalled stage needs.

## Out of scope

- Worker dispatch, DAG execution, task-packet construction/caching, model-routing defaults (→ 13).
- `tracker.*`/`observability.*` gateway tool implementations and the connector transport itself (→ 16).
- `capability.audit`/`capability.approve` gateway tools — owned and registered by 12 (`packages/detect`), not
  11, despite sharing the same tool registry.
- Stack-detection heuristics and the capability-quarantine pipeline itself (→ 12) — 11 only reads their
  output when present.
- Control-clone/worktree/freeze mechanics themselves (→ 07) — 11 only reads freeze records when present.
- CLI argument parsing, doctor checks, and the generic approval-prompt/HMAC-minting primitive (→ 09) — 11
  supplies the contract-specific content rendered through it.
- Plugin packaging, marketplace distribution, `.mcp.json` authoring (→ 10).
- Quality/security gate execution and `EvidenceRecord` emission (→ 14).
- A `change_set.*` MCP tool family — deliberately does not exist anywhere in v1 (Gap 1 resolution);
  `project.inspect` is the sole ChangeSet-state read surface.

## Interfaces produced

1. MCP tools registered into the `gateway mcp` tool registry (Gap 1 + Gap 2, registry exposed by 09 atop
   16's extensible registry): **`project.inspect`** (read-only repo/stack/connection/ChangeSet-state summary)
   and **`contract.approve`** (verify-only — checks a supervisor-minted token, never mints one). Wire names
   `mcp__${GATEWAY_MCP_SERVER_NAME}__project.inspect`, `mcp__${GATEWAY_MCP_SERVER_NAME}__contract.approve`
   (`GATEWAY_MCP_SERVER_NAME = "crabgic_gateway"`, constant owned by 02 — Gap 11).
2. `ChangeSet` (02) creation — 11 is the phase that instantiates ChangeSets, one per intake,
   `draft → awaiting_approval` on completion. Consumed by 05 (registries), 09 (`evidence`/`cancel
   <change-set-id>`), 15 (PerformanceContract evaluation), 21 (connector evidence integration).
3. `IntentContract` (02) instance + stable `Requirement` (02) IDs, with the bidirectional requirement ↔
   work-unit/artifact/test/evidence mapping. `IntentContract` consumed by 18 (Jira requirement sync), 21;
   `Requirement` IDs consumed by 14 (requirement → evidence resolution), 21.
4. Decision-complete DAG: `WorkUnit` (02) graph + roster (role → model) + write ownership + integration order
   + rollback strategy. Consumed by 04 (journal typing), 05 (registries), 06 (`session_id` assignment), 13
   (executor readiness + router).
5. `AuthorizationEnvelope` (02) instance, canonical hash-stable. Consumed by 09 (this is what the
   approval-prompt renders for the human), 03's compiler (invoked at dispatch time inside 06), 13 (TaskPacket
   owned paths/constraints/resource limits).
6. `CapabilityManifest` (02) instance, digest-pinned. Consumed by 23's release checklist; assembled from 12's
   quarantine entries and 10's plugin entry when present (see In scope).
7. One-time approval token, bound to the exact envelope hash — minted via 09's mechanism at 11's request;
   gates the existing `awaiting_approval → ready` transition; verified (never minted) by `contract.approve`;
   journaled as `approval_token_mint`, one of 02's 13 `JournalEntryType` members (Gap 5).
8. Amendment flow: a material change to an approved envelope produces a new, distinctly-hashed
   `AuthorizationEnvelope` version and invalidates the prior approval token; a fresh mint/verify cycle is
   required before any dispatch against the amended plan.
9. Stop-condition triggers: the seven named conditions above drive existing 02 run-lifecycle transitions
   (→ `blocked` or → `awaiting_approval`) inside `packages/supervisor`; no new state-machine states are added
   — 02's enum is unchanged.

## Interfaces consumed

**From 06 (`packages/engine-claude`):**
- `EngineAdapter.capabilities()` — `engineVersion`, `supportsJsonSchema`, `supportsSessionResume` (field
  names per Gap 7) — read at approval-preview time to populate `CapabilityManifest`'s pinned-engine entry and
  to caption `PerformanceContract` budget previews; 06's pinned baseline range is rendered alongside the plan
  so the human sees actual engine-version exposure, not just requirement text.

**From 09 (`packages/cli`):**
- Approval-token minting mechanism — terminal-prompt rendering of envelope digests + HMAC token minted and
  bound to the envelope hash, journaled (09 work item 6, explicitly "consumed in 11" per 09's own text). 11
  supplies the contract/plan/budget/mutation-preview/manifest content rendered through it; 09 owns the
  generic mint/expire/single-use machinery.
- `run` CLI command surface + typed UDS client — 11 implements the pre-dispatch intake → contract → approval
  sequence that `run` invokes before handing an approved `ChangeSet` to 13.
- `gateway mcp` command's extensible tool registry (Gap 2) — 11 registers `project.inspect`/`contract.approve`
  into it at 11's build time; full 8-family registry completeness remains a phase-23 gate.

**From 10 (`packages/plugin`):**
- Manager operating protocol (`buildManagerProtocolBlock()`, `MANAGER_STOP_CONDITIONS`) — the
  manager-facing rendering of this phase's seven stop conditions and approval gates, plus the Stop
  autonomy gate that enforces "do not stop mid-run for any other reason" (ledger Gap 17).
- `/eo:approve` skill — the only non-CLI approval trigger; a thin wrapper reaching the same verify-only
  `contract.approve` path, never a bare model-satisfiable call.
- `eo-explore`, `eo-reviewer` subagents — manager-session read-heavy exploration and drafting review used
  while assembling `project.inspect` summaries and `IntentContract`/DAG drafts.
- Plugin's own `CapabilityManifest` entry — folded into the ChangeSet-level manifest 11 assembles.

**Ambient, via `packages/contracts` (02):** foundational schema package on the critical path ahead of every
phase in Depends-on (00/01 → 02 → 03/04 → 05 → 06 → 11); not a direct Depends-on edge, matching the same
convention already used by 05/06/07/09/10's own consumption of 02.
- Schemas instantiated: `IntentContract`, `Requirement`, `AuthorizationEnvelope`, `CapabilityManifest`,
  `ChangeSet`, `WorkUnit`, `PerformanceContract` (provisional budgets), `ProjectProfile`, `StackEvidence`
  (read, never written, here).
- Run-lifecycle states transitioned into/out of: `draft`, `awaiting_approval`, `ready`, `blocked`,
  `cancelled`.
- `GATEWAY_MCP_SERVER_NAME` constant (Gap 11) — wire-level tool naming.
- `JournalEntryType` member `approval_token_mint` (Gap 5) — the entry type the token-mint mechanism writes.
- High-impact capability-flag labels — surfaced verbatim using 02's canonical set (Gap 10), never a
  connector-specific gloss.

## Work items

1. `project.inspect` aggregator + report schema: reads journal-persisted freeze/`StackEvidence` when
   present, degrades gracefully otherwise; also serves ChangeSet-state queries (Gap 1). Failing-first:
   empty-journal fixture (fresh repo, no 07/12 data yet) returns a valid partial report, not an error.
2. Contract/DAG/envelope/manifest builders with canonical hashing; manager-session drafting flow via
   `eo-explore`/`eo-reviewer` (10) and gateway tools. Failing-first: two builds of an identical fixture repo
   produce byte-identical envelope hashes; a one-field mutation changes the hash.
3. `ChangeSet` creation wired to the `draft → awaiting_approval` transition, idempotent on unchanged repo
   state. Failing-first: re-inspecting an unchanged repo never creates a second `ChangeSet`.
4. Approval-token lifecycle end-to-end against 09's minting mechanism; `contract.approve` registered as
   verify-only into the `gateway mcp` registry. Failing-first: a scripted worker-context call to
   `mcp__crabgic_gateway__contract.approve` with no token fails closed.
5. Amendment diff + re-approval: material change → new envelope hash → prior token invalidated → fresh mint
   required. Failing-first: approve, amend, then replay the *old* token — must fail.
6. Stop-condition detectors in the supervisor state machine, one fault-injection fixture per condition (7
   total). Failing-first: each seeded condition halts the run via the correct existing 02 transition and no
   other.

## Test plan

**Unit:** canonical-hash stability and perturbation-sensitivity of `AuthorizationEnvelope`; `Requirement` ID
uniqueness/stability across re-inspection; `ChangeSet`-creation idempotency.

**Property:** fast-check over random requirement sets — bidirectional requirement ↔ work-unit/artifact/test/
evidence mapping never orphans an entry; token properties (single-use, expiry, hash-binding) hold under
randomized amendment sequences.

**Integration (fake engine / fake supervisor):** E2E request → contract → approval → run halting correctly
on each of the 7 seeded stop conditions independently; graceful-degradation fixture (no 07/12 data yet);
unmapped requirement blocks `ready`.

**Conformance:** hand-reviewed golden `IntentContract`/DAG/`AuthorizationEnvelope`/`CapabilityManifest`
fixtures, byte-stable across two builds (mirrors 02's schema byte-stability criterion).

**Security:** model self-approval fixture — any model-originated `contract.approve` call without a
supervisor-minted token fails closed; worker-context adversarial fixture — a worker whose compiled envelope
legitimately allows `mcp__crabgic_gateway__*` (Appendix B's own worker profile) still cannot satisfy
`contract.approve` without the token payload, proving the tool itself enforces the gate rather than relying
on the allow-list; envelope-tamper fixture — mutating one byte of a stored envelope after token mint
invalidates the binding.

## Exit criteria

**CLOSED 2026-08-02, evidenced.** All seven criteria walked individually against recorded evidence
(criteria-closeout pass, batch 2; machine-readable index:
`docs/evidence/criteria-closeout/phase-11.json`). Shared citations reused by several boxes below:
`CI / unit-test+coverage (ubuntu-24.04-arm)` job
[91423926939](https://github.com/WitchyNibbles/crabgic/actions/runs/30720547145), green at `af46e00`,
whose step log names every suite cited here (run summary ` Test Files 623 passed (623)` /
`      Tests 6060 passed | 1 skipped (6061)`); and seven scoped local re-runs committed verbatim as
`docs/evidence/phase-11/closeout-c<k>-*.txt`.

The walk was done against the merged tree rather than against `docs/evidence/phase-11/README.md`,
because intake changed three times after that note was written: ledger Gap 21 (`4f2b33b`) removed
`performanceBudgetSource`/`performanceBudgets` from `IntakeRequest` and added `ecosystem` to
`requestContentHash`; `bddac4c` (#47) added `UnknownEcosystemError` and the contradictory-direction
refusal at the intake boundary; `06693e5` (#48) added roadmap/24's per-path seal assertions. None of
the seven criteria names a removed field, and all three changes strengthen the suites they touch —
details per box below and in the index.

Two claims in `docs/evidence/phase-11/README.md` have since gone stale. They back no criterion here
and that file is outside this pass's write set, so they are recorded rather than edited: (a) its
"Carry-forwards from prior phases" bullet on 12's `trust review|approve|revoke` CLI wiring says the
three verbs "still return the typed `NOT_IMPLEMENTED` shape in `dispatch.ts`" — that wiring landed in
`01ae7aa` (2026-07-25), is ticked as phase 12's exit criterion 6, and `docs/operator-guide.md` §5 was
corrected for the same reason in `6dd211b`; (b) its gate-results paragraph predates the three commits
above, so its test counts and coverage figures are historical.

- [x] E2E (fake engine): request → contract → approval → run; halts correctly on each of the 7 seeded stop
      conditions (named suite, e.g. `intake.e2e.spec`).
      — **Evidence (2026-08-02):** `packages/cli/src/intake/intake.e2e.test.ts:221` — `it.each` over
      `STOP_CONDITION_KINDS` drives a fresh run to `running` and asserts `blocked` for each of the seven;
      `packages/supervisor/src/intake/stop-conditions.test.ts:56` adds "exactly one
      `adjudication_decision` journaled" per condition and `:94` pins the count at 7;
      `packages/cli/src/intake/closed-loop.e2e.test.ts:265` carries the "→ run" leg to a driven work unit
      under 03's `FakeEngineAdapter`; job
      [91423926939](https://github.com/WitchyNibbles/crabgic/actions/runs/30720547145);
      `docs/evidence/phase-11/closeout-c1-e2e-and-stop-conditions.txt`.
- [x] Model self-approval fixture fails closed; worker-context `mcp__crabgic_gateway__contract.approve` call
      without a token fails closed (named adversarial fixtures).
      — **Evidence (2026-08-02):** `packages/cli/src/intake/contract-approve-handler.test.ts:128` (model
      self-approval fixture) and `:155` (worker-context fixture), both asserting `approved === false` with
      the ChangeSet still `awaiting_approval`, against the positive control at `:274`;
      `packages/cli/src/approval/durable-approval-ledger.test.ts:67`/`:171`;
      `packages/cli/src/gateway-mcp/build-tool-registry.test.ts:171` invokes the same handler through the
      real production registry. Scope recorded in the index: no test crosses the MCP stdio transport, and
      "worker-context" is modelled by an empty token rather than a compiled Appendix-B profile;
      `docs/evidence/phase-11/closeout-c2-self-approval-fails-closed.txt`.
- [x] Envelope hash stable across repeat builds of an unchanged fixture; amendment produces a distinct hash
      and invalidates the prior token (property test + golden fixture).
      — **Evidence (2026-08-02):** `packages/supervisor/src/intake/envelope-builder.test.ts:41`
      (two-build byte-identical), `:127` (the named fast-check property, 200 runs, stability +
      perturbation-sensitivity), `:58` (one-field mutation);
      `packages/supervisor/src/intake/amendment.test.ts:54` (distinct hash, ChangeSet repointed, envelope
      durably stored); `packages/cli/src/approval/durable-approval-ledger.test.ts:77` (the phase's own
      "envelope-tamper / amendment fixture" — the prior token fails against the amended digest);
      `packages/cli/src/intake/contract-approve-handler.test.ts:242` (the digest is re-derived from the
      ChangeSet's current envelope, which is what makes a repoint invalidate the token in the real call
      path); golden `packages/supervisor/goldens/authorization-envelope.json`;
      `docs/evidence/phase-11/closeout-c3-envelope-hash-and-amendment.txt`.
- [x] Unmapped requirement blocks the `ready` transition (unit test against 02's state machine).
      — **Evidence (2026-08-02):** `packages/supervisor/src/intake/readiness-gate.test.ts:31` —
      `UnmappedRequirementError` with zero `run_transition` journal entries and no state change; `:54` the
      full-coverage positive control; `:124` proves `@crabgic/contracts`' own `IllegalTransitionError`
      remains the arbiter once coverage passes, which is the "against 02's state machine" clause;
      `packages/cli/src/intake/contract-approve-handler.test.ts:405` reaches the same gate through
      `contract.approve`; `docs/evidence/phase-11/closeout-c4-unmapped-requirement-blocks-ready.txt`.
- [x] `project.inspect` returns a valid partial report with no 07/12 data journaled yet, and correct
      ChangeSet-state answers across a fixture set spanning every 02 run-lifecycle stage (Gap 1 clause).
      — **Evidence (2026-08-02):** `packages/supervisor/src/intake/project-inspect.test.ts:24` (empty
      journal → `freeze`/`stackEvidence` undefined, non-empty `degraded`, no throw), `:116` (a fixture per
      member of `RUN_LIFECYCLE_STATES`, all 11, queried individually and via the unscoped listing), `:139`
      (unknown id degrades rather than throws), with `:34`/`:93` as the controls proving a populated
      journal is not reported as degraded; `packages/cli/src/gateway-mcp/build-tool-registry.test.ts:138`
      is the Gap 1 negative control — exact set equality over the shipped tool names, with no
      `change_set.*` family present; `docs/evidence/phase-11/closeout-c5-project-inspect.txt`.
- [x] Golden `IntentContract`/DAG/`AuthorizationEnvelope`/`CapabilityManifest` fixtures byte-stable across
      two builds.
      — **Evidence (2026-08-02):** `packages/supervisor/src/intake/goldens/generate-golden-artifacts.test.ts:21`
      byte-diffs each freshly-built artifact against the file a previous build committed under
      `packages/supervisor/goldens/`; `:29` adds two consecutive in-process builds; `:42` pins the artifact
      count at 6 so the generated per-artifact tests cannot silently become zero. All four named artifacts
      are in the set (`generate-golden-artifacts.ts:24-40`). Re-verified after ledger Gap 21 regenerated
      three of the six goldens; `docs/evidence/phase-11/closeout-c6-golden-byte-stability.txt`.
- [x] `ChangeSet` creation idempotent: re-inspecting an unchanged repo never produces a second `ChangeSet`
      (journal-verified).
      — **Evidence (2026-08-02):** `packages/supervisor/src/intake/intake-pipeline.test.ts:161` — a second
      identical `runIntake` returns `replayed` with one ChangeSet, exactly one `remote_operation_record`
      and exactly one `run_transition` in the journal; `:185` proves the same across a simulated process
      boundary (fresh empty registries, same journal); `:204` is the changed-content control (`conflict`,
      still one ChangeSet) and `:96` the creation control; `:317` pins ledger Gap 21's new
      `IntakeRequest.ecosystem` into `requestContentHash` rather than letting it escape the idempotency
      key; `docs/evidence/phase-11/closeout-c7-changeset-idempotency.txt`.

## Risks & open questions

- Approval rendering must make high-impact capabilities and remote-mutation previews visually prominent —
  informed one-shot approval is the whole safety story.
- Adaptation §10 risk 9 (subscription-auth budget semantics): the approval preview's `PerformanceContract`
  budgets must present token/turn caps as authoritative and any USD figures as informational only — a human
  misreading a dollar figure as a hard cap is a real UX failure mode, not just a documentation nit.
- Verify-at-build-time (§10 risk 10, `MAX_MCP_OUTPUT_TOKENS` unconfirmed): `project.inspect`'s report payload
  must enforce its own result-size budget in the tool implementation, mirroring 16's gateway-side approach,
  rather than depending on an unconfirmed harness-side limit.
- Until 06 lands for real, `EngineAdapter.capabilities()` values used in the approval preview come from 03's
  fake engine; confirm fake-vs-real capability parity (06's own exit criterion) before trusting 11's rendered
  engine-version/capability claims in production.
- Amendment/re-approval against an already-`running` `ChangeSet` must hand off cleanly to 13's executor
  (which owns dispatch); the exact halt-then-resume coordination between 11 minting a new envelope and 13
  noticing it is not fully specified by the source material — flagged for whoever lands 13's consumption
  path, not silently resolved here.
