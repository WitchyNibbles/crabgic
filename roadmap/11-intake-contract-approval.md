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
- **Approval:** CLI terminal prompt (or explicitly-confirmed `/eo:approve`) renders contract + plan +
  provisional perf budgets + connector mutation previews + manifest → mints one-time token via 09's minting
  mechanism; MCP `contract.approve` only **verifies** — the model can never satisfy its own gate. Amendments
  create new envelope versions requiring delta re-approval.
- **Stop conditions enforced:** material amendment, expanded authority, critical security issue, unsafe
  overlap, irreducible product decision, exhausted repairs, blocking verification. New requests → separate
  `ChangeSet` unless explicit amendment.

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
   (`GATEWAY_MCP_SERVER_NAME = "eo_gateway"`, constant owned by 02 — Gap 11).
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
   `mcp__eo_gateway__contract.approve` with no token fails closed.
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
legitimately allows `mcp__eo_gateway__*` (Appendix B's own worker profile) still cannot satisfy
`contract.approve` without the token payload, proving the tool itself enforces the gate rather than relying
on the allow-list; envelope-tamper fixture — mutating one byte of a stored envelope after token mint
invalidates the binding.

## Exit criteria

- [ ] E2E (fake engine): request → contract → approval → run; halts correctly on each of the 7 seeded stop
      conditions (named suite, e.g. `intake.e2e.spec`).
- [ ] Model self-approval fixture fails closed; worker-context `mcp__eo_gateway__contract.approve` call
      without a token fails closed (named adversarial fixtures).
- [ ] Envelope hash stable across repeat builds of an unchanged fixture; amendment produces a distinct hash
      and invalidates the prior token (property test + golden fixture).
- [ ] Unmapped requirement blocks the `ready` transition (unit test against 02's state machine).
- [ ] `project.inspect` returns a valid partial report with no 07/12 data journaled yet, and correct
      ChangeSet-state answers across a fixture set spanning every 02 run-lifecycle stage (Gap 1 clause).
- [ ] Golden `IntentContract`/DAG/`AuthorizationEnvelope`/`CapabilityManifest` fixtures byte-stable across
      two builds.
- [ ] `ChangeSet` creation idempotent: re-inspecting an unchanged repo never produces a second `ChangeSet`
      (journal-verified).

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
